"use client";

import { useState } from "react";

type ChatLine = { role: "trainer" | "assistant"; text: string };

export function MealKarteFeedback({ endpoint }: { endpoint: string }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [feedback, setFeedback] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<"draft" | "revise" | "send" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function post(body: Record<string, string>) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      summary?: string;
      feedback?: string;
      ai?: boolean;
    };
    if (!res.ok) throw new Error(json.error ?? "失敗しました");
    return json;
  }

  async function openDraft() {
    setOpen(true);
    setErr(null);
    setMsg(null);
    if (feedback) return;
    setBusy("draft");
    try {
      const json = await post({ action: "draft" });
      setSummary(json.summary ?? "");
      setFeedback(json.feedback ?? "");
      if (json.ai === false) setMsg("AIが応答しなかったため、定型の文を入れています。欄を直接直せます。");
    } catch (e) {
      setErr(String((e as Error)?.message ?? "生成に失敗しました"));
    } finally {
      setBusy(null);
    }
  }

  async function revise() {
    const text = instruction.trim();
    if (!text || busy) return;
    setInstruction("");
    setChat((prev) => [...prev, { role: "trainer", text }]);
    setBusy("revise");
    setErr(null);
    try {
      const json = await post({ action: "revise", feedback, instruction: text });
      setFeedback(json.feedback ?? feedback);
      if (json.summary) setSummary(json.summary);
      setChat((prev) => [...prev, { role: "assistant", text: "フィードバックを直しました。上の文を確認して、送ってください。" }]);
    } catch (e) {
      setErr(String((e as Error)?.message ?? "修正に失敗しました"));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!feedback.trim() || busy) return;
    setBusy("send");
    setErr(null);
    setMsg(null);
    try {
      const json = await post({ action: "send", feedback });
      if (json.summary) setSummary(json.summary);
      setMsg("LINEで今日の記録まとめとフィードバックを送りました。");
    } catch (e) {
      setErr(String((e as Error)?.message ?? "送信に失敗しました"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void openDraft()}
        className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
      >
        フィードバックする
      </button>
      {open ? (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-bold text-slate-900">今日の記録まとめ</div>
          <pre className="whitespace-pre-wrap rounded-xl bg-white px-3 py-2 text-xs leading-relaxed text-slate-700">
            {busy === "draft" && !summary ? "食事内容から文章を作っています…" : summary || "まだありません。"}
          </pre>
          <label className="block space-y-1">
            <span className="text-sm font-bold text-slate-900">フィードバック</span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={6}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <div className="space-y-2">
            <div className="text-sm font-bold text-slate-900">修正チャット</div>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {chat.length === 0 ? (
                <p className="text-xs text-slate-500">「もっと短く」「たんぱく質を褒めて」のように指示すると、上の文を直します。</p>
              ) : null}
              {chat.map((line, i) => (
                <div
                  key={`${line.role}-${i}`}
                  className={[
                    "max-w-[90%] rounded-2xl px-3 py-2 text-xs leading-relaxed",
                    line.role === "trainer" ? "ml-auto bg-slate-900 text-white" : "bg-white text-slate-800",
                  ].join(" ")}
                >
                  {line.text}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void revise();
                  }
                }}
                placeholder="直し方を指示"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy != null || !instruction.trim()}
                onClick={() => void revise()}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
              >
                {busy === "revise" ? "反映中…" : "反映"}
              </button>
            </div>
          </div>
          <button
            type="button"
            disabled={busy != null || !feedback.trim()}
            onClick={() => void send()}
            className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === "send" ? "送信中…" : "今日のまとめとフィードバックを送る"}
          </button>
          {msg ? <div className="text-xs text-emerald-800">{msg}</div> : null}
          {err ? <div className="text-xs text-red-700">{err}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
