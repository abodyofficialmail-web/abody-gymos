/**
 * アンケート用 LIFF URL（LINE アプリ内ブラウザで開く。外部ブラウザ・Vercel ログインを避ける）
 *
 * LINE Developers で LIFF のエンドポイント URL を次に設定:
 *   https://abody-gymos.vercel.app/survey
 * （ログイン用 LIFF と別 ID を `NEXT_PUBLIC_LIFF_SURVEY_ID` に置いても可）
 */

export function surveyLiffId(): string | null {
  const surveyOnly = process.env.NEXT_PUBLIC_LIFF_SURVEY_ID?.trim();
  if (surveyOnly) return surveyOnly;
  return process.env.NEXT_PUBLIC_LIFF_ID?.trim() || null;
}

export function sessionSurveyOpenUrl(query: string): string | null {
  const liffId = surveyLiffId();
  if (liffId) {
    // エンドポイントが …/survey のとき、liff.state が s=… だけだと
    // LINE が …/surveys=… と連結して 404 になる。先頭に ? を付ける（LINE仕様）。
    const q = query.startsWith("?") ? query : `?${query}`;
    return `https://liff.line.me/${liffId}?liff.state=${encodeURIComponent(q)}`;
  }
  return null;
}
