import Link from "next/link";
import { DateTime } from "luxon";

const TZ = "Asia/Tokyo";

function formatDate(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: TZ });
  const dow = ["日", "月", "火", "水", "木", "金", "土"][dt.weekday % 7];
  return `${dt.toFormat("yyyy/M/d")}（${dow}）`;
}

function formatTimeRange(startAtUtc: string, endAtUtc: string) {
  const s = DateTime.fromISO(startAtUtc).setZone(TZ);
  const e = DateTime.fromISO(endAtUtc).setZone(TZ);
  return `${s.toFormat("HH:mm")}〜${e.toFormat("HH:mm")}`;
}

export default function BookingCompletePage({
  searchParams,
}: {
  searchParams: {
    storeName?: string;
    date?: string;
    startAt?: string;
    endAt?: string;
    memberName?: string;
    memberId?: string;
    reservationId?: string;
    sessionType?: string;
  };
}) {
  const storeName = searchParams.storeName ?? "-";
  const date = searchParams.date ?? "";
  const startAt = searchParams.startAt ?? "";
  const endAt = searchParams.endAt ?? "";
  const memberName = searchParams.memberName ?? "-";
  const memberId = searchParams.memberId ?? "-";
  const sessionType = searchParams.sessionType ?? "store";
  const sessionTypeLabel = sessionType === "online" ? "オンライン" : "店舗";
  const qs = new URLSearchParams();
  if (searchParams.memberId) qs.set("memberId", searchParams.memberId);

  return (
    <main className="mx-auto w-full max-w-[520px] px-5 py-6 space-y-6">
      <header className="space-y-2">
        <div className="text-sm text-ink-500">ABODY</div>
        <h1 className="text-2xl font-semibold tracking-tight">予約が完了しました</h1>
        <p className="text-ink-700 leading-relaxed">予約内容をご確認ください。</p>
      </header>

      <section className="rounded-2xl border border-line shadow-card p-5 space-y-4">
        <div className="space-y-1">
          <div className="text-xs text-ink-500">店舗</div>
          <div className="text-base font-medium">{storeName}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-ink-500">セッション種別</div>
          <div className="text-base font-medium">{sessionTypeLabel}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-ink-500">日付</div>
          <div className="text-base font-medium">{date ? formatDate(date) : "-"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-ink-500">時間</div>
          <div className="text-base font-medium">{startAt && endAt ? formatTimeRange(startAt, endAt) : "-"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-ink-500">会員（メールアドレス）</div>
          <div className="text-base font-medium">
            {memberName}（{memberId}）
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5 space-y-2">
        <div className="text-sm font-medium">今後のご案内</div>
        <div className="text-sm text-ink-700 leading-relaxed">今後はLINEからも予約できるよう準備中です。</div>
        {searchParams.reservationId ? <div className="text-xs text-ink-500">予約ID: {searchParams.reservationId}</div> : null}
      </section>

      <div className="grid gap-3">
        <Link
          href={qs.toString() ? `/booking?${qs.toString()}` : "/booking"}
          className="inline-flex w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-3 text-white font-semibold hover:bg-brand-700 active:bg-brand-700"
        >
          続けて予約する
        </Link>
        <Link
          href="/booking"
          className="inline-flex w-full items-center justify-center rounded-xl border border-line bg-white px-4 py-3 text-ink-900 font-semibold hover:bg-[#F9FAFB]"
        >
          別の日時を予約する
        </Link>
      </div>
    </main>
  );
}

