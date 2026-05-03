import { DateTime } from "luxon";
import { z } from "zod";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { chunkLinePushText, pushLineTextChunks } from "@/lib/lineMessagingPush";
import { dailyReportChannelToken, resolvePushRecipients } from "@/lib/dailyLineRecipients";

const TZ = "Asia/Tokyo";
const SLOT_MINUTES = 30;

/**
 * --- 送信文面の雛形（全店舗まとめ）-----------------------------------
 * 【全店舗】2026年5月5日（火）｜明日の業務サマリ
 * ※前日22時（JST）自動送信・対象日は翌日
 *
 * ━━ 恵比寿 ━━
 * ■ 勤務予定
 * ・…
 * ■ 予定（MTG/撮影/作業など）
 * ・12:00〜13:00 …｜MTG（予約枠: 抑える）
 * ■ 予約一覧（2件）
 * ・…
 *
 * ━━ 上野 ━━
 * …
 * -------------------------------------------------------------------
 */

const querySchema = z.object({
  target: z.enum(["today", "tomorrow"]),
  dry_run: z.enum(["0", "1"]).optional(),
});

/** x-cron-secret + REPORT_CRON_SECRET、または Authorization: Bearer + CRON_SECRET（Vercel標準） */
function mustCronAuth(req: Request): boolean {
  const reportSecret = process.env.REPORT_CRON_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (reportSecret && got === reportSecret) return true;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  return false;
}

function formatDateJa(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: TZ });
  return dt.isValid ? dt.setLocale("ja").toFormat("yyyy年M月d日（ccc）") : ymd;
}

function formatTimeJa(utcIso: string) {
  return DateTime.fromISO(utcIso).setZone(TZ).toFormat("HH:mm");
}

function sliceHhmm(t: string) {
  const s = String(t ?? "");
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function requestOrigin(req: Request): string {
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

async function fetchTrainerAvailableSlots(
  origin: string,
  storeId: string,
  dateYmd: string,
  trainerId: string
): Promise<Array<{ start_at: string; end_at: string }>> {
  if (!origin) return [];
  try {
    const u = new URL("/api/booking-v2/available-slots", origin);
    u.searchParams.set("store_id", storeId);
    u.searchParams.set("date", dateYmd);
    u.searchParams.set("trainer_id", trainerId);
    const res = await fetch(u.toString(), { cache: "no-store" });
    const j = await res.json().catch(() => []);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function formatFreeSlotsSummary(slots: Array<{ start_at: string; end_at: string }>): string {
  const n = slots.length;
  if (n === 0) return "空き枠なし（締切後・過去枠除く）";
  const minutes = n * SLOT_MINUTES;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const dur = h > 0 && m > 0 ? `${h}時間${m}分` : h > 0 ? `${h}時間` : `${m}分`;
  const samples = slots.slice(0, 5).map((s) => DateTime.fromISO(s.start_at).setZone(TZ).toFormat("HH:mm"));
  const more = n > 5 ? ` …他${n - 5}枠` : "";
  return `${n}枠（計${dur}） ${samples.join(", ")}${more}`;
}

export async function GET(req: Request) {
  try {
    if (!mustCronAuth(req)) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      target: url.searchParams.get("target"),
      dry_run: url.searchParams.get("dry_run") ?? undefined,
    });
    if (!parsed.success) return jsonResponse({ error: "invalid_query", detail: parsed.error.flatten() }, 400);

    const target = parsed.data.target;
    const dryRun = parsed.data.dry_run === "1";

    const nowJst = DateTime.now().setZone(TZ);
    const dateYmd = (target === "today" ? nowJst : nowJst.plus({ days: 1 })).toISODate()!;

    const supabase = createSupabaseServiceClient();

    const { ids: recipientIds, member_codes_queried, missing_line_for_codes } = await resolvePushRecipients(supabase);

    const token = dailyReportChannelToken();
    if (!dryRun && !token) {
      return jsonResponse(
        {
          error: "missing_token",
          detail: "LINE_DAILY_REPORT_CHANNEL_TOKEN または LINE_CHANNEL_ACCESS_TOKEN を設定してください",
        },
        500
      );
    }

    if (!dryRun && recipientIds.length === 0) {
      return jsonResponse(
        {
          error: "missing_recipients",
          detail:
            "送信先がありません。LINE_DAILY_REPORT_USER_IDS を設定するか、会員番号（既定EBI020）の LINE連携（line_user_id）を確認してください。",
          member_codes_queried,
          missing_line_for_codes,
        },
        500
      );
    }

    const { data: storeRows, error: storeErr } = await supabase
      .from("stores")
      .select("id,name,timezone")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (storeErr) return jsonResponse({ error: "stores_fetch_failed", detail: storeErr.message }, 500);

    const stores = (storeRows ?? []) as { id: string; name: string; timezone?: string | null }[];
    if (stores.length === 0) {
      return jsonResponse({ error: "no_active_stores", detail: "有効な店舗がありません" }, 500);
    }

    const dayStartUtc = DateTime.fromISO(dateYmd, { zone: TZ }).startOf("day").toUTC();
    const dayEndUtc = dayStartUtc.plus({ days: 1 });

    const { data: reservations, error: resErr } = await supabase
      .from("reservations")
      .select("id, store_id, trainer_id, member_id, start_at, end_at, status, session_type")
      .neq("status", "cancelled")
      .gte("start_at", dayStartUtc.toISO()!)
      .lt("start_at", dayEndUtc.toISO()!);
    if (resErr) return jsonResponse({ error: "reservations_fetch_failed", detail: resErr.message }, 500);

    const { data: shifts, error: shiftsErr } = await supabase
      .from("trainer_shifts")
      .select("id, store_id, trainer_id, shift_date, start_local, end_local, status, is_break")
      .eq("shift_date", dateYmd)
      .neq("status", "draft");
    if (shiftsErr) return jsonResponse({ error: "shifts_fetch_failed", detail: shiftsErr.message }, 500);

    let events: Array<{
      store_id: string;
      trainer_id: string;
      start_local: string;
      end_local: string;
      title: string;
      notes: string | null;
      block_booking: boolean;
    }> = [];

    const evQ = await supabase
      .from("trainer_events")
      .select("store_id,trainer_id,start_local,end_local,title,notes,block_booking")
      .eq("event_date", dateYmd);
    if (!evQ.error && evQ.data) events = evQ.data as typeof events;

    const reservationsFiltered = (reservations ?? []).filter((r) =>
      stores.some((st) => st.id === String(r.store_id))
    );

    const memberIds = Array.from(new Set(reservationsFiltered.map((r) => String(r.member_id)).filter(Boolean)));
    const trainerIds = Array.from(
      new Set(
        [
          ...reservationsFiltered.map((r) => String(r.trainer_id ?? "")).filter(Boolean),
          ...(shifts ?? []).map((s) => String(s.trainer_id ?? "")).filter(Boolean),
          ...events.map((e) => String(e.trainer_id ?? "")).filter(Boolean),
        ].filter(Boolean)
      )
    );

    const [membersQ, trainersQ] = await Promise.all([
      memberIds.length
        ? supabase.from("members").select("id,member_code,name,display_name").in("id", memberIds)
        : Promise.resolve({ data: [], error: null } as const),
      trainerIds.length
        ? supabase.from("trainers").select("id,display_name").in("id", trainerIds)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if (membersQ.error) return jsonResponse({ error: "members_fetch_failed", detail: membersQ.error.message }, 500);
    if (trainersQ.error) return jsonResponse({ error: "trainers_fetch_failed", detail: trainersQ.error.message }, 500);

    const memberById = new Map<string, { member_code: string; name: string }>();
    for (const m of membersQ.data ?? []) {
      memberById.set(String(m.id), {
        member_code: String(m.member_code ?? ""),
        name: String(m.display_name ?? m.name ?? ""),
      });
    }
    const trainerNameById = new Map<string, string>();
    for (const t of trainersQ.data ?? []) {
      trainerNameById.set(String(t.id), String(t.display_name ?? ""));
    }

    const timingLabel =
      target === "tomorrow"
        ? "明日の業務サマリ（前日22時・JST送信／対象は翌日）"
        : "本日の業務サマリ（当日8時・JST送信／対象は当日）";

    const origin =
      requestOrigin(req) ||
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

    const lines: string[] = [
      `【全店舗】${formatDateJa(dateYmd)}｜${timingLabel}`,
      `全店舗合計予約: ${reservationsFiltered.length}件`,
      ``,
    ];

    for (const st of stores) {
      const sid = st.id;

      const shiftList = (shifts ?? [])
        .filter((s) => String(s.store_id) === sid && s.is_break !== true)
        .slice()
        .sort((a, b) => String(a.start_local).localeCompare(String(b.start_local)));

      const shiftIds = shiftList.map((s) => String((s as { id: string }).id)).filter(Boolean);
      const breaksByShiftId = new Map<string, Array<{ start_time: string; end_time: string }>>();
      if (shiftIds.length > 0) {
        const br = await supabase.from("trainer_shift_breaks").select("shift_id,start_time,end_time").in("shift_id", shiftIds);
        if (!br.error && br.data) {
          for (const row of br.data as Array<{ shift_id: string; start_time: string; end_time: string }>) {
            const id = String(row.shift_id ?? "");
            if (!id) continue;
            const arr = breaksByShiftId.get(id) ?? [];
            arr.push({ start_time: String(row.start_time ?? ""), end_time: String(row.end_time ?? "") });
            breaksByShiftId.set(id, arr);
          }
        }
      }

      const trainerDutyBlocks: string[] = [];
      if (shiftList.length === 0) {
        trainerDutyBlocks.push("（勤務予定なし）");
      } else {
        const dutyLines = await Promise.all(
          shiftList.map(async (s) => {
            const trainerName = trainerNameById.get(String(s.trainer_id)) ?? String(s.trainer_id);
            const brList = breaksByShiftId.get(String(s.id)) ?? [];
            const brText =
              brList.length > 0
                ? brList.map((b) => `${sliceHhmm(String(b.start_time))}〜${sliceHhmm(String(b.end_time))}`).join(" / ")
                : "";
            const slots = await fetchTrainerAvailableSlots(origin, sid, dateYmd, String(s.trainer_id));
            const free = formatFreeSlotsSummary(slots);
            return [
              `・${trainerName} 勤務 ${sliceHhmm(String(s.start_local))}〜${sliceHhmm(String(s.end_local))}`,
              brText ? `  休憩: ${brText}` : `  休憩: （登録なし）`,
              `  空き: ${free}`,
            ].join("\n");
          })
        );
        trainerDutyBlocks.push(...dutyLines);
      }

      const storeEvents = events.filter((e) => String(e.store_id) === sid);
      const eventLines =
        storeEvents.length === 0
          ? ["（予定なし）"]
          : storeEvents
              .slice()
              .sort((a, b) => sliceHhmm(a.start_local).localeCompare(sliceHhmm(b.start_local)))
              .map((e) => {
                const trainerName = trainerNameById.get(String(e.trainer_id)) ?? String(e.trainer_id);
                const title = String(e.title ?? "").trim() || "（無題）";
                const blockLabel = e.block_booking ? "抑える" : "抑えない";
                const note = e.notes?.trim() ? `｜${e.notes.trim()}` : "";
                return `・${sliceHhmm(e.start_local)}〜${sliceHhmm(e.end_local)} ${trainerName}｜${title}（予約枠: ${blockLabel}）${note}`;
              });

      const resList = reservationsFiltered
        .filter((r) => String(r.store_id) === sid)
        .slice()
        .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));

      const resLines =
        resList.length === 0
          ? ["（予約なし）"]
          : resList.map((r) => {
              const member = memberById.get(String(r.member_id));
              const memberCode = member?.member_code ? member.member_code : String(r.member_id);
              const memberName = member?.name ? member.name : "";
              const tName = r.trainer_id ? trainerNameById.get(String(r.trainer_id)) ?? "" : "";
              const time = `${formatTimeJa(String(r.start_at))}〜${formatTimeJa(String(r.end_at))}`;
              const who = `${memberCode} ${memberName}`.trim();
              const stype = String(r.session_type ?? "store") === "online" ? "オンライン" : "店舗";
              const trainerSuffix = tName ? tName : "—";
              return `・${time}  ${who}（${stype}｜${trainerSuffix}）`;
            });

      lines.push(
        `━━ ${st.name}（店舗予約 ${resList.length}件）━━`,
        `■ トレーナー勤務・休憩・空き`,
        ...trainerDutyBlocks,
        ``,
        `■ 予定（MTG/撮影/作業など）`,
        ...eventLines,
        ``,
        `■ 予約一覧（${resList.length}件）`,
        ...resLines,
        ``
      );
    }

    const text = lines.join("\n").trimEnd();

    if (dryRun) {
      return jsonResponse(
        {
          ok: true,
          dry_run: true,
          target,
          date: dateYmd,
          store_count: stores.length,
          recipient_count: recipientIds.length,
          member_codes_queried,
          missing_line_for_codes,
          text,
        },
        200
      );
    }

    const chunks = chunkLinePushText(text);
    const perRecipient: Array<{ user_id: string; ok: boolean; chunks_sent: number; pushResults: Awaited<ReturnType<typeof pushLineTextChunks>> }> =
      [];

    for (const toUserId of recipientIds) {
      const pushResults = await pushLineTextChunks({ token: token!, toUserId, chunks });
      const allOk = pushResults.length > 0 && pushResults.every((r) => r.ok);
      perRecipient.push({ user_id: toUserId, ok: allOk, chunks_sent: chunks.length, pushResults });
    }

    const allOk = perRecipient.every((p) => p.ok);

    return jsonResponse(
      {
        ok: allOk,
        target,
        date: dateYmd,
        store_count: stores.length,
        recipients: perRecipient.length,
        chunks_per_message: chunks.length,
        perRecipient,
      },
      allOk ? 200 : 502
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "unexpected_error", detail: message }, 500);
  }
}
