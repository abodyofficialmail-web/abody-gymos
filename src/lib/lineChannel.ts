export type LineChannelKey = "default" | "ueno" | "sakuragicho" | "shinjuku" | "fukuoka";

export const LINE_CHANNEL_KEYS: LineChannelKey[] = ["default", "ueno", "sakuragicho", "shinjuku", "fukuoka"];

export function normalizeLineChannelKey(raw: unknown): LineChannelKey | null {
  const k = String(raw ?? "");
  if (k === "default" || k === "ueno" || k === "sakuragicho" || k === "shinjuku" || k === "fukuoka") return k;
  return null;
}

export function inferLineChannelKeyFromMemberCode(memberCode: string | null | undefined): LineChannelKey | null {
  const code = String(memberCode ?? "").trim().toUpperCase();
  if (code.startsWith("SAK")) return "sakuragicho";
  if (code.startsWith("UEN")) return "ueno";
  if (code.startsWith("SHI") || code.startsWith("SHJ")) return "shinjuku";
  if (code.startsWith("FUK")) return "fukuoka";
  if (code.startsWith("EBI") || code.startsWith("ON") || code.startsWith("ZAI")) return "default";
  return null;
}

export function lineChannelKeyForStoreName(storeName: string | null | undefined): LineChannelKey | null {
  const name = String(storeName ?? "").trim();
  if (name === "上野") return "ueno";
  if (name === "桜木町") return "sakuragicho";
  if (name === "新宿") return "shinjuku";
  if (name === "福岡") return "fukuoka";
  if (name === "恵比寿") return "default";
  return null;
}

export function lineChannelLabel(key: LineChannelKey | null | undefined): string {
  if (key === "ueno") return "上野公式LINE";
  if (key === "sakuragicho") return "桜木町公式LINE";
  if (key === "shinjuku") return "新宿公式LINE";
  if (key === "fukuoka") return "福岡公式LINE";
  return "恵比寿公式LINE";
}

export function storeNameForLineChannelKey(key: LineChannelKey | null | undefined): string | null {
  if (key === "ueno") return "上野";
  if (key === "sakuragicho") return "桜木町";
  if (key === "shinjuku") return "新宿";
  if (key === "fukuoka") return "福岡";
  if (key === "default") return "恵比寿";
  return null;
}

export function lineChannelTokenForStoreName(storeName: string): string | null {
  const key = lineChannelKeyForStoreName(storeName);
  if (!key) return null;
  return lineAccessTokenForChannelKey(key);
}

function nonEmptyToken(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim();
  return t.length > 0 ? t : null;
}

export function lineAccessTokenForChannelKey(key: LineChannelKey | null | undefined): string | null {
  if (key === "ueno") return nonEmptyToken(process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO);
  if (key === "sakuragicho") return nonEmptyToken(process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO);
  if (key === "shinjuku") return nonEmptyToken(process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU);
  if (key === "fukuoka") return nonEmptyToken(process.env.LINE_CHANNEL_ACCESS_TOKEN_FUKUOKA);
  if (key === "default") return nonEmptyToken(process.env.LINE_CHANNEL_ACCESS_TOKEN);
  return null;
}

/** 会員への push は連携チャネル（line_channel_key）を最優先。未設定時は会員番号プレフィックス、最後に予約店舗 */
export function linePushTokenForMember(params: {
  lineChannelKey?: LineChannelKey | null;
  memberCode?: string | null;
  fallbackStoreName?: string | null;
}): {
  token: string | null;
  channelKey: LineChannelKey | null;
  source: "explicit" | "store_fallback" | "member_code" | "missing";
} {
  if (params.lineChannelKey) {
    return {
      token: lineAccessTokenForChannelKey(params.lineChannelKey),
      channelKey: params.lineChannelKey,
      source: "explicit",
    };
  }

  const inferred = inferLineChannelKeyFromMemberCode(params.memberCode);
  if (inferred) {
    return {
      token: lineAccessTokenForChannelKey(inferred),
      channelKey: inferred,
      source: "member_code",
    };
  }

  if (params.fallbackStoreName) {
    const token = lineChannelTokenForStoreName(params.fallbackStoreName);
    if (token) {
      return {
        token,
        channelKey: lineChannelKeyForStoreName(params.fallbackStoreName),
        source: "store_fallback",
      };
    }
  }

  return { token: null, channelKey: null, source: "missing" };
}

export function linePushTokenForMemberRow(
  member: { member_code?: string | null; line_channel_key?: string | null } | null | undefined,
  fallbackStoreName?: string | null
) {
  const key = member?.line_channel_key;
  const channelKey = normalizeLineChannelKey(key);
  return linePushTokenForMember({
    lineChannelKey: channelKey,
    memberCode: member?.member_code ?? null,
    fallbackStoreName: fallbackStoreName ?? null,
  });
}

export async function lineMemberProfileReachable(token: string, lineUserId: string): Promise<boolean> {
  if (!token || !lineUserId) return false;
  const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}
