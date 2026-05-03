/**
 * LINE Messaging API（push）共通。
 * トークンは店舗名で既存の予約通知と同じ環境変数を参照する。
 */

export function lineChannelTokenForStoreName(storeName: string): string | null {
  if (storeName === "上野") return process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO ?? null;
  if (storeName === "桜木町") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO ?? null;
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
}

/** メッセージは最大約5000文字。余裕を見て分割する。 */
const LINE_TEXT_SAFE_MAX = 4800;

export function chunkLinePushText(body: string): string[] {
  const t = body.trimEnd();
  const MAX = LINE_TEXT_SAFE_MAX;
  if (t.length <= MAX) return [t];

  const chunks: string[] = [];
  let rest = t;
  while (rest.length > MAX) {
    const slice = rest.slice(0, MAX);
    const lastNl = slice.lastIndexOf("\n");
    const cut = lastNl > MAX * 0.4 ? lastNl : MAX;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length) chunks.push(rest);

  const total = chunks.length;
  if (total <= 1) return chunks;
  return chunks.map((c, i) => `【${i + 1}/${total}】\n${c}`);
}

async function linePushSingle(token: string, to: string, text: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  const raw = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: raw };
}

export async function pushLineTextChunks(params: {
  token: string;
  toUserId: string;
  chunks: string[];
}): Promise<Array<{ ok: boolean; status: number; body: string }>> {
  const out: Array<{ ok: boolean; status: number; body: string }> = [];
  for (const text of params.chunks) {
    const r = await linePushSingle(params.token, params.toUserId, text);
    out.push(r);
    if (!r.ok) break;
  }
  return out;
}

/** @returns すべて成功なら true */
export async function pushLineTextAsChunks(token: string | null, toUserId: string, text: string): Promise<boolean> {
  if (!token || !toUserId) return false;
  const chunks = chunkLinePushText(text);
  const results = await pushLineTextChunks({ token, toUserId, chunks });
  return results.length > 0 && results.every((r) => r.ok);
}
