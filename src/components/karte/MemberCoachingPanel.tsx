"use client";

import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collectImprovePoints,
  resolveCoachingFollowup,
  summarizeImprovePoints,
  type CoachingActionKey,
  type CoachingNote,
} from "@/lib/sessionCoaching";

type CheckRow = {
  action_key: CoachingActionKey;
  trainer_id: string | null;
  trainer_name: string;
  done_at: string;
};

type TrainerOption = { id: string; name: string };

const TZ = "Asia/Tokyo";

function formatSessionDate(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: TZ });
  if (!dt.isValid) return ymd;
  return dt.toFormat("M/d");
}

function formatDoneAt(iso: string) {
  const dt = DateTime.fromISO(iso).setZone(TZ);
  if (!dt.isValid) return "";
  return dt.toFormat("M/d HH:mm");
}

export function MemberCoachingPanel({
  memberId,
  month,
  todayYmd,
  thisMonthCount,
  lastMonthCount,
  joinedAt,
  membershipStatus,
  hiatusEndAt,
  notes,
  defaultTrainerId,
}: {
  memberId: string;
  month: string;
  todayYmd: string;
  thisMonthCount: number | null;
  lastMonthCount: number | null;
  joinedAt?: string | null;
  membershipStatus?: string | null;
  hiatusEndAt?: string | null;
  notes: CoachingNote[] | null;
  defaultTrainerId?: string;
}) {
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const [trainerId, setTrainerId] = useState(defaultTrainerId ?? "");
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [schemaReady, setSchemaReady] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const improveSummary = useMemo(
    () => (notes ? summarizeImprovePoints(collectImprovePoints(notes)) : null),
    [notes]
  );
  const followup = useMemo(() => {
    if (thisMonthCount == null || lastMonthCount == null) return null;
    return resolveCoachingFollowup({
      todayYmd,
      thisMonthCount,
      lastMonthCount,
      joinedAt,
      membershipStatus,
      hiatusEndAt,
    });
  }, [todayYmd, thisMonthCount, lastMonthCount, joinedAt, membershipStatus, hiatusEndAt]);
  const actions = followup?.actions ?? [];

  const loadChecks = useCallback(async () => {
    const res = await fetch(
      `/api/admin/members/${encodeURIComponent(memberId)}/coaching?month=${encodeURIComponent(month)}`,
      { cache: "no-store" }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
    setSchemaReady(Boolean((json as { schema_ready?: boolean }).schema_ready));
    setChecks(((json as { checks?: CheckRow[] }).checks ?? []) as CheckRow[]);
  }, [memberId, month]);

  useEffect(() => {
    void loadChecks().catch((e) => setErr(e instanceof Error ? e.message : "取得に失敗しました"));
  }, [loadChecks]);

  useEffect(() => {
    void fetch("/api/trainers", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { trainers?: { id: string; name: string }[] }) => {
        setTrainers(
          (data.trainers ?? [])
            .map((t) => ({ id: t.id, name: String(t.name ?? "").trim() }))
            .filter((t) => t.id && t.name)
        );
      })
      .catch(() => setTrainers([]));
  }, []);

  useEffect(() => {
    if (defaultTrainerId) setTrainerId(defaultTrainerId);
  }, [defaultTrainerId]);

  async function toggle(actionKey: CoachingActionKey, done: boolean) {
    if (busyKey) return;
    if (done && !trainerId) {
      setErr("実施したトレーナーを選んでください");
      return;
    }
    setBusyKey(actionKey);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/coaching`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month, action_key: actionKey, done, trainer_id: trainerId || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "保存に失敗しました");
      await loadChecks();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      <div>
        <div className="text-sm font-bold text-slate-900">提案と注意点</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          これまでの改善点をまとめています。誰が、いつのセッションで残したかが分かります。
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-700">注意点</div>
        {notes === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
        {improveSummary && improveSummary.items.length === 0 ? (
          <div className="text-sm text-slate-600">これまでのカルテに、改善点はまだありません。</div>
        ) : null}
        {improveSummary && improveSummary.items.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-3">
            <p className="text-sm leading-relaxed text-amber-950">{improveSummary.summary}</p>
            <ul className="mt-3 space-y-3">
              {improveSummary.items.map((item) => (
                <li key={item.noteId} className="text-sm text-slate-800">
                  <div className="whitespace-pre-wrap leading-relaxed">{item.body}</div>
                  <div className="mt-1 text-[11px] font-semibold text-slate-500">
                    {item.trainerName}が {formatSessionDate(item.date)} のセッションで残した改善点
                    {item.storeName ? `（${item.storeName}）` : ""}
                    {item.times > 1 ? `。同じ内容が${item.times}回` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {followup && actions.length > 0 ? (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold text-slate-700">提案</div>
          <div className="text-sm font-semibold text-slate-900">{followup.title}</div>
          <p className="text-xs leading-relaxed text-slate-600">{followup.detail}</p>
          <label className="block text-xs text-slate-600">
            実施したトレーナー
            <select
              value={trainerId}
              onChange={(e) => setTrainerId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">選択してください</option>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {!schemaReady ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              実施記録の保存準備がまだです。チェックは次回の更新後に残ります。
            </div>
          ) : null}
          <ul className="space-y-2">
            {actions.map((action) => {
              const check = checks.find((row) => row.action_key === action.key);
              return (
                <li key={action.key} className="rounded-xl border border-slate-200 px-3 py-2">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={Boolean(check)}
                      disabled={busyKey === action.key || !schemaReady}
                      onChange={(e) => void toggle(action.key, e.target.checked)}
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{action.label}</span>
                      <span className="block text-xs leading-relaxed text-slate-600">{action.detail}</span>
                      {check ? (
                        <span className="mt-1 block text-[11px] font-semibold text-emerald-800">
                          {check.trainer_name || "トレーナー"}が {formatDoneAt(check.done_at)} に実施
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {followup && actions.length === 0 ? (
        <div className="space-y-1 border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold text-slate-700">提案</div>
          <p className="text-xs text-slate-500">{followup.detail}</p>
        </div>
      ) : null}

      {err ? <div className="text-xs text-red-700">{err}</div> : null}
    </section>
  );
}
