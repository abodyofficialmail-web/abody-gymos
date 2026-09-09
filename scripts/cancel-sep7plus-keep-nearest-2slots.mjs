/**
 * 最終リスト13名のうち #4・#8・#10・#12 以外について、
 * 9/7〜9/30 の予約のうち「9/7に最も近い2コマ（30分単位）」以外をキャンセル。
 *
 *   node --env-file=.env.local scripts/cancel-sep7plus-keep-nearest-2slots.mjs --dry-run
 *   node --env-file=.env.local scripts/cancel-sep7plus-keep-nearest-2slots.mjs --confirm
 *   node --env-file=.env.local scripts/cancel-sep7plus-keep-nearest-2slots.mjs --confirm --send-line
 */
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import fs from "fs";
import path from "path";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const SLOT_MIN = 30;
const COUNT_START = "2026-09-07T00:00:00+09:00";
const COUNT_END = "2026-10-01T00:00:00+09:00";
const KEEP_SLOTS = 2;

/** 最終リスト13名（list-aug8-sep7plus-members 2026-09-06 時点） */
const FINAL_13 = [
  { no: 1, code: "SHI004", name: "川井えりか" },
  { no: 2, code: "SHI022", name: "ジャスミン" },
  { no: 3, code: "SHI018", name: "板谷敏生" },
  { no: 4, code: "SHI025", name: "武内千嘉" },
  { no: 5, code: "SHI026", name: "島崎裕烈" },
  { no: 6, code: "SHI027", name: "原田恵実" },
  { no: 7, code: "UEN011", name: "広瀬奈菜子" },
  { no: 8, code: "UEN054", name: "水谷友彦" },
  { no: 9, code: "SHI021", name: "月岡知子" },
  { no: 10, code: "SHI006", name: "澤田有人夢" },
  { no: 11, code: "SHI023", name: "鈴木昌輝" },
  { no: 12, code: "SHI002", name: "渡邉友哉" },
  { no: 13, code: "EBI008", name: "中村誠" },
];

/** キャンセル対象外（リスト番号） */
const SKIP_NOS = new Set([4, 8, 10, 12]);

function loadEnvFile(name) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (process.env[k]) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v) process.env[k] = v;
  }
}

loadEnvFile(".env.local");

function slotCount(startAt, endAt) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.round(ms / (SLOT_MIN * 60 * 1000)));
}

function fmtJst(iso) {
  return DateTime.fromISO(iso, { setZone: true }).setZone("Asia/Tokyo").toFormat("yyyy-MM-dd HH:mm");
}

function inRange(iso, start, end) {
  const t = new Date(iso).getTime();
  return t >= new Date(start).getTime() && t < new Date(end).getTime();
}

/** 9/7に最も近い順。同日内は開始時刻昇順 */
function sortNearestSep7(reservations) {
  return [...reservations].sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
}

/** 保持2コマ分を決定（予約単位・分割なし） */
function partitionKeepCancel(reservations) {
  const sorted = sortNearestSep7(reservations);
  const keep = [];
  const cancel = [];
  let keptSlots = 0;

  for (const r of sorted) {
    const slots = slotCount(r.start_at, r.end_at);
    if (keptSlots + slots <= KEEP_SLOTS) {
      keep.push(r);
      keptSlots += slots;
    } else {
      cancel.push(r);
    }
  }

  return { keep, cancel, keptSlots };
}

async function pushLineCancel({ token, to, storeName, startAt, endAt }) {
  if (!token || !to) return { sent: false, reason: "no_token_or_to" };
  const start = DateTime.fromISO(startAt, { setZone: true }).setZone("Asia/Tokyo");
  const end = DateTime.fromISO(endAt, { setZone: true }).setZone("Asia/Tokyo");
  const text = `【ご予約キャンセル】
店舗：${storeName}
日時：${start.setLocale("ja").toFormat("M月d日（ccc）")} ${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}

またのご予約をお待ちしております。`;
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { sent: false, reason: `line_failed_${res.status}`, body: body.slice(0, 200) };
  }
  return { sent: true };
}

function lineTokenForMember(member, storeName) {
  const key = String(member.line_channel_key ?? "").trim();
  if (key === "ueno") return process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO?.trim() || null;
  if (key === "sakuragicho") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO?.trim() || null;
  if (key === "shinjuku") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU?.trim() || null;
  if (key === "fukuoka") return process.env.LINE_CHANNEL_ACCESS_TOKEN_FUKUOKA?.trim() || null;
  if (key === "default") return process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() || null;

  const code = String(member.member_code ?? "").toUpperCase();
  if (code.startsWith("UEN")) return process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO?.trim() || null;
  if (code.startsWith("SAK")) return process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO?.trim() || null;
  if (code.startsWith("SHI") || code.startsWith("SHJ")) return process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU?.trim() || null;
  if (code.startsWith("FUK")) return process.env.LINE_CHANNEL_ACCESS_TOKEN_FUKUOKA?.trim() || null;
  return process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() || null;
}

async function main() {
  const dryRun = !process.argv.includes("--confirm");
  const sendLine = process.argv.includes("--send-line");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定");
    process.exit(1);
  }

  const targetMembers = FINAL_13.filter((m) => !SKIP_NOS.has(m.no));
  const targetCodes = new Set(targetMembers.map((m) => m.code));

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { rows: members } = await fetchAllChecked(
    supabase,
    "members",
    "id, member_code, display_name, name, line_user_id, line_channel_key, store_id",
    (q) => q.in("member_code", [...targetCodes]),
    "members.target",
  );

  const memberByCode = Object.fromEntries(
    members.map((m) => [String(m.member_code).toUpperCase(), m]),
  );

  const missing = targetMembers.filter((m) => !memberByCode[m.code]);
  if (missing.length) {
    console.warn("会員未登録:", missing.map((m) => m.code).join(", "));
  }

  const memberIds = members.map((m) => m.id);
  if (!memberIds.length) {
    console.error("対象会員が見つかりません");
    process.exit(1);
  }

  const { rows: stores } = await fetchAllChecked(supabase, "stores", "id, name", undefined, "stores");
  const storeNameById = Object.fromEntries(stores.map((s) => [s.id, s.name]));

  const { rows: reservations } = await fetchAllChecked(
    supabase,
    "reservations",
    "id, member_id, store_id, start_at, end_at, status, trainer_id",
    (q) =>
      q
        .in("member_id", memberIds)
        .gte("start_at", COUNT_START)
        .lt("start_at", COUNT_END)
        .neq("status", "cancelled"),
    "reservations.sep7plus",
  );

  const resByMemberId = new Map();
  for (const r of reservations) {
    const list = resByMemberId.get(r.member_id) ?? [];
    list.push(r);
    resByMemberId.set(r.member_id, list);
  }

  const summary = {
    mode: dryRun ? "dry-run" : "confirm",
    sendLine,
    range: "2026-09-07 〜 2026-09-30",
    keepSlots: KEEP_SLOTS,
    skipListNos: [...SKIP_NOS],
    targetMembers: targetMembers.map((m) => ({ no: m.no, code: m.code, name: m.name })),
    members: [],
    totals: { keepReservations: 0, cancelReservations: 0, keepSlots: 0, cancelSlots: 0 },
  };

  console.log(`\n=== ${dryRun ? "DRY-RUN" : "CONFIRM"} ===`);
  console.log(`対象: ${targetMembers.length}名（#${targetMembers.map((m) => m.no).join(", #")}）`);
  console.log(`期間: 9/7 0:00 〜 9/30 / 各会員 ${KEEP_SLOTS}コマのみ残す\n`);

  for (const tm of targetMembers) {
    const member = memberByCode[tm.code];
    if (!member) continue;

    const memberRes = (resByMemberId.get(member.id) ?? []).filter((r) =>
      inRange(r.start_at, COUNT_START, COUNT_END),
    );
    const { keep, cancel, keptSlots } = partitionKeepCancel(memberRes);
    const cancelSlots = cancel.reduce((s, r) => s + slotCount(r.start_at, r.end_at), 0);

    const entry = {
      listNo: tm.no,
      memberCode: tm.code,
      displayName: member.display_name ?? member.name ?? tm.name,
      totalReservations: memberRes.length,
      keepCount: keep.length,
      cancelCount: cancel.length,
      keepSlots: keptSlots,
      cancelSlots,
      keep: keep.map((r) => ({
        id: r.id,
        start: fmtJst(r.start_at),
        end: fmtJst(r.end_at),
        slots: slotCount(r.start_at, r.end_at),
        store: storeNameById[r.store_id] ?? "—",
      })),
      cancel: [],
    };

    summary.totals.keepReservations += keep.length;
    summary.totals.cancelReservations += cancel.length;
    summary.totals.keepSlots += keptSlots;
    summary.totals.cancelSlots += cancelSlots;

    console.log(`--- #${tm.no} ${tm.code} ${entry.displayName} ---`);
    console.log(`  予約 ${memberRes.length}件 → 残 ${keep.length}件(${keptSlots}コマ) / 取消 ${cancel.length}件(${cancelSlots}コマ)`);

    for (const r of keep) {
      console.log(`  [残] ${fmtJst(r.start_at)}-${fmtJst(r.end_at).slice(11)} (${slotCount(r.start_at, r.end_at)}コマ) ${storeNameById[r.store_id] ?? ""}`);
    }

    for (const r of cancel) {
      const storeName = storeNameById[r.store_id] ?? "—";
      console.log(`  [消] ${fmtJst(r.start_at)}-${fmtJst(r.end_at).slice(11)} (${slotCount(r.start_at, r.end_at)}コマ) ${storeName}`);

      const cancelResult = { id: r.id, start: fmtJst(r.start_at), end: fmtJst(r.end_at), store: storeName };

      if (!dryRun) {
        const { error: upErr } = await supabase
          .from("reservations")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("id", r.id);
        if (upErr) {
          cancelResult.error = upErr.message;
          console.error(`    ✗ DB更新失敗: ${upErr.message}`);
        } else {
          cancelResult.cancelled = true;
          console.log(`    ✓ キャンセル済`);

          if (sendLine && member.line_user_id) {
            const token = lineTokenForMember(member, storeName);
            const lineRes = await pushLineCancel({
              token,
              to: member.line_user_id,
              storeName,
              startAt: r.start_at,
              endAt: r.end_at,
            });
            cancelResult.line = lineRes;
            console.log(`    LINE: ${lineRes.sent ? "送信" : lineRes.reason}`);
            await new Promise((r) => setTimeout(r, 350));
          }
        }
      }

      entry.cancel.push(cancelResult);
    }

    if (!cancel.length && !keep.length) {
      console.log("  （9/7以降の予約なし）");
    }

    summary.members.push(entry);
  }

  console.log("\n--- サマリー ---");
  console.log(`残す予約: ${summary.totals.keepReservations}件 (${summary.totals.keepSlots}コマ)`);
  console.log(`${dryRun ? "取消予定" : "取消済"}: ${summary.totals.cancelReservations}件 (${summary.totals.cancelSlots}コマ)`);
  if (dryRun) {
    console.log("\n本番実行: node --env-file=.env.local scripts/cancel-sep7plus-keep-nearest-2slots.mjs --confirm");
    console.log("LINE通知付き:  ... --confirm --send-line");
  }

  console.log("\n" + JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
