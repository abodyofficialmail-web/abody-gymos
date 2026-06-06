export default function SurveyNotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <h1 className="text-lg font-bold">アンケートページが見つかりません</h1>
        <p className="mt-2 text-sm leading-relaxed">
          LINEのメッセージにある「アンケートに回答する」から、もう一度お開きください。
          業務システム（ログイン画面）ではありません。
        </p>
      </div>
    </main>
  );
}
