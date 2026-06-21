import { DateTime } from "luxon";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { lineAccessTokenForChannelKey, linePushTokenForMember, type LineChannelKey } from "@/lib/lineChannel";
import { lineMessageWithReservationDetails } from "@/lib/lineReservationMessage";
import { pushLineTextAsChunks } from "@/lib/lineMessagingPush";
import { pushSessionSurveyInviteLine } from "@/lib/sessionSurveyLine";
import { sessionSurveyPageUrlFromInviteToken } from "@/lib/sessionSurvey";

const TZ = "Asia/Tokyo";

function mustCronAuth(req: Request): boolean {
  const reportSecret = process.env.REPORT_CRON_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (reportSecret && got === reportSecret) return true;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const serviceKey = req.headers.get("x-service-role-key") ?? "";
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (expected && serviceKey === expected) return true;
  return false;
}

function messageForClientNote(params: { storeName: string; dateYmd: string; content: string }): string {
  const date = DateTime.fromISO(params.dateYmd, { zone: TZ });
  const dateLabel = date.isValid ? date.setLocale("ja").toFormat("M月d日（ccc）") : params.dateYmd;
  return `
【カルテを共有しました】
店舗：${params.storeName}
日付：${dateLabel}

${String(params.content ?? "").trim()}
`.trim();
}

const dateYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const bodySchema = z.object({
  member_code: z.string().min(1),
  line_channel_key: z.enum(["default", "ueno", "sakuragicho", "shinjuku"]).optional(),
  june: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  include_karte: z.boolean().optional().default(true),
  include_reservations: z.boolean().optional().default(true),
  include_session_surveys: z.boolean().optional().default(false),
  karte_dates: z.array(dateYmd).optional(),
  session_dates: z.array(dateYmd).optional(),
  dry_run: z.boolean().optional().default(false),
});

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function POST(req: Request) {
  try {
    if (!mustCronAuth(req)) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return jsonResponse({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
    }

    const code = parsed.data.member_code.trim().toUpperCase();
    const channelKey: LineChannelKey = parsed.data.line_channel_key ?? "default";
    const token = lineAccessTokenForChannelKey(channelKey);
    if (!parsed.data.dry_run && !token) {
      return jsonResponse({ error: "missing_token", channel: channelKey }, 500);
    }

    const supabase = createSupabaseServiceClient();

    let member: {
      id: string;
      member_code: string;
      name: string | null;
      line_user_id: string | null;
      line_channel_key?: string | null;
      is_active: boolean;
    } | null = null;

    const full = await (supabase as any)
      .from("members")
      .select("id, member_code, name, line_user_id, line_channel_key, is_active")
      .eq("member_code", code)
      .maybeSingle();
    if (full.error && /line_channel_key/i.test(String(full.error.message))) {
      const slim = await (supabase as any)
        .from("members")
        .select("id, member_code, name, line_user_id, is_active")
        .eq("member_code", code)
        .maybeSingle();
      if (slim.error) return jsonResponse({ error: slim.error.message }, 500);
      member = slim.data;
    } else if (full.error) {
      return jsonResponse({ error: full.error.message }, 500);
    } else {
      member = full.data;
    }

    if (!member?.is_active) {
      return jsonResponse({ error: "member_not_found_or_inactive", member_code: code }, 404);
    }
    if (!member.line_user_id) {
      return jsonResponse({ error: "no_line_user_id", member_code: code }, 400);
    }

    if (!parsed.data.dry_run) {
      const { error: upErr } = await (supabase as any)
        .from("members")
        .update({ line_channel_key: channelKey, updated_at: new Date().toISOString() })
        .eq("id", member.id);
      if (upErr && !/line_channel_key/i.test(String(upErr.message))) {
        return jsonResponse({ error: "member_update_failed", detail: upErr.message }, 500);
      }
    }

    const pushToken =
      token ??
      linePushTokenForMember({
        lineChannelKey: channelKey,
        memberCode: member.member_code,
        fallbackStoreName: null,
      }).token;

    const results: { karte: unknown[]; reservations: unknown[]; session_surveys: unknown[] } = {
      karte: [],
      reservations: [],
      session_surveys: [],
    };

    const karteDateFilter = parsed.data.karte_dates?.length ? new Set(parsed.data.karte_dates) : null;
    const sessionDateFilter = parsed.data.session_dates?.length ? new Set(parsed.data.session_dates) : null;

    if (parsed.data.include_karte) {
      let notesQuery = (supabase as any)
        .from("client_notes")
        .select("id, date, content, stores(name)")
        .eq("member_id", member.id)
        .order("date", { ascending: true });
      if (karteDateFilter) {
        notesQuery = notesQuery.in("date", [...karteDateFilter]);
      }
      const { data: notes, error: nErr } = await notesQuery;
      if (nErr) return jsonResponse({ error: nErr.message }, 500);

      for (const n of notes ?? []) {
        const storeName = String(n.stores?.name ?? "");
        const text = messageForClientNote({ storeName, dateYmd: n.date, content: n.content });
        if (parsed.data.dry_run) {
          results.karte.push({ date: n.date, store: storeName, dry_run: true });
          continue;
        }
        const ok = await pushLineTextAsChunks(pushToken!, member.line_user_id, text);
        results.karte.push({ date: n.date, store: storeName, ok });
      }
    }

    if (parsed.data.include_reservations) {
      let q = (supabase as any)
        .from("reservations")
        .select("id, start_at, end_at, session_type, stores(name)")
        .eq("member_id", member.id)
        .eq("status", "confirmed")
        .order("start_at", { ascending: true });

      if (parsed.data.june) {
        const j = parsed.data.june;
        const end = DateTime.fromISO(`${j}-01`, { zone: TZ }).endOf("month").toISO();
        q = q.gte("start_at", `${j}-01T00:00:00+09:00`).lte("start_at", end);
      }

      const { data: rows, error: rErr } = await q;
      if (rErr) return jsonResponse({ error: rErr.message }, 500);

      for (const r of rows ?? []) {
        const storeName = String(r.stores?.name ?? "恵比寿");
        const sessionType: "store" | "online" = r.session_type === "online" ? "online" : "store";
        const text = lineMessageWithReservationDetails({
          storeName,
          startAtUtcIso: r.start_at,
          endAtUtcIso: r.end_at,
          sessionType,
        });
        if (parsed.data.dry_run) {
          results.reservations.push({ start_at: r.start_at, store: storeName, session_type: sessionType, dry_run: true });
          continue;
        }
        const ok = await pushLineTextAsChunks(pushToken!, member.line_user_id, text);
        results.reservations.push({ start_at: r.start_at, store: storeName, session_type: sessionType, ok });
      }
    }

    if (parsed.data.include_session_surveys) {
      let invitesQuery = (supabase as any)
        .from("session_survey_invites")
        .select("id, session_date, trainers(display_name), stores(name)")
        .eq("member_id", member.id)
        .order("session_date", { ascending: true });
      if (sessionDateFilter) {
        invitesQuery = invitesQuery.in("session_date", [...sessionDateFilter]);
      }
      const { data: invites, error: iErr } = await invitesQuery;
      if (iErr) return jsonResponse({ error: iErr.message }, 500);

      for (const inv of invites ?? []) {
        const sessionDate = String(inv.session_date ?? "");
        const storeName = String(inv.stores?.name ?? "");
        const trainerDisplayName = String(inv.trainers?.display_name ?? "");
        const surveyUrl = sessionSurveyPageUrlFromInviteToken(String(inv.id));

        if (parsed.data.dry_run) {
          results.session_surveys.push({ session_date: sessionDate, store: storeName, dry_run: true });
          continue;
        }

        const sent = await pushSessionSurveyInviteLine({
          lineUserId: member.line_user_id,
          memberCode: member.member_code,
          lineChannelKey: channelKey,
          storeName,
          trainerDisplayName,
          inviteToken: surveyUrl,
        });
        if (sent) {
          await (supabase as any)
            .from("session_survey_invites")
            .update({ line_sent_at: new Date().toISOString() })
            .eq("id", inv.id);
        }
        results.session_surveys.push({ session_date: sessionDate, store: storeName, ok: sent });
      }
    }

    return jsonResponse(
      {
        ok: true,
        member_code: code,
        line_channel_key: channelKey,
        dry_run: parsed.data.dry_run,
        results,
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: message }, 500);
  }
}
