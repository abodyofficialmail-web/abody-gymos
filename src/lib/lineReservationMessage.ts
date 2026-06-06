import { DateTime } from "luxon";
import { storeVisitAddressText } from "@/lib/storeAddresses";

const TZ = "Asia/Tokyo";

export function formatReservationAddressBlock(params: {
  storeName: string;
  sessionType: "store" | "online";
}): string {
  if (params.sessionType === "online") return "";
  const address = storeVisitAddressText(params.storeName);
  if (!address) return "";
  return `
📍住所
${address}
`.trim();
}

export function lineMessageWithReservationDetails(params: {
  storeName: string;
  startAtUtcIso: string;
  endAtUtcIso: string;
  sessionType: "store" | "online";
}): string {
  const { storeName, startAtUtcIso, endAtUtcIso, sessionType } = params;
  const start = DateTime.fromISO(startAtUtcIso).setZone(TZ);
  const end = DateTime.fromISO(endAtUtcIso).setZone(TZ);

  const formattedDate = start.setLocale("ja").toFormat("M月d日（ccc）");
  const formattedTime = `${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}`;
  const sessionLabel = sessionType === "online" ? "オンライン" : "店舗";
  const addressBlock = formatReservationAddressBlock({ storeName, sessionType });

  return `
【ご予約確定】
店舗：${storeName}
日時：${formattedDate} ${formattedTime}

セッション種別：${sessionLabel}

${addressBlock ? `${addressBlock}\n\n` : ""}※当日でも店舗⇄オンラインの変更が可能です。
ご希望の場合はLINEでご連絡ください。

当日は動きやすい服装でお越しください！
更衣室もございます☺️

当日のトレーニング楽しみにお待ちしております！
`.trim();
}
