"use client";

import { Dumbbell } from "lucide-react";
import { DateTime } from "luxon";
import { useCallback, useEffect, useState } from "react";
import { HOME_PAGE_CLASS } from "@/components/member/WeightHomeCarousel";
import {
  TRAINING_LOG_TZ,
  trainingConditionLabel,
  trainingKindLabel,
  trainingPartsLabel,
  type MemberTrainingLogView,
} from "@/lib/memberTrainingLogs";

function formatYmd(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: TRAINING_LOG_TZ });
  if (!dt.isValid) return ymd;
  const dow = ["日", "月", "火", "水", "木", "金", "土"][dt.weekday % 7];
  return `${dt.toFormat("M/d")}（${dow}）`;
}

function formatHomeDate(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: TRAINING_LOG_TZ });
  if (!dt.isValid) return ymd;
  const dow = ["月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日"][dt.weekday - 1];
  return `${dow}, ${dt.toFormat("M月d日")}`;
}

function summaryOf(log: MemberTrainingLogView) {
  const bits: string[] = [trainingKindLabel(log.kind)];
  const parts = trainingPartsLabel(log.parts);
  if (parts) bits.push(parts);
  if (log.duration_min != null) bits.push(`${log.duration_min}分`);
  const condition = trainingConditionLabel(log.condition);
  if (condition) bits.push(`調子${condition}`);
  return bits.join("・");
}

export function TrainingDiaryPanel({ signed }: { signed?: { s: string; sig: string } | null }) {
  const [today, setToday] = useState("");
  const [logs, setLogs] = useState<MemberTrainingLogView[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const query = signed ? `?s=${encodeURIComponent(signed.s)}&sig=${encodeURIComponent(signed.sig)}` : "";

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/member/training-logs${query}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        today?: string;
        logs?: MemberTrainingLogView[];
        today_log?: MemberTrainingLogView | null;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "取得に失敗しました");
      setToday(json.today ?? "");
      const rows = Array.isArray(json.logs)
        ? json.logs
        : json.today_log
          ? [json.today_log]
          : [];
      setLogs(rows);
    } catch (e) {
      setErr(String((e as Error)?.message ?? "取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const todayLogs = today ? logs.filter((row) => row.log_date === today) : [];
  const pastLogs = today ? logs.filter((row) => row.log_date !== today) : logs;

  return (
    <section className={HOME_PAGE_CLASS}>
      <div className="text-center">
        <div className="text-3xl font-bold tracking-tight text-slate-900">トレーニング</div>
        <div className="mt-0.5 text-[11px] font-semibold text-slate-400">← 食事</div>
        {today ? <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{formatHomeDate(today)}</div> : null}
      </div>

      <div className="mt-4 space-y-4">
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Dumbbell className="h-4 w-4" />
            {today ? `${formatYmd(today)}の記録` : "今日の記録"}
          </div>
          {loading ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
          {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</div> : null}
          {!loading && !err && todayLogs.length === 0 ? (
            <div className="text-sm text-slate-600">まだトレーニングがありません。中央の＋から残せます。</div>
          ) : null}
          {todayLogs.map((log) => (
            <TrainingDiaryCard key={log.id} log={log} showDate={false} />
          ))}
        </section>

        {pastLogs.length ? (
          <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-bold text-slate-900">過去のトレーニング</div>
            <p className="text-xs text-slate-500">記録した日の内容です。追加・更新は中央の＋からできます。</p>
            {pastLogs.map((log) => (
              <TrainingDiaryCard key={log.id} log={log} showDate />
            ))}
          </section>
        ) : null}
      </div>
    </section>
  );
}

function TrainingDiaryCard({ log, showDate }: { log: MemberTrainingLogView; showDate: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2">
      <div className="flex gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <Dumbbell className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug text-slate-900">
            {showDate ? `${formatYmd(log.log_date)} ` : ""}
            {summaryOf(log)}
          </div>
          {log.source === "karte" ? (
            <div className="mt-0.5 text-[11px] font-semibold text-teal-800">トレーナーカルテ</div>
          ) : null}
          {log.note ? <div className="mt-0.5 text-[11px] text-slate-500">{log.note}</div> : null}
        </div>
      </div>
    </div>
  );
}
