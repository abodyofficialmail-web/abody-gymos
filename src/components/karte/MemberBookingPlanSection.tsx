"use client";

import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MemberMealLineDeliverySwitch } from "@/components/karte/MemberMealLineDeliverySwitch";
import {
  MEMBERSHIP_PLAN_OPTIONS,
  membershipPlanLabel,
  type MembershipPlan,
} from "@/lib/memberPlans";
import type { BookingStopGlance } from "@/lib/booking/bookingStopGlance";
import type { MemberBookingSnapshot } from "@/lib/booking/memberBookingRules";

type BlockRow = { id: string; blocked_date: string; note: string | null; created_at: string };
type LedgerRow = { id: string; delta: number; reason: string; note: string | null; created_at: string };

function tomorrowYmd() {
  return DateTime.now().setZone("Asia/Tokyo").plus({ days: 1 }).toISODate() ?? "";
}

export function MemberBookingPlanSection({
  memberId,
  initialPlan,
  initialTickets,
  initialStopProposed = false,
  onStopGlanceChange,
  lastMonthVisits = null,
  firstWeekKoma = null,
  embedded = false,
}: {
  memberId: string;
  initialPlan: MembershipPlan | null;
  initialTickets: number;
  initialStopProposed?: boolean;
  onStopGlanceChange?: (glance: BookingStopGlance) => void;
  lastMonthVisits?: number | null;
  firstWeekKoma?: number | null;
  embedded?: boolean;
}) {
  const [plan, setPlan] = useState<MembershipPlan | null>(initialPlan);
  const [tickets, setTickets] = useState(initialTickets);
  const [grantCount, setGrantCount] = useState("1");
  const [grantNote, setGrantNote] = useState("来月先行案内");
  const [blockDate, setBlockDate] = useState(tomorrowYmd);
  const [blockNote, setBlockNote] = useState("連続予約の調整");
  const [stopProposed, setStopProposed] = useState(initialStopProposed);
  const [stopReady, setStopReady] = useState(true);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [snapshot, setSnapshot] = useState<MemberBookingSnapshot | null>(null);
  const [schemaReady, setSchemaReady] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/booking-rules`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
    setSchemaReady(Boolean(json.schema_ready));
    if (json.snapshot) {
      setSnapshot(json.snapshot as MemberBookingSnapshot);
      setPlan((json.snapshot as MemberBookingSnapshot).plan);
      setTickets((json.snapshot as MemberBookingSnapshot).ticketKoma);
    }
    setBlocks((json.blocks ?? []) as BlockRow[]);
    setLedger((json.tickets ?? []) as LedgerRow[]);
    if (typeof json.booking_stop_proposed === "boolean") setStopProposed(json.booking_stop_proposed);
    if (typeof json.booking_stop_ready === "boolean") setStopReady(json.booking_stop_ready);
  }, [memberId]);

  useEffect(() => {
    onStopGlanceChange?.({
      proposed: stopProposed,
      blockedDates: blocks.map((row) => String(row.blocked_date).slice(0, 10)),
    });
  }, [blocks, onStopGlanceChange, stopProposed]);

  useEffect(() => {
    void load().catch((e) => setErr(e instanceof Error ? e.message : "取得に失敗しました"));
  }, [load]);

  const selectedHint = useMemo(
    () => MEMBERSHIP_PLAN_OPTIONS.find((o) => o.id === plan)?.hint ?? "未設定の間は予約制限をかけません",
    [plan]
  );

  async function savePlan(next: MembershipPlan | null) {
    if (saving) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/booking-rules`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ membership_plan: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "保存に失敗しました");
      setPlan(next);
      setMsg(next ? `${membershipPlanLabel(next)} に更新しました` : "プランを未設定にしました");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function grantTickets(delta: number) {
    if (saving || !delta) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/tickets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delta, note: grantNote.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "更新に失敗しました");
      setTickets(Number(json.bonus_ticket_koma ?? tickets + delta));
      setMsg(delta > 0 ? `チケットを ${delta} コマ付与しました` : `チケットを ${Math.abs(delta)} コマ減らしました`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function setProposed(next: boolean) {
    if (saving || !stopReady) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/booking-rules`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ booking_stop_proposed: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "保存に失敗しました");
      setStopProposed(next);
      setMsg(next ? "予約止め提案中にしました。カルテと予約に出ます" : "予約止め提案中をやめました");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function addBlock() {
    if (saving || !blockDate) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/booking-blocks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blocked_date: blockDate, note: blockNote.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "保存に失敗しました");
      setMsg(`${blockDate} をこの会員だけ×にしました`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function removeBlock(row: BlockRow) {
    if (saving) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/booking-blocks`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "削除に失敗しました");
      setMsg(`${String(row.blocked_date).slice(0, 10)} の制限を解除しました`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const grantN = Number(grantCount);

  const body = (
    <>
      {embedded ? null : <div className="text-sm font-bold text-slate-900">プラン・予約制限</div>}
      <MemberMealLineDeliverySwitch memberId={memberId} />
      {!schemaReady ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          DBマイグレーション未適用のため、プラン保存がまだできません。
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-700">会員プラン</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void savePlan(null)}
            className={[
              "rounded-full border px-3 py-1 text-xs font-semibold",
              plan == null ? "border-slate-400 bg-slate-100 text-slate-900" : "border-slate-200 bg-white text-slate-700",
            ].join(" ")}
          >
            未設定
          </button>
          {MEMBERSHIP_PLAN_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              disabled={saving}
              onClick={() => void savePlan(opt.id)}
              className={[
                "rounded-full border px-3 py-1 text-xs font-semibold",
                plan === opt.id ? "border-slate-400 bg-slate-100 text-slate-900" : "border-slate-200 bg-white text-slate-700",
              ].join(" ")}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-500 leading-relaxed">{selectedHint}</div>
      </div>

      {snapshot ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 space-y-0.5">
          <div>
            保持中: {snapshot.holdKoma} / {snapshot.maxHoldKoma ?? "—"} コマ
          </div>
          <div>
            今週: {snapshot.weekKoma} コマ
            {snapshot.mixThisWeek ? "（他店舗・オンライン併用中）" : "（単一店舗）"}
            {snapshot.weeklyMaxKoma != null && snapshot.mixThisWeek ? ` / 上限 ${snapshot.weeklyMaxKoma}` : ""}
          </div>
          {snapshot.monthlyMaxKoma != null ? (
            <div>
              今月消化: {snapshot.monthKoma} / {snapshot.monthlyMaxKoma} コマ
            </div>
          ) : null}
          {snapshot.maxDailyKoma != null ? <div>本日: {snapshot.dailyKomaToday} / {snapshot.maxDailyKoma} コマ</div> : null}
          <div>残チケット: {snapshot.ticketKoma} コマ</div>
        </div>
      ) : (
        <div className="text-xs text-slate-500">残チケット: {tickets} コマ</div>
      )}

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <div className="text-xs font-semibold text-slate-700">チケット付与</div>
        <div className="text-[11px] text-slate-500 leading-relaxed">
          今月来店が少ない人の来月先行案内も、ここでチケットを付与します。会員の予約画面とマイページに残数が表示されます。通常の予約上限を超える分だけ消化されます。同じ日のコマ上限はチケットでも解除しません。
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-[11px] text-slate-600">コマ数</span>
            <input
              type="number"
              min={1}
              max={20}
              value={grantCount}
              onChange={(e) => setGrantCount(e.target.value)}
              className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="flex-1 min-w-[12rem] space-y-1">
            <span className="block text-[11px] text-slate-600">メモ</span>
            <input
              value={grantNote}
              onChange={(e) => setGrantNote(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={saving || !Number.isFinite(grantN) || grantN < 1}
            onClick={() => void grantTickets(Math.floor(grantN))}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            付与
          </button>
          <button
            type="button"
            disabled={saving || tickets < 1}
            onClick={() => void grantTickets(-1)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-60"
          >
            1コマ減らす
          </button>
        </div>
        {ledger.length > 0 ? (
          <div className="text-[11px] text-slate-500 space-y-0.5">
            {ledger.slice(0, 5).map((row) => (
              <div key={row.id}>
                {DateTime.fromISO(row.created_at).setZone("Asia/Tokyo").toFormat("MM/dd HH:mm")} {row.delta > 0 ? "+" : ""}
                {row.delta} {row.note || row.reason}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <div className="text-xs font-semibold text-slate-700">予約を止めた方がいい人</div>
        <div className="grid gap-1 text-[11px] leading-relaxed text-slate-700">
          <div>
            先月{" "}
            <span className={(lastMonthVisits ?? 0) >= 12 ? "font-bold text-rose-800" : "font-semibold"}>
              {lastMonthVisits == null ? "…" : `${lastMonthVisits}回`}
            </span>
            （12回以上で止め候補）
          </div>
          <div>
            今月1日〜7日{" "}
            <span className={(firstWeekKoma ?? 0) >= 4 ? "font-bold text-rose-800" : "font-semibold"}>
              {firstWeekKoma == null ? "…" : `${firstWeekKoma}コマ`}
            </span>
            （4コマ以上で止め候補）
          </div>
        </div>
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-slate-600">
          <li>休みの日がなく、3日以上連続で予約している</li>
          <li>先の枠を、持てる上限いっぱいまでいつも埋めている</li>
          <li>同じ時間を毎日取って、他の会員がその時間に入れない</li>
        </ul>
        <div className="text-[11px] leading-relaxed text-slate-500">
          週2〜3回で間に空いている日がある人は対象外です。今月の来店が少ない人は、予約を止めずに声をかけます。
        </div>
        {stopProposed ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2">
            <span className="text-sm font-bold text-rose-950">予約止め提案中</span>
            <button
              type="button"
              disabled={saving}
              onClick={() => void setProposed(false)}
              className="text-xs font-semibold text-rose-900 underline disabled:opacity-60"
            >
              やめる
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={saving || !stopReady}
            onClick={() => void setProposed(true)}
            className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-900 disabled:opacity-60"
          >
            予約止め提案中にする
          </button>
        )}
        <div className="text-[11px] leading-relaxed text-slate-500">
          オンにすると、カルテの上と予約のその人の行に「予約止め提案中」と出ます。止める日は下で指定します。
        </div>
        {!stopReady ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            予約止め提案中の保存準備ができていません。
          </div>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <div className="text-xs font-semibold text-slate-700">この人だけ翌日×</div>
        <div className="text-[11px] text-slate-500 leading-relaxed">
          指定した日だけ、この会員の予約画面が×になります。他の会員の空き表示は変わりません。日付を入れると、カルテと予約の印にその日も出ます。
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-[11px] text-slate-600">制限する日</span>
            <input
              type="date"
              value={blockDate}
              onChange={(e) => setBlockDate(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="flex-1 min-w-[12rem] space-y-1">
            <span className="block text-[11px] text-slate-600">メモ</span>
            <input
              value={blockNote}
              onChange={(e) => setBlockNote(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={saving || !blockDate}
            onClick={() => void addBlock()}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            この日を×
          </button>
        </div>
        {blocks.length > 0 ? (
          <div className="space-y-1">
            {blocks.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <div>
                  <span className="font-semibold text-slate-800">{String(row.blocked_date).slice(0, 10)}</span>
                  {row.note ? <span className="ml-2 text-slate-500">{row.note}</span> : null}
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void removeBlock(row)}
                  className="text-slate-600 underline"
                >
                  解除
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-slate-400">制限中の日はありません</div>
        )}
      </div>

      {msg ? <div className="text-xs text-emerald-800">{msg}</div> : null}
      {err ? <div className="text-xs text-red-700">{err}</div> : null}
    </>
  );

  if (embedded) {
    return <div className="space-y-3">{body}</div>;
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">{body}</section>
  );
}
