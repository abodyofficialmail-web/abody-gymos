"use client";

import { useState } from "react";
import {
  OPTION_PAYMENT_LINKS,
  PAYMENT_COUPONS,
  PERSONAL_PAYMENT_LINKS,
  formatYen,
  type PaymentLinkItem,
} from "@/lib/paymentLinks";
import { PaymentLinkSendSection } from "./paymentLinkSendSection";
import { PaymentStatusSection, type PaymentGuideRequest } from "./paymentStatusSection";

function CopyButton({
  copyKey,
  text,
  label,
  copiedKey,
  onCopy,
}: {
  copyKey: string;
  text: string;
  label: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const copied = copiedKey === copyKey;
  return (
    <button
      type="button"
      onClick={() => onCopy(copyKey, text)}
      className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
    >
      {copied ? "コピーしました" : label}
    </button>
  );
}

function LinkRow({
  title,
  url,
  copyKey,
  copiedKey,
  onCopy,
}: {
  title?: string;
  url: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      {title ? <div className="text-xs font-semibold text-slate-600">{title}</div> : null}
      <div className={`break-all font-mono text-[12px] text-slate-700 ${title ? "mt-1" : ""}`}>{url}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyButton copyKey={copyKey} text={url} label="リンクをコピー" copiedKey={copiedKey} onCopy={onCopy} />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
        >
          開く
        </a>
      </div>
    </div>
  );
}

function PaymentCard({
  item,
  copiedKey,
  onCopy,
}: {
  item: PaymentLinkItem;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-bold text-slate-900">{item.name}</h3>
        <div className="shrink-0 text-base font-bold tabular-nums text-slate-900">{formatYen(item.priceYen)}</div>
      </div>
      <div className="mt-3 grid gap-2">
        <LinkRow
          title={item.amexUrl ? "通常" : undefined}
          url={item.url}
          copyKey={`link:${item.id}`}
          copiedKey={copiedKey}
          onCopy={onCopy}
        />
        {item.amexUrl ? (
          <LinkRow
            title="アメックスの場合"
            url={item.amexUrl}
            copyKey={`amex:${item.id}`}
            copiedKey={copiedKey}
            onCopy={onCopy}
          />
        ) : null}
      </div>
    </article>
  );
}

export function PaymentLinksClient() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<PaymentGuideRequest | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  async function onCopy(key: string, text: string) {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1600);
    } catch {
      setCopyError("コピーできませんでした。リンクを長押ししてコピーしてください。");
    }
  }

  return (
    <div className="space-y-6">
      <PaymentStatusSection
        reloadKey={reloadKey}
        onReload={() => setReloadKey((value) => value + 1)}
        onGuide={setPrefill}
      />
      <PaymentLinkSendSection prefill={prefill} onSent={() => setReloadKey((value) => value + 1)} />
      <p className="text-sm leading-relaxed text-slate-600">
        リンクとクーポンの一覧です。アメックスは専用リンクを使います。
      </p>
      {copyError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{copyError}</div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-slate-900">パーソナル決済</h2>
        {PERSONAL_PAYMENT_LINKS.map((item) => (
          <PaymentCard key={item.id} item={item} copiedKey={copiedKey} onCopy={onCopy} />
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-slate-900">オプション</h2>
        {OPTION_PAYMENT_LINKS.map((item) => (
          <PaymentCard key={item.id} item={item} copiedKey={copiedKey} onCopy={onCopy} />
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-slate-900">クーポンコード</h2>
        <div className="grid gap-2">
          {PAYMENT_COUPONS.map((coupon) => (
            <div
              key={coupon.id}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="text-sm font-bold text-slate-900">{coupon.label}</div>
                <div className="mt-1 font-mono text-lg font-bold tracking-wide text-slate-900">{coupon.code}</div>
              </div>
              <CopyButton
                copyKey={`coupon:${coupon.id}`}
                text={coupon.code}
                label="コードをコピー"
                copiedKey={copiedKey}
                onCopy={onCopy}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
