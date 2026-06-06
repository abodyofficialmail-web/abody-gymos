import { DateTime } from "luxon";

export const MEMBER_RESCHEDULE_TZ = "Asia/Tokyo";
export const MAX_MEMBER_RESCHEDULE_COUNT = 2;

export type MemberRescheduleMode = "cross_day" | "same_day";

export type MemberRescheduleEligibility =
  | { ok: true; mode: MemberRescheduleMode; bookingYmd: string; remaining: number }
  | { ok: false; reason: string };

function ymdFromIso(iso: string, now?: DateTime): string {
  const dt = iso.includes("T") ? DateTime.fromISO(iso).setZone(MEMBER_RESCHEDULE_TZ) : DateTime.fromISO(iso, { zone: MEMBER_RESCHEDULE_TZ });
  return dt.toISODate() ?? "";
}

export function getMemberRescheduleEligibility(params: {
  reservationStartAt: string;
  rescheduleCount?: number | null;
  now?: DateTime;
}): MemberRescheduleEligibility {
  const now = params.now ?? DateTime.now().setZone(MEMBER_RESCHEDULE_TZ);
  const todayYmd = now.toISODate() ?? "";
  const bookingYmd = ymdFromIso(params.reservationStartAt);
  const count = Number(params.rescheduleCount ?? 0);
  const remaining = MAX_MEMBER_RESCHEDULE_COUNT - (Number.isFinite(count) ? count : 0);

  if (!bookingYmd) return { ok: false, reason: "予約日時が不正です" };
  if (remaining <= 0) {
    return { ok: false, reason: `この予約は変更回数の上限（${MAX_MEMBER_RESCHEDULE_COUNT}回）に達しています` };
  }

  const curStart = DateTime.fromISO(params.reservationStartAt).setZone(MEMBER_RESCHEDULE_TZ);
  if (curStart.isValid && now.toMillis() >= curStart.toMillis()) {
    return { ok: false, reason: "開始時刻を過ぎた予約は変更できません" };
  }

  if (todayYmd > bookingYmd) {
    return { ok: false, reason: "予約日を過ぎたため変更できません" };
  }

  if (todayYmd === bookingYmd) {
    return { ok: true, mode: "same_day", bookingYmd, remaining };
  }

  return { ok: true, mode: "cross_day", bookingYmd, remaining };
}

export function validateMemberRescheduleTarget(params: {
  mode: MemberRescheduleMode;
  reservationStartAt: string;
  reservationEndAt: string;
  targetStartAt: string;
  targetEndAt: string;
  now?: DateTime;
}): { ok: true } | { ok: false; reason: string } {
  const now = params.now ?? DateTime.now().setZone(MEMBER_RESCHEDULE_TZ);
  const todayYmd = now.toISODate() ?? "";
  const bookingYmd = ymdFromIso(params.reservationStartAt);
  const targetYmd = ymdFromIso(params.targetStartAt);
  const targetStart = DateTime.fromISO(params.targetStartAt).setZone(MEMBER_RESCHEDULE_TZ);

  if (!bookingYmd || !targetYmd || !targetStart.isValid) {
    return { ok: false, reason: "日時が不正です" };
  }

  if (params.targetStartAt === params.reservationStartAt && params.targetEndAt === params.reservationEndAt) {
    return { ok: false, reason: "現在と同じ日時には変更できません" };
  }

  if (targetStart.toMillis() <= now.toMillis()) {
    return { ok: false, reason: "過去の時間には変更できません" };
  }

  if (targetYmd < todayYmd) {
    return { ok: false, reason: "過去の日付には変更できません" };
  }

  if (params.mode === "same_day") {
    if (targetYmd !== bookingYmd) {
      return { ok: false, reason: "当日は同じ日の別時間のみ変更できます" };
    }
  }

  // 別日の予約を「今日」の空き枠に移すことは不可（新規当日予約とは別扱い）
  if (params.mode === "cross_day" && targetYmd === todayYmd) {
    return {
      ok: false,
      reason: "別の日の予約を、今日の空き時間に変更することはできません。予約当日になったら、同じ日の別時間に変更できます。",
    };
  }

  return { ok: true };
}

/** cross_day モードのカレンダーで選択不可な日付 */
export function isCrossDayRescheduleDateDisabled(params: { ymd: string; todayYmd: string; slotCount: number }): boolean {
  const { ymd, todayYmd, slotCount } = params;
  if (!ymd) return true;
  if (ymd < todayYmd) return true;
  if (ymd === todayYmd) return true;
  if (slotCount <= 0) return true;
  return false;
}
