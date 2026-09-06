/**
 * 最終リスト13名の #4・#8 について、9/7以降の「一番遠い日程」から枠を削除。
 *
 *   #4 SHI025 武内千嘉: 1枠
 *   #8 UEN054 水谷友彦: 2枠
 *
 *   node scripts/cancel-farthest-slots-4-8.mjs --dry-run
 *   node scripts/cancel-farthest-slots-4-8.mjs --confirm  # LINE送信付き
 */
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const SLOT_MIN = 30;
const COUNT_START = "2026-09-07T00:00:00+09:00";
const COUNT_END = "2026-10-01T00:00:00+09:00";
const PRODUCTION_API = process.env.MEMBER_PLANS_API_URL?.trim() || "https://abody-gymos.vercel.app";

const TARGETS = [
  { listNo: 4, code: "SHI025", name: "武内千嘉", cancelSlots: 1 },
  { listNo: 8, code: "UEN054", name: "水谷友彦", cancelSlots: 2 },
];

function slotCount(startAt, endAt) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.round(ms / (SLOT_MIN * 60 * 1000)));
}

function fmtJst(iso) {
  return DateTime.fromISO(iso, { setZone: true }).setZone("Asia/Tokyo").toFormat("yyyy-MM-dd HH:mm");
}

function jstDate(iso) {
  return DateTime.fromISO(iso, { setZone: true }).setZone("Asia/Tokyo").toISODate();
}

/** 一番遠い日程から、指定枠数を削除するアクションを決定 */
function planFarthestSlotRemovals(reservations, slotsToCancel) {
  if (!reservations.length || slotsToCancel <= 0) return [];

  const sorted = [...reservations].sort(
    (a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime(),
  );
  const farthestDate = jstDate(sorted[0].start_at);
  const onFarthestDate = sorted
    .filter((r) => jstDate(r.start_at) === farthestDate)
    .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());

  const actions = [];
  let remaining = slotsToCancel;

  for (const r of onFarthestDate) {
    if (remaining <= 0) break;
    const slots = slotCount(r.start_at, r.end_at);
    if (slots <= remaining) {
      actions.push({
        type: "cancel_full",
        reservation: r,
        lineStart: r.start_at,
        lineEnd: r.end_at,
        slotsRemoved: slots,
      });
      remaining -= slots;
    } else {
      const lineEnd = r.end_at;
      const lineStart = DateTime.fromISO(r.end_at, { setZone: true })
        .minus({ minutes: remaining * SLOT_MIN })
        .toUTC()
        .toISO();
      const newEnd = lineStart;
      actions.push({
        type: "shorten",
        reservation: r,
        newEnd,
        lineStart,
        lineEnd,
        slotsRemoved: remaining,
      });
      remaining = 0;
    }
  }

  if (remaining > 0) {
    throw new Error(`削除枠が足りません（残り ${remaining} 枠）`);
  }
  return actions;
}

async function sendLineNotifications(notifications, serviceKey, dryRun) {
  if (!notifications.length) return { sent: 0, failed: 0 };

  const res = await fetch(`${PRODUCTION_API.replace(/\/$/, "")}/api/admin/send-cancel-line`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-service-role-key": serviceKey,
    },
    body: JSON.stringify({
      notifications,
      dry_run: dryRun,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`LINE API HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  return { sent: body.sent ?? 0, failed: body.failed ?? 0, results: body.results ?? [] };
}

async function main() {
  const dryRun = !process.argv.includes("--confirm");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE env missing");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const codes = TARGETS.map((t) => t.code);

  const { rows: members } = await fetchAllChecked(
    supabase,
    "members",
    "id, member_code, display_name, name, line_user_id, line_channel_key",
    (q) => q.in("member_code", codes),
    "members",
  );
  const memberByCode = Object.fromEntries(members.map((m) => [String(m.member_code).toUpperCase(), m]));

  const { rows: stores } = await fetchAllChecked(supabase, "stores", "id, name", undefined, "stores");
  const storeNameById = Object.fromEntries(stores.map((s) => [s.id, s.name]));

  const memberIds = members.map((m) => m.id);
  const { rows: reservations } = await fetchAllChecked(
    supabase,
    "reservations",
    "id, member_id, store_id, start_at, end_at, status",
    (q) =>
      q
        .in("member_id", memberIds)
        .gte("start_at", COUNT_START)
        .lt("start_at", COUNT_END)
        .neq("status", "cancelled"),
    "reservations.active",
  );

  const resByMemberId = new Map();
  for (const r of reservations) {
    const list = resByMemberId.get(r.member_id) ?? [];
    list.push(r);
    resByMemberId.set(r.member_id, list);
  }

  console.log(`\n=== ${dryRun ? "DRY-RUN" : "CONFIRM"} ===`);
  console.log("対象: #4 SHI025（1枠）, #8 UEN054（2枠）— 一番遠い日程から削除\n");

  const lineNotifications = [];
  const summary = { members: [], totalSlotsRemoved: 0 };

  for (const target of TARGETS) {
    const member = memberByCode[target.code];
    if (!member) {
      console.error(`会員未登録: ${target.code}`);
      process.exit(1);
    }

    const memberRes = resByMemberId.get(member.id) ?? [];
    const actions = planFarthestSlotRemovals(memberRes, target.cancelSlots);
    const displayName = member.display_name ?? member.name ?? target.name;

    console.log(`--- #${target.listNo} ${target.code} ${displayName} ---`);
    console.log(`  現予約 ${memberRes.length}件 / 削除 ${target.cancelSlots}枠`);

    const entry = { listNo: target.listNo, code: target.code, name: displayName, actions: [] };

    for (const action of actions) {
      const r = action.reservation;
      const storeName = storeNameById[r.store_id] ?? "—";
      const label =
        action.type === "cancel_full"
          ? `[全取消] ${fmtJst(r.start_at)}-${fmtJst(r.end_at).slice(11)} (${action.slotsRemoved}枠)`
          : `[短縮] ${fmtJst(action.lineStart)}-${fmtJst(action.lineEnd).slice(11)} を削除 (${action.slotsRemoved}枠)`;
      console.log(`  ${label} ${storeName}`);

      const actionResult = {
        type: action.type,
        reservationId: r.id,
        lineStart: action.lineStart,
        lineEnd: action.lineEnd,
        slotsRemoved: action.slotsRemoved,
        store: storeName,
      };

      if (!dryRun) {
        if (action.type === "cancel_full") {
          const { error } = await supabase
            .from("reservations")
            .update({ status: "cancelled", updated_at: new Date().toISOString() })
            .eq("id", r.id);
          if (error) {
            actionResult.error = error.message;
            console.error(`    ✗ DB取消失敗: ${error.message}`);
          } else {
            actionResult.done = true;
            console.log("    ✓ キャンセル済");
          }
        } else {
          const { error } = await supabase
            .from("reservations")
            .update({ end_at: action.newEnd, updated_at: new Date().toISOString() })
            .eq("id", r.id);
          if (error) {
            actionResult.error = error.message;
            console.error(`    ✗ DB短縮失敗: ${error.message}`);
          } else {
            actionResult.done = true;
            console.log(`    ✓ 短縮済（残: ${fmtJst(r.start_at)}-${fmtJst(action.newEnd).slice(11)}）`);
          }
        }
      }

      if (!actionResult.error) {
        lineNotifications.push({
          reservation_id: r.id,
          start_at: action.lineStart,
          end_at: action.lineEnd,
        });
      }

      entry.actions.push(actionResult);
      summary.totalSlotsRemoved += action.slotsRemoved;
    }

    summary.members.push(entry);
  }

  console.log(`\n--- LINE通知 ${lineNotifications.length}件 ---`);
  if (lineNotifications.length) {
    if (dryRun) {
      for (const n of lineNotifications) {
        console.log(`  [LINE予定] reservation=${n.reservation_id} ${fmtJst(n.start_at)}-${fmtJst(n.end_at).slice(11)}`);
      }
    } else {
      const lineResult = await sendLineNotifications(lineNotifications, key, false);
      console.log(`  送信: ${lineResult.sent} / 失敗: ${lineResult.failed}`);
      for (const r of lineResult.results ?? []) {
        if (!r.ok) console.log("  fail", r);
      }
      summary.line = lineResult;
    }
  }

  console.log(`\n削除枠合計: ${summary.totalSlotsRemoved}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
