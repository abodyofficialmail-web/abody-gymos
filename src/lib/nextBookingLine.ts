import { getAppUrl } from "@/lib/constants";
import {
  lineAccessTokenForChannelKey,
  lineChannelKeyForStoreName,
  lineMemberProfileReachable,
  linePushTokenForMember,
  normalizeLineChannelKey,
  type LineChannelKey,
} from "@/lib/lineChannel";
import { nextBookingTargetCopy, type NextBookingOffer } from "@/lib/sessionSurveyNextBooking";

export function nextBookingPageUrl(query: string): string {
  const q = query.startsWith("?") ? query.slice(1) : query;
  return `${getAppUrl()}/next-booking?${q}`;
}

export function nextBookingPageUrlFromInviteToken(inviteToken: string): string {
  return nextBookingPageUrl(`token=${encodeURIComponent(inviteToken)}`);
}

export function buildNextBookingFlexMessage(params: {
  storeName: string;
  bookingUrl: string;
  offer: NextBookingOffer;
}): object {
  const store = params.storeName.trim() || "店舗";
  const slotLines = params.offer.slots.slice(0, 5).map((s) => `・${s.date_label} ${s.time_label}`);
  const preferred = params.offer.preferred_labels.length
    ? `希望時間: ${params.offer.preferred_labels.join(" / ")}`
    : null;

  const bodyContents: object[] = [
    {
      type: "text",
      text: "次回のご予約",
      weight: "bold",
      size: "lg",
      color: "#065f46",
    },
    {
      type: "text",
      text: `${nextBookingTargetCopy(params.offer.monthly_average)}\n${store}の空きです。`,
      wrap: true,
      size: "sm",
      color: "#334155",
    },
  ];

  if (preferred) {
    bodyContents.push({
      type: "text",
      text: preferred,
      wrap: true,
      size: "xs",
      color: "#64748b",
    });
  }

  if (slotLines.length) {
    bodyContents.push({
      type: "text",
      text: slotLines.join("\n"),
      wrap: true,
      size: "sm",
      color: "#1e293b",
    });
  }

  bodyContents.push({
    type: "button",
    style: "primary",
    color: "#059669",
    height: "sm",
    action: {
      type: "uri",
      label: "この場で予約する",
      uri: params.bookingUrl,
    },
  });

  return {
    type: "flex",
    altText: "次回のご予約：通いやすい時間の空きからこの場で確定できます",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: bodyContents,
      },
    },
  };
}

async function linePushMessages(token: string, to: string, messages: object[]): Promise<boolean> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("LINE push failed for next booking", { status: res.status, body });
    return false;
  }
  return true;
}

export async function pushNextBookingInviteLine(params: {
  lineUserId: string;
  memberCode?: string | null;
  lineChannelKey?: string | null;
  storeName: string;
  bookingUrl: string;
  offer: NextBookingOffer;
}): Promise<boolean> {
  const flex = buildNextBookingFlexMessage({
    storeName: params.storeName,
    bookingUrl: params.bookingUrl,
    offer: params.offer,
  });

  const line = linePushTokenForMember({
    lineChannelKey: normalizeLineChannelKey(params.lineChannelKey),
    memberCode: params.memberCode,
    fallbackStoreName: params.storeName,
  });

  const tried = new Set<string>();
  const tokens: Array<{ token: string; channelKey: LineChannelKey | null }> = [];

  if (line.token) tokens.push({ token: line.token, channelKey: line.channelKey });

  const storeKey = lineChannelKeyForStoreName(params.storeName);
  const storeToken = storeKey ? lineAccessTokenForChannelKey(storeKey) : null;
  if (storeToken) tokens.push({ token: storeToken, channelKey: storeKey });

  if (!normalizeLineChannelKey(params.lineChannelKey)) {
    const defaultToken = lineAccessTokenForChannelKey("default");
    if (defaultToken) tokens.push({ token: defaultToken, channelKey: "default" });
  }

  for (const { token } of tokens) {
    if (tried.has(token)) continue;
    tried.add(token);
    const reachable = await lineMemberProfileReachable(token, params.lineUserId);
    if (!reachable) continue;
    const sent = await linePushMessages(token, params.lineUserId, [flex]);
    if (sent) return true;
  }

  console.error("LINE token missing or push failed for next booking", {
    storeName: params.storeName,
    memberCode: params.memberCode,
    lineChannelSource: line.source,
    lineChannelKey: line.channelKey,
  });
  return false;
}
