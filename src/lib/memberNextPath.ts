/** ログイン後の戻り先。オープンリダイレクト防止。 */
export function safeMemberNextPath(raw: string | null | undefined, fallback = "/member"): string {
  const v = String(raw ?? "").trim();
  if (!v.startsWith("/")) return fallback;
  if (v.startsWith("//")) return fallback;
  if (v.startsWith("/login")) return fallback;
  if (v.includes("://")) return fallback;
  return v;
}
