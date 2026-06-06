import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "セッション評価 | ABODY",
  description: "トレーニングセッション後のアンケート",
};

/** Gym OS（/login 等）とは別の会員向けアンケート専用レイアウト */
export default function SurveyLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50 text-slate-900">{children}</div>;
}
