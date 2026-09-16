"use client";

import { HomeCookSuggest } from "@/components/member/HomeCookSuggest";

export default function MealPersonalPreviewPage() {
  return (
    <main className="mx-auto max-w-md space-y-3 p-4 pb-24">
      <h1 className="text-lg font-bold text-slate-900">食事パーソナル（自炊プレビュー）</h1>
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-bold text-teal-900">
          マップからおすすめを見る
        </div>
        <HomeCookSuggest remaining={{ kcal: 1924, protein_g: 104, fat_g: 40, carb_g: 200 }} />
      </section>
    </main>
  );
}
