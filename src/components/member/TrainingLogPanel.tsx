"use client";

import { Dumbbell } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  TRAINING_CONDITIONS,
  TRAINING_KINDS,
  TRAINING_PARTS,
  type MemberTrainingLogView,
  type TrainingCondition,
  type TrainingKind,
} from "@/lib/memberTrainingLogs";

export function TrainingLogPanel({ signed }: { signed?: { s: string; sig: string } | null }) {
  const [log, setLog] = useState<MemberTrainingLogView | null>(null);
  const [kind, setKind] = useState<TrainingKind>("gym");
  const [parts, setParts] = useState<string[]>([]);
  const [duration, setDuration] = useState("");
  const [condition, setCondition] = useState<TrainingCondition | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = signed ? `?s=${encodeURIComponent(signed.s)}&sig=${encodeURIComponent(signed.sig)}` : "";

  const applyLog = useCallback((row: MemberTrainingLogView | null) => {
    setLog(row);
    if (!row) return;
    setKind(row.kind);
    setParts(row.parts);
    setDuration(row.duration_min != null ? String(row.duration_min) : "");
    setCondition(row.condition ?? "");
    setNote(row.note ?? "");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/member/training-logs${query}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { today_log?: MemberTrainingLogView | null; error?: string };
      if (!res.ok) throw new Error(json.error || "取得に失敗しました");
      applyLog(json.today_log ?? null);
    } catch (e) {
      setErr(String((e as Error)?.message ?? "取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }, [applyLog, query]);

  useEffect(() => {
    void load();
  }, [load]);

  function togglePart(id: string) {
    setParts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const res = await fetch("/api/member/training-logs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(signed ? { s: signed.s, sig: signed.sig } : {}),
          kind,
          parts,
          duration_min: duration.trim() === "" ? null : duration,
          condition: condition || null,
          note: note.trim() === "" ? null : note,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { today_log?: MemberTrainingLogView; error?: string };
      if (!res.ok) throw new Error(json.error || "保存に失敗しました");
      applyLog(json.today_log ?? null);
      setSavedMsg("今日のトレーニングを記録しました");
    } catch (e) {
      setErr(String((e as Error)?.message ?? "保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  const rest = kind === "rest";

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Dumbbell className="h-4 w-4" />
          トレーニングの記録
        </div>
        <p className="text-xs leading-relaxed text-slate-500">今日やった内容を残すと、食事とあわせて振り返りやすくなります。</p>
      </div>

      {loading ? <div className="text-sm text-slate-600">読み込み中…</div> : null}

      <div className="grid grid-cols-4 gap-1">
        {TRAINING_KINDS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setKind(item.id)}
            className={[
              "rounded-xl px-2 py-2 text-[11px] font-semibold",
              kind === item.id ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </div>

      {rest ? null : (
        <>
          <div>
            <div className="text-xs font-semibold text-slate-700">部位</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {TRAINING_PARTS.map((p) => {
                const active = parts.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePart(p.id)}
                    className={[
                      "rounded-xl border px-3 py-1.5 text-xs font-semibold",
                      active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800",
                    ].join(" ")}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block text-xs font-semibold text-slate-700">
            時間（分）
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={600}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="60"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
            />
          </label>
        </>
      )}

      <div>
        <div className="text-xs font-semibold text-slate-700">調子</div>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {TRAINING_CONDITIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCondition((prev) => (prev === item.id ? "" : item.id))}
              className={[
                "rounded-xl px-2 py-2 text-[11px] font-semibold",
                condition === item.id ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <label className="block text-xs font-semibold text-slate-700">
        メモ
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例: 脚の後半がきつかった"
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
        />
      </label>

      <button
        type="button"
        disabled={busy || loading}
        onClick={() => void save()}
        className="w-full rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? "保存中…" : log ? "トレーニングを更新する" : "トレーニングを記録する"}
      </button>
      {savedMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{savedMsg}</div>
      ) : null}
      {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</div> : null}
    </section>
  );
}
