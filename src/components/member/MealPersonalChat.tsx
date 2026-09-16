"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { MEAL_CHAT_GREETING } from "@/lib/memberMealChat";

export type MealChatBubble = {
  role: "user" | "assistant";
  text: string;
};

export function MealPersonalChat({
  messages,
  input,
  busy,
  canSend,
  onInput,
  onSend,
  fill = false,
  extra,
}: {
  messages: MealChatBubble[];
  input: string;
  busy: boolean;
  canSend: boolean;
  onInput: (value: string) => void;
  onSend: () => void;
  fill?: boolean;
  extra?: ReactNode;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [input]);

  return (
    <div className={fill ? "flex min-h-[60vh] flex-col" : "space-y-2"}>
      {fill ? null : <div className="text-xs font-semibold text-slate-700">AIと食事の相談・記録</div>}
      <div
        className={[
          "overflow-hidden bg-slate-50",
          fill ? "flex min-h-0 flex-1 flex-col rounded-none border-0" : "rounded-xl border border-slate-200",
        ].join(" ")}
      >
        <div
          className={[
            "space-y-2 overflow-y-auto px-3 py-3",
            fill ? "min-h-0 flex-1" : "max-h-96",
          ].join(" ")}
        >
          {(messages.length ? messages : [{ role: "assistant" as const, text: MEAL_CHAT_GREETING }]).map((m, i) => (
            <div key={`${m.role}-${i}`} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={[
                  "max-w-[92%] whitespace-pre-wrap px-3 py-2 text-sm leading-relaxed",
                  m.role === "user"
                    ? "rounded-2xl rounded-br-md bg-slate-900 text-white"
                    : "rounded-2xl rounded-bl-md border border-slate-200 bg-white text-slate-800",
                ].join(" ")}
              >
                {m.text}
              </div>
            </div>
          ))}
          {busy ? (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
                考えています…
              </div>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
        {extra}
        <form
          className="flex items-end gap-2 border-t border-slate-200 bg-white p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend && !busy) onSend();
          }}
        >
          <textarea
            ref={areaRef}
            value={input}
            rows={1}
            disabled={busy}
            placeholder="例：昼ごはん消して / 恵比寿で夜ごはん何がいい？"
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend && !busy) onSend();
              }
            }}
            className="max-h-24 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !canSend}
            className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            送信
          </button>
        </form>
      </div>
    </div>
  );
}
