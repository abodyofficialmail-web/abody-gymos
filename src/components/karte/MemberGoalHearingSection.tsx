"use client";

import { isGoalHearingKarteContent } from "@/lib/goalHearingPhotos";

type HearingNote = {
  id: string;
  date: string;
  content: string;
  store_name?: string;
  trainer_name?: string;
};

export function splitGoalHearingNotes<T extends { content: string }>(notes: T[] | null): {
  hearingNotes: T[];
  sessionNotes: T[];
} {
  const all = notes ?? [];
  const hearingNotes = all.filter((n) => isGoalHearingKarteContent(n.content));
  const sessionNotes = all.filter((n) => !isGoalHearingKarteContent(n.content));
  return { hearingNotes, sessionNotes };
}

/** 会員カルテ：目標ヒアリング本文を目標写真の直下に固定表示する */
export function MemberGoalHearingSection({ notes }: { notes: HearingNote[] }) {
  if (notes.length === 0) return null;

  return (
    <section className="rounded-2xl border border-teal-200 bg-white p-4 shadow-sm space-y-3">
      <div>
        <div className="text-sm font-bold text-slate-900">目標ヒアリング</div>
        <div className="mt-1 text-xs text-slate-600">
          なりたい体型の写真とあわせて確認する内容です。カルテ一覧には出さず、ここに固定しています。
        </div>
      </div>
      <div className="grid gap-3">
        {notes.map((n) => (
          <div key={n.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
            <div className="whitespace-pre-wrap text-slate-800">{n.content}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
