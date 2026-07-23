import { DateTime } from "luxon";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import {
  buildPreSessionReminderText,
  buildPreSessionSurveyFlex,
  preSessionSurveyPageUrl,
  pushPreSessionReminderMessages,
} from "@/lib/preSessionReminderLine";

const TZ = "Asia/Tokyo";
const WINDOW_MIN = 55;
const WINDOW_MAX = 65;

function mustCronAuth(req: Request): boolean {
  const reportSecret = process.env.REPORT_CRON_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (reportSecret && got === reportSecret) return true;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  return false;
}

function isDupInsertError(err: { code?: string; message?: string } | null): boolean {
  const c = String(err?.code ?? "");
  const m = String(err?.message ?? "");
  return c === "23505" || m.includes("duplicate") || m.includes("unique");
}

function isMissingTable(err: { message?: string } | null | undefined): boolean {
  const m = String(err?.message ?? "");
  return (
    m.includes("reservation_line_reminder_dispatches") ||
    m.includes("does not exist") ||
    m.includes("Could not find the table")
  );
}

function resolveAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "https://abody-gymos.vercel.app";
}

function pickRelName(
  rel: { display_name?: string | null; name?: string | null } | { display_name?: string | null; name?: string | null }[] | null,
  field: "display_name" | "name"
): string {
  if (!rel) return "";
  const row = Array.isArray(rel) ? rel[0] : rel;
  const v = row?.[field];
  return typeof v === "string" ? v.trim() : "";
}

async function pushFlexOnly(token: string, toUserId: string, surveyUrl: string) {
  const message = buildPreSessionSurveyFlex(surveyUrl);
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: toUserId, messages: [message] }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

type ReservationRow = {
  id: string;
  start_at: string;
  session_type: string | null;
  member_id: string;
  members:
    | {
        id: string;
        member_code: string | null;
        line_user_id: string | null;
        line_channel_key: string | null;
        is_active: boolean | null;
        reservation_reminder_line_enabled: boolean | null;
      }
    | {
        id: string;
        member_code: string | null;
        line_user_id: string | null;
        line_channel_key: string | null;
        is_active: boolean | null;
        reservation_reminder_line_enabled: boolean | null;
      }[]
    | null;
  stores: { name?: string | null } | { name?: string | null }[] | null;
  trainers: { display_name?: string | null } | { display_name?: string | null }[] | null;
};

/**
 * 会員予約の開始約60分前（55〜65分ウィンドウ）に
 * LINE リマインド + セッション前ヒアリングを送る。
 */
export async function GET(req: Request) {
  try {
    if (!mustCronAuth(req)) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const supabase = createSupabaseServiceClient();
    const appUrl = resolveAppUrl();
    const now = DateTime.now().setZone(TZ);
    const windowStart = now.plus({ minutes: WINDOW_MIN }).toUTC().toISO()!;
    const windowEnd = now.plus({ minutes: WINDOW_MAX }).toUTC().toISO()!;

    const { data: rows, error: rErr } = await supabase
      .from("reservations")
      .select(
        `
        id,
        start_at,
        session_type,
        member_id,
        members (
          id,
          member_code,
          line_user_id,
          line_channel_key,
          is_active,
          reservation_reminder_line_enabled
        ),
        stores ( name ),
        trainers ( display_name )
      `
      )
      .eq("status", "confirmed")
      .not("member_id", "is", null)
      .gte("start_at", windowStart)
      .lte("start_at", windowEnd);

    if (rErr) {
      return jsonResponse({ error: "reservations_fetch_failed", detail: rErr.message }, 500);
    }

    const results: Array<Record<string, unknown>> = [];

    for (const raw of (rows ?? []) as unknown as ReservationRow[]) {
      const member = Array.isArray(raw.members) ? raw.members[0] : raw.members;
      if (!member?.id || !member.is_active || !member.line_user_id) {
        results.push({ reservation_id: raw.id, sent: false, skipped: "member_or_line_missing" });
        continue;
      }
      if (member.reservation_reminder_line_enabled === false) {
        results.push({ reservation_id: raw.id, sent: false, skipped: "reminder_disabled" });
        continue;
      }

      const storeName = pickRelName(raw.stores, "name") || "店舗";
      const trainerName = pickRelName(raw.trainers, "display_name") || "担当トレーナー";
      const line = linePushTokenForMemberRow(
        {
          line_channel_key: member.line_channel_key,
          member_code: member.member_code,
        },
        storeName
      );
      if (!line.token) {
        results.push({
          reservation_id: raw.id,
          sent: false,
          error: "line_token_missing",
          line_source: line.source,
        });
        continue;
      }

      const surveyUrl = preSessionSurveyPageUrl(appUrl, {
        reservation_id: raw.id,
        member_id: member.id,
      });

      const { error: remClaimErr } = await supabase.from("reservation_line_reminder_dispatches").insert({
        reservation_id: raw.id,
        kind: "60m_reminder",
      });
      if (remClaimErr && isMissingTable(remClaimErr)) {
        return jsonResponse(
          {
            error: "migration_required",
            detail: "Supabase で reservation_line_reminder_dispatches のマイグレーションを実行してください",
          },
          500
        );
      }

      const reminderAlready = Boolean(remClaimErr && isDupInsertError(remClaimErr));
      if (remClaimErr && !reminderAlready) {
        results.push({
          reservation_id: raw.id,
          sent: false,
          error: "dispatch_claim_failed",
          detail: remClaimErr.message,
        });
        continue;
      }

      // リマインド済みなのにヒアリング未送信のとき、Flex だけ再送を試す
      if (reminderAlready) {
        const { error: surveyClaimErr } = await supabase.from("reservation_line_reminder_dispatches").insert({
          reservation_id: raw.id,
          kind: "60m_pre_session_survey",
        });
        if (surveyClaimErr && isDupInsertError(surveyClaimErr)) {
          results.push({ reservation_id: raw.id, sent: false, skipped: "already_sent_all" });
          continue;
        }
        if (surveyClaimErr) {
          results.push({
            reservation_id: raw.id,
            sent: false,
            error: "survey_dispatch_claim_failed",
            detail: surveyClaimErr.message,
          });
          continue;
        }
        const flexRes = await pushFlexOnly(line.token, String(member.line_user_id), surveyUrl);
        results.push({
          reservation_id: raw.id,
          member_code: member.member_code,
          sent: flexRes.ok,
          reminder_sent: false,
          survey_sent: flexRes.ok,
          survey_url: surveyUrl,
          ...(flexRes.ok ? {} : { error: "line_flex_push_failed", detail: flexRes.body }),
        });
        continue;
      }

      const reminderText = buildPreSessionReminderText({
        startAtUtcIso: raw.start_at,
        storeName,
        trainerName,
        sessionType: raw.session_type,
      });

      const push = await pushPreSessionReminderMessages({
        token: line.token,
        lineUserId: String(member.line_user_id),
        reminderText,
        surveyUrl,
      });

      if (!push.textOk) {
        // claim 済みだが送信失敗。次回は reminderAlready 分岐へ入るが、
        // テキスト再送はしない（二重防止優先）。Flex だけ再送される。
        results.push({
          reservation_id: raw.id,
          member_code: member.member_code,
          sent: false,
          error: "line_text_push_failed",
          survey_url: surveyUrl,
        });
        continue;
      }

      let surveyDispatchOk = false;
      if (push.flexOk) {
        const { error: surveyClaimErr } = await supabase.from("reservation_line_reminder_dispatches").insert({
          reservation_id: raw.id,
          kind: "60m_pre_session_survey",
        });
        if (!surveyClaimErr || isDupInsertError(surveyClaimErr)) {
          surveyDispatchOk = true;
        }
      }

      results.push({
        reservation_id: raw.id,
        member_code: member.member_code,
        sent: true,
        reminder_sent: true,
        survey_sent: push.flexOk,
        survey_dispatch_ok: surveyDispatchOk,
        survey_url: surveyUrl,
        start_at: raw.start_at,
        store_name: storeName,
        trainer_name: trainerName,
        line_source: line.source,
        ...(push.flexOk ? {} : { flex_error: push.flexDetail }),
      });
    }

    return jsonResponse(
      {
        ok: true,
        window: { min_minutes: WINDOW_MIN, max_minutes: WINDOW_MAX, start: windowStart, end: windowEnd },
        count: results.length,
        results,
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "unexpected_error", detail: message }, 500);
  }
}
