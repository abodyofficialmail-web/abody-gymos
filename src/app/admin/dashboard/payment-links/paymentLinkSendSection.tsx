"use client";

import { useEffect, useMemo, useState } from "react";
import {
  OPTION_PAYMENT_LINKS,
  PERSONAL_PAYMENT_LINKS,
  couponsForStore,
  formatYen,
  type PaymentLinkItem,
} from "@/lib/paymentLinks";
import { PAYMENT_SEND_REASONS, buildPaymentLinkLineMessage, type PaymentSendReason } from "@/lib/paymentLinkMessage";
import type { PaymentGuideRequest } from "./paymentStatusSection";

type MemberHit = {
  id: string;
  member_code: string;
  name: string | null;
  email: string | null;
  line_user_id: string | null;
  store_name?: string | null;
};

const SEND_LINKS: PaymentLinkItem[] = [...PERSONAL_PAYMENT_LINKS, ...OPTION_PAYMENT_LINKS];

function memberLabel(member: MemberHit): string {
  return `${member.member_code}${member.name ? ` ${member.name}` : ""}`;
}

export function PaymentLinkSendSection({
  prefill,
  onSent,
}: {
  prefill?: PaymentGuideRequest | null;
  onSent?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [member, setMember] = useState<MemberHit | null>(null);
  const [reason, setReason] = useState<PaymentSendReason>("payment_failed");
  const [linkId, setLinkId] = useState(SEND_LINKS[0]?.id ?? "");
  const [card, setCard] = useState<"standard" | "amex">("standard");
  const [includeCoupon, setIncludeCoupon] = useState(false);
  const [couponId, setCouponId] = useState(couponsForStore(null)[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const coupons = useMemo(() => couponsForStore(member?.store_name), [member?.store_name]);
  const item = SEND_LINKS.find((link) => link.id === linkId) ?? SEND_LINKS[0];
  const coupon = includeCoupon ? (coupons.find((row) => row.id === couponId) ?? coupons[0] ?? null) : null;
  const effectiveCard = item?.amexUrl && card === "amex" ? "amex" : "standard";

  const generated = useMemo(() => {
    if (!item) return "";
    return buildPaymentLinkLineMessage({
      memberName: member?.name,
      reason,
      item,
      card: effectiveCard,
      coupon,
      storeName: member?.store_name,
    });
  }, [member?.name, member?.store_name, reason, item, effectiveCard, coupon]);

  useEffect(() => {
    if (coupons.some((row) => row.id === couponId)) return;
    setCouponId(coupons[0]?.id ?? "");
  }, [coupons, couponId]);

  useEffect(() => {
    setDraft(generated);
    setConfirming(false);
    setSentTo(null);
  }, [generated]);

  useEffect(() => {
    if (!prefill?.memberCode) return;
    setMember(null);
    setReason(prefill.reason);
    if (prefill.planId && SEND_LINKS.some((link) => link.id === prefill.planId)) {
      setLinkId(prefill.planId);
    }
    setCard(prefill.card === "amex" ? "amex" : "standard");
    setIncludeCoupon(false);
    setQuery(prefill.memberCode);
    setSentTo(null);
    setSendError(null);
    setConfirming(false);
    document.getElementById("payment-send")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [prefill]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/members/search?q=${encodeURIComponent(q)}&limit=20`, { cache: "no-store" })
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(String(json.error ?? "会員検索に失敗しました"));
          return json as { members: MemberHit[] };
        })
        .then((json) => {
          if (cancelled) return;
          const rows = json.members ?? [];
          setResults(rows);
          setSearchError(null);
          const exact = rows.find((row) => row.member_code.toUpperCase() === q.toUpperCase());
          if (exact) setMember(exact);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setResults([]);
          setSearchError(e instanceof Error ? e.message : "会員検索に失敗しました");
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  async function copyDraft() {
    setSendError(null);
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setSendError("コピーできませんでした。文章を選択してコピーしてください。");
    }
  }

  async function send() {
    if (!member || !draft.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/admin/payment-link-line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          member_code: member.member_code,
          text: draft,
          plan_id: item?.id,
          reason,
          card: effectiveCard,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json.error ?? "LINEに送れませんでした"));
      const notify = json.notify as { sent?: string[]; missed?: string[] } | undefined;
      const sentLabels = notify?.sent ?? [];
      const missedLabels = notify?.missed ?? [];
      const notice = sentLabels.length ? `${sentLabels.join("、")}にも通知しました。` : "";
      setSentTo(`${memberLabel(member)} にLINEで送りました。${notice}`);
      if (json.record_saved === false) {
        setSendError("LINEは送りました。決済の記録には残せませんでした。");
      } else if (missedLabels.length) {
        setSendError(`${missedLabels.join("、")}への通知は届きませんでした。`);
      }
      setConfirming(false);
      onSent?.();
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : "LINEに送れませんでした");
    } finally {
      setSending(false);
    }
  }

  return (
    <section id="payment-send" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-base font-bold text-slate-900">会員様に送る</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          会員番号を選んで、送る理由に合わせた文章をLINEで送れます。送った内容はゆうととテストアカウントにも通知します。文章はそのまま直せます。
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold text-slate-700" htmlFor="payment-member-query">
          会員番号
        </label>
        <input
          id="payment-member-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="会員番号 / 氏名"
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
        />
        {searchError ? <div className="mt-2 text-sm text-red-700">{searchError}</div> : null}
        {results && !searchError ? (
          <div className="mt-2 max-h-52 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-1">
            {results.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-600">該当する会員がいません。</div>
            ) : (
              results.map((row) => {
                const selected = member?.id === row.id;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => {
                      setMember(row);
                      setSendError(null);
                      setSentTo(null);
                    }}
                    className={`w-full rounded-lg px-3 py-2 text-left ${selected ? "bg-white" : "hover:bg-white"}`}
                  >
                    <div className="text-sm font-semibold text-slate-900">{memberLabel(row)}</div>
                    <div className="text-xs text-slate-500">
                      {[row.store_name, row.line_user_id ? "LINE連携済み" : "LINE未連携"].filter(Boolean).join(" / ")}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>

      {member ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900">
          <div className="font-semibold">
            送付先 {memberLabel(member)}
            {member.store_name ? `（${member.store_name}）` : ""}
          </div>
          {member.line_user_id ? null : (
            <div className="mt-1 text-amber-800">LINE未連携です。文章をコピーして別の方法で送ってください。</div>
          )}
        </div>
      ) : null}

      <div>
        <div className="text-xs font-semibold text-slate-700">送る理由</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {PAYMENT_SEND_REASONS.map((row) => {
            const selected = reason === row.id;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => setReason(row.id)}
                className={`rounded-xl px-2 py-2 text-sm font-semibold ${
                  selected ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-800"
                }`}
              >
                {row.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-slate-700" htmlFor="payment-link">
          送るリンク
        </label>
        <select
          id="payment-link"
          value={item?.id ?? ""}
          onChange={(e) => setLinkId(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-[16px]"
        >
          <optgroup label="パーソナル決済">
            {PERSONAL_PAYMENT_LINKS.map((link) => (
              <option key={link.id} value={link.id}>
                {link.name} {formatYen(link.priceYen)}
              </option>
            ))}
          </optgroup>
          <optgroup label="オプション">
            {OPTION_PAYMENT_LINKS.map((link) => (
              <option key={link.id} value={link.id}>
                {link.name} {formatYen(link.priceYen)}
              </option>
            ))}
          </optgroup>
        </select>
        {member?.store_name === "福岡" && item?.id === "personal-30" ? (
          <p className="mt-1 text-xs text-slate-600">福岡店の30分通い放題・月10回リンクを使います。</p>
        ) : null}
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-700">クーポン番号</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setIncludeCoupon(false)}
            className={`rounded-xl px-3 py-2 text-sm font-semibold ${
              includeCoupon ? "border border-slate-200 bg-white text-slate-800" : "bg-slate-900 text-white"
            }`}
          >
            記載しない
          </button>
          <button
            type="button"
            onClick={() => setIncludeCoupon(true)}
            className={`rounded-xl px-3 py-2 text-sm font-semibold ${
              includeCoupon ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-800"
            }`}
          >
            記載する
          </button>
        </div>
        {includeCoupon ? (
          <select
            id="payment-coupon"
            aria-label="クーポン番号"
            value={couponId}
            onChange={(e) => setCouponId(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-[16px]"
          >
            {coupons.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code}（{row.label}）
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {item?.amexUrl ? (
        <div>
          <div className="text-xs font-semibold text-slate-700">カード</div>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(
              [
                ["standard", "通常"],
                ["amex", "アメックス"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCard(id)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                  effectiveCard === id ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <label className="text-xs font-semibold text-slate-700" htmlFor="payment-message">
          送る文章
        </label>
        <textarea
          id="payment-message"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setConfirming(false);
            setSentTo(null);
          }}
          rows={14}
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-relaxed text-slate-900"
        />
      </div>

      {sendError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{sendError}</div> : null}
      {sentTo ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{sentTo}</div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copyDraft} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800">
          {copied ? "コピーしました" : "文章をコピー"}
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              onClick={send}
              disabled={sending || !member?.line_user_id}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {sending ? "送信中…" : `${member ? memberLabel(member) : "会員"}に送る`}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={sending}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800"
            >
              戻る
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSendError(null);
              setSentTo(null);
              setConfirming(true);
            }}
            disabled={!member || !member.line_user_id || !draft.trim()}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            LINEで送る
          </button>
        )}
      </div>
    </section>
  );
}
