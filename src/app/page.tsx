import Link from "next/link";
import { APP_URL, LP_PUBLIC_URL } from "@/lib/constants";
/**
 * 業務システム（Gym OS）のエントリ。マーケ LP は同梱しない（別アプリ・別 URL）。
 */
export default function GymOsHomePage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-slate-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ABODY Gym OS</p>
      <h1 className="mt-2 text-2xl font-bold">業務システム</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        会員・トレーナー・管理向けの画面です。公開サイトとは別 URL でデプロイする想定です。
      </p>
      <div className="mt-6 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
        <p className="font-medium text-slate-500">この業務システムのベース URL（自動）</p>
        <p className="mt-1 break-all font-mono text-slate-900">{APP_URL}</p>
        <p className="mt-3 font-medium text-slate-500">公開 LP など別サイト（任意）</p>
        {LP_PUBLIC_URL ? (
          <p className="mt-1 break-all font-mono text-teal-800">{LP_PUBLIC_URL}</p>
        ) : (
          <p className="mt-1 text-slate-500">
            未設定（表示するには <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_LP_URL</code> を{" "}
            <code className="rounded bg-slate-100 px-1">.env.local</code> に書く）
          </p>
        )}
      </div>
      <ul className="mt-8 space-y-3">
        <li>
          <Link
            href="/login"
            className="block rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-semibold shadow-sm hover:bg-slate-50"
          >
            ログイン
          </Link>
        </li>
        <li>
          <Link
            href="/route-map"
            className="block rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-semibold shadow-sm hover:bg-slate-50"
          >
            画面URL一覧
          </Link>
        </li>
        {LP_PUBLIC_URL ? (
          <li>
            <a
              href={LP_PUBLIC_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-center text-sm font-semibold text-teal-900 hover:bg-teal-100"
            >
              公開サイト（LP）を開く
            </a>
          </li>
        ) : null}
      </ul>
      <p className="mt-10 text-xs text-slate-500">
        別サイトの URL をコードに埋め込まない方針のため、公開 LP へのボタンは{" "}
        <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_LP_URL</code> があるときだけ出ます。
      </p>
    </main>
  );
}

