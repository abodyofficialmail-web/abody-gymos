import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { getAppUrl } from "@/lib/constants";
import { lineMemberProfileReachable, linePushTokenForMemberRow } from "@/lib/lineChannel";
import { isMemberWeightLogEnabled, WEIGHT_LOG_PILOT_CODES, WEIGHT_LOG_PILOT_ONLY } from "@/lib/memberWeightLogRollout";
import { memberWeightLogPageUrl } from "@/lib/memberWeightLogSigned";
import { isMissingWeightLogTable, tokyoTodayYmd, WEIGHT_LOG_TZ } from "@/lib/memberWeightLogs";

export const MORNING_WEIGHT_REMINDER_HOUR_JST = 7;

const ACCENT = "#0f766e";

export function buildMorningWeightReminderText(): string {
  return `【毎朝の体重・体脂肪】
おはようございます！
今朝の体重と、測れる場合は体脂肪も記録してください。

おすすめのタイミングは
起床後 → トイレ後 → 朝食前 です。

毎日同じ条件で測ると、変化が見えやすくなります。`.trim();
}

export function buildMorningWeightReminderFlex(recordUrl: string) {
  return {
    type: "flex" as const,
    altText: "今朝の体重・体脂肪を記録してください",
    contents: {
      type: "bubble" as const,
      size: "mega" as const,
      body: {
        type: "box" as const,
        layout: "vertical" as const,
        spacing: "md" as const,
        contents: [
          {
            type: "text" as const,
            text: "今朝の体重・体脂肪",
            weight: "bold" as const,
            size: "lg" as const,
            color: "#1e293b",
          },
          {
            type: "text" as const,
            text: "起床後・トイレ後・朝食前に測ると、日々の変化がわかりやすくなります。体脂肪は測れるときだけで大丈夫です。",
            wrap: true,
            size: "sm" as const,
            color: "#334155",
          },
          {
            type: "button" as const,
            style: "primary" as const,
            color: ACCENT,
            height: "sm" as const,
            action: { type: "uri" as const, label: "今日の記録をする", uri: recordUrl },
          },
        ],
      },
    },
  };
}

async function pushReminderMessages(token: string, toUserId: string, recordUrl: string) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      to: toUserId,
      messages: [{ type: "text", text: buildMorningWeightReminderText() }, buildMorningWeightReminderFlex(recordUrl)],
    }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

function isActiveMember(m: { membership_status?: string | null; is_active?: boolean | null }): boolean {
  const ms = String(m.membership_status ?? "").toLowerCase();
  if (ms === "hiatus" || ms === "withdrawn") return false;
  if (ms === "active") return true;
  return m.is_active === true;
}

function isMissingWeightReminderColumn(err: { message?: string } | null | undefined): boolean {
  const msg = String(err?.message ?? "");
  return /weight_reminder_line_enabled/i.test(msg) && (/does not exist|column/i.test(msg) || /PGRST/i.test(msg) || /Could not find/i.test(msg));
}

export type MorningWeightReminderTarget = {
  id: string;
  member_code: string;
  name: string | null;
  line_user_id: string | null;
  line_channel_key: string | null;
  membership_status?: string | null;
  is_active?: boolean | null;
  weight_reminder_line_enabled?: boolean | null;
};

export type SendMorningWeightReminderResult = {
  member_code: string;
  sent: boolean;
  skipped?: string;
  dry_run?: boolean;
  error?: string;
  detail?: string;
  record_url?: string;
};

const MEMBER_SELECT_BASE =
  "id, member_code, name, line_user_id, line_channel_key, membership_status, is_active";
const MEMBER_SELECT_WITH_WEIGHT_FLAG = `${MEMBER_SELECT_BASE}, weight_reminder_line_enabled`;

async function listMorningWeightReminderTargetsWithSelect(
  supabase: SupabaseClient,
  select: string
): Promise<MorningWeightReminderTarget[]> {
  const pageSize = 1000;
  const rows: MorningWeightReminderTarget[] = [];
  let from = 0;
  for (;;) {
    let query = supabase
      .from("members")
      .select(select as never)
      .not("line_user_id", "is", null)
      .range(from, from + pageSize - 1);
    if (WEIGHT_LOG_PILOT_ONLY) {
      query = query.in("member_code", [...WEIGHT_LOG_PILOT_CODES]);
    }
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as MorningWeightReminderTarget[]));
    if (!data || data.length < pageSize) break;
    from += pageSize;
    if (WEIGHT_LOG_PILOT_ONLY) break;
  }
  return rows;
}

export async function listMorningWeightReminderTargets(
  supabase: SupabaseClient
): Promise<MorningWeightReminderTarget[]> {
  let rows: MorningWeightReminderTarget[];
  try {
    rows = await listMorningWeightReminderTargetsWithSelect(supabase, MEMBER_SELECT_WITH_WEIGHT_FLAG);
  } catch (e) {
    if (!isMissingWeightReminderColumn(e as { message?: string })) throw e;
    rows = await listMorningWeightReminderTargetsWithSelect(supabase, MEMBER_SELECT_BASE);
  }
  return rows.filter(
    (m) =>
      isMemberWeightLogEnabled(m.member_code) &&
      isActiveMember(m) &&
      Boolean(m.line_user_id) &&
      m.weight_reminder_line_enabled !== false
  );
}

export async function sendMorningWeightReminder(
  supabase: SupabaseClient,
  opts: {
    member: MorningWeightReminderTarget;
    today?: string;
    dryRun?: boolean;
    force?: boolean;
    recordDispatch?: boolean;
    appUrl?: string;
  }
): Promise<SendMorningWeightReminderResult> {
  const memberCode = String(opts.member.member_code ?? "").toUpperCase();
  const today = opts.today ?? tokyoTodayYmd();
  const dryRun = Boolean(opts.dryRun);
  const recordDispatch = opts.recordDispatch !== false && !dryRun;
  const appUrl = opts.appUrl || getAppUrl();

  if (!isMemberWeightLogEnabled(memberCode)) {
    return { member_code: memberCode, sent: false, skipped: "not_in_rollout" };
  }
  if (opts.member.weight_reminder_line_enabled === false && !opts.force) {
    return { member_code: memberCode, sent: false, skipped: "reminder_disabled" };
  }
  if (!opts.member.line_user_id) {
    return { member_code: memberCode, sent: false, error: "no_line_user_id" };
  }

  if (!opts.force) {
    const { data: existingLog, error: logErr } = await supabase
      .from("member_weight_logs")
      .select("id")
      .eq("member_id", opts.member.id)
      .eq("log_date", today)
      .maybeSingle();
    if (logErr && !isMissingWeightLogTable(logErr)) {
      return { member_code: memberCode, sent: false, error: "log_lookup_failed", detail: logErr.message };
    }
    if (existingLog?.id) {
      return { member_code: memberCode, sent: false, skipped: "already_logged" };
    }
  }

  const recordUrl = memberWeightLogPageUrl(appUrl, opts.member.id);
  const { token, channelKey } = linePushTokenForMemberRow(opts.member);
  if (!token) {
    return { member_code: memberCode, sent: false, error: "line_token_missing", record_url: recordUrl };
  }

  if (dryRun) {
    return { member_code: memberCode, sent: false, dry_run: true, record_url: recordUrl };
  }

  if (recordDispatch) {
    const { error: claimErr } = await supabase.from("morning_weight_reminder_dispatches").insert({
      member_id: opts.member.id,
      log_date: today,
    });
    if (claimErr) {
      if (isMissingWeightLogTable(claimErr)) {
        return { member_code: memberCode, sent: false, error: "dispatch_table_missing", detail: claimErr.message };
      }
      const msg = String(claimErr.message ?? "");
      if (/duplicate|unique/i.test(msg) || claimErr.code === "23505") {
        return { member_code: memberCode, sent: false, skipped: "already_sent" };
      }
      return { member_code: memberCode, sent: false, error: "dispatch_claim_failed", detail: claimErr.message };
    }
  }

  const reachable = await lineMemberProfileReachable(token, opts.member.line_user_id);
  if (!reachable) {
    return {
      member_code: memberCode,
      sent: false,
      error: "profile_not_reachable",
      detail: channelKey ?? undefined,
      record_url: recordUrl,
    };
  }

  const push = await pushReminderMessages(token, opts.member.line_user_id, recordUrl);
  if (!push.ok) {
    if (recordDispatch) {
      await supabase
        .from("morning_weight_reminder_dispatches")
        .delete()
        .eq("member_id", opts.member.id)
        .eq("log_date", today);
    }
    return {
      member_code: memberCode,
      sent: false,
      error: "line_push_failed",
      detail: push.body,
      record_url: recordUrl,
    };
  }
  return { member_code: memberCode, sent: true, record_url: recordUrl };
}

export async function sendMorningWeightReminderForCode(
  supabase: SupabaseClient,
  opts: { memberCode: string; dryRun?: boolean; force?: boolean; recordDispatch?: boolean; appUrl?: string }
): Promise<SendMorningWeightReminderResult> {
  const memberCode = opts.memberCode.trim().toUpperCase();
  let { data, error } = await supabase
    .from("members")
    .select(MEMBER_SELECT_WITH_WEIGHT_FLAG as never)
    .eq("member_code", memberCode)
    .maybeSingle();
  if (error && isMissingWeightReminderColumn(error)) {
    const retry = await supabase
      .from("members")
      .select(MEMBER_SELECT_BASE as never)
      .eq("member_code", memberCode)
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }
  if (error) return { member_code: memberCode, sent: false, error: "member_fetch_failed", detail: error.message };
  if (!data) return { member_code: memberCode, sent: false, error: "member_not_found" };
  return sendMorningWeightReminder(supabase, {
    member: data as unknown as MorningWeightReminderTarget,
    dryRun: opts.dryRun,
    force: opts.force,
    recordDispatch: opts.recordDispatch,
    appUrl: opts.appUrl,
  });
}

export function isMorningWeightReminderHour(now = DateTime.now().setZone(WEIGHT_LOG_TZ)): boolean {
  return now.hour === MORNING_WEIGHT_REMINDER_HOUR_JST;
}
