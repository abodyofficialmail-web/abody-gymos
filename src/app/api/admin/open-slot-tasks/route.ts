import { DateTime } from "luxon";
import { z } from "zod";
import { GET as getAvailableSlots } from "@/app/api/booking-v2/available-slots/route";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { getAppUrl } from "@/lib/constants";
import { normalizeLineChannelKey } from "@/lib/lineChannel";
import { pushLineTextForMember } from "@/lib/lineMessagingPush";
import {
  buildMemberInviteText,
  buildOpenSlotTaskReportText,
  buildSessionExtendText,
  extendedReservationRange,
  openSlotTaskByKey,
  type OpenSlotTaskKey,
} from "@/lib/openSlotTasks";
import { pushOpsLineImages, pushOpsLineNotice } from "@/lib/paymentLinkNotify";
import { validateOpenSlotSupplies } from "@/lib/openSlotSupplies";
import {
  isUenoStoreName,
  validateUenoCleaningSubmission,
  type UenoCleaningPhotoSlot,
} from "@/lib/uenoOpenSlotCleaning";
import { insertReservationChangeLog, requestUserAgent } from "@/lib/reservationChangeLog";
import { listStoreLowBookingMembers } from "@/lib/storeLowBookingMembers";
import { isProtectedTrainerName, verifyTrainerPassword } from "@/lib/trainerGate";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

const TZ = "Asia/Tokyo";

export const maxDuration = 60;

const taskKeySchema = z.enum(["cleaning", "sns", "machine", "invite", "extend", "supplies", "other"]);

const cleaningSchema = z.object({
  area_key: z.enum(["booth", "pilates", "rest", "kitchen"]),
  checks: z.array(z.object({ place_key: z.string().min(1).max(40), step_key: z.string().min(1).max(40), done: z.boolean() })).max(40),
  photos: z
    .array(
      z.object({
        place_key: z.string().min(1).max(40),
        step_key: z.string().min(1).max(40),
        data_base64: z.string().min(100).max(700_000),
      })
    )
    .max(8),
  note: z.string().max(400).optional(),
});

const suppliesSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.enum(["wet-wipes", "kitchen-paper", "tissue", "toilet-paper", "paper-cup", "sanitizer", "detergent", "cleaning", "other"]),
        quantity: z.number().int().min(1).max(999),
        note: z.string().max(80).optional(),
      })
    )
    .max(9),
  receipts: z.array(z.object({ data_base64: z.string().min(100).max(700_000) })).max(3),
});

const postSchema = z.object({
  store_id: z.string().uuid(),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
  task_key: taskKeySchema,
  detail: z.string().max(400).optional(),
  cleaning: cleaningSchema.optional(),
  supplies: suppliesSchema.optional(),
  member_id: z.string().uuid().optional(),
  reservation_id: z.string().uuid().optional(),
  operator_trainer_id: z.string().uuid(),
  operator_password: z.string().optional(),
  low_booking_member_ids: z.array(z.string().uuid()).max(200).optional(),
  low_booking_max: z.number().int().min(0).max(31).optional(),
});

const OPEN_SLOT_PHOTO_BUCKET = "open-slot-task-photos";

type SlotDto = { start_at: string; end_at: string };

function isMissingReportsTable(error: { message?: string } | null | undefined) {
  const msg = String(error?.message ?? "");
  return /open_slot_task_reports/i.test(msg) && /does not exist|schema cache|Could not find|relation/i.test(msg);
}

async function listTodayOpenSlots(storeId: string, dateYmd: string): Promise<SlotDto[]> {
  const req = new Request(
    `http://open-slots.internal/api/booking-v2/available-slots?store_id=${encodeURIComponent(storeId)}&date=${encodeURIComponent(dateYmd)}&ignore_cutoff=1&include_past=1`
  );
  const res = await getAvailableSlots(req);
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) return [];
  return (body as SlotDto[])
    .filter((slot) => DateTime.fromISO(String(slot.start_at ?? "")).setZone(TZ).isValid)
    .map((slot) => ({ start_at: String(slot.start_at), end_at: String(slot.end_at) }));
}

function sameInstant(a: string, b: string) {
  const da = DateTime.fromISO(a);
  const db = DateTime.fromISO(b);
  if (!da.isValid || !db.isValid) return false;
  return Math.abs(da.toMillis() - db.toMillis()) < 2000;
}

function memberLabel(member: { name?: string | null; member_code?: string | null }) {
  const name = String(member.name ?? "").trim() || "会員";
  const code = String(member.member_code ?? "").trim();
  return code ? `${name}（${code}）` : name;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const storeId = String(url.searchParams.get("store_id") ?? "");
    const dateYmd = String(url.searchParams.get("date") ?? "");
    if (!z.string().uuid().safeParse(storeId).success || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
      return jsonResponse({ error: "店舗と日付を確認してください" }, 400);
    }
    const today = DateTime.now().setZone(TZ).toISODate();
    const slots = dateYmd === today ? await listTodayOpenSlots(storeId, dateYmd) : [];

    const supabase = createSupabaseServiceClient();
    const dayStart = DateTime.fromISO(dateYmd, { zone: TZ }).startOf("day").toUTC().toISO();
    const dayEnd = DateTime.fromISO(dateYmd, { zone: TZ }).plus({ days: 1 }).startOf("day").toUTC().toISO();
    const { data, error } = await supabase
      .from("open_slot_task_reports")
      .select(
        "id, store_id, slot_start_at, slot_end_at, task_key, task_label, detail, operator_name, member_label, reservation_id, created_at"
      )
      .eq("store_id", storeId)
      .gte("slot_start_at", dayStart ?? "")
      .lt("slot_start_at", dayEnd ?? "")
      .order("created_at", { ascending: true });
    if (error) {
      if (isMissingReportsTable(error)) {
        return jsonResponse({ slots, reports: [], reports_ready: false }, 200);
      }
      return jsonResponse({ error: "タスク報告の取得に失敗しました", detail: error.message }, 500);
    }
    return jsonResponse({ slots, reports: data ?? [], reports_ready: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "空き枠の取得に失敗しました", detail: message }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = postSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonResponse({ error: "入力内容を確認してください", detail: parsed.error.flatten() }, 400);

    const body = parsed.data;
    const task = openSlotTaskByKey(body.task_key);
    if (!task) return jsonResponse({ error: "タスクを選んでください" }, 400);

    const start = DateTime.fromISO(body.start_at).setZone(TZ);
    const end = DateTime.fromISO(body.end_at).setZone(TZ);
    if (!start.isValid || !end.isValid || end <= start) {
      return jsonResponse({ error: "空き枠の時間を確認してください" }, 400);
    }
    const minutes = end.diff(start, "minutes").as("minutes");
    if (minutes < 20 || minutes > 40) return jsonResponse({ error: "空き枠は30分です" }, 400);

    const today = DateTime.now().setZone(TZ).toISODate();
    const dateYmd = start.toISODate();
    if (!dateYmd || dateYmd !== today) return jsonResponse({ error: "当日の空き枠だけ実行できます" }, 400);

    const note = String(body.detail ?? "").trim();
    if (body.task_key === "other" && !note) return jsonResponse({ error: "その他タスクの内容を書いてください" }, 400);
    if (body.task_key === "invite" && !body.member_id) return jsonResponse({ error: "案内する会員を選んでください" }, 400);
    const broadcastIds = body.low_booking_member_ids ?? [];
    if (body.task_key === "extend" && body.reservation_id && broadcastIds.length > 0) {
      return jsonResponse({ error: "延長と一斉送信は分けて実行してください" }, 400);
    }
    if (body.task_key === "extend" && !body.reservation_id && broadcastIds.length === 0) {
      return jsonResponse({ error: "延長する予約か、案内する会員を選んでください" }, 400);
    }

    const supabase = createSupabaseServiceClient();
    const operator = await resolveOperator(supabase, body.operator_trainer_id, body.operator_password);
    if (!operator.ok) return jsonResponse({ error: operator.error, code: operator.code }, operator.status);

    const { data: store, error: storeErr } = await supabase.from("stores").select("id, name").eq("id", body.store_id).maybeSingle();
    if (storeErr) return jsonResponse({ error: "店舗の確認に失敗しました", detail: storeErr.message }, 500);
    if (!store) return jsonResponse({ error: "店舗が見つかりません" }, 404);
    const storeName = String(store.name ?? "");

    const slots = await listTodayOpenSlots(store.id, dateYmd);
    const slot = slots.find((item) => sameInstant(item.start_at, body.start_at) && sameInstant(item.end_at, body.end_at));
    if (!slot) return jsonResponse({ error: "この時間はもう空き枠ではありません" }, 409);

    let memberId: string | null = null;
    let memberText: string | null = null;
    let reservationId: string | null = null;
    let execution = "";
    let memberNotified: boolean | null = null;
    let taskLabel: string = task.label;

    if (body.task_key === "invite") {
      const sent = await sendMemberInvite(supabase, {
        memberId: body.member_id!,
        storeName,
        startAt: slot.start_at,
        endAt: slot.end_at,
      });
      if (!sent.ok) return jsonResponse({ error: sent.error }, sent.status);
      memberId = sent.memberId;
      memberText = sent.memberLabel;
      execution = `${sent.memberLabel}へ、この枠の予約案内をLINEで送りました`;
      memberNotified = true;
    }

    if (body.task_key === "extend" && broadcastIds.length > 0) {
      const invited = await sendLowBookingSlotInvites(supabase, {
        storeId: store.id,
        storeName,
        startAt: slot.start_at,
        endAt: slot.end_at,
        memberIds: broadcastIds,
        maxCount: body.low_booking_max ?? 4,
      });
      if (!invited.ok) return jsonResponse({ error: invited.error }, invited.status);
      memberText = invited.memberLabel;
      execution = invited.summary;
      memberNotified = true;
      taskLabel = "予約が少ない会員へ案内";
    }

    if (body.task_key === "extend" && broadcastIds.length === 0) {
      const extended = await extendMemberSession({
        supabase,
        request,
        reservationId: body.reservation_id!,
        storeId: store.id,
        storeName,
        slot,
        operator,
      });
      if (!extended.ok) return jsonResponse({ error: extended.error }, extended.status);
      memberId = extended.memberId;
      memberText = extended.memberLabel;
      reservationId = extended.reservationId;
      execution = extended.summary;
      memberNotified = extended.memberNotified;
    }

    const uenoCleaning = body.task_key === "cleaning" && isUenoStoreName(storeName);
    let detail = [execution, note].map((part) => part.trim()).filter(Boolean).join("\n") || null;
    let photoCount = 0;
    let photoUrls: string[] = [];
    if (body.task_key === "supplies") {
      if (!body.supplies) return jsonResponse({ error: "品目を選んでください" }, 400);
      const supplies = validateOpenSlotSupplies({
        items: body.supplies.items.map((item) => ({ key: item.key, quantity: item.quantity, note: item.note })),
        receiptCount: body.supplies.receipts.length,
      });
      if (!supplies.ok) return jsonResponse({ error: supplies.error }, 400);
      const uploaded = await uploadOpenSlotJpegs(
        supabase,
        body.supplies.receipts.map((receipt, index) => ({
          path: `${store.id}/${DateTime.fromISO(slot.start_at).toUTC().toFormat("yyyyLLddHHmmss")}/supplies/receipt-${index + 1}.jpg`,
          dataBase64: receipt.data_base64,
          label: `領収書${index + 1}`,
        }))
      );
      if (!uploaded.ok) return jsonResponse({ error: uploaded.error }, uploaded.status);
      detail = supplies.detail;
      photoUrls = uploaded.urls;
      photoCount = uploaded.urls.length;
    }
    if (uenoCleaning) {
      if (!body.cleaning) return jsonResponse({ error: "掃除の場所を選んでください" }, 400);
      const cleaning = validateUenoCleaningSubmission({
        areaKey: body.cleaning.area_key,
        slotStart: slot.start_at,
        checks: body.cleaning.checks.map((check) => ({ placeKey: check.place_key, stepKey: check.step_key, done: check.done })),
        photos: body.cleaning.photos.map((photo) => ({ placeKey: photo.place_key, stepKey: photo.step_key })),
        note: body.cleaning.note,
      });
      if (!cleaning.ok) return jsonResponse({ error: cleaning.error }, 400);
      const uploaded = await uploadUenoCleaningPhotos(supabase, {
        storeId: store.id,
        slotStart: slot.start_at,
        areaKey: body.cleaning.area_key,
        photos: body.cleaning.photos,
        slots: cleaning.slots,
      });
      if (!uploaded.ok) return jsonResponse({ error: uploaded.error }, uploaded.status);
      taskLabel = cleaning.taskLabel;
      detail = cleaning.detail;
      photoUrls = uploaded.urls;
      photoCount = uploaded.urls.length;
    }
    const reportText = buildOpenSlotTaskReportText({
      storeName,
      startAt: slot.start_at,
      endAt: slot.end_at,
      taskLabel,
      operatorName: operator.displayName,
      detail,
      memberLabel: memberText,
    });

    const { data: saved, error: saveErr } = await supabase
      .from("open_slot_task_reports")
      .insert({
        store_id: store.id,
        slot_start_at: slot.start_at,
        slot_end_at: slot.end_at,
        task_key: task.key as OpenSlotTaskKey,
        task_label: taskLabel,
        detail,
        operator_trainer_id: operator.trainerId,
        operator_name: operator.displayName,
        member_id: memberId,
        member_label: memberText,
        reservation_id: reservationId,
      })
      .select("id, task_label, detail, operator_name, member_label, slot_start_at, slot_end_at, created_at")
      .single();
    if (saveErr || !saved) {
      if (isMissingReportsTable(saveErr)) {
        return jsonResponse({ error: "報告の保存先がまだありません。データベースの更新が必要です" }, 500);
      }
      return jsonResponse(
        {
          error: reservationId
            ? "セッションは延長しましたが、報告の保存に失敗しました"
            : "報告の保存に失敗しました",
          detail: saveErr?.message,
        },
        500
      );
    }

    const notice = await pushOpsLineNotice(supabase, reportText);
    const images = photoUrls.length > 0 ? await pushOpsLineImages(supabase, photoUrls) : null;
    return jsonResponse(
      {
        report: saved,
        line: notice,
        photos: images ? { sent: images.ok ? photoCount : 0, failed: images.ok ? 0 : photoCount } : undefined,
        member_notified: memberNotified,
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "タスクの実行に失敗しました", detail: message }, 500);
  }
}

async function sendLowBookingSlotInvites(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  input: { storeId: string; storeName: string; startAt: string; endAt: string; memberIds: string[]; maxCount: number }
): Promise<
  | { ok: true; summary: string; memberLabel: string }
  | { ok: false; status: number; error: string }
> {
  const listed = await listStoreLowBookingMembers(supabase, input.storeId);
  const wanted = new Set(input.memberIds);
  const targets = listed.members.filter(
    (member) => wanted.has(member.id) && member.lineUserId && member.count <= input.maxCount
  );
  if (targets.length === 0) return { ok: false, status: 400, error: "案内できる会員がいません" };

  const text = buildMemberInviteText({
    storeName: input.storeName,
    startAt: input.startAt,
    endAt: input.endAt,
    bookingUrl: `${getAppUrl()}/booking`,
  });
  const sent: string[] = [];
  const failed: string[] = [];
  for (const member of targets) {
    const pushed = await pushLineTextForMember({
      toUserId: member.lineUserId!,
      text,
      memberCode: member.memberCode,
      lineChannelKey: normalizeLineChannelKey(member.lineChannelKey),
      storeName: input.storeName,
    });
    if (pushed.ok) sent.push(`${member.name}（${member.memberCode}）`);
    else failed.push(member.memberCode);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (sent.length === 0) return { ok: false, status: 502, error: "会員のLINEに送れませんでした" };

  const lines = [
    `${listed.monthLabel}に終了したセッションが${input.maxCount}回以下の会員へ、この枠の案内を送りました`,
    `送信 ${sent.length}人: ${sent.join("、")}`,
  ];
  if (failed.length > 0) lines.push(`失敗: ${failed.join("、")}`);
  return { ok: true, summary: lines.join("\n"), memberLabel: `${sent.length}人` };
}

async function sendMemberInvite(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  input: { memberId: string; storeName: string; startAt: string; endAt: string }
): Promise<
  | { ok: true; memberId: string; memberLabel: string }
  | { ok: false; status: number; error: string }
> {
  const { data: member, error } = await supabase
    .from("members")
    .select("id, member_code, name, line_user_id, line_channel_key")
    .eq("id", input.memberId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "会員の確認に失敗しました" };
  if (!member) return { ok: false, status: 404, error: "会員が見つかりません" };
  if (!member.line_user_id) return { ok: false, status: 400, error: "この会員はLINE未連携です" };

  const text = buildMemberInviteText({
    storeName: input.storeName,
    startAt: input.startAt,
    endAt: input.endAt,
    bookingUrl: `${getAppUrl()}/booking`,
  });
  const pushed = await pushLineTextForMember({
    toUserId: member.line_user_id,
    text,
    memberCode: member.member_code,
    lineChannelKey: normalizeLineChannelKey(member.line_channel_key),
    storeName: input.storeName,
  });
  if (!pushed.ok) return { ok: false, status: 502, error: "会員のLINEに送れませんでした" };
  return { ok: true, memberId: member.id, memberLabel: memberLabel(member) };
}

async function extendMemberSession(input: {
  supabase: ReturnType<typeof createSupabaseServiceClient>;
  request: Request;
  reservationId: string;
  storeId: string;
  storeName: string;
  slot: SlotDto;
  operator: { trainerId: string; displayName: string };
}): Promise<
  | { ok: true; memberId: string; memberLabel: string; reservationId: string; summary: string; memberNotified: boolean }
  | { ok: false; status: number; error: string }
> {
  const { supabase, slot, operator } = input;
  const { data: reservation, error } = await (supabase as any)
    .from("reservations")
    .select("id, store_id, member_id, trainer_id, start_at, end_at, session_type, status")
    .eq("id", input.reservationId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "予約の確認に失敗しました" };
  if (!reservation || String(reservation.status ?? "") === "cancelled") {
    return { ok: false, status: 404, error: "予約が見つかりません" };
  }
  if (String(reservation.store_id) !== input.storeId) {
    return { ok: false, status: 400, error: "この店舗の予約を選んでください" };
  }
  if (!reservation.member_id) return { ok: false, status: 400, error: "会員の予約を選んでください" };
  if (String(reservation.session_type ?? "store") === "online") {
    return { ok: false, status: 400, error: "オンラインの予約はこの枠には延長できません" };
  }

  const slotStart = DateTime.fromISO(slot.start_at).toMillis();
  const slotEnd = DateTime.fromISO(slot.end_at).toMillis();
  const resStart = DateTime.fromISO(String(reservation.start_at)).toMillis();
  const resEnd = DateTime.fromISO(String(reservation.end_at)).toMillis();
  const next = extendedReservationRange(
    { startMs: resStart, endMs: resEnd },
    { startMs: slotStart, endMs: slotEnd }
  );
  if (!next) return { ok: false, status: 400, error: "この予約はこの空き枠の前後につながっていません" };

  const newStart = DateTime.fromMillis(next.startMs).toUTC().toISO();
  const newEnd = DateTime.fromMillis(next.endMs).toUTC().toISO();
  if (!newStart || !newEnd) return { ok: false, status: 400, error: "延長後の時間を計算できませんでした" };

  if (reservation.trainer_id) {
    const covered = await trainerCoversRange({
      supabase,
      storeId: input.storeId,
      trainerId: String(reservation.trainer_id),
      dateYmd: DateTime.fromISO(slot.start_at).setZone(TZ).toISODate() ?? "",
      startMs: next.startMs,
      endMs: next.endMs,
    });
    if (!covered) return { ok: false, status: 409, error: "担当トレーナーのシフト外のため延長できません" };
  }

  const { data: overlaps, error: ovErr } = await (supabase as any)
    .from("reservations")
    .select("id")
    .eq("member_id", reservation.member_id)
    .neq("status", "cancelled")
    .lt("start_at", newEnd)
    .gt("end_at", newStart);
  if (ovErr) return { ok: false, status: 500, error: "予約の重複確認に失敗しました" };
  const dup = (overlaps ?? []).some((row: { id: string }) => String(row.id) !== String(reservation.id));
  if (dup) return { ok: false, status: 409, error: "この会員は延長後の時間に別の予約があります" };

  const { data: updated, error: upErr } = await (supabase as any)
    .from("reservations")
    .update({ start_at: newStart, end_at: newEnd, updated_at: new Date().toISOString() })
    .eq("id", reservation.id)
    .select("id, store_id, member_id, start_at, end_at, status, session_type")
    .maybeSingle();
  if (upErr || !updated) return { ok: false, status: 500, error: "セッションの延長に失敗しました" };

  const { data: member, error: memberErr } = await supabase
    .from("members")
    .select("id, member_code, name, line_user_id, line_channel_key")
    .eq("id", reservation.member_id)
    .maybeSingle();
  if (memberErr || !member) return { ok: false, status: 500, error: "延長しましたが、会員の確認に失敗しました" };

  await insertReservationChangeLog(supabase, {
    reservation_id: updated.id,
    member_id: updated.member_id,
    action: "reschedule",
    source: "admin_dashboard",
    actor_type: "trainer",
    actor_id: operator.trainerId,
    actor_label: operator.displayName,
    before_status: reservation.status,
    after_status: updated.status,
    before_start_at: reservation.start_at,
    before_end_at: reservation.end_at,
    before_store_id: reservation.store_id,
    after_start_at: updated.start_at,
    after_end_at: updated.end_at,
    after_store_id: updated.store_id,
    user_agent: requestUserAgent(input.request),
  });

  let memberNotified = false;
  if (member.line_user_id) {
    const text = buildSessionExtendText({
      storeName: input.storeName,
      startAt: updated.start_at,
      endAt: updated.end_at,
      operatorName: operator.displayName,
    });
    const pushed = await pushLineTextForMember({
      toUserId: member.line_user_id,
      text,
      memberCode: member.member_code,
      lineChannelKey: normalizeLineChannelKey(member.line_channel_key),
      storeName: input.storeName,
    });
    memberNotified = pushed.ok;
  }

  const before = DateTime.fromISO(String(reservation.start_at)).setZone(TZ);
  const afterStart = DateTime.fromISO(String(updated.start_at)).setZone(TZ);
  const afterEnd = DateTime.fromISO(String(updated.end_at)).setZone(TZ);
  const summary = `${memberLabel(member)}のセッションを ${before.toFormat("HH:mm")}〜${DateTime.fromISO(String(reservation.end_at)).setZone(TZ).toFormat("HH:mm")} から ${afterStart.toFormat("HH:mm")}〜${afterEnd.toFormat("HH:mm")} に延長しました`;
  return {
    ok: true,
    memberId: member.id,
    memberLabel: memberLabel(member),
    reservationId: updated.id,
    summary,
    memberNotified,
  };
}

async function trainerCoversRange(input: {
  supabase: ReturnType<typeof createSupabaseServiceClient>;
  storeId: string;
  trainerId: string;
  dateYmd: string;
  startMs: number;
  endMs: number;
}) {
  const { data, error } = await input.supabase
    .from("trainer_shifts")
    .select("start_local, end_local, status, is_break")
    .eq("store_id", input.storeId)
    .eq("trainer_id", input.trainerId)
    .eq("shift_date", input.dateYmd)
    .neq("status", "draft");
  if (error || !data) return false;
  const start = DateTime.fromMillis(input.startMs).setZone(TZ);
  const end = DateTime.fromMillis(input.endMs).setZone(TZ);
  const startMin = start.hour * 60 + start.minute;
  const endMin = end.hour * 60 + end.minute;
  return data.some((row) => {
    if (row.is_break) return false;
    const a = parseMinutes(String(row.start_local ?? ""));
    const b = parseMinutes(String(row.end_local ?? ""));
    return Number.isFinite(a) && Number.isFinite(b) && a <= startMin && b >= endMin;
  });
}

async function uploadOpenSlotJpegs(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  files: { path: string; dataBase64: string; label: string }[]
): Promise<{ ok: true; urls: string[] } | { ok: false; status: number; error: string }> {
  const urls: string[] = [];
  for (const file of files) {
    const bytes = decodeJpeg(file.dataBase64);
    if (!bytes) return { ok: false, status: 400, error: `${file.label}の写真を確認してください` };
    const { error } = await supabase.storage.from(OPEN_SLOT_PHOTO_BUCKET).upload(file.path, bytes, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) {
      const missing = /bucket|not found|schema/i.test(error.message);
      return {
        ok: false,
        status: 500,
        error: missing ? "写真の保存先がまだありません。データベースの更新が必要です" : "写真の保存に失敗しました",
      };
    }
    const signed = await supabase.storage.from(OPEN_SLOT_PHOTO_BUCKET).createSignedUrl(file.path, 60 * 60);
    if (signed.error || !signed.data?.signedUrl) return { ok: false, status: 500, error: "写真の送信準備に失敗しました" };
    urls.push(signed.data.signedUrl);
  }
  return { ok: true, urls };
}

function decodeJpeg(dataBase64: string): Buffer | null {
  const cleaned = dataBase64.replace(/^data:image\/jpeg;base64,/i, "").replace(/\s/g, "");
  const buf = Buffer.from(cleaned, "base64");
  if (buf.length < 100 || buf.length > 1_500_000) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  return buf;
}

async function uploadUenoCleaningPhotos(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  input: {
    storeId: string;
    slotStart: string;
    areaKey: string;
    photos: { place_key: string; step_key: string; data_base64: string }[];
    slots: UenoCleaningPhotoSlot[];
  }
): Promise<{ ok: true; urls: string[] } | { ok: false; status: number; error: string }> {
  const urls: string[] = [];
  const stamp = DateTime.fromISO(input.slotStart).toUTC().toFormat("yyyyLLddHHmmss");
  for (const slot of input.slots) {
    const photo = input.photos.find((item) => item.place_key === slot.placeKey && item.step_key === slot.stepKey);
    if (!photo) return { ok: false, status: 400, error: `${slot.label}の写真を付けてください` };
    const bytes = decodeJpeg(photo.data_base64);
    if (!bytes) return { ok: false, status: 400, error: `${slot.label}の写真を確認してください` };
    const path = `${input.storeId}/${stamp}/${input.areaKey}/${slot.placeKey}-${slot.stepKey}.jpg`;
    const { error } = await supabase.storage.from(OPEN_SLOT_PHOTO_BUCKET).upload(path, bytes, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) {
      const missing = /bucket|not found|schema/i.test(error.message);
      return {
        ok: false,
        status: 500,
        error: missing ? "写真の保存先がまだありません。データベースの更新が必要です" : "写真の保存に失敗しました",
      };
    }
    const signed = await supabase.storage.from(OPEN_SLOT_PHOTO_BUCKET).createSignedUrl(path, 60 * 60);
    if (signed.error || !signed.data?.signedUrl) return { ok: false, status: 500, error: "写真の送信準備に失敗しました" };
    urls.push(signed.data.signedUrl);
  }
  return { ok: true, urls };
}

async function resolveOperator(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  trainerId: string,
  password?: string
): Promise<
  | { ok: true; trainerId: string; displayName: string }
  | { ok: false; status: 401 | 404; error: string; code?: string }
> {
  const { data } = await supabase
    .from("trainers")
    .select("id, display_name, is_active")
    .eq("id", trainerId)
    .maybeSingle();
  if (!data || data.is_active === false) {
    return { ok: false, status: 404, error: "担当トレーナーが見つかりません" };
  }
  const name = String(data.display_name ?? "").trim();
  if (isProtectedTrainerName(name)) {
    if (!password) return { ok: false, status: 401, error: "password_required", code: "password_required" };
    if (!verifyTrainerPassword(name, password)) {
      return { ok: false, status: 401, error: "パスワードが違います" };
    }
  }
  return { ok: true, trainerId: data.id, displayName: name || "トレーナー" };
}

function parseMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}
