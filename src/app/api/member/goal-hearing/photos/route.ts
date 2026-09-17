import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { MEMBER_BODY_PHOTO_BUCKET, validateBodyPhotoFile } from "@/lib/memberBodyPhotos";
import { goalHearingPhotoStoragePath } from "@/lib/goalHearing";
import { tokenKeyFromSigned, verifyGoalHearingSigned } from "@/lib/goalHearingSigned";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const s = String(form.get("s") ?? "");
    const sig = String(form.get("sig") ?? "");
    const indexRaw = String(form.get("index") ?? "0");
    const file = form.get("file");

    const signed = verifyGoalHearingSigned(s, sig);
    if (!signed) return json({ error: "リンクが無効または期限切れです" }, 400);

    const index = Number(indexRaw);
    if (!Number.isInteger(index) || index < 0 || index > 2) {
      return json({ error: "写真は最大3枚までです" }, 400);
    }
    if (!(file instanceof File)) return json({ error: "画像ファイルを選択してください" }, 400);

    const invalid = validateBodyPhotoFile(file);
    if (invalid) return json({ error: invalid }, 400);

    const supabase = createSupabaseServiceClient();
    const { data: member } = await supabase
      .from("members")
      .select("id, is_active")
      .eq("id", signed.member_id)
      .maybeSingle();
    if (!member?.id || !member.is_active) return json({ error: "会員が見つかりません" }, 404);

    const tokenKey = tokenKeyFromSigned(signed);
    const path = goalHearingPhotoStoragePath(member.id, tokenKey, index);
    const bytes = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await supabase.storage.from(MEMBER_BODY_PHOTO_BUCKET).upload(path, bytes, {
      contentType: file.type || "image/jpeg",
      upsert: true,
    });
    if (upErr) return json({ error: "画像の保存に失敗しました", detail: upErr.message }, 500);

    return json({ ok: true, path });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "アップロードに失敗しました" }, 500);
  }
}
