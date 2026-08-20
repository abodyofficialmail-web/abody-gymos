import { getAppUrl } from "@/lib/constants";
import {
  lineAccessTokenForChannelKey,
  lineChannelKeyForStoreName,
  lineMemberProfileReachable,
  linePushTokenForMember,
  normalizeLineChannelKey,
  type LineChannelKey,
} from "@/lib/lineChannel";
import {
  nextBookingTargetCopy,
  type NextBookingOffer,
  type SuggestedBookingSlot,
} from "@/lib/sessionSurveyNextBooking";

/** Flex carousel の上限は 12。枠カード + 末尾の「他の時間」用に残す */
const SLOT_CARDS_MAX = 10;

export function nextBookingPageUrl(query: string): string {
  const q = query.startsWith("?") ? query.slice(1) : query;
  return `${getAppUrl()}/next-booking?${q}`;
}

export function nextBookingPageUrlFromInviteToken(inviteToken: string): string {
  return nextBookingPageUrl(`token=${encodeURIComponent(inviteToken)}`);
}

export function nextBookingPageUrlForSlot(
  inviteToken: string,
  slot: Pick<SuggestedBookingSlot, "start_at" | "end_at">
): string {
  return nextBookingPageUrl(
    new URLSearchParams({
      token: inviteToken,
      start_at: slot.start_at,
      end_at: slot.end_at,
    }).toString()
  );
}

function absoluteAppPath(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${getAppUrl()}${path}`;
}

function slotBubble(params: {
  storeName: string;
  slot: SuggestedBookingSlot;
  bookingUrl: string;
}): object {
  return {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#059669",
      paddingAll: "16px",
      contents: [
        {
          type: "text",
          text: params.storeName,
          size: "xs",
          color: "#d1fae5",
        },
        {
          type: "text",
          text: params.slot.date_label,
          weight: "bold",
          size: "lg",
          color: "#ffffff",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      contents: [
        {
          type: "text",
          text: params.slot.time_label,
          weight: "bold",
          size: "xl",
          color: "#065f46",
        },
        {
          type: "text",
          text: params.slot.match_label || "空き枠",
          size: "xs",
          color: "#64748b",
          wrap: true,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "12px",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#059669",
          height: "sm",
          action: {
            type: "uri",
            label: "この枠で予約する",
            uri: params.bookingUrl,
          },
        },
      ],
    },
  };
}

function otherTimesBubble(bookingSiteUrl: string): object {
  return {
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      contents: [
        {
          type: "text",
          text: "他の時間がいい場合",
          weight: "bold",
          size: "md",
          color: "#0f172a",
          wrap: true,
        },
        {
          type: "text",
          text: "予約サイトから日時を選べます。",
          size: "sm",
          color: "#64748b",
          wrap: true,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: {
            type: "uri",
            label: "予約サイトを開く",
            uri: bookingSiteUrl,
          },
        },
      ],
    },
  };
}

function emptySlotsBubble(params: { bookingUrl: string; copy: string }): object {
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "次回のご予約",
          weight: "bold",
          size: "lg",
          color: "#065f46",
        },
        {
          type: "text",
          text: `${params.copy}\nいま希望時間の空きが見つかりませんでした。`,
          wrap: true,
          size: "sm",
          color: "#334155",
        },
        {
          type: "button",
          style: "primary",
          color: "#059669",
          height: "sm",
          action: {
            type: "uri",
            label: "予約サイトを開く",
            uri: params.bookingUrl,
          },
        },
      ],
    },
  };
}

export function buildNextBookingFlexMessage(params: {
  storeName: string;
  inviteToken: string;
  bookingUrl?: string;
  offer: NextBookingOffer;
}): object {
  const store = params.storeName.trim() || "店舗";
  const listUrl = params.bookingUrl ?? nextBookingPageUrlFromInviteToken(params.inviteToken);
  const slots = params.offer.slots.slice(0, SLOT_CARDS_MAX);

  if (!slots.length) {
    return {
      type: "flex",
      altText: "次回のご予約：いま希望時間の空きが見つかりませんでした",
      contents: emptySlotsBubble({
        bookingUrl: absoluteAppPath(params.offer.booking_url || "/booking"),
        copy: nextBookingTargetCopy(params.offer.monthly_average),
      }),
    };
  }

  const bubbles: object[] = slots.map((slot) =>
    slotBubble({
      storeName: store,
      slot,
      bookingUrl: nextBookingPageUrlForSlot(params.inviteToken, slot),
    })
  );
  bubbles.push(otherTimesBubble(absoluteAppPath(params.offer.booking_url || listUrl)));

  return {
    type: "flex",
    altText: "次回のご予約：カードを横にスライドして、通いやすい空き枠からこの場で確定できます",
    contents: {
      type: "carousel",
      contents: bubbles,
    },
  };
}

export function buildNextBookingLineMessages(params: {
  storeName: string;
  inviteToken: string;
  bookingUrl?: string;
  offer: NextBookingOffer;
}): object[] {
  const store = params.storeName.trim() || "店舗";
  const preferred = params.offer.preferred_labels.length
    ? `\n希望時間: ${params.offer.preferred_labels.join(" / ")}`
    : "";
  const intro =
    params.offer.slots.length > 0
      ? `${nextBookingTargetCopy(params.offer.this_month_count ?? params.offer.monthly_average)}\n${store}の空きです。カードを横にスライドして、希望の枠をお選びください。${preferred}`
      : `${nextBookingTargetCopy(params.offer.this_month_count ?? params.offer.monthly_average)}\n${store}の希望時間に、いま空きが見つかりませんでした。`;

  return [
    { type: "text", text: intro },
    buildNextBookingFlexMessage(params),
  ];
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
  inviteToken: string;
  bookingUrl?: string;
  offer: NextBookingOffer;
}): Promise<boolean> {
  const messages = buildNextBookingLineMessages({
    storeName: params.storeName,
    inviteToken: params.inviteToken,
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
    const sent = await linePushMessages(token, params.lineUserId, messages);
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
