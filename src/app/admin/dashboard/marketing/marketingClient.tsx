"use client";

import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useState } from "react";
import { costPer, formatSignedCount, formatYen, peakHourLabel } from "@/lib/marketing/formatAdsMarketingReport";
import type { AdsMarketingReport, StoreAdsSlice } from "@/lib/marketing/types";

const TZ = "Asia/Tokyo";

type Store = { id: string; name: string };
type Account = {
  store_id: string;
  instagram_username: string | null;
  instagram_user_id: string | null;
  meta_ad_account_id: string | null;
};

function yesterdayYmd() {
  return DateTime.now().setZone(TZ).minus({ days: 1 }).toISODate()!;
}

function HourBars({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <div className="mt-2 flex items-end gap-px h-16">
      {counts.map((c, h) => (
        <div key={h} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${h}時 ${c}人`}>
          <div
            className="w-full rounded-t bg-slate-800"
            style={{ height: `${Math.max(c > 0 ? 8 : 2, (c / max) * 100)}%`, opacity: c > 0 ? 1 : 0.15 }}
          />
        </div>
      ))}
    </div>
  );
}

export function MarketingReportClient() {
  const [kind, setKind] = useState<"daily" | "weekly">("daily");
  const [date, setDate] = useState(yesterdayYmd);
  const [report, setReport] = useState<AdsMarketingReport | null>(null);
  const [preview, setPreview] = useState("");
  const [stores, setStores] = useState<Store[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [metaConfigured, setMetaConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [manualStoreId, setManualStoreId] = useState("");
  const [manualSpend, setManualSpend] = useState("");
  const [manualFollowers, setManualFollowers] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ kind, date });
      const res = await fetch(`/api/admin/marketing-report?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error === "tables_missing" ? "テーブル未作成です。マイグレーションを適用してください。" : json.error ?? "取得に失敗");
      setReport(json.report ?? null);
      setPreview(String(json.preview ?? ""));
      setStores(json.stores ?? []);
      setAccounts(json.accounts ?? []);
      setMetaConfigured(Boolean(json.meta_token_configured));
      setManualStoreId((cur) => cur || String(json.stores?.[0]?.id ?? ""));
    } catch (e: any) {
      setErr(String(e?.message ?? "取得に失敗しました"));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [kind, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const storesInReport = report?.stores ?? [];
    const spendValues = storesInReport.map((s) => s.spend).filter((n): n is number => n != null);
    const spend = spendValues.length ? spendValues.reduce((a, b) => a + b, 0) : null;
    const ig = storesInReport.reduce((n, s) => n + (s.instagram_followers_delta ?? 0), 0);
    const lineAdds = storesInReport.reduce((n, s) => n + s.line_adds, 0);
    return { spend, ig, lineAdds };
  }, [report]);

  async function post(body: unknown, label: string) {
    setBusy(label);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch("/api/admin/marketing-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || json.error || "失敗しました");
      setMsg(label === "send" ? `LINE送信 ${json.sent ?? 0}件` : "保存しました");
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? "失敗しました"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-white p-5 shadow-md space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs font-semibold text-slate-700">期間</div>
            <div className="mt-1 flex gap-2">
              {(["daily", "weekly"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={[
                    "rounded-full border px-3 py-1 text-sm",
                    kind === k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700",
                  ].join(" ")}
                >
                  {k === "daily" ? "日次" : "週次"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-700">{kind === "weekly" ? "終了日" : "対象日"}</div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 rounded-xl border border-slate-200 px-3 py-2 text-[16px]"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
          >
            再読込
          </button>
        </div>
        <p className="text-xs text-slate-500">
          毎朝9時（JST）に前日分をLINEへ自動送信します。月曜日は週次（直近7日）も送ります。Meta未連携の店舗は下から消化金額とInstagramフォロワーを手入力できます。
        </p>
        {metaConfigured ? (
          <p className="text-xs text-emerald-700">Metaアクセストークンは設定済みです。</p>
        ) : (
          <p className="text-xs text-amber-800">
            Meta未設定です。消化・IGフォロワーは手入力、公式LINE追加の人数と時間帯は友だち追加から自動で入ります。
          </p>
        )}
      </section>

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}
      {msg ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{msg}</div> : null}

      {loading ? <div className="text-sm text-slate-600">読み込み中…</div> : null}

      {report ? (
        <>
          <section className="grid gap-2 sm:grid-cols-3">
            <SummaryCard label="消化金額" value={formatYen(totals.spend)} />
            <SummaryCard label="IGフォロワー増" value={formatSignedCount(totals.ig)} />
            <SummaryCard label="公式LINE追加" value={`${totals.lineAdds.toLocaleString("ja-JP")}人`} />
          </section>
          <p className="text-xs text-slate-500">LINE追加1人あたり {costPer(totals.spend, totals.lineAdds)}</p>

          <div className="space-y-3">
            {report.stores.map((s) => (
              <StoreCard key={s.store_id} slice={s} kind={kind} />
            ))}
          </div>
        </>
      ) : null}

      <section className="rounded-xl bg-white p-5 shadow-md space-y-3">
        <div className="text-sm font-bold text-slate-900">手入力（Meta未連携時）</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">
            店舗
            <select
              value={manualStoreId}
              onChange={(e) => setManualStoreId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-[16px]"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">
            消化金額（円）
            <input
              inputMode="numeric"
              value={manualSpend}
              onChange={(e) => setManualSpend(e.target.value)}
              placeholder="例）12000"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-[16px]"
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Instagramフォロワー数（その日の時点）
            <input
              inputMode="numeric"
              value={manualFollowers}
              onChange={(e) => setManualFollowers(e.target.value)}
              placeholder="例）1252"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-[16px]"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={!manualStoreId || busy != null}
          onClick={() =>
            void post(
              {
                action: "manual_metrics",
                store_id: manualStoreId,
                date,
                spend: manualSpend.trim() === "" ? null : Number(manualSpend),
                instagram_followers: manualFollowers.trim() === "" ? null : Number(manualFollowers),
              },
              "save"
            )
          }
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          この日の数字を保存
        </button>
      </section>

      <section className="rounded-xl bg-white p-5 shadow-md space-y-3">
        <div className="text-sm font-bold text-slate-900">Instagram / 広告アカウント</div>
        <p className="text-xs text-slate-500">
          店舗ごとの Instagram ビジネスID と Meta 広告アカウントID。環境変数 <code>META_ACCESS_TOKEN</code> と合わせて自動取得します。
        </p>
        {stores.map((s) => {
          const acc = accounts.find((a) => a.store_id === s.id);
          return (
            <AccountRow
              key={s.id}
              store={s}
              account={acc}
              disabled={busy != null}
              onSave={(next) => void post({ action: "save_account", store_id: s.id, ...next }, "save")}
            />
          );
        })}
      </section>

      <section className="rounded-xl bg-white p-5 shadow-md space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy != null}
            onClick={() => void post({ action: "sync", date }, "sync")}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800"
          >
            Meta / LINE人数を取り込み
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => void post({ action: "send", kind, date }, "send")}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            この内容をLINEで送る
          </button>
        </div>
        {preview ? (
          <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-800">{preview}</pre>
        ) : null}
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function StoreCard({ slice, kind }: { slice: StoreAdsSlice; kind: "daily" | "weekly" }) {
  const peak = peakHourLabel(slice.hour_counts);
  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-4">
      <div className="text-base font-bold text-slate-900">{slice.store_name}</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Mini label="消化" value={formatYen(slice.spend)} />
        <Mini
          label="IGフォロワー"
          value={
            slice.instagram_followers == null
              ? "未取得"
              : `${slice.instagram_followers.toLocaleString("ja-JP")}（${formatSignedCount(slice.instagram_followers_delta)}）`
          }
        />
        <Mini
          label="公式LINE追加"
          value={`${slice.line_adds.toLocaleString("ja-JP")}人${slice.line_unfollows ? ` / ブロック ${slice.line_unfollows}` : ""}`}
        />
      </div>
      <div className="mt-2 text-xs text-slate-600">LINE追加1人あたり {costPer(slice.spend, slice.line_adds)}</div>
      {kind === "weekly" ? (
        <div className="mt-2 text-xs text-slate-600">
          曜日: {["月", "火", "水", "木", "金", "土", "日"].map((d, i) => `${d}${slice.weekday_counts[i] ?? 0}`).join(" ")}
        </div>
      ) : null}
      <div className="mt-3 text-xs font-semibold text-slate-700">友だち追加の時間帯（0〜23時）{peak ? `・最多 ${peak}` : ""}</div>
      <HourBars counts={slice.hour_counts} />
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

function AccountRow({
  store,
  account,
  disabled,
  onSave,
}: {
  store: Store;
  account?: Account;
  disabled: boolean;
  onSave: (next: { instagram_username: string | null; instagram_user_id: string | null; meta_ad_account_id: string | null }) => void;
}) {
  const [username, setUsername] = useState(account?.instagram_username ?? "");
  const [igId, setIgId] = useState(account?.instagram_user_id ?? "");
  const [adId, setAdId] = useState(account?.meta_ad_account_id ?? "");

  useEffect(() => {
    setUsername(account?.instagram_username ?? "");
    setIgId(account?.instagram_user_id ?? "");
    setAdId(account?.meta_ad_account_id ?? "");
  }, [account?.instagram_username, account?.instagram_user_id, account?.meta_ad_account_id]);

  return (
    <div className="rounded-xl border border-slate-200 px-3 py-3 space-y-2">
      <div className="text-sm font-semibold text-slate-900">{store.name}</div>
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="IGユーザー名"
          className="rounded-xl border border-slate-200 px-3 py-2 text-[16px]"
        />
        <input
          value={igId}
          onChange={(e) => setIgId(e.target.value)}
          placeholder="IGユーザーID"
          className="rounded-xl border border-slate-200 px-3 py-2 text-[16px]"
        />
        <input
          value={adId}
          onChange={(e) => setAdId(e.target.value)}
          placeholder="広告アカウントID"
          className="rounded-xl border border-slate-200 px-3 py-2 text-[16px]"
        />
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onSave({
            instagram_username: username.trim() || null,
            instagram_user_id: igId.trim() || null,
            meta_ad_account_id: adId.trim() || null,
          })
        }
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-800"
      >
        保存
      </button>
    </div>
  );
}
