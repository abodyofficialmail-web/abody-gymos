"use client";

import Script from "next/script";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PRE_SESSION_ACCENT_COLOR,
  type PreSessionIntensityId,
  type PreSessionMealId,
} from "@/lib/preSessionSurvey";

type SurveyPayload = {
  survey: {
    reservation_id: string;
    session_date_label: string;
    session_type_label: string;
    store_name: string;
    trainer_name: string;
    already_responded: boolean;
  };
  meal_options: Array<{ id: PreSessionMealId; label: string }>;
  intensity_options: Array<{ id: PreSessionIntensityId; label: string }>;
  submit: { s: string; sig: string };
};

function readSignedFromLocation(): { s: string; sig: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const s = params.get("s") ?? "";
  const sig = params.get("sig") ?? "";
  if (!s || !sig) return null;
  return { s, sig };
}

export default function PreSessionSurveyPage() {
  const [signed, setSigned] = useState<{ s: string; sig: string } | null>(null);
  const [payload, setPayload] = useState<SurveyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [conditionScore, setConditionScore] = useState<number | null>(null);
  const [mealStatus, setMealStatus] = useState<PreSessionMealId | null>(null);
  const [intensity, setIntensity] = useState<PreSessionIntensityId | null>(null);
  const [requestFocus, setRequestFocus] = useState("");
  const [concern, setConcern] = useState("");
  const [freeComment, setFreeComment] = useState("");

  const title = useMemo(() => payload?.survey.session_date_label ?? "セッション前ヒアリング", [payload]);

  const load = useCallback(async (s: string, sig: string) => {
    setLoading(true);
    setErr(null);
    const res = await fetch(`/api/member/pre-session-survey?s=${encodeURIComponent(s)}&sig=${encodeURIComponent(sig)}`, {
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string })?.error ?? "読み込みに失敗しました");
    const data = json as SurveyPayload;
    setPayload(data);
    if (data.survey.already_responded) setDone(true);
  }, []);

  useEffect(() => {
    const params = readSignedFromLocation();
    if (!params) {
      setErr("リンクが不正です。LINEのメッセージから再度お開きください。");
      setLoading(false);
      return;
    }
    setSigned(params);
    load(params.s, params.sig)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [load]);

  const submit = async () => {
    if (!signed || !conditionScore || !mealStatus || !intensity) {
      setErr("今日の調子・食事・強度感は必須です");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/member/pre-session-survey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          s: signed.s,
          sig: signed.sig,
          condition_score: conditionScore,
          meal_status: mealStatus,
          intensity_preference: intensity,
          request_focus: requestFocus.trim() || undefined,
          concern: concern.trim() || undefined,
          free_comment: freeComment.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string })?.error ?? "送信に失敗しました");
      setDone(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const accentStyle = { backgroundColor: PRE_SESSION_ACCENT_COLOR };

  if (loading) {
    return (
      <>
        <Script src="https://static.line-scdn.net/liff/edge/2/sdk.js" strategy="afterInteractive" />
        <main className="mx-auto min-h-screen max-w-lg bg-slate-50 px-4 py-10">
          <p className="text-center text-slate-600">読み込み中…</p>
        </main>
      </>
    );
  }

  if (err && !payload) {
    return (
      <main className="mx-auto min-h-screen max-w-lg bg-slate-50 px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">{err}</div>
      </main>
    );
  }

  if (done && payload) {
    return (
      <main className="mx-auto min-h-screen max-w-lg bg-slate-50 px-4 py-10">
        <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">ご回答ありがとうございました</h1>
          <p className="mt-2 text-sm text-slate-600">
            {payload.survey.trainer_name
              ? `担当の${payload.survey.trainer_name}がセッション準備に活用します。`
              : "トレーナーがセッション準備に活用します。"}
          </p>
        </div>
      </main>
    );
  }

  const trainerName = payload?.survey.trainer_name?.trim() || "トレーナー";

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-gradient-to-b from-blue-50 to-slate-50 px-4 py-8 pb-16">
      <Script src="https://static.line-scdn.net/liff/edge/2/sdk.js" strategy="afterInteractive" />
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">セッション前ヒアリング</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          担当<strong className="text-slate-900">{trainerName}</strong>がセッション内容を準備します。ご協力ください。
        </p>
        {payload?.survey.store_name ? (
          <p className="mt-1 text-xs text-slate-500">
            店舗：{payload.survey.store_name} / {payload.survey.session_type_label}
          </p>
        ) : null}
      </header>

      <div className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">今日の調子（5段階）</h2>
          <div className="mt-3 flex justify-between gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setConditionScore(n)}
                className={`flex h-12 flex-1 flex-col items-center justify-center rounded-xl border text-sm font-bold transition ${
                  conditionScore === n
                    ? "border-blue-600 bg-blue-600 text-white shadow-md"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300"
                }`}
              >
                <span className="text-lg leading-none">{n}</span>
                <span className="mt-0.5 text-[10px] font-normal opacity-80">
                  {n === 1 ? "つらい" : n === 5 ? "絶好調" : ""}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">食事</h2>
          <div className="mt-3 space-y-2">
            {(payload?.meal_options ?? []).map((opt) => (
              <label
                key={opt.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
                  mealStatus === opt.id ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-blue-200"
                }`}
              >
                <input
                  type="radio"
                  name="meal"
                  className="accent-blue-600"
                  checked={mealStatus === opt.id}
                  onChange={() => setMealStatus(opt.id)}
                />
                <span className="text-sm font-medium text-slate-800">{opt.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">トレーニングの強度感</h2>
          <div className="mt-3 space-y-2">
            {(payload?.intensity_options ?? []).map((opt) => (
              <label
                key={opt.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
                  intensity === opt.id ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-blue-200"
                }`}
              >
                <input
                  type="radio"
                  name="intensity"
                  className="accent-blue-600"
                  checked={intensity === opt.id}
                  onChange={() => setIntensity(opt.id)}
                />
                <span className="text-sm font-medium text-slate-800">{opt.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div>
            <label className="text-sm font-bold text-slate-900">今日重点的にやりたい部位・種目</label>
            <textarea
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              rows={2}
              value={requestFocus}
              onChange={(e) => setRequestFocus(e.target.value)}
              placeholder="任意"
            />
          </div>
          <div>
            <label className="text-sm font-bold text-slate-900">痛み・違和感・避けたいこと</label>
            <textarea
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              rows={2}
              value={concern}
              onChange={(e) => setConcern(e.target.value)}
              placeholder="任意"
            />
          </div>
          <div>
            <label className="text-sm font-bold text-slate-900">その他伝えたいこと</label>
            <textarea
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              rows={2}
              value={freeComment}
              onChange={(e) => setFreeComment(e.target.value)}
              placeholder="任意"
            />
          </div>
        </section>

        {err ? <p className="text-sm text-red-600">{err}</p> : null}

        <button
          type="button"
          disabled={submitting}
          onClick={submit}
          className="w-full rounded-2xl py-4 text-base font-bold text-white shadow-lg disabled:opacity-60"
          style={accentStyle}
        >
          {submitting ? "送信中…" : "回答を送信する"}
        </button>
      </div>
    </main>
  );
}
