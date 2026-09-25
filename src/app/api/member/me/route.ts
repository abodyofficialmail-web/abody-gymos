import { DateTime } from "luxon";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { getMemberIdFromCookie } from "../_cookies";
import { isMemberWeightLogEnabled } from "@/lib/memberWeightLogRollout";
import { isMemberMealPersonalEnabled } from "@/lib/memberMealPersonalRollout";
import {
  fetchMealPersonalPassForMemberId,
  mealPersonalPassPriceLabel,
} from "@/lib/memberMealPersonalPass";
import { fetchTrainerVisibilityPassForMemberId, trainerVisibilityPassPriceLabel } from "@/lib/trainerVisibilityPass";
import { fetchOnShiftTrainerNamesBySlots } from "@/lib/onShiftTrainers";
import { canBookOrLogin } from "@/lib/memberMembershipStatus";
import { remainingBookableKoma } from "@/lib/booking/memberBookingRules";
import { loadMemberBookingRuleContext, snapshotFromContext } from "@/lib/booking/memberBookingRulesDb";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const TZ = "Asia/Tokyo";

/** 「2枚は2026-09-30まで、2枚は2026-10-07まで」を画面用に短くする。 */
function formatTicketExpiryNote(note: string): string | null {
  const parts = [...note.matchAll(/(\d+)枚は(\d{4})-(\d{2})-(\d{2})まで/g)];
  if (parts.length === 0) return null;
  return parts.map((p) => `${p[1]}枚は${Number(p[3])}/${Number(p[4])}まで`).join("、");
}

function isMissingDbColumn(err: { message?: string } | null | undefined, column: string): boolean {
  const msg = String(err?.message ?? "");
  return new RegExp(column, "i").test(msg) && (/does not exist|column/i.test(msg) || /PGRST/i.test(msg) || /Could not find/i.test(msg));
}

function isMissingReminderColumn(err: { message?: string } | null | undefined): boolean {
  return isMissingDbColumn(err, "reservation_reminder_line_enabled");
}

function isMissingWeightReminderColumn(err: { message?: string } | null | undefined): boolean {
  return isMissingDbColumn(err, "weight_reminder_line_enabled");
}

const patchSchema = z
  .object({
    reservation_reminder_line_enabled: z.boolean().optional(),
    weight_reminder_line_enabled: z.boolean().optional(),
  })
  .refine(
    (d) => d.reservation_reminder_line_enabled !== undefined || d.weight_reminder_line_enabled !== undefined,
    { message: "at least one setting required" }
  );

export async function GET() {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return json({ error: "未ログイン" }, 401);

    const supabase = createSupabaseServiceClient();

    const selectWithBothReminders =
      "id, member_code, name, email, line_user_id, is_active, membership_status, reservation_reminder_line_enabled, weight_reminder_line_enabled";
    const selectWithReservationReminder =
      "id, member_code, name, email, line_user_id, is_active, membership_status, reservation_reminder_line_enabled";
    const selectLegacy = "id, member_code, name, email, line_user_id, is_active, membership_status";
    const selectNoStatus = "id, member_code, name, email, line_user_id, is_active";

    let { data: member, error: mErr } = await (supabase as any)
      .from("members")
      .select(selectWithBothReminders)
      .eq("id", memberId)
      .maybeSingle();
    if (mErr && isMissingWeightReminderColumn(mErr)) {
      const second = await (supabase as any)
        .from("members")
        .select(selectWithReservationReminder)
        .eq("id", memberId)
        .maybeSingle();
      member = second.data;
      mErr = second.error;
    }
    if (mErr && isMissingReminderColumn(mErr)) {
      const second = await (supabase as any).from("members").select(selectLegacy).eq("id", memberId).maybeSingle();
      member = second.data;
      mErr = second.error;
    }
    if (mErr && /membership_status/i.test(String(mErr.message ?? ""))) {
      const third = await (supabase as any).from("members").select(selectNoStatus).eq("id", memberId).maybeSingle();
      member = third.data;
      mErr = third.error;
    }
    if (mErr) return json({ error: "会員の取得に失敗しました", detail: mErr.message }, 500);
    if (!member || !canBookOrLogin({ membershipStatus: member.membership_status, isActive: member.is_active })) {
      return json({ error: "未ログイン" }, 401);
    }

    let ticketKoma = 0;
    let remainingBookable: number | null = null;
    try {
      const nowIso = new Date().toISOString();
      const ctx = await loadMemberBookingRuleContext(supabase, { memberId, nowIso });
      const snap = snapshotFromContext(ctx, nowIso);
      ticketKoma = snap.ticketKoma;
      remainingBookable = remainingBookableKoma(snap);
    } catch (e) {
      console.error("member remaining bookable failed", e);
    }
    const ticketRow = await (supabase as any)
      .from("members")
      .select("bonus_ticket_koma")
      .eq("id", memberId)
      .maybeSingle();
    if (!ticketRow.error) {
      ticketKoma = Math.max(0, Number(ticketRow.data?.bonus_ticket_koma ?? 0) || 0);
    }
    let ticketExpiryText: string | null = null;
    const ledger = await (supabase as any)
      .from("member_ticket_ledger")
      .select("note, created_at")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(8);
    if (!ledger.error) {
      const note = ((ledger.data ?? []) as { note?: string | null }[])
        .map((row) => String(row.note ?? ""))
        .find((text) => text.includes("まで"));
      ticketExpiryText = formatTicketExpiryNote(note ?? "");
    }

    // マイページは「当月」だけだと月末に翌月予約が見えないため、今月〜翌月の2ヶ月分を返す
    const monthKey = DateTime.now().setZone(TZ).toFormat("yyyy-MM");
    const start = DateTime.fromISO(`${monthKey}-01`, { zone: TZ }).startOf("month");
    const end = start.plus({ months: 2 });

    const reservationSelectFull =
      "id, start_at, end_at, session_type, trainer_id, member_id, store_id, status, created_at, reschedule_count";
    const reservationSelectLegacy =
      "id, start_at, end_at, session_type, trainer_id, member_id, store_id, status, created_at";

    let resQuery = (supabase as any)
      .from("reservations")
      .select(reservationSelectFull)
      .eq("member_id", memberId)
      .neq("status", "cancelled")
      .gte("start_at", start.toUTC().toISO()!)
      .lt("start_at", end.toUTC().toISO()!)
      .order("start_at", { ascending: true });
    let { data: resRows, error: rErr } = await resQuery;
    if (rErr) {
      const msg = String(rErr.message ?? "");
      const retry =
        /reschedule_count|does not exist|column/i.test(msg) || (/PGRST/i.test(msg) && /column/i.test(msg));
      if (retry) {
        const second = await (supabase as any)
          .from("reservations")
          .select(reservationSelectLegacy)
          .eq("member_id", memberId)
          .neq("status", "cancelled")
          .gte("start_at", start.toUTC().toISO()!)
          .lt("start_at", end.toUTC().toISO()!)
          .order("start_at", { ascending: true });
        resRows = second.data;
        rErr = second.error;
      }
    }
    if (rErr) return json({ error: "予約の取得に失敗しました", detail: rErr.message }, 500);

    const rows = (resRows ?? []) as any[];
    const storeIds = Array.from(new Set(rows.map((r) => r.store_id).filter(Boolean)));
    const trainerIds = Array.from(new Set(rows.map((r) => r.trainer_id).filter(Boolean))) as string[];
    const [storesRes, trainersRes] = await Promise.all([
      storeIds.length
        ? (supabase as any).from("stores").select("id, name").in("id", storeIds)
        : Promise.resolve({ data: [], error: null }),
      trainerIds.length
        ? (supabase as any).from("trainers").select("id, display_name").in("id", trainerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const storeById = new Map<string, string>((storesRes.data ?? []).map((s: any) => [s.id, String(s.name ?? "")]));
    const trainerById = new Map<string, string>(
      (trainersRes.data ?? []).map((t: any) => [t.id, String(t.display_name ?? "")])
    );
    const reservations = rows.map((r: any) => ({
      ...r,
      stores: { name: storeById.get(r.store_id) ?? "" },
      trainers: r.trainer_id ? { display_name: trainerById.get(r.trainer_id) ?? "" } : null,
    }));

    // client_notes は環境によって未作成/スキーマキャッシュ未反映の場合があるため、失敗しても予約表示は継続する
    let notes: any[] = [];
    {
      const { data: notesData, error: nErr } = await (supabase as any)
        .from("client_notes")
        .select(
          `
            id,
            member_id,
            store_id,
            trainer_id,
            date,
            content,
            created_at,
            trainers(id, display_name),
            stores(id, name)
          `
        )
        .eq("member_id", memberId)
        .order("date", { ascending: false })
        .limit(30);
      if (nErr) {
        const msg = String(nErr.message ?? "");
        const isMissingTable = msg.includes("Could not find the table") || msg.includes("does not exist");
        if (!isMissingTable) return json({ error: "カルテの取得に失敗しました", detail: nErr.message }, 500);
        notes = [];
      } else {
        notes = notesData ?? [];
      }
    }

    const reminderEnabled =
      typeof (member as any).reservation_reminder_line_enabled === "boolean"
        ? Boolean((member as any).reservation_reminder_line_enabled)
        : true;
    const weightReminderEnabled =
      typeof (member as any).weight_reminder_line_enabled === "boolean"
        ? Boolean((member as any).weight_reminder_line_enabled)
        : true;

    const trainerVisibilityPass = await fetchTrainerVisibilityPassForMemberId(
      supabase,
      memberId,
      String((member as any).email ?? "")
    );
    const mealPersonalPass = await fetchMealPersonalPassForMemberId(
      supabase,
      memberId,
      String(member.member_code ?? "")
    );
    const mealPersonalEnabled = mealPersonalPass.active || isMemberMealPersonalEnabled(member.member_code);

    let onShiftNames: string[] = reservations.map(() => "");
    if (trainerVisibilityPass.active && reservations.length > 0) {
      try {
        onShiftNames = await fetchOnShiftTrainerNamesBySlots(
          supabase,
          reservations.map((r: any) => ({
            store_id: String(r.store_id ?? ""),
            start_at: String(r.start_at ?? ""),
            end_at: String(r.end_at ?? r.start_at ?? ""),
          }))
        );
      } catch (e) {
        console.error("member me on-shift trainers failed", e);
      }
    }

    return json(
      {
        member: {
          id: member.id,
          member_code: member.member_code,
          name: member.name ?? "",
          email: (member as any).email ?? null,
          line_user_id: member.line_user_id ?? null,
          reservation_reminder_line_enabled: reminderEnabled,
          weight_reminder_line_enabled: weightReminderEnabled,
          weight_log_enabled: isMemberWeightLogEnabled(member.member_code),
          meal_personal_enabled: mealPersonalEnabled,
          ticket_koma: ticketKoma,
          ticket_expiry_text: ticketExpiryText,
          remaining_bookable_koma: remainingBookable,
        },
        meal_personal_pass: {
          ...mealPersonalPass,
          price_label: mealPersonalPassPriceLabel(),
        },
        trainer_visibility_pass: {
          ...trainerVisibilityPass,
          price_label: trainerVisibilityPassPriceLabel(),
        },
        reservations: (reservations ?? []).map((r: any, i: number) => ({
          id: r.id,
          start_at: r.start_at,
          end_at: r.end_at,
          session_type: r.session_type ?? "store",
          reschedule_count: (r as any)?.reschedule_count ?? 0,
          store_id: r.store_id,
          store_name: r.stores?.name ?? "",
          trainer_id: r.trainer_id,
          trainer_name: r.trainers?.display_name ?? "",
          on_shift_trainer_names: onShiftNames[i] || "",
          status: r.status,
        })),
        notes: (notes ?? []).map((n: any) => ({
          id: n.id,
          date: n.date,
          store_id: n.store_id,
          store_name: n.stores?.name ?? "",
          trainer_id: n.trainer_id,
          trainer_name: n.trainers?.display_name ?? "",
          content: n.content,
        })),
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "エラーが発生しました", detail: message }, 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return json({ error: "未ログイン" }, 401);

    const raw = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();

    const { data: member, error: mErr } = await (supabase as any)
      .from("members")
      .select("id, is_active, membership_status")
      .eq("id", memberId)
      .maybeSingle();
    if (mErr && /membership_status/i.test(String(mErr.message ?? ""))) {
      const retry = await (supabase as any).from("members").select("id, is_active").eq("id", memberId).maybeSingle();
      if (retry.error) return json({ error: "会員の取得に失敗しました", detail: retry.error.message }, 500);
      if (!retry.data || !canBookOrLogin({ membershipStatus: null, isActive: retry.data.is_active })) {
        return json({ error: "未ログイン" }, 401);
      }
    } else {
      if (mErr) return json({ error: "会員の取得に失敗しました", detail: mErr.message }, 500);
      if (!member || !canBookOrLogin({ membershipStatus: member.membership_status, isActive: member.is_active })) {
        return json({ error: "未ログイン" }, 401);
      }
    }

    const update: Record<string, boolean> = {};
    if (parsed.data.reservation_reminder_line_enabled !== undefined) {
      update.reservation_reminder_line_enabled = parsed.data.reservation_reminder_line_enabled;
    }
    if (parsed.data.weight_reminder_line_enabled !== undefined) {
      update.weight_reminder_line_enabled = parsed.data.weight_reminder_line_enabled;
    }

    const selectCols = ["id", ...Object.keys(update)].join(", ");
    const { data: updated, error: uErr } = await (supabase as any)
      .from("members")
      .update(update)
      .eq("id", memberId)
      .select(selectCols)
      .maybeSingle();

    if (uErr) {
      if (isMissingReminderColumn(uErr) || isMissingWeightReminderColumn(uErr)) {
        return json(
          {
            error: "設定の保存準備ができていません。しばらくしてからお試しください。",
            detail: uErr.message,
          },
          503
        );
      }
      return json({ error: "設定の更新に失敗しました", detail: uErr.message }, 500);
    }

    return json(
      {
        ok: true,
        member: {
          id: updated?.id ?? memberId,
          reservation_reminder_line_enabled:
            parsed.data.reservation_reminder_line_enabled !== undefined
              ? Boolean(updated?.reservation_reminder_line_enabled ?? parsed.data.reservation_reminder_line_enabled)
              : undefined,
          weight_reminder_line_enabled:
            parsed.data.weight_reminder_line_enabled !== undefined
              ? Boolean(updated?.weight_reminder_line_enabled ?? parsed.data.weight_reminder_line_enabled)
              : undefined,
        },
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "エラーが発生しました", detail: message }, 500);
  }
}
