import { z } from "zod";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { normalizeLineChannelKey } from "@/lib/lineChannel";
import { pushLineTextForMember } from "@/lib/lineMessagingPush";
import { notifyPaymentLinkSent } from "@/lib/paymentLinkNotify";
import { knownPaymentUrls } from "@/lib/paymentLinks";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  member_code: z.string().trim().min(1).max(32),
  text: z.string().trim().min(1).max(2000),
});

export async function POST(req: Request) {
  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonResponse({ error: "送信内容を確認してください" }, 400);

    const text = parsed.data.text;
    if (!knownPaymentUrls().some((url) => text.includes(url))) {
      return jsonResponse({ error: "文章に決済リンクが含まれていません" }, 400);
    }

    const code = parsed.data.member_code.toUpperCase();
    const supabase = createSupabaseServiceClient();
    const { data: member, error } = await supabase
      .from("members")
      .select("id, member_code, name, line_user_id, line_channel_key, store_id")
      .eq("member_code", code)
      .maybeSingle();
    if (error) return jsonResponse({ error: "会員の確認に失敗しました" }, 500);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);
    if (!member.line_user_id) {
      return jsonResponse({ error: "この会員はLINE未連携です。文章をコピーして送ってください。" }, 400);
    }

    let storeName: string | null = null;
    if (member.store_id) {
      const { data: store } = await supabase.from("stores").select("name").eq("id", member.store_id).maybeSingle();
      storeName = store?.name ?? null;
    }

    const pushed = await pushLineTextForMember({
      toUserId: member.line_user_id,
      text,
      memberCode: member.member_code,
      lineChannelKey: normalizeLineChannelKey(member.line_channel_key),
      storeName,
    });
    if (!pushed.ok) {
      return jsonResponse({ error: "LINEに送れませんでした。文章をコピーして送ってください。" }, 502);
    }

    const notify = await notifyPaymentLinkSent(supabase, {
      memberCode: member.member_code,
      memberName: member.name,
      storeName,
      sentText: text,
    });

    return jsonResponse({ ok: true, member_code: member.member_code, name: member.name, notify });
  } catch {
    return jsonResponse({ error: "送信に失敗しました" }, 500);
  }
}
