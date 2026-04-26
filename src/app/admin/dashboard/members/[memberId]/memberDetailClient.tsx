"use client";

import { DateTime } from "luxon";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const TZ = "Asia/Tokyo";

type ReservationRow = {
  id: string;
  store_id: string;
  store_name?: string;
  trainer_id: string | null;
  trainer_name?: string;
  member_id: string;
  member_code?: string;
  start_at: string;
  end_at: string;
  status: string;
  created_at: string;
};

type ClientNoteRow = {
  id: string;
  member_id: string;
  store_id: string;
  store_name?: string;
  trainer_id: string;
  trainer_name?: string;
  date: string; // YYYY-MM-DD
  content: string;
  created_at: string;
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "取得に失敗しました");
  return json as T;
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "更新に失敗しました");
  return json as T;
}

export function MemberDetailClient({
  memberId,
  member,
}: {
  memberId: string;
  member: {
    id: string;
    member_code: string;
    name: string;
    email: string | null;
    is_active: boolean;
    line_user_id: string | null;
  };
}) {
  const month = useMemo(() => DateTime.now().setZone(TZ).toFormat("yyyy-MM"), []);
  const [rows, setRows] = useState<ReservationRow[] | null>(null);
  const [memo, setMemo] = useState("");
  const [notes, setNotes] = useState<ClientNoteRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState(member.email ?? "");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);

  useEffect(() => {
    // SSR/キャッシュ差分で email が空になることがあるので、画面表示時に必ず最新を取り直す
    apiGet<{ member: { email: string | null } }>(`/api/admin/members/${encodeURIComponent(memberId)}/get`)
      .then((d) => {
        const next = d.member?.email ?? "";
        setEmail((cur) => {
          // ユーザーが既に入力し始めている場合は上書きしない
          if (cur.trim().length > 0) return cur;
          return next;
        });
      })
      .catch(() => {
        // 取得失敗は致命ではない（手入力で救える）
      });
  }, [memberId]);

  useEffect(() => {
    setErr(null);
    apiGet<{ reservations: ReservationRow[] }>(
      `/api/booking-v2/reservations?member_id=${encodeURIComponent(memberId)}&month=${encodeURIComponent(month)}`
    )
      .then((d) => setRows(d.reservations ?? []))
      .catch((e: any) => {
        setErr(String(e?.message ?? "取得に失敗しました"));
        setRows([]);
      });
  }, [memberId, month]);

  useEffect(() => {
    apiGet<{ notes: ClientNoteRow[] }>(`/api/client-notes?member_id=${encodeURIComponent(memberId)}`)
      .then((d) => setNotes(d.notes ?? []))
      .catch(() => setNotes([]));
  }, [memberId]);

  return (
    <div className="space-y-4">
      <Link href="/admin/dashboard/members" className="text-sm text-slate-600 underline">
        ← 一覧へ
      </Link>

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

      {/* 会員基本情報 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-bold text-slate-900">{member.member_code || member.id}</div>
            <div className="pt-1 text-sm text-slate-700">{member.name || ""}</div>
            <div className="pt-1 text-xs text-slate-500">{member.is_active ? "有効" : "無効"}</div>
            <div className="pt-1 text-[11px] text-slate-400 break-all">ID: {member.id}</div>
            {email.trim() ? (
              <div className="pt-1 text-[11px] text-slate-500 break-all">Email: {email.trim()}</div>
            ) : (
              <div className="pt-1 text-[11px] text-slate-400">Email: 未登録</div>
            )}
          </div>
          <div
            className={[
              "rounded-full px-3 py-1 text-xs font-semibold border",
              member.line_user_id ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600",
            ].join(" ")}
          >
            {member.line_user_id ? "LINE連携済み" : "LINE未連携"}
          </div>
        </div>

        <div className="pt-2 space-y-1">
          <div className="text-xs font-semibold text-slate-700">メールアドレス</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailMsg(null);
              }}
              inputMode="email"
              placeholder="未登録（入力して保存）"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={emailSaving}
              onClick={async () => {
                setEmailSaving(true);
                setEmailMsg(null);
                try {
                  await apiPatch(`/api/admin/members/${encodeURIComponent(memberId)}`, { email });
                  setEmailMsg("保存しました");
                } catch (e: any) {
                  setEmailMsg(String(e?.message ?? "保存に失敗しました"));
                } finally {
                  setEmailSaving(false);
                }
              }}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {emailSaving ? "保存中…" : "保存"}
            </button>
          </div>
          {emailMsg ? <div className="text-xs text-slate-600">{emailMsg}</div> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <div className="text-sm font-bold text-slate-900">メモ</div>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          className="min-h-[120px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          placeholder="ここにメモ（永続化は未実装）"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <div className="text-sm font-bold text-slate-900">予約履歴（当月）</div>
        {rows === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
        {rows !== null && rows.length === 0 ? <div className="text-sm text-slate-600">予約がありません。</div> : null}
        <div className="grid gap-2">
          {(rows ?? []).map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <div className="font-semibold">
                {DateTime.fromISO(r.start_at).setZone(TZ).toFormat("M/d HH:mm")}〜
                {DateTime.fromISO(r.end_at).setZone(TZ).toFormat("HH:mm")}
              </div>
              <div className="text-xs text-slate-500">
                トレーナー: {r.trainer_name || (r.trainer_id ?? "-")} / 店舗: {r.store_name || r.store_id}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <div className="text-sm font-bold text-slate-900">カルテ（全店舗）</div>
        {notes === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
        {notes !== null && notes.length === 0 ? <div className="text-sm text-slate-600">履歴がありません。</div> : null}
        <div className="grid gap-2">
          {(notes ?? []).map((n) => (
            <div key={n.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm space-y-1">
              <div className="font-semibold">
                {n.date} {n.store_name || n.store_id}（{n.trainer_name || n.trainer_id}）
              </div>
              <div className="whitespace-pre-wrap text-slate-800">{n.content}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

