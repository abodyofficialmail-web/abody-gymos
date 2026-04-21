/** 店舗別LINE予約リンク（体験予約） */
export const LINE_URL_EBISU = "https://lin.ee/Lt7TNZd";
export const LINE_URL_UENO = "https://lin.ee/j02i6sq";
export const LINE_URL_SAKURAGICHO = "https://lin.ee/X2nEVKr";
/** 店舗ID → LINE予約URL */
export const LINE_URL_BY_STORE: Record<string, string> = {
  ebisu: LINE_URL_EBISU,
  ueno: LINE_URL_UENO,
  sakuragicho: LINE_URL_SAKURAGICHO,
};
/** 共通LINE（ヘッダー・キャンペーン等で未指定時のフォールバック＝恵比寿店） */
export const LINE_URL =
  process.env.NEXT_PUBLIC_LINE_URL || LINE_URL_EBISU;
/** リクルート（採用）用LINE */
export const LINE_URL_RECRUIT = "https://lin.ee/cqUlxW8";
/**
 * 業務システム（会員・トレーナー・管理・このリポジトリルートの Next アプリ）の公開オリジン。
 * 他に運用している LP / 予約サイトなどの URL はデフォルトで持たない（別サイトは `NEXT_PUBLIC_LP_URL` 等で明示）。
 *
 * 解決順: `NEXT_PUBLIC_APP_URL` → Vercel の `VERCEL_URL` → ローカル `http://localhost:3000`
 */
function resolveAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/$/, "");
  }
  return "http://localhost:3000";
}
export const APP_URL = resolveAppUrl();
/**
 * 公開マーケ LP 等（別サイト）のオリジン。未設定なら空（リンクは UI 側で出さない）。
 * 既存の別プロダクトの URL をデフォルトにしない。
 */
export const LP_PUBLIC_URL = (process.env.NEXT_PUBLIC_LP_URL ?? "").trim().replace(/\/$/, "");
/**
 * @deprecated `APP_URL` を使用してください（旧名。LP や別ドメインと混同しやすい）
 */
export const SITE_URL = APP_URL;
/** このアプリ内の `/booking`（ルートアプリに存在する場合） */
export const BOOKING_PAGE_URL = `${APP_URL}/booking`;
/** 会員向け予約・一覧など、業務システム上の絶対 URL */
export function absoluteAppUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${APP_URL}${p}`;
}
/** トレーニング風景のInstagram Reel。thumbnail に public/ 内の画像パスを指定するとサムネイル表示（例: /reel-thumb-1.jpg） */
export const INSTAGRAM_REELS: { url: string; thumbnail?: string }[] = [
  { url: "https://www.instagram.com/reel/DN5cyCOj6-0/" },
  { url: "https://www.instagram.com/reel/DG5Z3u3TBJx/" },
  { url: "https://www.instagram.com/reel/DTzovGWgRk7/" },
];
