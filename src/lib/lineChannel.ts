import { lineChannelTokenForStoreName } from "@/lib/lineMessagingPush";

export type LineChannelKey = "default" | "ueno" | "sakuragicho" | "shinjuku";

export function normalizeLineChannelKey(raw: unknown): LineChannelKey | null {
  const k = String(raw ?? "");
  if (k === "default" || k === "ueno" || k === "sakuragicho" || k === "shinjuku") return k;
  return null;
}

export function inferLineChannelKeyFromMemberCode(memberCode: string | null | undefined): LineChannelKey | null {
  const code = String(memberCode ?? "").trim().toUpperCase();
  if (code.startsWith("SAK")) return "sakuragicho";
  if (code.startsWith("UEN")) return "ueno";
  if (code.startsWith("SHJ")) return "shinjuku";
  if (code.startsWith("EBI")) return "default";
  return null;
}

export function lineAccessTokenForChannelKey(key: LineChannelKey | null | undefined): string | null {
  if (key === "ueno") return process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO ?? null;
  if (key === "sakuragicho") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO ?? null;
  if (key === "shinjuku") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU ?? null;
  if (key === "default") return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
  return null;
}

/** 会員への push は連携チャネル（line_channel_key）を最優先。会員番号プレフィックスだけでは誤ることがある */
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

  if (params.fallbackStoreName) {
    const token = lineChannelTokenForStoreName(params.fallbackStoreName);
    if (token) {
      return {
        token,
        channelKey: null,
        source: "store_fallback",
      };
    }
  }

  const inferred = inferLineChannelKeyFromMemberCode(params.memberCode);
  if (inferred) {
    return {
      token: lineAccessTokenForChannelKey(inferred),
      channelKey: inferred,
      source: "member_code",
    };
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
