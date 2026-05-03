import { DateTime } from "luxon";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { dailyReportChannelToken, resolvePushRecipients } from "@/lib/dailyLineRecipients";
import { chunkLinePushText, pushLineTextChunks } from "@/lib/lineMessagingPush";
import { jsonResponse } from "@/app/api/booking-v2/_cors";

const TZ = "Asia/Tokyo";

function mustCronAuth(req: Request): boolean {
  const reportSecret = process.env.REPORT_CRON_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (reportSecret && got === reportSecret) return true;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  return false;
}

function sliceHhmm(t: string) {
  const s = String(t ?? "");
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function formatDateJa(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: TZ });
  return dt.isValid ? dt.setLocale("ja").toFormat("yyyy年M月d日（ccc）") : ymd;
}

function normalizeLocalHms(t: string): string {
  const s = String(t).trim();
  if (/^\d{2}:\d{2}$/u.test(s)) return `${s}:00`;
  if (s.length >= 8) return s.slice(0, 8);
  return s;
}

function isDupInsertError(err: { code?: string; message?: string } | null): boolean {
  const c = String(err?.code ?? "");
  const m = String(err?.message ?? "");
  return c === "23505" || m.includes("duplicate") || m.includes("unique");
}

/**
 * ダイキ（表示名に「ダイキ」を含むトレーナー、または DAIKI_TRAINER_ID）の
 * trainer_events について、開始の約60分前・約10分前に LINE リマインド。
 * 送信先は日報と同じ（LINE_DAILY_REPORT_* / EBI020）。
 */
export async function GET(req: Request) {
  try {
    if (!mustCronAuth(req)) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const token = dailyReportChannelToken();
    if (!token) {
      return jsonResponse({ error: "missing_token", detail: "LINE_CHANNEL_ACCESS_TOKEN 等" }, 500);
    }

    const supabase = createSupabaseServiceClient();
    const { ids: recipients, missing_line_for_codes } = await resolvePushRecipients(supabase);
    if (recipients.length === 0) {
      return jsonResponse(
        {
          error: "missing_recipients",
          detail: "日報と同じ送信先設定が必要です",
          missing_line_for_codes,
        },
        500
      );
    }

    const envTrainer = process.env.DAIKI_TRAINER_ID?.trim();
    let daikiId = envTrainer ?? null;
    if (!daikiId) {
      const { data: trows } = await supabase
        .from("trainers")
        .select("id,display_name")
        .eq("is_active", true)
        .ilike("display_name", "%ダイキ%")
        .limit(3);
      const list = trows ?? [];
      const exact = list.find((t) => String(t.display_name).trim() === "ダイキ");
      daikiId = (exact ?? list[0])?.id ?? null;
    }
    if (!daikiId) {
      return jsonResponse({ ok: true, skipped: true, reason: "daiki_trainer_not_found" }, 200);
    }

    const now = DateTime.now().setZone(TZ);
    const startYmd = now.toISODate()!;
    const endYmd = now.plus({ days: 14 }).toISODate()!;

    const { data: events, error: evErr } = await supabase
      .from("trainer_events")
      .select(
        `
        id,
        store_id,
        event_date,
        start_local,
        end_local,
        title,
        notes,
        stores ( name, timezone )
      `
      )
      .eq("trainer_id", daikiId)
      .gte("event_date", startYmd)
      .lte("event_date", endYmd);

    if (evErr) return jsonResponse({ error: "events_fetch_failed", detail: evErr.message }, 500);

    const results: Array<{ event_id: string; kind: string; sent: boolean }> = [];

    for (const ev of events ?? []) {
      const st = (ev as any).stores as { name?: string; timezone?: string | null } | null;
      const storeName = String(st?.name ?? "");
      const zone = String(st?.timezone ?? "").trim() || TZ;
      const startLoc = normalizeLocalHms(String((ev as any).start_local ?? ""));
      const endLoc = normalizeLocalHms(String((ev as any).end_local ?? ""));
      const eventDate = String((ev as any).event_date ?? "");
      const evStart = DateTime.fromISO(`${eventDate}T${startLoc}`, { zone });
      if (!evStart.isValid) continue;

      const msUntil = evStart.toMillis() - now.toMillis();
      const minsUntil = Math.floor(msUntil / 60000);
      if (msUntil <= 0) continue;

      const title = String((ev as any).title ?? "").trim() || "（無題）";
      const note = String((ev as any).notes ?? "").trim();
      const noteLine = note ? `\nメモ: ${note}` : "";

      const base = `店舗: ${storeName || "—"}
${formatDateJa(eventDate)} ${sliceHhmm(startLoc)}〜${sliceHhmm(endLoc)}
予定: ${title}${noteLine}`;

      const window60 = minsUntil >= 59 && minsUntil <= 61;
      const window10 = minsUntil >= 9 && minsUntil <= 11;

      if (window60) {
        const { error: insErr } = await supabase.from("trainer_event_reminder_dispatches").insert({
          event_id: String((ev as any).id),
          kind: "60min",
        });
        if (
          insErr &&
          (String(insErr.message ?? "").includes("trainer_event_reminder_dispatches") ||
            String(insErr.message ?? "").includes("does not exist"))
        ) {
          return jsonResponse(
            {
              error: "migration_required",
              detail: "Supabase で trainer_event_reminder_dispatches のマイグレーションを実行してください",
            },
            500
          );
        }
        if (!insErr) {
          const text = `【ダイキ｜予定リマインド】約60分後\n${base}`;
          const chunks = chunkLinePushText(text);
          for (const to of recipients) {
            await pushLineTextChunks({ token, toUserId: to, chunks });
          }
          results.push({ event_id: String((ev as any).id), kind: "60min", sent: true });
        } else if (!isDupInsertError(insErr)) {
          results.push({ event_id: String((ev as any).id), kind: "60min", sent: false });
        }
      }

      if (window10) {
        const { error: insErr } = await supabase.from("trainer_event_reminder_dispatches").insert({
          event_id: String((ev as any).id),
          kind: "10min",
        });
        if (
          insErr &&
          (String(insErr.message ?? "").includes("trainer_event_reminder_dispatches") ||
            String(insErr.message ?? "").includes("does not exist"))
        ) {
          return jsonResponse(
            {
              error: "migration_required",
              detail: "Supabase で trainer_event_reminder_dispatches のマイグレーションを実行してください",
            },
            500
          );
        }
        if (!insErr) {
          const text = `【ダイキ｜予定リマインド】約10分後\n${base}`;
          const chunks = chunkLinePushText(text);
          for (const to of recipients) {
            await pushLineTextChunks({ token, toUserId: to, chunks });
          }
          results.push({ event_id: String((ev as any).id), kind: "10min", sent: true });
        } else if (!isDupInsertError(insErr)) {
          results.push({ event_id: String((ev as any).id), kind: "10min", sent: false });
        }
      }
    }

    return jsonResponse({ ok: true, daiki_trainer_id: daikiId, results }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "unexpected_error", detail: message }, 500);
  }
}
