"use client";

import type { WeightProgressRow } from "@/lib/monthlyProgressReport/types";

export type WeightProgressPanelData = {
  yearMonthLabel: string;
  nextMonthLabel: string;
  profile: {
    sex: "female" | "male" | null;
    bodyWeightKg: number | null;
    heightCm?: number | null;
    ageYears?: number | null;
  };
  rows: WeightProgressRow[];
  aiCommentStatus?: "ready" | "pending" | "partial";
};

function deltaText(v: number | null | undefined, unit = "kg") {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v}${unit}`;
}

function deltaClass(v: number | null | undefined) {
  if (v == null) return "text-slate-400";
  if (v > 0) return "font-semibold text-emerald-700";
  if (v < 0) return "font-semibold text-rose-600";
  return "text-slate-500";
}

function sexLabel(sex: "female" | "male" | null) {
  if (sex === "female") return "女性";
  if (sex === "male") return "男性";
  return "未設定";
}

export function WeightProgressPanel({
  data,
  loading,
  error,
  compact = false,
}: {
  data: WeightProgressPanelData | null;
  loading?: boolean;
  error?: string | null;
  compact?: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        種目別マックス重量を集計中…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        {error}
      </div>
    );
  }
  if (!data || data.rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        まだ重量記録のある種目がありません。カルテに種目とkgを記録するとここに表示されます。
      </div>
    );
  }

  const rows = compact ? data.rows.slice(0, 12) : data.rows;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-bold text-slate-900">種目別マックス重量</div>
        <p className="text-xs leading-relaxed text-slate-500">
          {data.yearMonthLabel}基準。初回・先月・今月の最高重量と、性別・体重・身長・年齢・履歴から推定した
          <span className="font-semibold text-slate-700">今月（{data.nextMonthLabel}）の目標重量</span>
          です。コメントは事前生成キャッシュを表示します。
        </p>
        <div className="flex flex-wrap gap-2 text-[11px] text-slate-600">
          <span className="rounded-full bg-slate-100 px-2 py-0.5">性別: {sexLabel(data.profile.sex)}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5">
            体重: {data.profile.bodyWeightKg != null ? `${data.profile.bodyWeightKg}kg` : "未設定"}
          </span>
          {data.profile.heightCm != null ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5">身長: {Math.round(data.profile.heightCm)}cm</span>
          ) : null}
          {data.profile.ageYears != null ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5">年齢: {data.profile.ageYears}歳</span>
          ) : null}
          {data.aiCommentStatus === "pending" ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
              AIコメント生成中（数字は表示済み）
            </span>
          ) : data.aiCommentStatus === "partial" ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">AIコメント一部反映</span>
          ) : data.aiCommentStatus === "ready" && data.rows.some((r) => r.aiRationale) ? (
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-teal-800">AIコメント反映済み</span>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 pr-2 font-medium">種目</th>
              <th className="py-2 pr-2 font-medium">初回最高</th>
              <th className="py-2 pr-2 font-medium">先月最高</th>
              <th className="py-2 pr-2 font-medium text-amber-700">今月最高</th>
              <th className="py-2 pr-2 font-medium">先月比</th>
              <th className="py-2 pr-2 font-medium">初回比</th>
              <th className="py-2 pr-2 font-medium">伸び率</th>
              <th className="py-2 font-medium text-teal-800">{data.nextMonthLabel}目標</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.exercise} className="border-b border-slate-100 align-top">
                <td className="py-2.5 pr-2 font-medium text-slate-900">
                  {r.exercise}
                  {r.hasCurrentMonth === false ? (
                    <div className="mt-0.5 text-[10px] font-normal text-slate-400">今月未実施</div>
                  ) : null}
                </td>
                <td className="py-2.5 pr-2 text-slate-700">
                  {r.firstMax}kg
                  <div className="text-[10px] text-slate-400">{r.firstDate}</div>
                </td>
                <td className="py-2.5 pr-2 text-slate-700">
                  {r.prevMonthMax != null ? `${r.prevMonthMax}kg` : "—"}
                </td>
                <td className="py-2.5 pr-2 font-semibold text-amber-800 bg-amber-50/60">
                  {r.hasCurrentMonth === false ? "—" : `${r.monthMax}kg`}
                </td>
                <td className={`py-2.5 pr-2 ${deltaClass(r.vsPrev)}`}>
                  {deltaText(r.vsPrev)}
                  {r.vsPrevPct != null ? (
                    <div className="text-[10px] font-normal opacity-80">({deltaText(r.vsPrevPct, "%")})</div>
                  ) : null}
                </td>
                <td className={`py-2.5 pr-2 ${deltaClass(r.vsFirst)}`}>{deltaText(r.vsFirst)}</td>
                <td className={`py-2.5 pr-2 ${deltaClass(r.growthPct)}`}>{deltaText(r.growthPct, "%")}</td>
                <td className="py-2.5 text-teal-900">
                  {r.nextTarget != null ? (
                    <>
                      <div className="font-semibold">{r.nextTarget}kg</div>
                      <div className={`text-[10px] ${deltaClass(r.nextDelta)}`}>
                        {deltaText(r.nextDelta)}
                        {r.nextGrowthPct != null ? ` / ${deltaText(r.nextGrowthPct, "%")}` : ""}
                      </div>
                      {r.aiRationale ? (
                        <div className="mt-0.5 text-[10px] font-normal leading-snug text-slate-600">
                          {r.aiRationale}
                        </div>
                      ) : r.nextReason ? (
                        <div className="mt-0.5 text-[10px] font-normal leading-snug text-slate-500">
                          {r.nextReason}
                        </div>
                      ) : null}
                      {r.trainerTip ? (
                        <div className="mt-0.5 text-[10px] font-medium leading-snug text-teal-700">
                          トレーナー: {r.trainerTip}
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
    </div>
  );
}
