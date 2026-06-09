"use client";

import { GymShell } from "@/components/gym/GymShell";
import {
  BODY_PHOTO_ANGLE_LABELS,
  type MemberBodyPhotoSetView,
} from "@/lib/memberBodyPhotos";
import {
  MAX_MEMBER_RESCHEDULE_COUNT,
  getMemberRescheduleEligibility,
  isCrossDayRescheduleDateDisabled,
  type MemberRescheduleEligibility,
} from "@/lib/memberReschedule";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";

const TZ = "Asia/Tokyo";

type AvailableDay = { date: string; slotCount: number; status: "available" | "limited" | "full" };

type MeResponse = {
  member: { id: string; member_code: string; name: string; email: string | null; line_user_id: string | null };
  reservations: Array<{
    id: string;
    start_at: string;
    end_at: string;
    session_type: string;
    reschedule_count?: number;
    store_id: string;
    store_name: string;
    trainer_id: string | null;
    trainer_name: string;
    status: string;
  }>;
  notes: Array<{
    id: string;
    date: string;
    store_id: string;
    store_name: string;
    trainer_id: string;
    trainer_name: string;
    content: string;
  }>;
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((json as any)?.error ?? "取得に失敗しました");
    (err as any).status = res.status;
    throw err;
  }
  return json as T;
}

async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "更新に失敗しました");
  return json as T;
}

function sessionLabel(sessionType: string) {
  return sessionType === "online" ? "💻 オンライン" : "🏠 店舗";
}

function formatBodyPhotoDateLabel(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: TZ });
  if (!dt.isValid) return ymd;
  const dow = ["日", "月", "火", "水", "木", "金", "土"][dt.weekday % 7];
  return `${dt.toFormat("yyyy/M/d")}（${dow}）`;
}

export default function MemberPage() {
  const [data, setData] = useState<MeResponse | null>(null);
  const [bodyPhotos, setBodyPhotos] = useState<MemberBodyPhotoSetView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [changeTarget, setChangeTarget] = useState<MeResponse["reservations"][number] | null>(null);
  const [changeEligibility, setChangeEligibility] = useState<MemberRescheduleEligibility | null>(null);
  const [changeMonth, setChangeMonth] = useState(() => DateTime.now().setZone(TZ).startOf("month"));
  const [changeDays, setChangeDays] = useState<AvailableDay[] | null>(null);
  const [changeSelectedDate, setChangeSelectedDate] = useState<string>("");
  const [changeSlots, setChangeSlots] = useState<Array<{ start_at: string; end_at: string }> | null>(null);
  const [changeSelected, setChangeSelected] = useState<{ start_at: string; end_at: string } | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeErr, setChangeErr] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MeResponse["reservations"][number] | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState<string | null>(null);

  const title = useMemo(() => (data?.member?.name ? `マイページ（${data.member.name}）` : "マイページ"), [data?.member?.name]);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    Promise.all([
      apiGet<MeResponse>("/api/member/me"),
      apiGet<{ sets: MemberBodyPhotoSetView[] }>("/api/member/body-photos").catch(() => ({ sets: [] })),
    ])
      .then(([me, photos]) => {
        setData(me);
        setBodyPhotos(photos.sets ?? []);
      })
      .catch((e: any) => {
        const status = Number((e as any)?.status ?? 0);
        if (status === 401) {
          window.location.href = "/login";
          return;
        }
        setErr(String(e?.message ?? "取得に失敗しました"));
        setData(null);
        setBodyPhotos(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const formatDateLabel = (ymd: string) => {
    const dt = DateTime.fromISO(ymd, { zone: TZ });
    const dow = ["日", "月", "火", "水", "木", "金", "土"][dt.weekday % 7];
    return `${dt.toFormat("M/d")}（${dow}）`;
  };

  const todayYmd = useMemo(() => DateTime.now().setZone(TZ).toISODate()!, []);

  const changeDaysByDate = useMemo(() => {
    const m = new Map<string, { slotCount: number; status: AvailableDay["status"] }>();
    for (const d of changeDays ?? []) m.set(d.date, { slotCount: d.slotCount, status: d.status });
    return m;
  }, [changeDays]);

  const resetChangeModal = () => {
    setChangeTarget(null);
    setChangeEligibility(null);
    setChangeErr(null);
    setChangeDays(null);
    setChangeSelectedDate("");
    setChangeSlots(null);
    setChangeSelected(null);
  };

  const openChange = (r: MeResponse["reservations"][number]) => {
    setChangeErr(null);
    setChangeSelected(null);
    setChangeSlots(null);
    setChangeDays(null);
    setChangeSelectedDate("");
    const eligibility = getMemberRescheduleEligibility({
      reservationStartAt: r.start_at,
      rescheduleCount: r.reschedule_count,
    });
    setChangeEligibility(eligibility);
    setChangeTarget(r);
    const bookingYmd = DateTime.fromISO(r.start_at).setZone(TZ).toISODate()!;
    setChangeMonth(DateTime.fromISO(bookingYmd, { zone: TZ }).startOf("month"));
    if (eligibility.ok && eligibility.mode === "same_day") {
      setChangeSelectedDate(bookingYmd);
    }
  };

  useEffect(() => {
    if (!changeTarget || !changeEligibility?.ok || changeEligibility.mode !== "cross_day") return;
    setChangeBusy(true);
    setChangeErr(null);
    const monthParam = changeMonth.toFormat("yyyy-MM");
    apiGet<{ dates: { date: string; count: number }[] }>(
      `/api/booking-v2/available-dates?store_id=${encodeURIComponent(changeTarget.store_id)}&month=${encodeURIComponent(monthParam)}`
    )
      .then((d) =>
        setChangeDays(
          (d.dates ?? []).map((x) => {
            const slotCount = x.count;
            const status = slotCount >= 3 ? "available" : slotCount >= 1 ? "limited" : "full";
            return { date: x.date, slotCount, status };
          })
        )
      )
      .catch((e: any) => {
        setChangeErr(String(e?.message ?? "空き日の取得に失敗しました"));
        setChangeDays([]);
      })
      .finally(() => setChangeBusy(false));
  }, [changeTarget, changeEligibility, changeMonth]);

  useEffect(() => {
    if (!changeTarget || !changeEligibility?.ok || !changeSelectedDate) return;
    setChangeBusy(true);
    setChangeErr(null);
    setChangeSelected(null);
    const ignoreCutoff = changeEligibility.mode === "same_day" ? "&ignore_cutoff=1" : "";
    apiGet<Array<{ start_at: string; end_at: string }>>(
      `/api/booking-v2/available-slots?store_id=${encodeURIComponent(changeTarget.store_id)}&date=${encodeURIComponent(changeSelectedDate)}${ignoreCutoff}`
    )
      .then((slots) => {
        const filtered = (slots ?? []).filter(
          (s) => !(s.start_at === changeTarget.start_at && s.end_at === changeTarget.end_at)
        );
        setChangeSlots(filtered);
      })
      .catch((e: any) => {
        setChangeErr(String(e?.message ?? "空き枠の取得に失敗しました"));
        setChangeSlots([]);
      })
      .finally(() => setChangeBusy(false));
  }, [changeTarget, changeEligibility, changeSelectedDate]);

  return (
    <GymShell
      title={title}
      nav={[
        { href: "/booking", label: "予約" },
        { href: "/login", label: "ログイン" },
      ]}
    >
      <div className="space-y-4">
        {loading ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
        {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

        {data ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
              <div className="text-sm font-bold text-slate-900">会員情報</div>
              <div className="text-sm text-slate-700">
                {data.member.member_code}（{data.member.name || "-"}）
              </div>
              <div className="text-xs text-slate-500 break-all">Email: {data.member.email ?? "未登録"}</div>
              <div className="text-xs text-slate-500">{data.member.line_user_id ? "LINE連携済み" : "LINE未連携"}</div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
              <div className="text-sm font-bold text-slate-900">予約一覧（今月〜翌月）</div>
              {data.reservations.length === 0 ? <div className="text-sm text-slate-600">予約がありません。</div> : null}
              <div className="grid gap-2">
                {data.reservations.map((r) => (
                  <div key={r.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-sm font-bold text-slate-900">
                      {DateTime.fromISO(r.start_at).setZone(TZ).toFormat("M/d HH:mm")}〜
                      {DateTime.fromISO(r.end_at).setZone(TZ).toFormat("HH:mm")}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">{sessionLabel(r.session_type)}</div>
                    <div className="mt-1 text-xs text-slate-500">店舗: {r.store_name || r.store_id}</div>
                    <div className="mt-1 text-xs text-slate-500">トレーナー: {r.trainer_name || (r.trainer_id ?? "-")}</div>

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                        onClick={() => openChange(r)}
                      >
                        変更
                      </button>
                      <button
                        type="button"
                        className="flex-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-100"
                        onClick={() => {
                          setCancelErr(null);
                          setCancelTarget(r);
                        }}
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
              <div className="text-sm font-bold text-slate-900">体型の記録</div>
              {bodyPhotos === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
              {bodyPhotos !== null && bodyPhotos.length === 0 ? (
                <div className="text-sm text-slate-600">まだ登録がありません。</div>
              ) : null}
              <div className="grid gap-3">
                {(bodyPhotos ?? []).map((s) => {
                  const thumbs = [
                    { label: BODY_PHOTO_ANGLE_LABELS.front, url: s.front_url },
                    { label: BODY_PHOTO_ANGLE_LABELS.back, url: s.back_url },
                    { label: BODY_PHOTO_ANGLE_LABELS.side_left, url: s.side_left_url },
                    { label: BODY_PHOTO_ANGLE_LABELS.side_right, url: s.side_right_url },
                  ].filter((x) => x.url);
                  if (thumbs.length === 0) return null;
                  return (
                    <div key={s.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2">
                      <div className="text-xs font-semibold text-slate-700">{formatBodyPhotoDateLabel(s.photo_date)}</div>
                      {s.note ? <div className="text-xs text-slate-500">{s.note}</div> : null}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {thumbs.map((t) => (
                          <div key={t.label} className="space-y-1">
                            <div className="aspect-[3/4] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={t.url!} alt={t.label} className="h-full w-full object-cover" />
                            </div>
                            <div className="text-center text-[10px] text-slate-500">{t.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
              <div className="text-sm font-bold text-slate-900">カルテ（最新30件）</div>
              {data.notes.length === 0 ? <div className="text-sm text-slate-600">履歴がありません。</div> : null}
              <div className="grid gap-2">
                {data.notes.map((n) => (
                  <div key={n.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs font-semibold text-slate-700">
                      {n.date} / {n.store_name || n.store_id}（{n.trainer_name || n.trainer_id}）
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{n.content}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {changeTarget ? (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
            <div className="mx-auto flex min-h-full max-w-lg items-end sm:items-center">
              <div className="flex max-h-[min(90vh,720px)] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-lg">
                <div className="shrink-0 space-y-2 border-b border-slate-200 px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-bold text-slate-900">予約の変更</div>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm"
                      onClick={() => {
                        if (changeBusy) return;
                        resetChangeModal();
                      }}
                    >
                      閉じる
                    </button>
                  </div>
                  <div className="text-sm text-slate-700">
                    {DateTime.fromISO(changeTarget.start_at).setZone(TZ).toFormat("M/d HH:mm")}〜
                    {DateTime.fromISO(changeTarget.end_at).setZone(TZ).toFormat("HH:mm")}
                  </div>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
              {!changeEligibility?.ok ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {changeEligibility?.reason ?? "この予約は変更できません"}
                </div>
              ) : (
                <>
                  <div className="text-xs text-slate-600">
                    {changeEligibility.mode === "same_day"
                      ? `予約当日の空き時間から選択できます（変更は${MAX_MEMBER_RESCHEDULE_COUNT}回まで・残り${changeEligibility.remaining}回）。新規の当日予約の締切後でも、すでに予約がある方は変更できます。`
                      : `予約日の前日まで、別の日時に変更できます（変更は${MAX_MEMBER_RESCHEDULE_COUNT}回まで・残り${changeEligibility.remaining}回）。今日の空き時間への変更はできません。予約当日になったら、同じ日の別時間に変更できます。`}
                  </div>

                  {changeEligibility.mode === "cross_day" ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setChangeMonth((m) => m.minus({ months: 1 }).startOf("month"))}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        >
                          ← 前月
                        </button>
                        <div className="text-sm font-medium">{changeMonth.toFormat("yyyy年M月")}</div>
                        <button
                          type="button"
                          onClick={() => setChangeMonth((m) => m.plus({ months: 1 }).startOf("month"))}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        >
                          次月 →
                        </button>
                      </div>

                      <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
                        {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
                          <div key={w} className="py-1">
                            {w}
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-7 gap-1">
                        {(() => {
                          const first = changeMonth.startOf("month");
                          const startDow = first.weekday % 7;
                          const daysInMonth = changeMonth.daysInMonth ?? 31;
                          return Array.from({ length: 42 }, (_, idx) => {
                            const dayNum = idx - startDow + 1;
                            const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
                            const ymd = inMonth ? changeMonth.set({ day: dayNum }).toISODate()! : "";
                            const meta = ymd ? changeDaysByDate.get(ymd) : null;
                            const status = meta?.status ?? "full";
                            const symbol = status === "available" ? "○" : status === "limited" ? "△" : "×";
                            const disabled =
                              !inMonth ||
                              isCrossDayRescheduleDateDisabled({
                                ymd,
                                todayYmd,
                                slotCount: meta?.slotCount ?? 0,
                              });
                            const selected = ymd && changeSelectedDate === ymd;

                            return (
                              <button
                                key={idx}
                                type="button"
                                disabled={disabled}
                                onClick={() => {
                                  setChangeSelectedDate(ymd);
                                  setChangeSlots(null);
                                }}
                                className={[
                                  "aspect-square rounded-xl border p-2 text-left transition-colors",
                                  !inMonth ? "border-transparent bg-transparent" : "border-slate-200 bg-white",
                                  disabled && inMonth ? "opacity-50" : "hover:bg-slate-50",
                                  selected ? "border-slate-900 bg-slate-100" : "",
                                ].join(" ")}
                              >
                                {inMonth ? (
                                  <div className="flex h-full flex-col justify-between">
                                    <div className="text-sm font-medium">{dayNum}</div>
                                    <div className="text-sm font-semibold text-slate-600">{symbol}</div>
                                  </div>
                                ) : (
                                  <div />
                                )}
                              </button>
                            );
                          });
                        })()}
                      </div>

                      {changeDays === null ? <div className="text-sm text-slate-600">空き日を取得中…</div> : null}
                      {changeSelectedDate ? (
                        <div className="text-sm text-slate-700">選択中: {formatDateLabel(changeSelectedDate)}</div>
                      ) : (
                        <div className="text-sm text-slate-600">変更先の日付を選んでください。</div>
                      )}
                    </div>
                  ) : null}

                  {changeErr ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{changeErr}</div>
                  ) : null}
                  {changeSelectedDate && changeSlots === null ? <div className="text-sm text-slate-600">空き枠を取得中…</div> : null}
                  {changeSelectedDate && changeSlots !== null && changeSlots.length === 0 ? (
                    <div className="text-sm text-slate-600">空き枠がありません。</div>
                  ) : null}
                  {changeSlots && changeSlots.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {changeSlots.map((s) => {
                        const start = DateTime.fromISO(s.start_at).setZone(TZ).toFormat("HH:mm");
                        const end = DateTime.fromISO(s.end_at).setZone(TZ).toFormat("HH:mm");
                        const active = changeSelected?.start_at === s.start_at && changeSelected?.end_at === s.end_at;
                        return (
                          <button
                            key={`${s.start_at}|${s.end_at}`}
                            type="button"
                            onClick={() => setChangeSelected(s)}
                            className={[
                              "rounded-xl border px-3 py-3 text-sm font-semibold",
                              active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
                            ].join(" ")}
                          >
                            {start}〜{end}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                    <div className="text-xs font-semibold text-slate-700">確認</div>
                    <div className="mt-1 text-sm text-slate-900">店舗: {changeTarget.store_name || changeTarget.store_id}</div>
                    <div className="mt-1 text-sm text-slate-900">
                      変更後:
                      {changeSelected
                        ? ` ${DateTime.fromISO(changeSelected.start_at).setZone(TZ).toFormat("M/d HH:mm")}〜${DateTime.fromISO(changeSelected.end_at)
                            .setZone(TZ)
                            .toFormat("HH:mm")}`
                        : " 未選択"}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={changeBusy || !changeSelected}
                    onClick={async () => {
                      if (!changeSelected) return;
                      setChangeBusy(true);
                      setChangeErr(null);
                      try {
                        await apiPatch(`/api/member/reservations/${encodeURIComponent(changeTarget.id)}/reschedule`, changeSelected);
                        const d = await apiGet<MeResponse>("/api/member/me");
                        setData(d);
                        resetChangeModal();
                      } catch (e: any) {
                        setChangeErr(String(e?.message ?? "変更に失敗しました"));
                      } finally {
                        setChangeBusy(false);
                      }
                    }}
                    className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {changeBusy ? "変更中…" : "この時間に変更する"}
                  </button>
                </>
              )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {cancelTarget ? (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
            <div className="mx-auto flex min-h-full max-w-lg items-end sm:items-center">
              <div className="flex max-h-[min(90vh,560px)] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-lg">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                  <div className="text-sm font-bold text-slate-900">予約のキャンセル</div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm"
                    onClick={() => {
                      if (cancelBusy) return;
                      setCancelTarget(null);
                      setCancelErr(null);
                    }}
                  >
                    閉じる
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold text-slate-700">店舗</div>
                <div className="text-sm text-slate-900">{cancelTarget.store_name || cancelTarget.store_id}</div>
                <div className="mt-2 text-xs font-semibold text-slate-700">日時</div>
                <div className="text-sm text-slate-900">
                  {DateTime.fromISO(cancelTarget.start_at).setZone(TZ).toFormat("M/d（ccc）")}{" "}
                  {DateTime.fromISO(cancelTarget.start_at).setZone(TZ).toFormat("HH:mm")}〜
                  {DateTime.fromISO(cancelTarget.end_at).setZone(TZ).toFormat("HH:mm")}
                </div>
                <div className="mt-2 text-xs text-slate-600">
                  この予約をキャンセルしますか？
                </div>
              </div>

              {cancelErr ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{cancelErr}</div>
              ) : null}

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={cancelBusy}
                  onClick={() => {
                    setCancelTarget(null);
                    setCancelErr(null);
                  }}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 disabled:opacity-60"
                >
                  やめる
                </button>
                <button
                  type="button"
                  disabled={cancelBusy}
                  onClick={async () => {
                    setCancelBusy(true);
                    setCancelErr(null);
                    try {
                      await apiPatch(`/api/member/reservations/${encodeURIComponent(cancelTarget.id)}/cancel`);
                      const d = await apiGet<MeResponse>("/api/member/me");
                      setData(d);
                      setCancelTarget(null);
                    } catch (e: any) {
                      setCancelErr(String(e?.message ?? "キャンセルに失敗しました"));
                    } finally {
                      setCancelBusy(false);
                    }
                  }}
                  className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {cancelBusy ? "キャンセル中…" : "キャンセルする"}
                </button>
              </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </GymShell>
  );
}

