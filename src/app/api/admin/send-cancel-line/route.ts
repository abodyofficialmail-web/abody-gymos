import { DateTime } from "luxon";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mustAuth(req: Request): boolean {
  const serviceKey = req.headers.get("x-service-role-key") ?? "";
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (expected && serviceKey === expected) return true;
  const cronSecret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (cronSecret && bearer === cronSecret) return true;
  return false;
}

function messageForAdminCancel(params: { storeName: string; startAtUtcIso: string; endAtUtcIso: string }): string {
  const start = DateTime.fromISO(params.startAtUtcIso).setZone("Asia/Tokyo");
  const end = DateTime.fromISO(params.endAtUtcIso).setZone("Asia/Tokyo");
  return `【ご予約キャンセル】
店舗：${params.storeName}
日時：${start.setLocale("ja").toFormat("M月d日（ccc）")} ${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}

またのご予約をお待ちしております。`;
}

const bodySchema = z.object({
  reservation_ids: z.array(z.string().uuid()).min(1),
  dry_run: z.boolean().optional(),
});

/** キャンセル済み予約のキャンセルLINEを送信（本番VercelのLINEトークン使用） */
export async function POST(req: Request) {
  try {
    if (!mustAuth(req)) return json({ error: "unauthorized" }, 401);

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const results: Array<Record<string, unknown>> = [];

    for (const reservationId of parsed.data.reservation_ids) {
      const { data: r, error } = await supabase
        .from("reservations")
        .select("id, member_id, store_id, start_at, end_at, status")
        .eq("id", reservationId)
        .maybeSingle();
      if (error || !r) {
        results.push({ reservation_id: reservationId, ok: false, error: error?.message ?? "not_found" });
        continue;
      }
      if (!r.member_id) {
        results.push({ reservation_id: reservationId, ok: false, error: "no_member" });
        continue;
      }

      const { data: member } = await supabase
        .from("members")
        .select("id, member_code, line_user_id, line_channel_key")
        .eq("id", r.member_id)
        .maybeSingle();
      const { data: store } = await supabase.from("stores").select("name").eq("id", r.store_id).maybeSingle();
      const storeName = store?.name ?? "—";

      if (!member?.line_user_id) {
        results.push({ reservation_id: reservationId, ok: false, error: "no_line_user_id", member_code: member?.member_code });
        continue;
      }

      const line = linePushTokenForMemberRow(member, storeName);
      if (!line.token) {
        results.push({ reservation_id: reservationId, ok: false, error: "no_line_token", member_code: member.member_code });
        continue;
      }

      const text = messageForAdminCancel({ storeName, startAtUtcIso: r.start_at, endAtUtcIso: r.end_at });

      if (parsed.data.dry_run) {
        results.push({ reservation_id: reservationId, ok: true, dry_run: true, member_code: member.member_code, storeName });
        continue;
      }

      const res = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${line.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to: member.line_user_id, messages: [{ type: "text", text }] }),
      });
      const body = await res.text().catch(() => "");
      results.push({
        reservation_id: reservationId,
        ok: res.ok,
        member_code: member.member_code,
        storeName,
        status: res.status,
        body: body.slice(0, 200),
      });
    }

    return json({
      ok: results.every((x) => x.ok),
      sent: results.filter((x) => x.ok && !x.dry_run).length,
      failed: results.filter((x) => !x.ok).length,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}
