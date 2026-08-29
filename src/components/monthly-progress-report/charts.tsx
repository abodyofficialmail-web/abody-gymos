"use client";

import {
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart as RePie,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlyProgressReport } from "@/lib/monthlyProgressReport/types";
import { SectionCard } from "./ui";

const GOLD = "#B98A2E";
const GRAYS = ["#B98A2E", "#8A8A8A", "#C4C4C4", "#6B6B6B", "#D9D2C5", "#4A4A4A"];

export function PartPieChart({ data }: { data: MonthlyProgressReport["partRatios"] }) {
  const chartData = data.map((d) => ({ name: d.part, value: d.pct }));
  const totalSets = data.reduce((a, b) => a + b.count, 0);
  return (
    <SectionCard title="部位別トレーニング比率">
      <div className="grid grid-cols-[140px_1fr] items-center gap-3">
        <div className="relative h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <RePie>
              <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={62} paddingAngle={2}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={GRAYS[i % GRAYS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </RePie>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[10px] text-abody-muted">Total</div>
            <div className="text-sm font-semibold">{totalSets}</div>
          </div>
        </div>
        <ul className="space-y-1.5 text-xs">
          {data.map((d, i) => (
            <li key={d.part} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: GRAYS[i % GRAYS.length] }} />
                {d.part}
              </span>
              <span className="font-medium text-abody-gold">{d.pct}%</span>
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}

export function WeightTable({
  rows,
  nextMonthLabel = "来月",
}: {
  rows: MonthlyProgressReport["weightRows"];
  nextMonthLabel?: string;
}) {
  return (
    <SectionCard title="主要種目の重量推移">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead>
            <tr className="border-b border-abody-line text-abody-muted">
              <th className="py-2 font-medium">種目</th>
              <th className="py-2 font-medium">初回最高</th>
              <th className="py-2 font-medium">先月最高</th>
              <th className="py-2 font-medium text-abody-gold">今月最高</th>
              <th className="py-2 font-medium">先月比</th>
              <th className="py-2 font-medium">初回比</th>
              <th className="py-2 font-medium">伸び率</th>
              <th className="py-2 font-medium text-emerald-700">{nextMonthLabel}目標</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((r) => (
              <tr key={r.exercise} className="border-b border-abody-line/70">
                <td className="py-2.5 font-medium">{r.exercise}</td>
                <td>{r.firstMax}kg</td>
                <td>{r.prevMonthMax != null ? `${r.prevMonthMax}kg` : "—"}</td>
                <td className="bg-abody-gold-soft/50 font-semibold text-abody-gold">{r.monthMax}kg</td>
                <td className={deltaClass(r.vsPrev)}>
                  {r.vsPrev == null ? "—" : `${r.vsPrev > 0 ? "↗ +" : r.vsPrev < 0 ? "↘ " : ""}${r.vsPrev}kg`}
                  {r.vsPrevPct != null ? (
                    <div className="text-[10px] opacity-80">
                      ({r.vsPrevPct > 0 ? "+" : ""}
                      {r.vsPrevPct}%)
                    </div>
                  ) : null}
                </td>
                <td className={deltaClass(r.vsFirst)}>
                  {r.vsFirst > 0 ? "+" : ""}
                  {r.vsFirst}kg
                </td>
                <td className={deltaClass(r.growthPct)}>
                  {r.growthPct > 0 ? "+" : ""}
                  {r.growthPct}%
                </td>
                <td className="font-semibold text-emerald-800">
                  {r.nextTarget != null ? (
                    <>
                      {r.nextTarget}kg
                      {r.nextDelta != null ? (
                        <div className={`text-[10px] font-medium ${deltaClass(r.nextDelta)}`}>
                          {r.nextDelta > 0 ? "+" : ""}
                          {r.nextDelta}kg
                          {r.nextGrowthPct != null ? ` / ${r.nextGrowthPct > 0 ? "+" : ""}${r.nextGrowthPct}%` : ""}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function deltaClass(v: number | null) {
  if (v == null) return "text-abody-muted";
  if (v > 0) return "font-medium text-emerald-700";
  if (v < 0) return "font-medium text-rose-600";
  return "text-abody-muted";
}

export function VolumeTrendCharts({ data }: { data: MonthlyProgressReport["volumeTrend"] }) {
  if (!data.some((d) => d.sets > 0)) return null;
  return (
    <SectionCard title="トレーニングパフォーマンス推移">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MiniLine title="総重量" data={data} dataKey="totalKg" unit="kg" />
        <MiniLine title="平均重量" data={data} dataKey="avgKg" unit="kg" />
        <MiniLine title="セット数" data={data} dataKey="sets" unit="sets" />
      </div>
    </SectionCard>
  );
}

function MiniLine({
  title,
  data,
  dataKey,
  unit,
}: {
  title: string;
  data: MonthlyProgressReport["volumeTrend"];
  dataKey: "totalKg" | "avgKg" | "sets";
  unit: string;
}) {
  const first = data.find((d) => d[dataKey] > 0)?.[dataKey] ?? 0;
  const last = [...data].reverse().find((d) => d[dataKey] > 0)?.[dataKey] ?? 0;
  const delta = Math.round((last - first) * 10) / 10;
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-abody-muted">{title}</div>
      <div className="h-[100px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis hide />
            <Tooltip />
            <Line type="monotone" dataKey={dataKey} stroke={GOLD} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 text-xs text-abody-gold">
        {delta >= 0 ? "+" : ""}
        {delta}
        {unit}
      </div>
    </div>
  );
}

export function VisitCalendar({
  yearMonth,
  visitDates,
}: {
  yearMonth: string;
  visitDates: string[];
}) {
  const [y, m] = yearMonth.split("-").map(Number);
  const firstDow = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const set = new Set(visitDates);
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <SectionCard title="来店履歴">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-abody-muted">
        {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e-${i}`} />;
          const ymd = `${yearMonth}-${String(d).padStart(2, "0")}`;
          const visited = set.has(ymd);
          return (
            <div
              key={ymd}
              className={
                visited
                  ? "rounded-full bg-abody-gold py-1.5 font-semibold text-white"
                  : "rounded-full py-1.5 text-abody-ink"
              }
            >
              {d}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-abody-muted">今月は {visitDates.length} 日来店しました</p>
    </SectionCard>
  );
}
