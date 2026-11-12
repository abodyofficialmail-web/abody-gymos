"use client";

import { useEffect, useState } from "react";
import { formatYen } from "@/lib/paymentLinks";
import { PAYMENT_SEND_REASONS, type PaymentSendReason } from "@/lib/paymentLinkMessage";

export type PaymentGuideRequest = {
  token: number;
  memberCode: string;
  planId: string | null;
  reason: PaymentSendReason;
  card: "standard" | "amex";
};

type PaymentRecord = {
  id: string;
  member_code: string | null;
  member_name: string | null;
  email: string | null;
  store_name: string | null;
  plan_id: string | null;
  plan_name: string;
  price_yen: number | null;
  amount_yen: number | null;
  card_kind: string | null;
  status: "guided" | "paid" | "failed";
  reason: string | null;
  occurred_at: string;
  period_start?: string | null;
  period_end?: string | null;
  stripe_subscription_id?: string | null;
  stopped_at?: string | null;
};

type Snapshot = {
  month_label: string;
  sales_yen: number;
  month_counts: { guided: number; paid: number; failed: number };
  records: PaymentRecord[];
};

const STATUS_LABEL = {
  guided: "案内済み",
  paid: "決済成功",
  failed: "決済失敗",
} as const;

const STATUS_CLASS = {
  guided: "bg-amber-50 text-amber-900",
  paid: "bg-emerald-50 text-emerald-900",
  failed: "bg-red-50 text-red-800",
} as const;

const FILTERS = [
  { id: "open", label: "要対応" },
  { id: "all", label: "すべて" },
  { id: "paid", label: "成功" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
}

function periodLabel(row: PaymentRecord): string {
  const start = row.period_start ? formatDay(row.period_start) : "";
  const end = row.period_end ? formatDay(row.period_end) : "";
  if (!start || !end) return "";
  return `継続 ${start}〜${end}`;
}

function reasonLabel(reason: string | null): string {
  return PAYMENT_SEND_REASONS.find((row) => row.id === reason)?.label ?? "";
}

function knownReason(reason: string | null): PaymentSendReason {
  return PAYMENT_SEND_REASONS.find((row) => row.id === reason)?.id ?? "payment_failed";
}

function amountLabel(row: PaymentRecord): string {
  if (row.amount_yen != null && row.price_yen != null && row.amount_yen !== row.price_yen) {
    return `${formatYen(row.amount_yen)} / 定価 ${formatYen(row.price_yen)}`;
  }
  const amount = row.amount_yen ?? row.price_yen;
  return amount == null ? "" : formatYen(amount);
}

function whoLabel(row: PaymentRecord): string {
  const name = [row.member_code, row.member_name].filter(Boolean).join(" ");
  return name || row.email || "会員未特定";
}

export function PaymentStatusSection({
  reloadKey,
  onReload,
  onGuide,
}: {
  reloadKey: number;
  onReload: () => void;
  onGuide: (request: PaymentGuideRequest) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterId>("open");
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/admin/payment-records", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json.error ?? "決済記録の取得に失敗しました"));
        return json as Snapshot;
      })
      .then((json) => {
        if (cancelled) return;
        setSnapshot(json);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSnapshot(null);
        setError(e instanceof Error ? e.message : "決済記録の取得に失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const records = (snapshot?.records ?? []).filter((row) => {
    if (filter === "paid") return row.status === "paid";
    if (filter === "open") return row.status === "failed" || row.status === "guided";
    return true;
  });

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">決済状況</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            案内、決済成功、決済失敗、継続期間が残ります。成功の金額が今月の売上です。GymOSから送ったリンクの次回以降は、ここから止められます。
          </p>
        </div>
        <button
          type="button"
          onClick={onReload}
          className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
        >
          更新
        </button>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

      {snapshot ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="col-span-2 rounded-xl bg-slate-900 px-4 py-3 text-white sm:col-span-1">
            <div className="text-xs text-slate-200">{snapshot.month_label}の売上</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{formatYen(snapshot.sales_yen)}</div>
          </div>
          <div className="rounded-xl bg-emerald-50 px-4 py-3">
            <div className="text-xs text-emerald-800">成功</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-emerald-950">{snapshot.month_counts.paid}</div>
          </div>
          <div className="rounded-xl bg-red-50 px-4 py-3">
            <div className="text-xs text-red-800">失敗</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-red-950">{snapshot.month_counts.failed}</div>
          </div>
          <div className="rounded-xl bg-amber-50 px-4 py-3">
            <div className="text-xs text-amber-800">案内済み</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-amber-950">{snapshot.month_counts.guided}</div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        {FILTERS.map((row) => {
          const selected = filter === row.id;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => setFilter(row.id)}
              className={`rounded-xl px-2 py-2 text-sm font-semibold ${
                selected ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-800"
              }`}
            >
              {row.label}
            </button>
          );
        })}
      </div>

      {stopError ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{stopError}</div> : null}

      {loading && !snapshot ? <div className="text-sm text-slate-600">読み込み中です。</div> : null}

      {snapshot && records.length === 0 ? (
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {filter === "open"
            ? "対応が必要な決済はありません。"
            : "まだ決済の記録はありません。案内を送るか、支払いが完了するとここに出ます。"}
        </div>
      ) : null}

      <div className="space-y-2">
        {records.map((row) => {
          const reason = row.status === "failed" ? "payment_failed" : knownReason(row.reason);
          const canGuide = Boolean(row.member_code) && row.status !== "paid";
          return (
            <article key={row.id} className="rounded-xl border border-slate-200 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_CLASS[row.status]}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                    <span className="text-xs text-slate-500">{formatWhen(row.occurred_at)}</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{whoLabel(row)}</div>
                  <div className="mt-0.5 text-sm text-slate-700">
                    {row.plan_name}
                    {amountLabel(row) ? ` ${amountLabel(row)}` : ""}
                  </div>
                  {periodLabel(row) ? <div className="mt-0.5 text-xs text-slate-600">{periodLabel(row)}</div> : null}
                  <div className="mt-0.5 text-xs text-slate-500">
                    {[
                      row.reason === "stopped" || row.stopped_at ? "" : reasonLabel(row.reason),
                      row.card_kind === "amex" ? "アメックス" : "",
                      row.store_name,
                    ]
                      .filter(Boolean)
                      .join(" / ")}
                  </div>
                  {row.reason === "stopped" || row.stopped_at ? (
                    <div className="mt-1 text-xs font-semibold text-slate-700">次回以降は停止します。</div>
                  ) : null}
                  {!row.member_code ? <div className="mt-1 text-xs text-amber-800">会員番号が未特定です。</div> : null}
                </div>
                {canGuide ? (
                  <button
                    type="button"
                    onClick={() =>
                      onGuide({
                        token: Date.now(),
                        memberCode: row.member_code ?? "",
                        planId: row.plan_id,
                        reason,
                        card: row.card_kind === "amex" ? "amex" : "standard",
                      })
                    }
                    className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                  >
                    決済案内
                  </button>
                ) : null}
                {row.status === "paid" && row.stripe_subscription_id && row.reason !== "stopped" && !row.stopped_at ? (
                  <button
                    type="button"
                    disabled={stoppingId === row.id}
                    onClick={() => {
                      const name = whoLabel(row);
                      const ok = window.confirm(
                        `${name}の${row.plan_name}は、次回以降の決済を止めます。今の期間の支払いは残ります。`
                      );
                      if (!ok) return;
                      setStoppingId(row.id);
                      setStopError(null);
                      fetch("/api/admin/payment-records", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ id: row.id }),
                      })
                        .then(async (res) => {
                          const json = (await res.json().catch(() => ({}))) as { error?: string };
                          if (!res.ok) throw new Error(json.error || "決済を止められませんでした");
                          onReload();
                        })
                        .catch((e: unknown) => {
                          setStopError(e instanceof Error ? e.message : "決済を止められませんでした");
                        })
                        .finally(() => setStoppingId(null));
                    }}
                    className="shrink-0 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-60"
                  >
                    {stoppingId === row.id ? "止めています" : "次回から止める"}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
