"use client";

import { useState } from "react";

export function MemberMemoClient() {
  const [memo, setMemo] = useState("");
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-2">
      <div className="text-sm font-bold text-slate-900">メモ</div>
      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        className="min-h-[140px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        placeholder="ここにメモ（永続化は未実装）"
      />
    </section>
  );
}

