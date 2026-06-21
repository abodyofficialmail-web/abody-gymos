/**
 * 予約確定LINEを手動再送（本番トークンは vercel env run 推奨）
 *
 * usage:
 *   npx vercel env run --environment=production node scripts/resend-reservation-line.mjs EBI027
 *   npx vercel env run --environment=production node scripts/resend-reservation-line.mjs --test-token
 */
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { lineMessageWithReservationDetails } from "./lib/lineReservationMessage.mjs";

const TZ = "Asia/Tokyo";

function tokenForStoreName(storeName) {
  if (storeName === "上野") return process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO ?? null;
  if (storeName === "桜木町") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO ?? null;
  if (storeName === "新宿") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU ?? null;
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
}

async function pushLine({ to, text, token }) {
  if (!token) throw new Error("LINE access token が未設定です");
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`LINE push failed ${res.status}: ${body}`);
  return body;
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--test-token") {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    console.log("LINE_CHANNEL_ACCESS_TOKEN length:", token?.length ?? 0);
    if (!token) {
      console.error("トークンがありません");
      process.exit(1);
    }
    const res = await fetch("https://api.line.me/v2/bot/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.text();
    console.log("bot profile:", res.status, body);
    process.exit(res.ok ? 0 : 1);
  }

  const codes = arg ? [arg] : ["EBI027", "EBI029"];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  for (const memberCode of codes) {
    const { data: member, error: mErr } = await supabase
      .from("members")
      .select("id, member_code, name, line_user_id")
      .eq("member_code", memberCode)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!member?.line_user_id) {
      console.log(memberCode, "skip: no line_user_id");
      continue;
    }

    const { data: reservations, error: rErr } = await supabase
      .from("reservations")
      .select("id, start_at, end_at, session_type, status, stores(name)")
      .eq("member_id", member.id)
      .eq("status", "confirmed")
      .gte("start_at", DateTime.now().setZone(TZ).toISO() ?? "")
      .order("start_at", { ascending: true });
    if (rErr) throw rErr;

    if (!reservations?.length) {
      console.log(memberCode, "no upcoming confirmed reservations");
      continue;
    }

    for (const r of reservations) {
      const storeName = r.stores?.name ?? "恵比寿";
      const token = tokenForStoreName(storeName);
      const sessionType = r.session_type === "online" ? "online" : "store";
      const text = lineMessageWithReservationDetails({
        storeName,
        startAtUtcIso: r.start_at,
        endAtUtcIso: r.end_at,
        sessionType,
      });
      await pushLine({ to: member.line_user_id, text, token });
      const start = DateTime.fromISO(r.start_at).setZone(TZ);
      console.log("sent", memberCode, start.toFormat("M/d HH:mm"), "->", member.line_user_id);
    }
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
