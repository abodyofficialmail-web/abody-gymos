"use client";

import { useEffect, useState } from "react";

type MemberSettings = {
  member: {
    reservation_reminder_line_enabled?: boolean;
    weight_reminder_line_enabled?: boolean;
    weight_log_enabled?: boolean;
    meal_personal_enabled?: boolean;
  };
  trainer_visibility_pass?: {
    active: boolean;
    subscribe_url?: string | null;
    price_label?: string;
  };
};

async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string })?.error ?? "更新に失敗しました");
  return json as T;
}

function LineSwitch({
  checked,
  disabled,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className={[
        "relative mt-0.5 h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-60",
        checked ? "bg-slate-900" : "bg-slate-300",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform",
          checked ? "left-7" : "left-1",
        ].join(" ")}
      />
      <span className="sr-only">{checked ? "ON" : "OFF"}</span>
    </button>
  );
}

export function MemberSettingsPanel() {
  const [data, setData] = useState<MemberSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderErr, setReminderErr] = useState<string | null>(null);
  const [weightReminderBusy, setWeightReminderBusy] = useState(false);
  const [weightReminderErr, setWeightReminderErr] = useState<string | null>(null);

  const reminderEnabled = data?.member?.reservation_reminder_line_enabled !== false;
  const weightReminderEnabled = data?.member?.weight_reminder_line_enabled !== false;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch("/api/member/me", { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = (await res.json().catch(() => ({}))) as MemberSettings & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "取得に失敗しました");
        setData(json);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(String((e as Error)?.message ?? "取得に失敗しました"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">読み込み中…</div>;
  }
  if (err || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {err ?? "設定を読み込めませんでした"}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-bold text-slate-900">LINE配信</div>
        {data.member.meal_personal_enabled ? (
          <p className="text-xs leading-relaxed text-slate-500">
            食事の案内時刻は
            <a href="/meal-log" className="mx-1 font-semibold underline">
              食事パーソナル
            </a>
            の設定から変更できます。
          </p>
        ) : null}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-semibold text-slate-900">予約リマインド</div>
            <p className="text-xs leading-relaxed text-slate-600">
              セッション開始60分前にLINEでお知らせします（セッション前ヒアリングも含みます）。
            </p>
            <p className="text-xs leading-relaxed text-slate-500">
              OFFにしても、予約の確定・変更・キャンセルやカルテ共有などの通知は届きます。
            </p>
            <div className="text-xs font-semibold text-slate-700">
              現在: {reminderEnabled ? "ON（送信する）" : "OFF（送らない）"}
              {reminderBusy ? " …更新中" : ""}
            </div>
          </div>
          <LineSwitch
            checked={reminderEnabled}
            disabled={reminderBusy}
            onToggle={() => {
              void (async () => {
                const next = !reminderEnabled;
                setReminderBusy(true);
                setReminderErr(null);
                try {
                  await apiPatch<{ member: { reservation_reminder_line_enabled: boolean } }>("/api/member/me", {
                    reservation_reminder_line_enabled: next,
                  });
                  setData((prev) =>
                    prev ? { ...prev, member: { ...prev.member, reservation_reminder_line_enabled: next } } : prev
                  );
                } catch (e: unknown) {
                  setReminderErr(String((e as Error)?.message ?? "設定の更新に失敗しました"));
                } finally {
                  setReminderBusy(false);
                }
              })();
            }}
          />
        </div>
        {reminderErr ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{reminderErr}</div>
        ) : null}

        {data.member.weight_log_enabled ? (
          <>
            <div className="border-t border-slate-100" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-semibold text-slate-900">毎朝の体重・体脂肪</div>
                <p className="text-xs leading-relaxed text-slate-600">
                  毎朝7時に、今日の体重・体脂肪の記録案内をLINEで送ります。
                </p>
                <p className="text-xs leading-relaxed text-slate-500">OFFにしても、マイページからいつでも記録できます。</p>
                <div className="text-xs font-semibold text-slate-700">
                  現在: {weightReminderEnabled ? "ON（送信する）" : "OFF（送らない）"}
                  {weightReminderBusy ? " …更新中" : ""}
                </div>
              </div>
              <LineSwitch
                checked={weightReminderEnabled}
                disabled={weightReminderBusy}
                onToggle={() => {
                  void (async () => {
                    const next = !weightReminderEnabled;
                    setWeightReminderBusy(true);
                    setWeightReminderErr(null);
                    try {
                      await apiPatch<{ member: { weight_reminder_line_enabled: boolean } }>("/api/member/me", {
                        weight_reminder_line_enabled: next,
                      });
                      setData((prev) =>
                        prev ? { ...prev, member: { ...prev.member, weight_reminder_line_enabled: next } } : prev
                      );
                    } catch (e: unknown) {
                      setWeightReminderErr(String((e as Error)?.message ?? "設定の更新に失敗しました"));
                    } finally {
                      setWeightReminderBusy(false);
                    }
                  })();
                }}
              />
            </div>
            {weightReminderErr ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {weightReminderErr}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-bold text-slate-900">出勤トレーナー表示</div>
        {data.trainer_visibility_pass?.active ? (
          <div className="text-sm text-slate-700">
            パス適用中。予約変更の空き時間に、その時間の出勤トレーナー名を表示します。
          </div>
        ) : (
          <>
            <div className="text-sm text-slate-700">
              {data.trainer_visibility_pass?.price_label || "月額パス"}で、空き時間ごとに出勤トレーナーを表示できます。
            </div>
            {data.trainer_visibility_pass?.subscribe_url ? (
              <a
                href={data.trainer_visibility_pass.subscribe_url}
                className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                申し込む
              </a>
            ) : (
              <a
                href="/booking"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800"
              >
                予約カレンダーから確認
              </a>
            )}
          </>
        )}
      </section>
    </div>
  );
}
