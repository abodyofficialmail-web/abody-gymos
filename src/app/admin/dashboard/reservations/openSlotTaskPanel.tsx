"use client";

import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { OPEN_SLOT_TASKS, extendedReservationRange, type OpenSlotTaskKey } from "@/lib/openSlotTasks";

const TZ = "Asia/Tokyo";

export type OpenSlotDto = { start_at: string; end_at: string };

export type OpenSlotTaskReport = {
  id: string;
  slot_start_at: string;
  slot_end_at: string;
  task_key: string;
  task_label: string;
  detail: string | null;
  operator_name: string | null;
  member_label: string | null;
  created_at: string;
};

type ReservationRow = {
  id: string;
  store_id: string;
  trainer_name?: string;
  member_id: string | null;
  member_code?: string;
  member_name?: string;
  session_type?: string | null;
  start_at: string;
  end_at: string;
};

type TrainerOption = { id: string; display_name: string };

type MemberHit = { id: string; member_code: string; name: string | null; line_user_id?: string | null };

function hhmm(iso: string) {
  return DateTime.fromISO(iso).setZone(TZ).toFormat("HH:mm");
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string })?.error ?? "取得に失敗しました");
  return json as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json as { error?: string; code?: string; detail?: string };
    const detail = typeof err.detail === "string" ? err.detail : "";
    const message = err.error ?? "実行に失敗しました";
    const error = new Error(detail ? `${message}: ${detail}` : message) as Error & { code?: string };
    error.code = err.code;
    throw error;
  }
  return json as T;
}

export function OpenSlotTaskPanel(props: {
  storeId: string;
  storeName: string;
  slot: OpenSlotDto;
  reservations: ReservationRow[];
  trainers: TrainerOption[];
  defaultTrainerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [taskKey, setTaskKey] = useState<OpenSlotTaskKey | "">("");
  const [detail, setDetail] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberHits, setMemberHits] = useState<MemberHit[] | null>(null);
  const [member, setMember] = useState<MemberHit | null>(null);
  const [reservationId, setReservationId] = useState("");
  const [trainerId, setTrainerId] = useState(props.defaultTrainerId);
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const task = OPEN_SLOT_TASKS.find((item) => item.key === taskKey) ?? null;
  const extendOptions = useMemo(() => {
    const slotStart = DateTime.fromISO(props.slot.start_at).toMillis();
    const slotEnd = DateTime.fromISO(props.slot.end_at).toMillis();
    return props.reservations
      .filter((row) => row.member_id && String(row.session_type ?? "store") !== "online" && row.store_id === props.storeId)
      .map((row) => {
        const next = extendedReservationRange(
          {
            startMs: DateTime.fromISO(row.start_at).toMillis(),
            endMs: DateTime.fromISO(row.end_at).toMillis(),
          },
          { startMs: slotStart, endMs: slotEnd }
        );
        return next ? { row, next } : null;
      })
      .filter((item): item is { row: ReservationRow; next: { startMs: number; endMs: number; direction: "after" | "before" } } => Boolean(item));
  }, [props.reservations, props.slot.end_at, props.slot.start_at, props.storeId]);

  useEffect(() => {
    if (taskKey !== "invite") return;
    const q = memberQuery.trim();
    if (q.length < 1) {
      setMemberHits(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      apiGet<{ members: MemberHit[] }>(`/api/admin/members/search?q=${encodeURIComponent(q)}&limit=8`)
        .then((data) => {
          if (!cancelled) setMemberHits(data.members ?? []);
        })
        .catch(() => {
          if (!cancelled) setMemberHits([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [memberQuery, taskKey]);

  const submit = async () => {
    if (!taskKey) {
      setErr("タスクを選んでください");
      return;
    }
    if (taskKey === "other" && !detail.trim()) {
      setErr("その他タスクの内容を書いてください");
      return;
    }
    if (taskKey === "invite" && !member) {
      setErr("案内する会員を選んでください");
      return;
    }
    if (taskKey === "extend" && !reservationId) {
      setErr("延長する予約を選んでください");
      return;
    }
    if (!trainerId) {
      setErr("担当トレーナーを選んでください");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const result = await apiPost<{
        line?: { sent?: string[]; missed?: string[] };
        member_notified?: boolean | null;
      }>("/api/admin/open-slot-tasks", {
        store_id: props.storeId,
        start_at: props.slot.start_at,
        end_at: props.slot.end_at,
        task_key: taskKey,
        detail: detail.trim() || undefined,
        member_id: member?.id,
        reservation_id: reservationId || undefined,
        operator_trainer_id: trainerId,
        operator_password: needPassword ? password : undefined,
      });
      const missed = result.line?.missed ?? [];
      const sent = result.line?.sent ?? [];
      const lines = ["実行して報告しました。"];
      if (sent.length > 0) lines.push(`${sent.join("と")}にLINEで送りました。`);
      if (missed.length > 0) lines.push(`${missed.join("と")}にはLINEが届きませんでした。`);
      if (taskKey === "extend" && result.member_notified === false) {
        lines.push("会員への延長連絡は送れませんでした。");
      }
      setDone(lines.join(""));
      props.onDone();
    } catch (e) {
      const error = e as Error & { code?: string };
      if (String(error.message).includes("password_required") || error.code === "password_required") {
        setNeedPassword(true);
        setErr("このトレーナーはパスワードが必要です");
      } else {
        setErr(error.message || "実行に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-900">
              空き枠 {hhmm(props.slot.start_at)}〜{hhmm(props.slot.end_at)}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {props.storeName} / 実行するとゆうととテストアカウントに報告します
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            閉じる
          </button>
        </div>

        {done ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
            {done}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-2">
              {OPEN_SLOT_TASKS.map((item) => {
                const active = taskKey === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setTaskKey(item.key);
                      setErr(null);
                    }}
                    className={[
                      "rounded-xl border px-3 py-2 text-left",
                      active ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                    <div className="text-[11px] text-slate-500">{item.hint}</div>
                  </button>
                );
              })}
            </div>

            {taskKey === "invite" ? (
              <div>
                <div className="text-xs font-semibold text-slate-700">案内する会員</div>
                {member ? (
                  <div className="mt-2 flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
                    <span>
                      {member.member_code}
                      {member.name ? `（${member.name}）` : ""}
                      {!member.line_user_id ? " / LINE未連携" : ""}
                    </span>
                    <button type="button" className="text-xs font-semibold text-slate-600" onClick={() => setMember(null)}>
                      選び直す
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      value={memberQuery}
                      onChange={(e) => setMemberQuery(e.target.value)}
                      placeholder="会員番号か名前"
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    />
                    <div className="mt-2 grid gap-1">
                      {(memberHits ?? []).map((hit) => (
                        <button
                          key={hit.id}
                          type="button"
                          onClick={() => setMember(hit)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                        >
                          {hit.member_code}
                          {hit.name ? `（${hit.name}）` : ""}
                          {!hit.line_user_id ? " / LINE未連携" : ""}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {taskKey === "extend" ? (
              <div>
                <div className="text-xs font-semibold text-slate-700">延長する予約</div>
                {extendOptions.length === 0 ? (
                  <div className="mt-2 text-xs text-slate-500">この枠の直前・直後に会員の店舗予約がありません。</div>
                ) : (
                  <div className="mt-2 grid gap-2">
                    {extendOptions.map(({ row, next }) => {
                      const active = reservationId === row.id;
                      const nextStart = DateTime.fromMillis(next.startMs).setZone(TZ).toFormat("HH:mm");
                      const nextEnd = DateTime.fromMillis(next.endMs).setZone(TZ).toFormat("HH:mm");
                      return (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => setReservationId(row.id)}
                          className={[
                            "rounded-xl border px-3 py-2 text-left text-sm",
                            active ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white",
                          ].join(" ")}
                        >
                          <div className="font-semibold text-slate-900">
                            {hhmm(row.start_at)}〜{hhmm(row.end_at)} → {nextStart}〜{nextEnd}
                          </div>
                          <div className="text-xs text-slate-600">
                            {row.member_code || "会員"}
                            {row.member_name ? `（${row.member_name}）` : ""} / {row.trainer_name || "担当未定"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {task ? (
              <div>
                <div className="text-xs font-semibold text-slate-700">
                  {taskKey === "other" ? "タスク内容" : "報告メモ"}
                </div>
                <textarea
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  rows={3}
                  maxLength={400}
                  placeholder={taskKey === "other" ? "何をしたか書いてください" : "あれば補足"}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            ) : null}

            <div>
              <div className="text-xs font-semibold text-slate-700">担当トレーナー</div>
              <select
                value={trainerId}
                onChange={(e) => {
                  setTrainerId(e.target.value);
                  setNeedPassword(false);
                  setPassword("");
                }}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">選択してください</option>
                {props.trainers.map((trainer) => (
                  <option key={trainer.id} value={trainer.id}>
                    {trainer.display_name}
                  </option>
                ))}
              </select>
              {needPassword ? (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="パスワード"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              ) : null}
            </div>

            {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div> : null}

            <button
              type="button"
              onClick={submit}
              disabled={busy || !taskKey || !trainerId || (needPassword && !password)}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "送信中…" : "実行して報告"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
