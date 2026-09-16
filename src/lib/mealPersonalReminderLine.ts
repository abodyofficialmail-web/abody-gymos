import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppUrl } from "@/lib/constants";
import { lineMemberProfileReachable, linePushTokenForMemberRow } from "@/lib/lineChannel";
import { isMemberMealPersonalFullEnabled, isMissingMealPersonalPassColumn, type MealPersonalPassRow } from "@/lib/memberMealPersonalPass";
import { memberMealLogPageUrl } from "@/lib/memberMealLogSigned";
import {
  hasMealSlotLogged,
  isMissingMealPersonalTable,
  MEAL_SLOT_LABELS,
  tokyoTodayYmd,
} from "@/lib/memberMealLogs";

const ACCENT = "#0f766e";

export const MEAL_REMINDER_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealReminderSlot = (typeof MEAL_REMINDER_SLOTS)[number];

export function buildMealReminderText(slot: MealReminderSlot): string {
  const label = MEAL_SLOT_LABELS[slot];
  return `【${label}ごはんの記録】
${label}の食事を写真で送ってください。

写真を送ると、カロリーとPFCの目安と、今日の残りが出ます。
水・お通じ・お酒も同じ画面から記録できます。`.trim();
}

export function buildMealReminderFlex(slot: MealReminderSlot, recordUrl: string) {
  const label = MEAL_SLOT_LABELS[slot];
  return {
    type: "flex" as const,
    altText: `${label}ごはんを写真で記録してください`,
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
            text: `${label}ごはんを記録`,
            weight: "bold" as const,
            size: "lg" as const,
            color: "#1e293b",
          },
          {
            type: "text" as const,
            text: "食事の写真を送ると、カロリー・PFCと今日の残りを出します。",
            wrap: true,
            size: "sm" as const,
            color: "#334155",
          },
          {
            type: "button" as const,
            style: "primary" as const,
            color: ACCENT,
            height: "sm" as const,
            action: { type: "uri" as const, label: "写真で記録する", uri: recordUrl },
          },
        ],
      },
    },
  };
}

async function pushReminderMessages(token: string, toUserId: string, slot: MealReminderSlot, recordUrl: string) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      to: toUserId,
      messages: [{ type: "text", text: buildMealReminderText(slot) }, buildMealReminderFlex(slot, recordUrl)],
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

export type MealReminderTarget = {
  id: string;
  member_code: string;
  name: string | null;
  line_user_id: string | null;
  line_channel_key: string | null;
  membership_status?: string | null;
  is_active?: boolean | null;
  meal_personal_pass_status?: string | null;
  meal_personal_pass_current_period_end?: string | null;
};

export type SendMealReminderResult = {
  member_code: string;
  slot: MealReminderSlot;
  sent: boolean;
  skipped?: string;
  dry_run?: boolean;
  error?: string;
  detail?: string;
  record_url?: string;
};

export async function listMealPersonalReminderTargets(supabase: SupabaseClient): Promise<MealReminderTarget[]> {
  const pageSize = 1000;
  const rows: MealReminderTarget[] = [];
  const selectWithPass =
    "id, member_code, name, line_user_id, line_channel_key, membership_status, is_active, meal_personal_pass_status, meal_personal_pass_current_period_end";
  const selectLegacy = "id, member_code, name, line_user_id, line_channel_key, membership_status, is_active";
  let from = 0;
  let usePassCols = true;
  for (;;) {
    const { data, error } = await (supabase as any)
      .from("members")
      .select(usePassCols ? selectWithPass : selectLegacy)
      .not("line_user_id", "is", null)
      .range(from, from + pageSize - 1);
    if (error && usePassCols && isMissingMealPersonalPassColumn(error)) {
      usePassCols = false;
      continue;
    }
    if (error) throw error;
    rows.push(...((data ?? []) as MealReminderTarget[]));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows.filter((m) => {
    const pass: MealPersonalPassRow | null = usePassCols
      ? {
          meal_personal_pass_status: m.meal_personal_pass_status,
          meal_personal_pass_current_period_end: m.meal_personal_pass_current_period_end,
        }
      : null;
    return isMemberMealPersonalFullEnabled({ memberCode: m.member_code, pass }) && isActiveMember(m) && Boolean(m.line_user_id);
  });
}

export async function sendMealPersonalReminder(
  supabase: SupabaseClient,
  opts: {
    member: MealReminderTarget;
    slot: MealReminderSlot;
    today?: string;
    dryRun?: boolean;
    force?: boolean;
    recordDispatch?: boolean;
    appUrl?: string;
  }
): Promise<SendMealReminderResult> {
  const memberCode = String(opts.member.member_code ?? "").toUpperCase();
  const today = opts.today ?? tokyoTodayYmd();
  const slot = opts.slot;
  const dryRun = Boolean(opts.dryRun);
  const recordDispatch = opts.recordDispatch !== false && !dryRun;
  const appUrl = opts.appUrl || getAppUrl();

  const pass: MealPersonalPassRow = {
    meal_personal_pass_status: (opts.member as MealReminderTarget).meal_personal_pass_status,
    meal_personal_pass_current_period_end: (opts.member as MealReminderTarget).meal_personal_pass_current_period_end,
  };
  if (!isMemberMealPersonalFullEnabled({ memberCode, pass })) {
    return { member_code: memberCode, slot, sent: false, skipped: "not_in_rollout" };
  }
  if (!opts.member.line_user_id) {
    return { member_code: memberCode, slot, sent: false, error: "no_line_user_id" };
  }

  if (!opts.force) {
    const already = await hasMealSlotLogged(supabase, opts.member.id, today, slot);
    if (already) return { member_code: memberCode, slot, sent: false, skipped: "already_logged" };
  }

  const recordUrl = memberMealLogPageUrl(appUrl, opts.member.id, slot);
  const { token, channelKey } = linePushTokenForMemberRow(opts.member);
  if (!token) {
    return { member_code: memberCode, slot, sent: false, error: "line_token_missing", record_url: recordUrl };
  }

  if (dryRun) {
    return { member_code: memberCode, slot, sent: false, dry_run: true, record_url: recordUrl };
  }

  if (recordDispatch) {
    const { error: claimErr } = await supabase.from("meal_personal_reminder_dispatches" as never).insert({
      member_id: opts.member.id,
      log_date: today,
      meal_slot: slot,
    } as never);
    if (claimErr) {
      if (isMissingMealPersonalTable(claimErr)) {
        return { member_code: memberCode, slot, sent: false, error: "dispatch_table_missing", detail: claimErr.message };
      }
      const msg = String(claimErr.message ?? "");
      if (/duplicate|unique/i.test(msg) || claimErr.code === "23505") {
        return { member_code: memberCode, slot, sent: false, skipped: "already_sent" };
      }
      return { member_code: memberCode, slot, sent: false, error: "dispatch_claim_failed", detail: claimErr.message };
    }
  }

  const reachable = await lineMemberProfileReachable(token, opts.member.line_user_id);
  if (!reachable) {
    return {
      member_code: memberCode,
      slot,
      sent: false,
      error: "profile_not_reachable",
      detail: channelKey ?? undefined,
      record_url: recordUrl,
    };
  }

  const push = await pushReminderMessages(token, opts.member.line_user_id, slot, recordUrl);
  if (!push.ok) {
    if (recordDispatch) {
      await supabase
        .from("meal_personal_reminder_dispatches" as never)
        .delete()
        .eq("member_id", opts.member.id)
        .eq("log_date", today)
        .eq("meal_slot", slot);
    }
    return {
      member_code: memberCode,
      slot,
      sent: false,
      error: "line_push_failed",
      detail: push.body,
      record_url: recordUrl,
    };
  }
  return { member_code: memberCode, slot, sent: true, record_url: recordUrl };
}

export async function sendMealPersonalReminderForCode(
  supabase: SupabaseClient,
  opts: {
    memberCode: string;
    slot: MealReminderSlot;
    dryRun?: boolean;
    force?: boolean;
    recordDispatch?: boolean;
    appUrl?: string;
  }
): Promise<SendMealReminderResult> {
  const memberCode = opts.memberCode.trim().toUpperCase();
  const selectWithPass =
    "id, member_code, name, line_user_id, line_channel_key, membership_status, is_active, meal_personal_pass_status, meal_personal_pass_current_period_end";
  const selectLegacy = "id, member_code, name, line_user_id, line_channel_key, membership_status, is_active";
  let { data, error } = await (supabase as any).from("members").select(selectWithPass).eq("member_code", memberCode).maybeSingle();
  if (error && isMissingMealPersonalPassColumn(error)) {
    const second = await (supabase as any).from("members").select(selectLegacy).eq("member_code", memberCode).maybeSingle();
    data = second.data;
    error = second.error;
  }
  if (error) return { member_code: memberCode, slot: opts.slot, sent: false, error: "member_fetch_failed", detail: error.message };
  if (!data) return { member_code: memberCode, slot: opts.slot, sent: false, error: "member_not_found" };
  return sendMealPersonalReminder(supabase, {
    member: data as MealReminderTarget,
    slot: opts.slot,
    dryRun: opts.dryRun,
    force: opts.force,
    recordDispatch: opts.recordDispatch,
    appUrl: opts.appUrl,
  });
}
