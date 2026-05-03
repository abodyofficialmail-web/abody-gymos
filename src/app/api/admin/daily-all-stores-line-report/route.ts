import { DateTime } from "luxon";
import { z } from "zod";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { chunkLinePushText, pushLineTextChunks } from "@/lib/lineMessagingPush";

const TZ = "Asia/Tokyo";

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

function splitEnvList(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 送信先LINEユーザーIDを集める。
 * - LINE_DAILY_REPORT_USER_IDS / LINE_EBI020_USER_ID … そのまま push 先（U…）
 * - 上記がどちらも無いとき、会員番号 EBI020 を DB から解決（line_user_id）
 * - LINE_DAILY_REPORT_MEMBER_CODES を設定すると、会員番号を追加で解決（カンマ区切り）
 *
 * 予約確定と同じ恵比寿公式チャネル（LINE_CHANNEL_ACCESS_TOKEN）で送る前提で、
 * 受信側はそのボットを友だち追加している会員の line_user_id が必要。
 */
async function resolvePushRecipients(supabase: ReturnType<typeof createSupabaseServiceClient>): Promise<{
  ids: string[];
  member_codes_queried: string[];
  missing_line_for_codes: string[];
}> {
  const explicit: string[] = [];
  const rawUsers = process.env.LINE_DAILY_REPORT_USER_IDS?.trim();
  if (rawUsers) explicit.push(...splitEnvList(rawUsers));
  const legacy = process.env.LINE_EBI020_USER_ID?.trim();
  if (legacy) explicit.push(legacy);

  const codesEnv = process.env.LINE_DAILY_REPORT_MEMBER_CODES?.trim();
  let memberCodesToQuery: string[] = [];
  if (codesEnv !== undefined && codesEnv !== "") {
    memberCodesToQuery = splitEnvList(codesEnv);
  } else if (explicit.length === 0) {
    memberCodesToQuery = ["EBI020"];
  }

  const fromMembers: string[] = [];
  const missingLineForCodes: string[] = [];

  if (memberCodesToQuery.length > 0) {
    const { data, error } = await supabase
      .from("members")
      .select("member_code,line_user_id")
      .in("member_code", memberCodesToQuery)
      .eq("is_active", true);
    if (error) {
      throw new Error(`members_lookup_failed:${error.message}`);
    }
    for (const code of memberCodesToQuery) {
      const row = (data ?? []).find((r) => String(r.member_code) === code);
      if (!row) {
        missingLineForCodes.push(code);
        continue;
      }
      const uid = row.line_user_id ? String(row.line_user_id).trim() : "";
      if (uid) fromMembers.push(uid);
      else missingLineForCodes.push(code);
    }
  }

  const ids = Array.from(new Set([...explicit, ...fromMembers]));
  return {
    ids,
    member_codes_queried: memberCodesToQuery,
    missing_line_for_codes: missingLineForCodes,
  };
}

/** 送信に使う Messaging API チャネルトークン（受信者が友だち追加しているボット） */
function dailyReportChannelToken(): string | null {
  const explicit = process.env.LINE_DAILY_REPORT_CHANNEL_TOKEN?.trim();
  if (explicit) return explicit;
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
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
      .select("id,name")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (storeErr) return jsonResponse({ error: "stores_fetch_failed", detail: storeErr.message }, 500);

    const stores = (storeRows ?? []) as { id: string; name: string }[];
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

    const lines: string[] = [
      `【全店舗】${formatDateJa(dateYmd)}｜${timingLabel}`,
      ``,
    ];

    for (const st of stores) {
      const sid = st.id;

      const shiftList = (shifts ?? [])
        .filter((s) => String(s.store_id) === sid && s.is_break !== true)
        .slice()
        .sort((a, b) => String(a.start_local).localeCompare(String(b.start_local)));

      const shiftLines =
        shiftList.length === 0
          ? ["（勤務予定なし）"]
          : shiftList.map((s) => {
              const trainerName = trainerNameById.get(String(s.trainer_id)) ?? String(s.trainer_id);
              return `・${trainerName} ${sliceHhmm(String(s.start_local))}〜${sliceHhmm(String(s.end_local))}`;
            });

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

      lines.push(`━━ ${st.name} ━━`, `■ 勤務予定`, ...shiftLines, ``, `■ 予定（MTG/撮影/作業など）`, ...eventLines, ``, `■ 予約一覧（${resList.length}件）`, ...resLines, ``);
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
