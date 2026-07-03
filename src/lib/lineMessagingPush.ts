/**
 * LINE Messaging API（push）共通。
 * トークンは店舗名で既存の予約通知と同じ環境変数を参照する。
 */

import {
  lineAccessTokenForChannelKey,
  lineChannelKeyForStoreName,
  lineChannelTokenForStoreName,
  lineMemberProfileReachable,
  linePushTokenForMember,
  type LineChannelKey,
} from "@/lib/lineChannel";

export { lineChannelTokenForStoreName } from "@/lib/lineChannel";

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

export type LineTextPushResult = {
  ok: boolean;
  status?: number;
  body?: string;
};

/** @returns すべて成功なら ok: true */
export async function pushLineTextAsChunks(token: string | null, toUserId: string, text: string): Promise<LineTextPushResult> {
  if (!token || !toUserId) return { ok: false, body: "missing token or user id" };
  const chunks = chunkLinePushText(text);
  const results = await pushLineTextChunks({ token, toUserId, chunks });
  if (results.length === 0) return { ok: false, body: "no chunks" };
  const last = results[results.length - 1];
  return {
    ok: results.every((r) => r.ok),
    status: last?.status,
    body: last?.body,
  };
}

export type LinePushForMemberResult = {
  ok: boolean;
  channelKey: LineChannelKey | null;
  source: "explicit" | "store_fallback" | "member_code" | "store_fallback_retry" | "missing";
  status?: number;
  body?: string;
};

/** 会員の連携チャネルで push。失敗時はセッション店舗の公式LINEトークンでも再試行する */
export async function pushLineTextForMember(params: {
  toUserId: string;
  text: string;
  memberCode?: string | null;
  lineChannelKey?: LineChannelKey | null;
  storeName?: string | null;
}): Promise<LinePushForMemberResult> {
  const { toUserId, text, memberCode, lineChannelKey, storeName } = params;
  if (!toUserId) return { ok: false, channelKey: null, source: "missing", body: "missing line user id" };
  if (!text.trim()) return { ok: false, channelKey: null, source: "missing", body: "empty message" };

  const primary = linePushTokenForMember({
    lineChannelKey: lineChannelKey ?? null,
    memberCode: memberCode ?? null,
    fallbackStoreName: storeName ?? null,
  });

  const tried = new Set<string>();
  const candidates: Array<{
    token: string;
    channelKey: LineChannelKey | null;
    source: LinePushForMemberResult["source"];
  }> = [];

  if (primary.token) {
    candidates.push({
      token: primary.token,
      channelKey: primary.channelKey ?? lineChannelKeyForStoreName(storeName ?? null),
      source: primary.source,
    });
  }

  const storeToken = storeName ? lineChannelTokenForStoreName(storeName) : null;
  if (storeToken) {
    candidates.push({
      token: storeToken,
      channelKey: lineChannelKeyForStoreName(storeName ?? null),
      source: "store_fallback_retry",
    });
  }

  // 連携チャネル未設定のときだけ恵比寿公式を試す（店舗専用LINEと混同しない）
  if (!lineChannelKey) {
    const defaultToken = lineAccessTokenForChannelKey("default");
    if (defaultToken) {
      candidates.push({
        token: defaultToken,
        channelKey: "default",
        source: "store_fallback_retry",
      });
    }
  }

  let lastError: { status?: number; body?: string } = {};

  for (const candidate of candidates) {
    if (tried.has(candidate.token)) continue;
    tried.add(candidate.token);

    const reachable = await lineMemberProfileReachable(candidate.token, toUserId);
    if (!reachable) {
      lastError = { body: `profile not reachable on channel ${candidate.channelKey ?? "unknown"}` };
      continue;
    }

    const result = await pushLineTextAsChunks(candidate.token, toUserId, text);
    if (result.ok) {
      return { ok: true, channelKey: candidate.channelKey, source: candidate.source };
    }
    lastError = { status: result.status, body: result.body };
  }

  return {
    ok: false,
    channelKey: primary.channelKey,
    source: primary.source,
    status: lastError.status,
    body: lastError.body,
  };
}
