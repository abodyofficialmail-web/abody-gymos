"use client";

import { GymShell } from "@/components/gym/GymShell";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";

const TZ = "Asia/Tokyo";

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

export default function MemberPage() {
  const [data, setData] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [changeTarget, setChangeTarget] = useState<MeResponse["reservations"][number] | null>(null);
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
    apiGet<MeResponse>("/api/member/me")
      .then((d) => setData(d))
      .catch((e: any) => {
        const status = Number((e as any)?.status ?? 0);
        if (status === 401) {
          window.location.href = "/login";
          return;
        }
        setErr(String(e?.message ?? "取得に失敗しました"));
        setData(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const isSameYmdJst = (aIso: string, bIsoOrYmd: string) => {
    const a = DateTime.fromISO(aIso).setZone(TZ).toISODate();
    const b = bIsoOrYmd.includes("T") ? DateTime.fromISO(bIsoOrYmd).setZone(TZ).toISODate() : bIsoOrYmd;
    return Boolean(a && b && a === b);
  };

  const todayYmd = useMemo(() => DateTime.now().setZone(TZ).toISODate()!, []);

  const openChange = async (r: MeResponse["reservations"][number]) => {
    setChangeErr(null);
    setChangeSelected(null);
    setChangeSlots(null);
    setChangeTarget(r);
    // 当日以外は案内のみ
    if (!isSameYmdJst(r.start_at, todayYmd)) return;
    // 変更は1回まで
    if (Number(r.reschedule_count ?? 0) >= 1) return;
    setChangeBusy(true);
    try {
      const ymd = DateTime.fromISO(r.start_at).setZone(TZ).toISODate()!;
      const slots = await apiGet<Array<{ start_at: string; end_at: string }>>(
        `/api/booking-v2/available-slots?store_id=${encodeURIComponent(r.store_id)}&date=${encodeURIComponent(ymd)}`
      );
      // 自分の現在枠は除外（同じ時間への変更は意味がない）
      const filtered = (slots ?? []).filter((s) => !(s.start_at === r.start_at && s.end_at === r.end_at));
      setChangeSlots(filtered);
    } catch (e: any) {
      setChangeErr(String(e?.message ?? "空き枠の取得に失敗しました"));
      setChangeSlots([]);
    } finally {
      setChangeBusy(false);
    }
  };

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
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
            <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-slate-900">予約の変更</div>
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm"
                  onClick={() => {
                    if (changeBusy) return;
                    setChangeTarget(null);
                    setChangeErr(null);
                    setChangeSlots(null);
                    setChangeSelected(null);
                  }}
                >
                  閉じる
                </button>
              </div>
              <div className="text-sm text-slate-700">
                {DateTime.fromISO(changeTarget.start_at).setZone(TZ).toFormat("M/d HH:mm")}〜
                {DateTime.fromISO(changeTarget.end_at).setZone(TZ).toFormat("HH:mm")}
              </div>

              {Number(changeTarget.reschedule_count ?? 0) >= 1 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  この予約はすでに変更済みのため、本日これ以上変更できません（1日1回まで）。
                </div>
              ) : !isSameYmdJst(changeTarget.start_at, todayYmd) ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                  前日までは変更できません。
                  <div className="mt-1 text-xs text-slate-600">
                    「キャンセル」→予約ページから再度ご予約ください。当日になったらこのボタンから、空き時間があれば変更できます。
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-xs text-slate-600">当日の空き時間から選択できます（変更は1回まで）。</div>
                  {changeErr ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{changeErr}</div>
                  ) : null}
                  {changeSlots === null ? <div className="text-sm text-slate-600">空き枠を取得中…</div> : null}
                  {changeSlots !== null && changeSlots.length === 0 ? (
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
                        setChangeTarget(null);
                        setChangeSlots(null);
                        setChangeSelected(null);
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
        ) : null}

        {cancelTarget ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
            <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-slate-900">予約のキャンセル</div>
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm"
                  onClick={() => {
                    if (cancelBusy) return;
                    setCancelTarget(null);
                    setCancelErr(null);
                  }}
                >
                  閉じる
                </button>
              </div>

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
        ) : null}
      </div>
    </GymShell>
  );
}

