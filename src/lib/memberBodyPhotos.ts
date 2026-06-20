import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const MEMBER_BODY_PHOTO_BUCKET = "member-body-photos";
export const BODY_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const BODY_PHOTO_SIGNED_URL_TTL_SEC = 3600;

export const BODY_PHOTO_ANGLES = ["front", "back", "side_left", "side_right"] as const;
export type BodyPhotoAngle = (typeof BODY_PHOTO_ANGLES)[number];

export const BODY_PHOTO_ANGLE_LABELS: Record<BodyPhotoAngle, string> = {
  front: "正面",
  back: "背面",
  side_left: "左横",
  side_right: "右横",
};

const ANGLE_PATH_COLUMN: Record<BodyPhotoAngle, keyof MemberBodyPhotoSetRow> = {
  front: "front_path",
  back: "back_path",
  side_left: "side_left_path",
  side_right: "side_right_path",
};

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "",
]);

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);

function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export type MemberBodyPhotoSetRow = Database["public"]["Tables"]["member_body_photo_sets"]["Row"];

export type MemberBodyPhotoSetView = {
  id: string;
  photo_date: string;
  front_url: string | null;
  back_url: string | null;
  side_left_url: string | null;
  side_right_url: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export function isBodyPhotoAngle(value: string): value is BodyPhotoAngle {
  return (BODY_PHOTO_ANGLES as readonly string[]).includes(value);
}

export function bodyPhotoStoragePath(memberId: string, photoDate: string, angle: BodyPhotoAngle): string {
  return `${memberId}/${photoDate}/${angle}.jpg`;
}

export function pathColumnForAngle(angle: BodyPhotoAngle): keyof MemberBodyPhotoSetRow {
  return ANGLE_PATH_COLUMN[angle];
}

export function validateBodyPhotoFile(file: File): string | null {
  const ext = fileExtension(file.name);
  const mimeOk = ALLOWED_MIME.has(file.type);
  const extOk = ext !== "" && ALLOWED_EXT.has(ext);
  if (!mimeOk && !extOk) {
    return "JPEG / PNG / WebP / HEIC の画像のみアップロードできます";
  }
  if (file.size > BODY_PHOTO_MAX_BYTES) {
    return "画像が大きすぎます（5MB以下）。別の写真をお試しください";
  }
  return null;
}

export function validatePhotoDateYmd(photoDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(photoDate)) {
    return "日付の形式が不正です";
  }
  const [y, m, d] = photoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return "日付が不正です";
  }
  return null;
}

async function signedUrlForPath(
  supabase: SupabaseClient<Database>,
  path: string | null
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(MEMBER_BODY_PHOTO_BUCKET)
    .createSignedUrl(path, BODY_PHOTO_SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function toBodyPhotoSetView(
  supabase: SupabaseClient<Database>,
  row: MemberBodyPhotoSetRow
): Promise<MemberBodyPhotoSetView> {
  const [front_url, back_url, side_left_url, side_right_url] = await Promise.all([
    signedUrlForPath(supabase, row.front_path),
    signedUrlForPath(supabase, row.back_path),
    signedUrlForPath(supabase, row.side_left_path),
    signedUrlForPath(supabase, row.side_right_path),
  ]);
  return {
    id: row.id,
    photo_date: row.photo_date,
    front_url,
    back_url,
    side_left_url,
    side_right_url,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listBodyPhotoSetsForMember(
  supabase: SupabaseClient<Database>,
  memberId: string,
  limit = 50
): Promise<MemberBodyPhotoSetView[]> {
  const { data, error } = await supabase
    .from("member_body_photo_sets")
    .select("*")
    .eq("member_id", memberId)
    .order("photo_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as MemberBodyPhotoSetRow[];
  return Promise.all(rows.map((row) => toBodyPhotoSetView(supabase, row)));
}

export async function deleteBodyPhotoSet(
  supabase: SupabaseClient<Database>,
  memberId: string,
  setId: string
): Promise<void> {
  const { data: row, error: fetchErr } = await supabase
    .from("member_body_photo_sets")
    .select("*")
    .eq("id", setId)
    .eq("member_id", memberId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) throw new Error("体型写真が見つかりません");

  const paths = BODY_PHOTO_ANGLES.map((angle) => row[pathColumnForAngle(angle)] as string | null).filter(
    Boolean
  ) as string[];
  if (paths.length > 0) {
    const { error: storageErr } = await supabase.storage.from(MEMBER_BODY_PHOTO_BUCKET).remove(paths);
    if (storageErr) throw storageErr;
  }

  const { error: deleteErr } = await supabase
    .from("member_body_photo_sets")
    .delete()
    .eq("id", setId)
    .eq("member_id", memberId);
  if (deleteErr) throw deleteErr;
}

export async function uploadBodyPhotoAngle(params: {
  supabase: SupabaseClient<Database>;
  memberId: string;
  photoDate: string;
  angle: BodyPhotoAngle;
  fileBytes: ArrayBuffer;
  contentType: string;
  trainerId?: string | null;
  note?: string | null;
}): Promise<MemberBodyPhotoSetView> {
  const { supabase, memberId, photoDate, angle, fileBytes, contentType, trainerId, note } = params;
  const storagePath = bodyPhotoStoragePath(memberId, photoDate, angle);
  const pathColumn = pathColumnForAngle(angle);
  const now = new Date().toISOString();

  const { error: uploadErr } = await supabase.storage.from(MEMBER_BODY_PHOTO_BUCKET).upload(storagePath, fileBytes, {
    contentType: contentType === "image/heic" || contentType === "image/heif" ? "image/jpeg" : contentType || "image/jpeg",
    upsert: true,
  });
  if (uploadErr) throw uploadErr;

  const { data: existing, error: existingErr } = await supabase
    .from("member_body_photo_sets")
    .select("*")
    .eq("member_id", memberId)
    .eq("photo_date", photoDate)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing) {
    const updatePayload: Database["public"]["Tables"]["member_body_photo_sets"]["Update"] = {
      [pathColumn]: storagePath,
      updated_at: now,
    };
    if (trainerId) updatePayload.uploaded_by_trainer_id = trainerId;
    if (note !== undefined) updatePayload.note = note;

    const { data: updated, error: updateErr } = await supabase
      .from("member_body_photo_sets")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (updateErr) throw updateErr;
    return toBodyPhotoSetView(supabase, updated as MemberBodyPhotoSetRow);
  }

  const insertPayload: Database["public"]["Tables"]["member_body_photo_sets"]["Insert"] = {
    member_id: memberId,
    photo_date: photoDate,
    [pathColumn]: storagePath,
    uploaded_by_trainer_id: trainerId ?? null,
    note: note ?? null,
    updated_at: now,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("member_body_photo_sets")
    .insert(insertPayload)
    .select("*")
    .single();
  if (insertErr) throw insertErr;
  return toBodyPhotoSetView(supabase, inserted as MemberBodyPhotoSetRow);
}
