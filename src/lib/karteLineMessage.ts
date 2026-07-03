import { DateTime } from "luxon";

const TZ = "Asia/Tokyo";

function sectionBody(content: string, heading: string): string {
  const re = new RegExp(`【${heading}】\\n([\\s\\S]*?)(?=\\n【|$)`);
  const m = content.match(re);
  return (m?.[1] ?? "").trim();
}

/** 保存済みカルテ本文から会員向けLINE文面を組み立てる（管理画面の buildLineMessage に近い形式） */
export function karteLineMessageFromNote(params: {
  memberName?: string | null;
  memberCode?: string | null;
  storeName?: string | null;
  dateYmd: string;
  content: string;
}): string {
  const content = String(params.content ?? "").trim();
  const memberName = String(params.memberName ?? "").trim();
  const memberCode = String(params.memberCode ?? "").trim();
  const storeName = String(params.storeName ?? "").trim();
  const honor = memberName ? `${memberName}様` : memberCode ? `${memberCode}様` : "会員様";
  const dateLabel = DateTime.fromISO(params.dateYmd, { zone: TZ }).setLocale("ja").toFormat("yyyy年M月d日");

  const training = sectionBody(content, "本日のトレーニング内容");
  const menu = sectionBody(content, "本日のメニュー");
  const stretch = sectionBody(content, "ストレッチ");
  const feedback = sectionBody(content, "トレーナーからのフィードバック");

  const lines: string[] = [
    honor,
    "",
    "本日もトレーニングお疲れさまでした！",
    "",
    `実施日：${dateLabel}`,
  ];
  if (storeName) lines.push(`店舗：${storeName}店`);
  if (training) {
    lines.push("", "【本日のトレーニング内容】", training);
  }
  if (menu) {
    lines.push("", "【本日のメニュー】", menu);
  }
  if (stretch) {
    lines.push("", "【ストレッチ】", stretch);
  }
  if (feedback) {
    lines.push("", "【トレーナーからのフィードバック】", feedback);
  }
  lines.push("", "※ご不明点があれば、いつでも気軽にLINEでご連絡ください！");
  if (storeName) lines.push("", `Abody ${storeName}店`);
  return lines.join("\n").trim();
}
