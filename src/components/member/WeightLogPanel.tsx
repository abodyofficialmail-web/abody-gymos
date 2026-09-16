"use client";

import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HOME_PAGE_CLASS, WeightOutlookStrip } from "@/components/member/WeightHomeCarousel";
import { buildWeightOutlook } from "@/lib/diet/weightOutlook";
import { formatIntakeLabel, type MemberNutritionTargetView } from "@/lib/memberNutritionTargets";
import type { MemberWeightLogStats, MemberWeightLogView } from "@/lib/memberWeightLogs";
import { WEIGHT_LOG_TZ } from "@/lib/memberWeightLogs";

type WeightLogsResponse = {
  enabled?: boolean;
  today: string;
  today_log: MemberWeightLogView | null;
  logs: MemberWeightLogView[];
  stats: MemberWeightLogStats;
  nutrition?: MemberNutritionTargetView | null;
  error?: string;
};

function formatYmdLabel(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: WEIGHT_LOG_TZ });
  if (!dt.isValid) return ymd;
  const dow = ["日", "月", "火", "水", "木", "金", "土"][dt.weekday % 7];
  return `${dt.toFormat("M/d")}（${dow}）`;
}

function formatKg(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toFixed(1)} kg`;
}

function formatFat(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

function deltaLabel(n: number | null | undefined, unit: "kg" | "%" = "kg") {
  if (n == null) return null;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}${unit === "%" ? "%" : " kg"}`;
}

function deltaClass(n: number | null | undefined) {
  if (n == null || n === 0) return "text-slate-500";
  if (n > 0) return "text-amber-700";
  return "text-emerald-700";
}

function niceWeightScale(minKg: number, maxKg: number) {
  const span = Math.max(maxKg - minKg, 0.5);
  const paddedMin = minKg - Math.max(0.15, span * 0.12);
  const paddedMax = maxKg + Math.max(0.15, span * 0.12);
  const inner = paddedMax - paddedMin;
  const step = inner <= 0.8 ? 0.2 : inner <= 1.6 ? 0.5 : inner <= 5 ? 1 : 2;
  const y0 = Math.floor(paddedMin / step) * step;
  const y1 = Math.ceil(paddedMax / step) * step;
  const ticks: number[] = [];
  const count = Math.round((y1 - y0) / step);
  for (let i = 0; i <= count; i += 1) {
    ticks.push(Number((y0 + i * step).toFixed(1)));
  }
  return { y0, y1, ticks };
}

function formatAxisKg(n: number) {
  return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(1);
}

function formatAxisDate(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: WEIGHT_LOG_TZ });
  if (!dt.isValid) return ymd;
  return dt.toFormat("M/d");
}

function xLabelIndexes(n: number) {
  if (n <= 1) return [0];
  if (n <= 5) return Array.from({ length: n }, (_, i) => i);
  return [...new Set([0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round((3 * (n - 1)) / 4), n - 1])];
}

function WeightSparkline({ logs, today }: { logs: MemberWeightLogView[]; today: string }) {
  const points = useMemo(() => {
    const byDate = new Map(logs.map((l) => [l.log_date, l.weight_kg]));
    const end = DateTime.fromISO(today, { zone: WEIGHT_LOG_TZ });
    const out: Array<{ date: string; kg: number | null }> = [];
    for (let i = 13; i >= 0; i -= 1) {
      const date = end.minus({ days: i }).toFormat("yyyy-MM-dd");
      out.push({ date, kg: byDate.get(date) ?? null });
    }
    return out;
  }, [logs, today]);

  const nums = points.map((p) => p.kg).filter((n): n is number => n != null);
  if (nums.length < 2) {
    return <div className="text-xs text-slate-500">2日以上記録するとグラフが表示されます。</div>;
  }

  const { y0, y1, ticks } = niceWeightScale(Math.min(...nums), Math.max(...nums));
  const padL = 36;
  const padR = 12;
  const padT = 28;
  const padB = 26;
  const innerW = 280;
  const innerH = 112;
  const w = padL + innerW + padR;
  const h = padT + innerH + padB;
  const xAt = (i: number) => padL + (i / Math.max(points.length - 1, 1)) * innerW;
  const yAt = (kg: number) => padT + innerH - ((kg - y0) / Math.max(y1 - y0, 0.01)) * innerH;
  const recorded = points
    .map((p, i) => (p.kg == null ? null : { i, date: p.date, kg: p.kg, x: xAt(i), y: yAt(p.kg) }))
    .filter((p): p is { i: number; date: string; kg: number; x: number; y: number } => p != null);
  const coords = recorded.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const xLabels = xLabelIndexes(points.length);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-44 w-full"
      role="img"
      aria-label="直近14日の体重推移"
    >
      <text x={padL - 6} y={16} textAnchor="end" fill="#94a3b8" fontSize="9">
        kg
      </text>
      {ticks.map((tick) => {
        const y = yAt(tick);
        return (
          <g key={tick}>
            <line x1={padL} y1={y} x2={padL + innerW} y2={y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={padL - 6} y={y} textAnchor="end" dominantBaseline="middle" fill="#64748b" fontSize="10">
              {formatAxisKg(tick)}
            </text>
          </g>
        );
      })}
      {xLabels.map((i) => (
        <line
          key={`v-${points[i].date}`}
          x1={xAt(i)}
          y1={padT}
          x2={xAt(i)}
          y2={padT + innerH}
          stroke="#f1f5f9"
          strokeWidth="1"
        />
      ))}
      <line
        x1={padL}
        y1={padT + innerH}
        x2={padL + innerW}
        y2={padT + innerH}
        stroke="#cbd5e1"
        strokeWidth="1"
      />
      <polyline
        fill="none"
        stroke="#0f766e"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={coords}
      />
      {recorded.map((p) => (
        <circle key={p.date} cx={p.x} cy={p.y} r="3" fill="#0f766e" stroke="#fff" strokeWidth="1.25" />
      ))}
      {xLabels.map((i) => {
        const x = xAt(i);
        const isFirst = i === 0;
        const isLast = i === points.length - 1;
        return (
          <g key={points[i].date}>
            <line x1={x} y1={padT + innerH} x2={x} y2={padT + innerH + 4} stroke="#cbd5e1" strokeWidth="1" />
            <text
              x={x}
              y={padT + innerH + 16}
              textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
              fill="#64748b"
              fontSize="10"
            >
              {formatAxisDate(points[i].date)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function WeightLogPanel({
  signed,
  compact = false,
  apiPath = "/api/member/weight-logs",
  readOnly = false,
  showLogList = true,
  showNutrition = true,
  showOutlook = false,
  recentKcalAvg = null,
}: {
  signed?: { s: string; sig: string } | null;
  compact?: boolean;
  apiPath?: string;
  readOnly?: boolean;
  showLogList?: boolean;
  showNutrition?: boolean;
  showOutlook?: boolean;
  recentKcalAvg?: number | null;
}) {
  const [data, setData] = useState<WeightLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState("");
  const [fatInput, setFatInput] = useState("");
  const [logDate, setLogDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const query = signed ? `?s=${encodeURIComponent(signed.s)}&sig=${encodeURIComponent(signed.sig)}` : "";
  const listUrl = `${apiPath}${query}`;

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(listUrl, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as WeightLogsResponse;
      if (!res.ok) throw new Error(json.error || "取得に失敗しました");
      setData(json);
      setLogDate((prev) => prev || json.today);
      const todayExisting = json.today_log ?? json.logs.find((l) => l.log_date === json.today);
      if (todayExisting) {
        setWeightInput(todayExisting.weight_kg.toFixed(1));
        setFatInput(todayExisting.body_fat_pct != null ? todayExisting.body_fat_pct.toFixed(1) : "");
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? "取得に失敗しました"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [listUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data) return;
    const existing = data.logs.find((l) => l.log_date === logDate);
    setWeightInput(existing ? existing.weight_kg.toFixed(1) : "");
    setFatInput(existing?.body_fat_pct != null ? existing.body_fat_pct.toFixed(1) : "");
  }, [data, logDate]);

  const selectedExisting = data?.logs.find((l) => l.log_date === logDate) ?? null;
  const isToday = Boolean(data && logDate === data.today);

  async function save() {
    if (!data) return;
    setBusy(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(signed ? { s: signed.s, sig: signed.sig } : {}),
          log_date: logDate || data.today,
          weight_kg: weightInput,
          body_fat_pct: fatInput.trim() === "" ? null : fatInput,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as WeightLogsResponse & { ok?: boolean };
      if (!res.ok) throw new Error(json.error || "保存に失敗しました");
      setData({
        enabled: true,
        today: json.today,
        today_log: json.today_log,
        logs: json.logs,
        stats: json.stats,
        nutrition: json.nutrition ?? data.nutrition ?? null,
      });
      const saved = json.logs?.find((l) => l.log_date === (logDate || data.today)) ?? json.today_log;
      const withFat = saved?.body_fat_pct != null;
      setSavedMsg(
        isToday
          ? withFat
            ? "今日の体重・体脂肪を記録しました"
            : "今日の体重を記録しました"
          : withFat
            ? `${formatYmdLabel(logDate)}の体重・体脂肪を記録しました`
            : `${formatYmdLabel(logDate)}の体重を記録しました`
      );
    } catch (e) {
      setErr(String((e as Error)?.message ?? "保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    if (showOutlook) {
      return (
        <section className={HOME_PAGE_CLASS}>
          <div className="text-3xl font-bold tracking-tight text-slate-900">体重</div>
          <p className="mt-4 text-sm text-slate-600">読み込み中…</p>
        </section>
      );
    }
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        体重・体脂肪を読み込み中…
      </div>
    );
  }

  if (err && !data) {
    if (showOutlook) {
      return (
        <section className={HOME_PAGE_CLASS}>
          <div className="text-3xl font-bold tracking-tight text-slate-900">体重</div>
          <p className="mt-4 text-sm text-red-700">{err}</p>
        </section>
      );
    }
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
    );
  }

  if (!data) return null;

  const outlook = showOutlook
    ? buildWeightOutlook({
        stats: data.stats,
        tdee: data.nutrition?.daily_expenditure_kcal ?? null,
        intakeTarget: data.nutrition?.intake_kcal ?? null,
        recentKcalAvg,
      })
    : null;

  const minDate = DateTime.fromISO(data.today, { zone: WEIGHT_LOG_TZ }).minus({ days: 30 }).toFormat("yyyy-MM-dd");

  const recordFields = readOnly ? (
    <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 space-y-1">
      <div>
        直近: {formatKg(data.stats.latest_kg)}
        {data.stats.delta_kg != null ? (
          <span className={`ml-2 ${deltaClass(data.stats.delta_kg)}`}>{deltaLabel(data.stats.delta_kg)}</span>
        ) : null}
      </div>
      <div>
        体脂肪: {formatFat(data.stats.latest_fat_pct)}
        {data.stats.delta_fat_pct != null ? (
          <span className={`ml-2 ${deltaClass(data.stats.delta_fat_pct)}`}>
            {deltaLabel(data.stats.delta_fat_pct, "%")}
          </span>
        ) : null}
      </div>
    </div>
  ) : (
    <>
      {showOutlook ? null : (
        <label className="block text-xs font-semibold text-slate-700">
          記録日
          <input
            type="date"
            value={logDate}
            min={minDate}
            max={data.today}
            onChange={(e) => setLogDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
          />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 text-xs font-semibold text-slate-700">
          体重（kg）
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min={15}
            max={300}
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            placeholder={data.stats.previous_kg != null ? data.stats.previous_kg.toFixed(1) : "55.0"}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-lg font-semibold text-slate-900"
          />
        </label>
        <label className="min-w-0 text-xs font-semibold text-slate-700">
          体脂肪（%）
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min={3}
            max={60}
            value={fatInput}
            onChange={(e) => setFatInput(e.target.value)}
            placeholder={data.stats.previous_fat_pct != null ? data.stats.previous_fat_pct.toFixed(1) : "任意"}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-lg font-semibold text-slate-900"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy || !weightInput.trim()}
        onClick={() => void save()}
        className="w-full rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? "保存中…" : selectedExisting ? "更新する" : "記録する"}
      </button>
    </>
  );

  const previousLine =
    isToday && (data.stats.previous_kg != null || data.stats.previous_fat_pct != null) ? (
      <div className="text-xs text-slate-600 space-y-0.5">
        {data.stats.previous_kg != null ? (
          <div>
            前回の体重: {formatKg(data.stats.previous_kg)}
            {data.today_log && data.stats.delta_kg != null ? (
              <span className={`ml-2 font-semibold ${deltaClass(data.stats.delta_kg)}`}>
                {deltaLabel(data.stats.delta_kg)}
              </span>
            ) : null}
          </div>
        ) : null}
        {data.stats.previous_fat_pct != null ? (
          <div>
            前回の体脂肪: {formatFat(data.stats.previous_fat_pct)}
            {data.today_log?.body_fat_pct != null && data.stats.delta_fat_pct != null ? (
              <span className={`ml-2 font-semibold ${deltaClass(data.stats.delta_fat_pct)}`}>
                {deltaLabel(data.stats.delta_fat_pct, "%")}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null;

  const statusNotes = (
    <>
      {savedMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {savedMsg}
        </div>
      ) : null}
      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</div>
      ) : null}
    </>
  );

  if (showOutlook) {
    const dateLabel = DateTime.fromISO(data.today, { zone: WEIGHT_LOG_TZ }).toFormat("M月d日");
    return (
      <section className={HOME_PAGE_CLASS}>
        <div className="text-center">
          <div className="text-3xl font-bold tracking-tight text-slate-900">体重</div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{dateLabel}</div>
        </div>
        <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <div className="text-lg font-bold text-slate-900">今日の記録</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">体脂肪は任意です。</p>
          </div>
          {recordFields}
          {data.stats.previous_kg != null ? (
            <div className="text-xs text-slate-600">
              前回 {formatKg(data.stats.previous_kg)}
              {data.today_log && data.stats.delta_kg != null ? (
                <span className={`ml-2 font-semibold ${deltaClass(data.stats.delta_kg)}`}>
                  {deltaLabel(data.stats.delta_kg)}
                </span>
              ) : null}
            </div>
          ) : null}
          {statusNotes}
        </div>
        {outlook ? (
          <div className="mt-4">
            <WeightOutlookStrip outlook={outlook} />
          </div>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            体重を1回記録すると、1ヶ月・3ヶ月・6ヶ月の見通しが下に出ます。
          </p>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="space-y-1">
          <div className="text-sm font-bold text-slate-900">今日の体重・体脂肪</div>
          <p className="text-xs leading-relaxed text-slate-500">
            起床後・トイレ後・朝食前に測ると、日々の変化がわかりやすくなります。体脂肪は測れるときだけで大丈夫です。
            {readOnly ? null : "毎朝7時のLINE案内は、マイページの「設定」からオフにできます。"}
          </p>
        </div>
        {recordFields}
        {previousLine}
        {statusNotes}
      </section>

      {showNutrition && data.nutrition ? <WeightNutritionBlock target={data.nutrition} /> : null}

      {!compact ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <div className="text-sm font-bold text-slate-900">推移</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 px-2 py-3">
              <div className="text-[10px] font-semibold text-slate-500">直近</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{formatKg(data.stats.latest_kg)}</div>
              <div className="mt-0.5 text-[11px] font-semibold text-slate-600">{formatFat(data.stats.latest_fat_pct)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 px-2 py-3">
              <div className="text-[10px] font-semibold text-slate-500">7日平均</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{formatKg(data.stats.week_avg_kg)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 px-2 py-3">
              <div className="text-[10px] font-semibold text-slate-500">7日前比</div>
              <div className={`mt-1 text-sm font-bold ${deltaClass(data.stats.change_7d_kg)}`}>
                {deltaLabel(data.stats.change_7d_kg) ?? "—"}
              </div>
              {data.stats.change_7d_fat_pct != null ? (
                <div className={`mt-0.5 text-[11px] font-semibold ${deltaClass(data.stats.change_7d_fat_pct)}`}>
                  {deltaLabel(data.stats.change_7d_fat_pct, "%")}
                </div>
              ) : null}
            </div>
          </div>
          <WeightSparkline logs={data.logs} today={data.today} />
          <div className="text-[11px] text-slate-500">グラフは直近14日 / 直近30日: {data.stats.logged_days_30}日記録</div>
        </section>
      ) : null}

      {showLogList ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <div className="text-sm font-bold text-slate-900">記録一覧</div>
          {data.logs.length === 0 ? <div className="text-sm text-slate-600">まだ記録がありません。</div> : null}
          <div className="grid gap-2">
            {data.logs.slice(0, compact ? 7 : 30).map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => {
                  setLogDate(row.log_date);
                  setWeightInput(row.weight_kg.toFixed(1));
                  setFatInput(row.body_fat_pct != null ? row.body_fat_pct.toFixed(1) : "");
                }}
                className={[
                  "flex items-center justify-between rounded-xl border px-4 py-2.5 text-left",
                  row.log_date === logDate ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-white",
                ].join(" ")}
              >
                <span className="text-sm font-semibold text-slate-800">{formatYmdLabel(row.log_date)}</span>
                <span className="text-sm font-bold text-slate-900">
                  {row.weight_kg.toFixed(1)} kg
                  {row.body_fat_pct != null ? (
                    <span className="ml-2 font-semibold text-slate-600">{row.body_fat_pct.toFixed(1)}%</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function pfcPercents(target: MemberNutritionTargetView) {
  const p = target.protein_g * 4;
  const f = target.fat_g * 9;
  const c = target.carb_g * 4;
  const total = p + f + c;
  if (total <= 0) return { p: 0, f: 0, c: 0 };
  return {
    p: Math.round((p / total) * 100),
    f: Math.round((f / total) * 100),
    c: Math.round((c / total) * 100),
  };
}

function WeightNutritionBlock({ target }: { target: MemberNutritionTargetView }) {
  const pct = pfcPercents(target);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-bold text-slate-900">目標カロリー・PFC</div>
        <p className="text-xs leading-relaxed text-slate-500">
          目標達成のための1日の目安です。トレーナーが調整する場合があります。
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-[11px] font-semibold text-slate-500">1日消費カロリー</div>
          <div className="mt-0.5 text-lg font-bold text-slate-900">
            {target.daily_expenditure_kcal}
            <span className="ml-1 text-xs font-semibold text-slate-500">kcal</span>
          </div>
        </div>
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-3">
          <div className="text-[11px] font-semibold text-teal-800">目標達成に必要な摂取カロリー</div>
          <div className="mt-0.5 text-lg font-bold text-teal-900">
            {formatIntakeLabel(target)}
            <span className="ml-1 text-xs font-semibold text-teal-700">kcal</span>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 space-y-2">
        <div className="text-[11px] font-semibold text-slate-500">PFCバランス</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[11px] font-semibold text-rose-700">P たんぱく質</div>
            <div className="text-base font-bold text-slate-900">{target.protein_g}g</div>
            <div className="text-[11px] text-slate-500">{pct.p}%</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-amber-700">F 脂質</div>
            <div className="text-base font-bold text-slate-900">{target.fat_g}g</div>
            <div className="text-[11px] text-slate-500">{pct.f}%</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-sky-700">C 炭水化物</div>
            <div className="text-base font-bold text-slate-900">{target.carb_g}g</div>
            <div className="text-[11px] text-slate-500">{pct.c}%</div>
          </div>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="bg-rose-400" style={{ width: `${pct.p}%` }} />
          <div className="bg-amber-400" style={{ width: `${pct.f}%` }} />
          <div className="bg-sky-400" style={{ width: `${pct.c}%` }} />
        </div>
      </div>
      {target.note ? <div className="text-xs text-slate-600">※{target.note}</div> : null}
    </section>
  );
}
