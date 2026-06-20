import { jsonResponse } from "@/app/api/booking-v2/_cors";
import {
  isBodyPhotoAngle,
  listBodyPhotoSetsForMember,
  uploadBodyPhotoAngle,
  validateBodyPhotoFile,
  validatePhotoDateYmd,
} from "@/lib/memberBodyPhotos";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET(_request: Request, ctx: { params: { memberId: string } }) {
  try {
    const memberId = ctx.params.memberId?.trim();
    if (!memberId) return jsonResponse({ error: "memberId が不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    const { data: member, error: memberErr } = await (supabase as any)
      .from("members")
      .select("id")
      .eq("id", memberId)
      .maybeSingle();
    if (memberErr) return jsonResponse({ error: "会員の取得に失敗しました", detail: memberErr.message }, 500);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);

    const sets = await listBodyPhotoSetsForMember(supabase, memberId);
    return jsonResponse({ sets }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const isMissingTable = message.includes("member_body_photo_sets") && message.includes("does not exist");
    if (isMissingTable) {
      return jsonResponse(
        {
          error: "体型写真の準備ができていません（member_body_photo_sets テーブルが未作成の可能性）",
          detail: message,
        },
        503
      );
    }
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}

export async function POST(request: Request, ctx: { params: { memberId: string } }) {
  try {
    const memberId = ctx.params.memberId?.trim();
    if (!memberId) return jsonResponse({ error: "memberId が不正です" }, 400);

    const formData = await request.formData();
    const photoDate = String(formData.get("photo_date") ?? "").trim();
    const angleRaw = String(formData.get("angle") ?? "").trim();
    const trainerId = String(formData.get("trainer_id") ?? "").trim() || null;
    const noteRaw = formData.get("note");
    const note = noteRaw == null ? undefined : String(noteRaw).trim() || null;
    const file = formData.get("file");

    const dateErr = validatePhotoDateYmd(photoDate);
    if (dateErr) return jsonResponse({ error: dateErr }, 400);
    if (!isBodyPhotoAngle(angleRaw)) return jsonResponse({ error: "angle が不正です" }, 400);
    if (!(file instanceof File)) return jsonResponse({ error: "画像ファイルが必要です" }, 400);

    const fileErr = validateBodyPhotoFile(file);
    if (fileErr) return jsonResponse({ error: fileErr }, 400);

    const supabase = createSupabaseServiceClient();
    const { data: member, error: memberErr } = await (supabase as any)
      .from("members")
      .select("id")
      .eq("id", memberId)
      .maybeSingle();
    if (memberErr) return jsonResponse({ error: "会員の取得に失敗しました", detail: memberErr.message }, 500);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);

    const fileBytes = await file.arrayBuffer();
    const set = await uploadBodyPhotoAngle({
      supabase,
      memberId,
      photoDate,
      angle: angleRaw,
      fileBytes,
      contentType: file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg",
      trainerId,
      note,
    });

    return jsonResponse({ set }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const isMissingTable = message.includes("member_body_photo_sets") && message.includes("does not exist");
    if (isMissingTable) {
      return jsonResponse(
        {
          error: "体型写真の準備ができていません（member_body_photo_sets テーブルが未作成の可能性）",
          detail: message,
        },
        503
      );
    }
    return jsonResponse({ error: "保存中にエラーが発生しました", detail: message }, 500);
  }
}
