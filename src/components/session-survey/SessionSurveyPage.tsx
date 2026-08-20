"use client";

import Script from "next/script";
import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SESSION_SURVEY_HIGHLIGHTS,
  SESSION_SURVEY_INTENSITY,
  type SessionSurveyHighlightId,
  type SessionSurveyIntensityId,
} from "@/lib/sessionSurvey";
import {
  captureSurveyParamsFromLocation,
  persistSurveyParams,
  restoreSurveyParams,
  toSurveyApiQuery,
  type SurveyUrlParams,
} from "@/lib/sessionSurveyParams";

const TZ = "Asia/Tokyo";

function surveyLiffIdFromEnv(): string | null {
  const survey = process.env.NEXT_PUBLIC_LIFF_SURVEY_ID?.trim();
  if (survey) return survey;
  return process.env.NEXT_PUBLIC_LIFF_ID?.trim() || null;
}

const LIFF_INIT_TIMEOUT_MS = 8_000;

async function tryInitSurveyLiff(liffId: string): Promise<boolean> {
  const deadline = Date.now() + LIFF_INIT_TIMEOUT_MS;
  return new Promise((resolve) => {
    const tick = window.setInterval(() => {
      if (Date.now() > deadline) {
        window.clearInterval(tick);
        resolve(false);
        return;
      }
      const liff = (window as Window & {
        liff?: {
          init?: (o: { liffId: string }) => Promise<void>;
          isInClient?: () => boolean;
        };
      }).liff;
      if (!liff?.init) return;
      window.clearInterval(tick);
      liff
        .init({ liffId })
        .then(() => resolve(Boolean(liff.isInClient?.())))
        .catch(() => resolve(false));
    }, 50);
  });
}

type InvitePayload = {
  invite: {
    token: string;
    session_date: string;
    trainer_name: string;
    store_name: string;
    already_responded: boolean;
  };
  highlights: typeof SESSION_SURVEY_HIGHLIGHTS;
  intensity_options: typeof SESSION_SURVEY_INTENSITY;
  submit?: { token?: string; s?: string; sig?: string };
};

function formatSessionDate(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: TZ });
  return dt.isValid ? dt.setLocale("ja").toFormat("M月d日（ccc）") : ymd;
}

export default function SessionSurveyPage() {
  const [token, setToken] = useState<string | null>(null);
  const [signed, setSigned] = useState<{ s: string; sig: string } | null>(null);
  const [submitRef, setSubmitRef] = useState<{ token?: string; s?: string; sig?: string }>({});
  const [payload, setPayload] = useState<InvitePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [inLiff, setInLiff] = useState(false);

  const [rating, setRating] = useState<number | null>(null);
  const [highlights, setHighlights] = useState<SessionSurveyHighlightId[]>([]);
  const [intensity, setIntensity] = useState<SessionSurveyIntensityId | null>(null);
  const [commentGeneral, setCommentGeneral] = useState("");
  const [commentImprove, setCommentImprove] = useState("");
  const [commentQuestions, setCommentQuestions] = useState("");

  const title = useMemo(() => {
    if (!payload) return "セッション評価";
    return `${formatSessionDate(payload.invite.session_date)}のセッション`;
  }, [payload]);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    setErr(null);
    const res = await fetch(`/api/member/session-survey?${query}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string })?.error ?? "読み込みに失敗しました");
    const data = json as InvitePayload;
    setPayload(data);
    setSubmitRef(data.submit ?? {});
    if (data.invite.already_responded) setDone(true);
  }, []);

  const closeLiff = () => {
    const liff = (window as Window & { liff?: { closeWindow?: () => void; isInClient?: () => boolean } }).liff;
    if (liff?.isInClient?.()) {
      liff.closeWindow?.();
      return;
    }
    window.history.back();
  };

  useEffect(() => {
    let cancelled = false;

    const applyParams = async (p: SurveyUrlParams) => {
      if (p.token) setToken(p.token);
      if (p.s && p.sig) setSigned({ s: p.s, sig: p.sig });
      const q = toSurveyApiQuery(p);
      await load(q);
    };

    const boot = async () => {
      const early = captureSurveyParamsFromLocation();
      if (early) persistSurveyParams(early);

      const liffId = surveyLiffIdFromEnv();
      let params = early ?? restoreSurveyParams();

      if (!params && liffId) {
        const inClient = await tryInitSurveyLiff(liffId);
        if (!cancelled) setInLiff(inClient);
        if (cancelled) return;
        params = captureSurveyParamsFromLocation() ?? restoreSurveyParams();
      } else if (liffId) {
        void tryInitSurveyLiff(liffId).then((inClient) => {
          if (!cancelled) setInLiff(inClient);
        });
      }

      if (cancelled) return;
      if (!params) {
        setErr("リンクが不正です。LINEのメッセージから再度お開きください。");
        setLoading(false);
        return;
      }

      try {
        await applyParams(params);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    boot();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const toggleHighlight = (id: SessionSurveyHighlightId) => {
    if (id === "none") {
      setHighlights(["none"]);
      return;
    }
    setHighlights((prev) => {
      const withoutNone = prev.filter((x) => x !== "none");
      if (withoutNone.includes(id)) return withoutNone.filter((x) => x !== id);
      return [...withoutNone, id];
    });
  };

  const submit = async () => {
    if ((!token && !signed) || !rating || !intensity || highlights.length === 0) {
      setErr("評価・よかったところ・追い込みは必須です");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/member/session-survey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: submitRef.token ?? token ?? undefined,
          s: submitRef.s ?? signed?.s,
          sig: submitRef.sig ?? signed?.sig,
          rating,
          highlights,
          intensity_feedback: intensity,
          comment_general: commentGeneral.trim() || undefined,
          comment_improve: commentImprove.trim() || undefined,
          comment_questions: commentQuestions.trim() || undefined,
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
        <Script src="https://static.line-scdn.net/liff/edge/2/sdk.js" strategy="afterInteractive" />
        <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">ご回答ありがとうございました</h1>
          <p className="mt-2 text-sm text-slate-600">
            {payload.invite.trainer_name
              ? `担当の${payload.invite.trainer_name}へフィードバックをお届けしました。`
              : "フィードバックを記録しました。"}
            次回のセッション改善に活かします。
          </p>
          {inLiff ? (
            <button
              type="button"
              onClick={closeLiff}
              className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white"
            >
              LINEに戻る
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  const trainerName = payload?.invite.trainer_name?.trim() || "トレーナー";

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-gradient-to-b from-rose-50 to-slate-50 px-4 py-8 pb-16">
      <Script src="https://static.line-scdn.net/liff/edge/2/sdk.js" strategy="afterInteractive" />
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-rose-600">セッション評価</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          担当トレーナーの<strong className="text-slate-900">{trainerName}</strong>です。
          本日のセッションはいかがでしたか？次回に活かすため、ご協力ください。
        </p>
        {payload?.invite.store_name ? (
          <p className="mt-1 text-xs text-slate-500">店舗：{payload.invite.store_name}</p>
        ) : null}
      </header>

      <div className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">セッション評価（5段階）</h2>
          <div className="mt-3 flex justify-between gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className={`flex h-12 flex-1 flex-col items-center justify-center rounded-xl border text-sm font-bold transition ${
                  rating === n
                    ? "border-rose-500 bg-rose-500 text-white shadow-md"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:border-rose-300"
                }`}
              >
                <span className="text-lg leading-none">{n}</span>
                <span className="mt-0.5 text-[10px] font-normal opacity-80">
                  {n === 1 ? "不満" : n === 5 ? "最高" : ""}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">よかったところ（複数可）</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {SESSION_SURVEY_HIGHLIGHTS.map((h) => {
              const on = highlights.includes(h.id);
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => toggleHighlight(h.id)}
                  className={`rounded-full border px-3 py-2 text-sm font-medium transition ${
                    on
                      ? "border-rose-500 bg-rose-50 text-rose-800"
                      : "border-slate-200 bg-white text-slate-700 hover:border-rose-200"
                  }`}
                >
                  {h.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">追い込みはいかがでしたか？</h2>
          <div className="mt-3 space-y-2">
            {SESSION_SURVEY_INTENSITY.map((opt) => (
              <label
                key={opt.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
                  intensity === opt.id ? "border-rose-500 bg-rose-50" : "border-slate-200 hover:border-rose-200"
                }`}
              >
                <input
                  type="radio"
                  name="intensity"
                  className="accent-rose-600"
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
            <label className="text-sm font-bold text-slate-900">感想やご意見</label>
            <textarea
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              rows={3}
              value={commentGeneral}
              onChange={(e) => setCommentGeneral(e.target.value)}
              placeholder="任意"
            />
          </div>
          <div>
            <label className="text-sm font-bold text-slate-900">
              嫌だったこと・次回こうして欲しいこと
            </label>
            <textarea
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              rows={3}
              value={commentImprove}
              onChange={(e) => setCommentImprove(e.target.value)}
              placeholder="任意"
            />
          </div>
          <div>
            <label className="text-sm font-bold text-slate-900">
              わからなかったこと・次回聞きたいこと
            </label>
            <textarea
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              rows={3}
              value={commentQuestions}
              onChange={(e) => setCommentQuestions(e.target.value)}
              placeholder="任意"
            />
          </div>
        </section>

        {err ? <p className="text-sm text-red-600">{err}</p> : null}

        <button
          type="button"
          disabled={submitting}
          onClick={submit}
          className="w-full rounded-2xl bg-rose-600 py-4 text-base font-bold text-white shadow-lg disabled:opacity-60"
        >
          {submitting ? "送信中…" : "回答を送信する"}
        </button>
      </div>
    </main>
  );
}
