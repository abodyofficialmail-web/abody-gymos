import { DateTime } from "luxon";
import type { AdsMarketingReport, StoreAdsSlice } from "@/lib/marketing/types";

const TZ = "Asia/Tokyo";
const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

export function formatYen(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "未取得";
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

export function formatSignedCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "未取得";
  const rounded = Math.round(n);
  if (rounded > 0) return `+${rounded.toLocaleString("ja-JP")}`;
  return rounded.toLocaleString("ja-JP");
}

export function costPer(spend: number | null | undefined, count: number): string {
  if (spend == null || !Number.isFinite(spend) || count <= 0) return "—";
  return formatYen(spend / count);
}

export function sumNullable(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let seen = false;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    total += v;
    seen = true;
  }
  return seen ? total : null;
}

export function peakHourLabel(hourCounts: number[]): string | null {
  let max = 0;
  let hour = 0;
  hourCounts.forEach((c, h) => {
    if (c > max) {
      max = c;
      hour = h;
    }
  });
  if (max <= 0) return null;
  return `${hour}時（${max}人）`;
}

export function formatHourHistogram(hourCounts: number[], limit = 8): string {
  const parts = hourCounts
    .map((count, hour) => ({ hour, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || a.hour - b.hour);
  if (parts.length === 0) return "（追加なし）";
  const shown = parts.slice(0, limit);
  const rest = parts.length - shown.length;
  const body = shown.map((x) => `${x.hour}時 ${x.count}人`).join(" / ");
  return rest > 0 ? `${body} / 他${rest}枠` : body;
}

export function formatWeekdayHistogram(weekdayCounts: number[]): string {
  const parts = WEEKDAY_LABELS.map((label, i) => ({ label, count: weekdayCounts[i] ?? 0 })).filter((x) => x.count > 0);
  if (parts.length === 0) return "（追加なし）";
  return parts.map((x) => `${x.label} ${x.count}人`).join(" / ");
}

function formatDateJaRange(startYmd: string, endYmd: string, kind: AdsMarketingReport["kind"]): string {
  const start = DateTime.fromISO(startYmd, { zone: TZ }).setLocale("ja");
  const end = DateTime.fromISO(endYmd, { zone: TZ }).setLocale("ja");
  if (kind === "daily" || startYmd === endYmd) {
    return start.toFormat("yyyy年M月d日（ccc）");
  }
  return `${start.toFormat("M/d（ccc）")}〜${end.toFormat("M/d（ccc）")}`;
}

function storeSection(s: StoreAdsSlice, kind: AdsMarketingReport["kind"]): string {
  const lines = [
    `━━ ${s.store_name} ━━`,
    `消化: ${formatYen(s.spend)}`,
    `Instagramフォロワー: ${s.instagram_followers == null ? "未取得" : s.instagram_followers.toLocaleString("ja-JP")}（${formatSignedCount(s.instagram_followers_delta)}）`,
    `公式LINE追加: ${s.line_adds.toLocaleString("ja-JP")}人${s.line_unfollows > 0 ? `（ブロック ${s.line_unfollows}）` : ""}`,
    `LINE追加1人あたり: ${costPer(s.spend, s.line_adds)}`,
  ];
  if (s.instagram_followers_delta != null && s.instagram_followers_delta > 0) {
    lines.push(`フォロワー1人あたり: ${costPer(s.spend, s.instagram_followers_delta)}`);
  }
  const peak = peakHourLabel(s.hour_counts);
  if (kind === "weekly") {
    lines.push(`追加が多かった曜日: ${formatWeekdayHistogram(s.weekday_counts)}`);
  }
  lines.push(`追加時間帯: ${formatHourHistogram(s.hour_counts)}`);
  if (peak) lines.push(`いちばん多い時間: ${peak}`);
  return lines.join("\n");
}

export function formatAdsMarketingReport(
  report: AdsMarketingReport,
  opts?: { storeNames?: string[] | null; allStores?: boolean }
): string {
  const names = opts?.storeNames?.filter(Boolean) ?? [];
  const filtered =
    opts?.allStores === false && names.length > 0
      ? report.stores.filter((s) => names.includes(s.store_name))
      : report.stores;
  const title = report.kind === "weekly" ? "広告週次" : "広告日次";
  const head = `【${title}】${formatDateJaRange(report.startYmd, report.endYmd, report.kind)}`;
  if (filtered.length === 0) {
    return `${head}\n\n担当店舗の広告データがありません。`;
  }

  const lines = [head, ""];
  if (filtered.length > 1) {
    const spend = sumNullable(filtered.map((s) => s.spend));
    const igDelta = sumNullable(filtered.map((s) => s.instagram_followers_delta));
    const lineAdds = filtered.reduce((n, s) => n + s.line_adds, 0);
    lines.push("全店舗");
    lines.push(`消化: ${formatYen(spend)}  IG ${formatSignedCount(igDelta)}  LINE追加 ${lineAdds}人`);
    lines.push(`LINE追加1人あたり: ${costPer(spend, lineAdds)}`);
    lines.push("");
  }

  for (const s of filtered) {
    lines.push(storeSection(s, report.kind));
    lines.push("");
  }

  lines.push("※LINE追加の時間帯は、GymOSが友だち追加を受けてから記録した分です。");
  if (filtered.some((s) => s.spend == null)) {
    lines.push("※消化金額が未取得の店舗は、管理画面で入力するか Meta 広告アカウントを連携してください。");
  }
  return lines.join("\n").trim();
}
