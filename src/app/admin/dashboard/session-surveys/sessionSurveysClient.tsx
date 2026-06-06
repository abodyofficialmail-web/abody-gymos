"use client";

import { DateTime } from "luxon";
import { useCallback, useEffect, useState } from "react";
import { SESSION_SURVEY_HIGHLIGHTS, SESSION_SURVEY_INTENSITY } from "@/lib/sessionSurvey";

const TZ = "Asia/Tokyo";

type Row = {
  id: string;
  session_date: string;
  rating: number;
  highlights: string[];
  intensity_feedback: string;
  comment_general: string | null;
  comment_improve: string | null;
  comment_questions: string | null;
  followup_status: string;
  followup_note: string | null;
  created_at: string;
  trainers: { id: string; display_name: string } | null;
  members: { id: string; member_code: string; name: string | null; line_user_id: string | null } | null;
  stores: { id: string; name: string } | null;
};

type FilterOptions = {
  stores: Array<{ id: string; name: string }>;
  trainers: Array<{ id: string; display_name: string }>;
};

type TrainerStat = {
  trainer_id: string;
  trainer_name: string;
  count: number;
  average_rating: number;
};

function intensityLabel(id: string) {
  return SESSION_SURVEY_INTENSITY.find((i) => i.id === id)?.label ?? id;
}

function highlightLabel(id: string) {
  return SESSION_SURVEY_HIGHLIGHTS.find((h) => h.id === id)?.label ?? id;
}

export function SessionSurveysClient() {
  const [tab, setTab] = useState<"pending" | "done" | "all">("pending");
  const [storeId, setStoreId] = useState("");
  const [trainerId, setTrainerId] = useState("");
  const [highlight, setHighlight] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ stores: [], trainers: [] });
  const [trainerStats, setTrainerStats] = useState<TrainerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<Row | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [replySending, setReplySending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ followup: tab, limit: "500" });
      if (storeId) params.set("store_id", storeId);
      if (trainerId) params.set("trainer_id", trainerId);
      if (highlight) params.set("highlight", highlight);
      const res = await fetch(`/api/admin/session-surveys?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string })?.error ?? "取得に失敗");
      const data = json as {
        responses: Row[];
        filter_options?: FilterOptions;
        trainer_stats?: TrainerStat[];
      };
      setRows(data.responses ?? []);
      setFilterOptions(data.filter_options ?? { stores: [], trainers: [] });
      setTrainerStats(data.trainer_stats ?? []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "取得に失敗");
    } finally {
      setLoading(false);
    }
  }, [highlight, storeId, tab, trainerId]);

  useEffect(() => {
    load();
  }, [load]);

  const markDone = async (id: string, note: string) => {
    const res = await fetch(`/api/admin/session-surveys/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ followup_status: "done", followup_note: note }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert((json as { error?: string })?.error ?? "更新に失敗");
      return;
    }
    load();
  };

  const sendReply = async () => {
    if (!replyTarget) return;
    const message = replyMessage.trim();
    if (!message) {
      alert("返信内容を入力してください");
      return;
    }
    setReplySending(true);
    try {
      const res = await fetch(`/api/admin/session-surveys/${replyTarget.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string })?.error ?? "返信に失敗しました");
      alert("LINEに返信しました");
      setReplyTarget(null);
      setReplyMessage("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "返信に失敗しました");
    } finally {
      setReplySending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["pending", "done", "all"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              tab === t ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700"
            }`}
          >
            {t === "pending" ? "要ヒアリング" : t === "done" ? "対応済み" : "すべて"}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm font-semibold text-slate-700">
            店舗
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">すべて</option>
              {filterOptions.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            トレーナー
            <select
              value={trainerId}
              onChange={(e) => setTrainerId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">すべて</option>
              {filterOptions.trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setStoreId("");
                setTrainerId("");
                setHighlight("");
              }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
            >
              絞り込みを解除
            </button>
          </div>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-700">良かった項目</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setHighlight("")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                !highlight ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700"
              }`}
            >
              すべて
            </button>
            {SESSION_SURVEY_HIGHLIGHTS.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setHighlight(h.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  highlight === h.id ? "bg-rose-600 text-white" : "border border-rose-200 bg-rose-50 text-rose-800"
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {trainerStats.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-bold text-slate-900">トレーナー別集計</div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {trainerStats.map((s) => (
              <button
                key={s.trainer_id}
                type="button"
                onClick={() => s.trainer_id !== "unknown" && setTrainerId(s.trainer_id)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left"
              >
                <div className="text-sm font-semibold text-slate-900">{s.trainer_name}</div>
                <div className="mt-1 text-xs text-slate-600">
                  回答 {s.count}件 / 平均 {s.average_rating.toFixed(1)}
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {loading ? <p className="text-sm text-slate-600">読み込み中…</p> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      {!loading && !err && rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">該当なし</p>
      ) : null}

      <ul className="space-y-3">
        {rows.map((r) => {
          const memberLabel = r.members?.name
            ? `${r.members.name}（${r.members.member_code}）`
            : r.members?.member_code ?? "—";
          const dateLabel = DateTime.fromISO(r.session_date, { zone: TZ }).toFormat("yyyy/M/d");
          return (
            <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-slate-900">
                    評価 {r.rating}/5 — {memberLabel}
                  </p>
                  <p className="text-sm text-slate-600">
                    {dateLabel} · {r.stores?.name} · 担当 {r.trainers?.display_name}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">追い込み: {intensityLabel(r.intensity_feedback)}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.highlights.map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setHighlight(h)}
                        className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-800"
                      >
                        {highlightLabel(h)}
                      </button>
                    ))}
                  </div>
                </div>
                {r.rating <= 2 ? (
                  <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-800">要ヒアリング</span>
                ) : null}
              </div>
              {(r.comment_improve || r.comment_general || r.comment_questions) && (
                <div className="mt-3 space-y-1 text-sm text-slate-700">
                  {r.comment_general ? <p>感想: {r.comment_general}</p> : null}
                  {r.comment_improve ? <p>改善: {r.comment_improve}</p> : null}
                  {r.comment_questions ? <p>質問: {r.comment_questions}</p> : null}
                </div>
              )}
              {r.followup_status === "pending" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                    onClick={() => {
                      const note = window.prompt("対応メモ（任意）") ?? "";
                      markDone(r.id, note);
                    }}
                  >
                    ヒアリング済みにする
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50"
                    disabled={!r.members?.line_user_id}
                    onClick={() => {
                      setReplyTarget(r);
                      setReplyMessage("");
                    }}
                  >
                    返信する
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-emerald-700">対応済み{r.followup_note ? ` — ${r.followup_note}` : ""}</p>
                  <button
                    type="button"
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-50"
                    disabled={!r.members?.line_user_id}
                    onClick={() => {
                      setReplyTarget(r);
                      setReplyMessage("");
                    }}
                  >
                    返信する
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {replyTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-lg space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-900">会員LINEへ返信</div>
                <div className="mt-1 text-xs text-slate-600">
                  {replyTarget.members?.name || replyTarget.members?.member_code} へ送信
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyTarget(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold"
              >
                閉じる
              </button>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              送信時に「アンケート回答ありがとうございます。担当させていただきました{replyTarget.trainers?.display_name ?? "トレーナー"}です。」が先頭に付きます。
            </div>
            <textarea
              value={replyMessage}
              onChange={(e) => setReplyMessage(e.target.value)}
              rows={5}
              placeholder="返信内容を入力"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={replySending}
              onClick={sendReply}
              className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {replySending ? "送信中…" : "LINEに送信する"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
