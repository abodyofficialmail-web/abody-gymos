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
  member: {
    id: string;
    member_code: string;
    name: string;
    email: string | null;
    line_user_id: string | null;
    reservation_reminder_line_enabled?: boolean;
  };
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

type MemberTab = "reservations" | "karte" | "photos" | "reports";

type MonthlyProgressReportItem = {
  yearMonth: string;
  yearMonthLabel: string;
  visitCount: number;
  abodyScore: number;
  overallGrade: string;
  generatedAt: string;
  lineSentAt: string | null;
  pdfUrl: string | null;
  pageUrls: string[];
};

const MEMBER_TABS: Array<{ id: MemberTab; label: string }> = [
  { id: "reservations", label: "予約一覧" },
  { id: "karte", label: "カルテ" },
  { id: "photos", label: "写真記録" },
  { id: "reports", label: "成長レポート" },
];

function bodyPhotoThumbs(set: MemberBodyPhotoSetView) {
  return [
    { angle: "front" as const, label: BODY_PHOTO_ANGLE_LABELS.front, url: set.front_url },
    { angle: "back" as const, label: BODY_PHOTO_ANGLE_LABELS.back, url: set.back_url },
    { angle: "side_left" as const, label: BODY_PHOTO_ANGLE_LABELS.side_left, url: set.side_left_url },
    { angle: "side_right" as const, label: BODY_PHOTO_ANGLE_LABELS.side_right, url: set.side_right_url },
  ];
}

export default function MemberPage() {
  const [data, setData] = useState<MeResponse | null>(null);
  const [bodyPhotos, setBodyPhotos] = useState<MemberBodyPhotoSetView[] | null>(null);
  const [progressReports, setProgressReports] = useState<MonthlyProgressReportItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MemberTab>("reservations");
  const [beforePhotoSetId, setBeforePhotoSetId] = useState<string | null>(null);
  const [selectedReportYm, setSelectedReportYm] = useState<string | null>(null);

  const [changeTarget, setChangeTarget] = useState<MeResponse["reservations"][number] | null>(null);
  const [changeEligibility, setChangeEligibility] = useState<MemberRescheduleEligibility | null>(null);
  const [changeMonth, setChangeMonth] = useState(() => DateTime.now().setZone(TZ).startOf("month"));
  const [changeDays, setChangeDays] = useState<AvailableDay[] | null>(null);
  const [changeSelectedDate, setChangeSelectedDate] = useState<string>("");
  const [changeSlots, setChangeSlots] = useState<Array<{ start_at: string; end_at: string }> | null>(null);
  const [changeSelected, setChangeSelected] = useState<{ start_at: string; end_at: string } | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeErr, setChangeErr] = useState<string | null>(null);
  const [changeSuccess, setChangeSuccess] = useState<{
    storeName: string;
    start_at: string;
    end_at: string;
    lineNotified: boolean;
  } | null>(null);
  const [changeNotice, setChangeNotice] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MeResponse["reservations"][number] | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderErr, setReminderErr] = useState<string | null>(null);

  const title = useMemo(() => (data?.member?.name ? `マイページ（${data.member.name}）` : "マイページ"), [data?.member?.name]);
  const reminderEnabled = data?.member?.reservation_reminder_line_enabled !== false;

  // APIは新しい順。右=最新、左=比較用（デフォルトは最古）
  const latestPhotoSet = useMemo(() => (bodyPhotos && bodyPhotos.length > 0 ? bodyPhotos[0] : null), [bodyPhotos]);
  const olderPhotoSets = useMemo(() => (bodyPhotos && bodyPhotos.length > 1 ? bodyPhotos.slice(1) : []), [bodyPhotos]);
  const beforePhotoSet = useMemo(() => {
    if (olderPhotoSets.length === 0) return null;
    return olderPhotoSets.find((s) => s.id === beforePhotoSetId) ?? olderPhotoSets[olderPhotoSets.length - 1];
  }, [olderPhotoSets, beforePhotoSetId]);

  const selectedReport = useMemo(() => {
    if (!progressReports?.length) return null;
    return progressReports.find((r) => r.yearMonth === selectedReportYm) ?? progressReports[0];
  }, [progressReports, selectedReportYm]);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    Promise.all([
      apiGet<MeResponse>("/api/member/me"),
      apiGet<{ sets: MemberBodyPhotoSetView[] }>("/api/member/body-photos").catch(() => ({ sets: [] })),
      apiGet<{ reports: MonthlyProgressReportItem[] }>("/api/member/monthly-progress-reports").catch(() => ({
        reports: [],
      })),
    ])
      .then(([me, photos, reportsRes]) => {
        setData(me);
        const sets = photos.sets ?? [];
        setBodyPhotos(sets);
        // デフォルトの比較元は最古のセット
        if (sets.length > 1) setBeforePhotoSetId(sets[sets.length - 1].id);
        else setBeforePhotoSetId(null);
        const reports = reportsRes.reports ?? [];
        setProgressReports(reports);
        setSelectedReportYm(reports[0]?.yearMonth ?? null);
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
        setProgressReports(null);
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
    setChangeSuccess(null);
  };

  const closeChangeModal = () => {
    if (changeBusy) return;
    if (changeSuccess) {
      const start = DateTime.fromISO(changeSuccess.start_at).setZone(TZ);
      const end = DateTime.fromISO(changeSuccess.end_at).setZone(TZ);
      setChangeNotice(
        `予約を変更しました：${changeSuccess.storeName} ${start.toFormat("M/d（ccc）")} ${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}`
      );
    }
    resetChangeModal();
  };

  const openChange = (r: MeResponse["reservations"][number]) => {
    setChangeErr(null);
    setChangeSuccess(null);
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
        {changeNotice ? (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">{changeNotice}</div>
        ) : null}

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
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-bold text-slate-900">予約リマインドLINE</div>
                  <p className="text-xs leading-relaxed text-slate-600">
                    セッション開始60分前にLINEでお知らせします（セッション前ヒアリングも含みます）。
                  </p>
                  <p className="text-xs leading-relaxed text-slate-500">
                    OFFにしても、予約の確定・変更・キャンセルやカルテ共有などの通知は届きます。
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={reminderEnabled}
                  disabled={reminderBusy}
                  onClick={async () => {
                    if (!data) return;
                    const next = !reminderEnabled;
                    setReminderBusy(true);
                    setReminderErr(null);
                    try {
                      await apiPatch<{ member: { reservation_reminder_line_enabled: boolean } }>("/api/member/me", {
                        reservation_reminder_line_enabled: next,
                      });
                      setData({
                        ...data,
                        member: { ...data.member, reservation_reminder_line_enabled: next },
                      });
                    } catch (e: any) {
                      setReminderErr(String(e?.message ?? "設定の更新に失敗しました"));
                    } finally {
                      setReminderBusy(false);
                    }
                  }}
                  className={[
                    "relative mt-0.5 h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-60",
                    reminderEnabled ? "bg-slate-900" : "bg-slate-300",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform",
                      reminderEnabled ? "left-7" : "left-1",
                    ].join(" ")}
                  />
                  <span className="sr-only">{reminderEnabled ? "ON" : "OFF"}</span>
                </button>
              </div>
              <div className="text-xs font-semibold text-slate-700">
                現在: {reminderEnabled ? "ON（送信する）" : "OFF（送らない）"}
                {reminderBusy ? " …更新中" : ""}
              </div>
              {reminderErr ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{reminderErr}</div>
              ) : null}
            </section>

            <div className="flex gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1">
              {MEMBER_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={[
                    "flex-1 rounded-xl px-1.5 py-2.5 text-[11px] font-semibold transition-colors sm:text-sm sm:px-2",
                    activeTab === t.id
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {activeTab === "reservations" ? (
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
            ) : null}

            {activeTab === "karte" ? (
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
            ) : null}

            {activeTab === "photos" ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-bold text-slate-900">写真記録（ビフォーアフター）</div>
                  <p className="text-xs leading-relaxed text-slate-500">
                    左に過去、右に最新の写真を縦に並べて比較できます。
                  </p>
                </div>

                {bodyPhotos === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
                {bodyPhotos !== null && bodyPhotos.length === 0 ? (
                  <div className="text-sm text-slate-600">まだ登録がありません。</div>
                ) : null}

                {latestPhotoSet ? (
                  <div className="space-y-3">
                    {olderPhotoSets.length > 1 ? (
                      <label className="block text-xs font-semibold text-slate-700">
                        比較する過去の日付
                        <select
                          value={beforePhotoSet?.id ?? ""}
                          onChange={(e) => setBeforePhotoSetId(e.target.value || null)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                        >
                          {[...olderPhotoSets].reverse().map((s) => (
                            <option key={s.id} value={s.id}>
                              {formatBodyPhotoDateLabel(s.photo_date)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0 space-y-2">
                        <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
                          <div className="text-[10px] font-semibold text-slate-500">ビフォー</div>
                          <div className="text-[11px] font-semibold text-slate-800">
                            {beforePhotoSet
                              ? formatBodyPhotoDateLabel(beforePhotoSet.photo_date)
                              : "—"}
                          </div>
                        </div>
                        {beforePhotoSet ? (
                          bodyPhotoThumbs(beforePhotoSet).map((t) => (
                            <div key={`before-${t.angle}`} className="space-y-1">
                              <div className="aspect-[3/4] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                                {t.url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={t.url} alt={`ビフォー ${t.label}`} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-[10px] text-slate-400">未登録</div>
                                )}
                              </div>
                              <div className="text-center text-[10px] text-slate-500">{t.label}</div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-500">
                            比較用の過去写真がまだありません
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 space-y-2">
                        <div className="rounded-lg bg-slate-900 px-2 py-1.5 text-center">
                          <div className="text-[10px] font-semibold text-slate-300">アフター（最新）</div>
                          <div className="text-[11px] font-semibold text-white">
                            {formatBodyPhotoDateLabel(latestPhotoSet.photo_date)}
                          </div>
                        </div>
                        {bodyPhotoThumbs(latestPhotoSet).map((t) => (
                          <div key={`after-${t.angle}`} className="space-y-1">
                            <div className="aspect-[3/4] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                              {t.url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={t.url} alt={`アフター ${t.label}`} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-[10px] text-slate-400">未登録</div>
                              )}
                            </div>
                            <div className="text-center text-[10px] text-slate-500">{t.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {beforePhotoSet?.note || latestPhotoSet.note ? (
                      <div className="space-y-1 text-xs text-slate-500">
                        {beforePhotoSet?.note ? <div>ビフォーメモ: {beforePhotoSet.note}</div> : null}
                        {latestPhotoSet.note ? <div>最新メモ: {latestPhotoSet.note}</div> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTab === "reports" ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-bold text-slate-900">成長レポート</div>
                  <p className="text-xs leading-relaxed text-slate-500">
                    月次の成長レポートです。PDFや各ページ画像をいつでも確認できます。画像をタップすると拡大表示できます。
                  </p>
                </div>

                {progressReports === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
                {progressReports !== null && progressReports.length === 0 ? (
                  <div className="text-sm text-slate-600">まだレポートがありません。</div>
                ) : null}

                {selectedReport ? (
                  <div className="space-y-3">
                    {progressReports && progressReports.length > 1 ? (
                      <label className="block text-xs font-semibold text-slate-700">
                        対象月
                        <select
                          value={selectedReport.yearMonth}
                          onChange={(e) => setSelectedReportYm(e.target.value || null)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                        >
                          {progressReports.map((r) => (
                            <option key={r.yearMonth} value={r.yearMonth}>
                              {r.yearMonthLabel}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <div className="text-sm font-semibold text-slate-800">{selectedReport.yearMonthLabel}</div>
                    )}

                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                      <div>
                        来店 {selectedReport.visitCount}回 / Score {selectedReport.abodyScore}
                        {selectedReport.overallGrade ? `（${selectedReport.overallGrade}）` : ""}
                      </div>
                    </div>

                    {selectedReport.pdfUrl ? (
                      <a
                        href={selectedReport.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                      >
                        PDFを開く
                      </a>
                    ) : null}

                    <div className="grid gap-3">
                      {selectedReport.pageUrls.map((url, i) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`成長レポート ${i + 1}ページ`}
                            className="w-full rounded-xl border border-slate-200 bg-white"
                            loading={i === 0 ? "eager" : "lazy"}
                            decoding="async"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}

        {changeTarget ? (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
            <div className="mx-auto flex min-h-full max-w-lg items-end sm:items-center">
              <div className="flex max-h-[min(90vh,720px)] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-lg">
                <div className="shrink-0 space-y-2 border-b border-slate-200 px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-bold text-slate-900">{changeSuccess ? "変更完了" : "予約の変更"}</div>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm"
                      onClick={closeChangeModal}
                    >
                      閉じる
                    </button>
                  </div>
                  {!changeSuccess ? (
                    <div className="text-sm text-slate-700">
                      {DateTime.fromISO(changeTarget.start_at).setZone(TZ).toFormat("M/d HH:mm")}〜
                      {DateTime.fromISO(changeTarget.end_at).setZone(TZ).toFormat("HH:mm")}
                    </div>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
              {changeSuccess ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-4 space-y-3">
                    <div className="text-base font-bold text-green-900">予約を変更しました</div>
                    <div className="space-y-1 text-sm text-green-900">
                      <div>店舗：{changeSuccess.storeName}</div>
                      <div className="font-semibold">
                        {DateTime.fromISO(changeSuccess.start_at).setZone(TZ).toFormat("M/d（ccc）")}{" "}
                        {DateTime.fromISO(changeSuccess.start_at).setZone(TZ).toFormat("HH:mm")}〜
                        {DateTime.fromISO(changeSuccess.end_at).setZone(TZ).toFormat("HH:mm")}
                      </div>
                    </div>
                    {changeSuccess.lineNotified ? (
                      <div className="text-xs text-green-800">変更内容をLINEにもお送りしました。</div>
                    ) : data?.member.line_user_id ? (
                      <div className="text-xs text-green-800">予約一覧を更新しました。LINE通知は送信できませんでした。</div>
                    ) : (
                      <div className="text-xs text-green-800">予約一覧を更新しました。</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={closeChangeModal}
                    className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                  >
                    閉じる
                  </button>
                </div>
              ) : !changeEligibility?.ok ? (
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
                        const result = await apiPatch<{ line_notified?: boolean }>(
                          `/api/member/reservations/${encodeURIComponent(changeTarget.id)}/reschedule`,
                          changeSelected
                        );
                        const d = await apiGet<MeResponse>("/api/member/me");
                        setData(d);
                        setChangeSuccess({
                          storeName: changeTarget.store_name || changeTarget.store_id,
                          start_at: changeSelected.start_at,
                          end_at: changeSelected.end_at,
                          lineNotified: Boolean(result.line_notified),
                        });
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

