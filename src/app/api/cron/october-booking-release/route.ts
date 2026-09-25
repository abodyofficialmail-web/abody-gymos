import { DateTime } from "luxon";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";

export const maxDuration = 300;

const TZ = "Asia/Tokyo";
const RELEASE_DATE = "2026-09-26";
const RELEASE_HOUR = 18;
const MONTH_START = "2026-10-01";
const MONTH_END = "2026-10-31";
const STORES = ["恵比寿", "上野", "新宿", "桜木町"];
const LEDGER_REASON = "october_public_release_line";
const INCLUDE_HIATUS = new Set(["SAK012"]);
const EXCLUDE_NAMES = new Set(["松本瑞生", "北山潤美", "浅野清香", "川畠絢子"]);

const MESSAGE = `【10月のご予約を解放しました📅】

いつもご利用いただきありがとうございます😊

10月分のご予約を解放いたしました！

10月は、常に2コマ先までご予約いただけます。

【他店舗利用について】
・1店舗のみご利用の場合は、これまで通り受け放題でご利用いただけます。
・他店舗をご利用される場合は、週3回までのご利用となります。（翌週にリセットされます。）

【30分セッションをご利用の会員様へ】
・30分セッションは、受け放題でご利用いただけます。
・月10コマは保証しております。
・10コマに満たない場合は、60分セッションを入れて10コマになるようご予約いただいて大丈夫です。
・ご予約が取りづらい場合は、お気軽にご連絡ください。

【10コマプランをご利用の会員様へ】
・1ヶ月あたり10コマまでのご予約です。
・60分セッションは、30分セッション2コマ分としてカウントいたします。
・そのため、60分セッションは1ヶ月あたり5回までです。
・同じ日は2コマまでです。60分セッションは1日1回までとなります。

【60分受け放題をご利用の会員様へ】
・60分セッションを、回数の上限なくご利用いただけます。
・60分セッションは、30分セッション2コマ分としてカウントいたします。
・常に4コマ先までご予約いただけます。60分セッションなら、2回先までです。
・同じ日は2コマまでです。60分セッションは1日1回までとなります。

ご希望のお時間は埋まりやすくなりますので、お早めのご予約をおすすめいたします。

ご不明な点がございましたら、お気軽にご連絡ください😊`;

function mustCronAuth(req: Request): boolean {
  const reportSecret = process.env.REPORT_CRON_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (reportSecret && got === reportSecret) return true;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  return false;
}

function normName(name: string | null | undefined): string {
  return String(name ?? "").replace(/\s/g, "");
}

async function pushLine(token: string, to: string, text: string) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: body.slice(0, 180) };
}

export async function GET(req: Request) {
  try {
    if (!mustCronAuth(req)) return jsonResponse({ error: "unauthorized" }, 401);
    const now = DateTime.now().setZone(TZ);
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    if (!force && (now.toISODate() !== RELEASE_DATE || now.hour < RELEASE_HOUR)) {
      return jsonResponse({ ok: true, skipped: true, now: now.toISO() });
    }

    const supabase = createSupabaseServiceClient();
    const { data: stores, error: storeErr } = await supabase.from("stores").select("id,name").in("name", STORES);
    if (storeErr) return jsonResponse({ error: storeErr.message }, 500);
    const storeIds = (stores ?? []).map((s) => s.id);
    if (storeIds.length !== STORES.length) {
      return jsonResponse({ error: "store_missing", found: (stores ?? []).map((s) => s.name) }, 500);
    }

    const { data: updated, error: shiftErr } = await supabase
      .from("trainer_shifts")
      .update({ status: "confirmed" })
      .in("store_id", storeIds)
      .gte("shift_date", MONTH_START)
      .lte("shift_date", MONTH_END)
      .eq("status", "draft")
      .or("is_break.is.null,is_break.eq.false")
      .select("id");
    if (shiftErr) return jsonResponse({ error: shiftErr.message }, 500);

    const { data: members, error: memberErr } = await supabase
      .from("members")
      .select("id,member_code,name,membership_status,line_user_id,line_channel_key")
      .or("membership_status.eq.active,member_code.eq.SAK012");
    if (memberErr) return jsonResponse({ error: memberErr.message }, 500);

    const candidates = (members ?? []).filter((m) => {
      const name = normName(m.name);
      if (EXCLUDE_NAMES.has(name) || /テスト/.test(name)) return false;
      if (!m.line_user_id) return false;
      if (m.membership_status !== "active" && !INCLUDE_HIATUS.has(String(m.member_code))) return false;
      return true;
    });

    const ids = candidates.map((m) => m.id);
    const already = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { data: prior, error: priorErr } = await (supabase as any)
        .from("member_ticket_ledger")
        .select("member_id")
        .eq("reason", LEDGER_REASON)
        .in("member_id", chunk);
      if (priorErr) return jsonResponse({ error: priorErr.message }, 500);
      for (const row of prior ?? []) already.add(row.member_id);
    }

    const sent: string[] = [];
    const failed: Array<{ member_code: string; error: string }> = [];
    const skipped: string[] = [];
    for (const member of candidates) {
      if (already.has(member.id)) {
        skipped.push(String(member.member_code));
        continue;
      }
      const line = linePushTokenForMemberRow(member);
      if (!line.token || !member.line_user_id) {
        failed.push({ member_code: String(member.member_code), error: "no_token" });
        continue;
      }
      const pushed = await pushLine(line.token, member.line_user_id, MESSAGE);
      if (!pushed.ok) {
        failed.push({ member_code: String(member.member_code), error: pushed.body || String(pushed.status) });
        continue;
      }
      const { error: ledErr } = await (supabase as any).from("member_ticket_ledger").insert({
        member_id: member.id,
        delta: 0,
        reason: LEDGER_REASON,
        note: RELEASE_DATE,
      });
      if (ledErr) {
        failed.push({ member_code: String(member.member_code), error: `sent_but_log_failed:${ledErr.message}` });
        continue;
      }
      sent.push(String(member.member_code));
      await new Promise((r) => setTimeout(r, 120));
    }

    return jsonResponse({
      ok: failed.length === 0,
      released: (updated ?? []).length,
      sent: sent.length,
      skipped: skipped.length,
      failed,
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
