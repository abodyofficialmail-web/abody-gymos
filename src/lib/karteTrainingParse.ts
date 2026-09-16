export const MEMBER_TRAINING_NOTE_HEADING = "【会員トレーニング記録】";

export type ParsedTrainingKind = "gym" | "self" | "cardio" | "rest";
export type ParsedTrainingCondition = "good" | "normal" | "hard";

export type ParsedTrainingLog = {
  id: string;
  log_date: string;
  kind: ParsedTrainingKind;
  parts: string[];
  duration_min: number | null;
  condition: ParsedTrainingCondition | null;
  note: string | null;
  source?: "app" | "karte";
};

const PART_IDS = new Set(["脚", "背中", "胸", "肩", "腕", "腹筋", "ピラティス", "有酸素"]);

const KIND_LABEL: Record<ParsedTrainingKind, string> = {
  gym: "パーソナル",
  self: "自主トレ",
  cardio: "有酸素",
  rest: "休養",
};

const CONDITION_LABEL: Record<ParsedTrainingCondition, string> = {
  good: "良い",
  normal: "普通",
  hard: "きつい",
};

const KINDS = new Set<string>(Object.keys(KIND_LABEL));
const CONDITIONS = new Set<string>(Object.keys(CONDITION_LABEL));

function parseParts(raw: string[]) {
  return [...new Set(raw.map((x) => x.trim()).filter((x) => PART_IDS.has(x)))];
}

function labelToKind(raw: string): ParsedTrainingKind | null {
  const t = raw.trim();
  if (KINDS.has(t)) return t as ParsedTrainingKind;
  const found = (Object.entries(KIND_LABEL) as Array<[ParsedTrainingKind, string]>).find(([, label]) => label === t);
  return found?.[0] ?? null;
}

function labelToCondition(raw: string): ParsedTrainingCondition | null {
  const t = raw.trim();
  if (CONDITIONS.has(t)) return t as ParsedTrainingCondition;
  if (t === "良い") return "good";
  if (t === "普通") return "normal";
  if (t === "きつい" || t === "やや不調" || t === "不調") return "hard";
  return null;
}

function valueAfter(label: string, content: string) {
  const re = new RegExp(`^${label}\\s*[:：]\\s*(.+)$`, "m");
  const m = content.match(re);
  return m?.[1]?.trim() ?? "";
}

export function formatMemberTrainingNote(log: {
  kind: ParsedTrainingKind;
  parts: string[];
  duration_min: number | null;
  condition: ParsedTrainingCondition | null;
  note: string | null;
}) {
  const lines = [
    MEMBER_TRAINING_NOTE_HEADING,
    `種類: ${KIND_LABEL[log.kind]}`,
    `部位: ${log.parts.length ? log.parts.join(" / ") : "-"}`,
  ];
  if (log.duration_min != null) lines.push(`時間: ${log.duration_min}分`);
  if (log.condition) lines.push(`調子: ${CONDITION_LABEL[log.condition]}`);
  if (log.note?.trim()) lines.push(`メモ: ${log.note.trim()}`);
  return lines.join("\n");
}

export function isMemberTrainingNote(content: string) {
  return content.trim().startsWith(MEMBER_TRAINING_NOTE_HEADING);
}

export function parseMemberTrainingNote(
  content: string,
  meta: { id: string; log_date: string }
): ParsedTrainingLog | null {
  if (!isMemberTrainingNote(content)) return null;
  const kind = labelToKind(valueAfter("種類", content));
  if (!kind) return null;
  const partsRaw = valueAfter("部位", content);
  const parts = parseParts(partsRaw && partsRaw !== "-" ? partsRaw.split(/[\/／,、]/).map((x) => x.trim()) : []);
  const durationMatch = valueAfter("時間", content).match(/(\d+)/);
  const duration_min = durationMatch ? Number(durationMatch[1]) : null;
  const condition = labelToCondition(valueAfter("調子", content));
  const note = valueAfter("メモ", content) || null;
  return {
    id: meta.id,
    log_date: meta.log_date,
    kind,
    parts: kind === "rest" ? [] : parts,
    duration_min: kind === "rest" || duration_min == null || !Number.isFinite(duration_min) ? null : duration_min,
    condition,
    note,
    source: "app",
  };
}

export function parseKarteSessionTraining(
  content: string,
  meta: { id: string; log_date: string }
): ParsedTrainingLog | null {
  if (isMemberTrainingNote(content)) return null;
  if (!content.includes("【本日のトレーニング内容】") && !/部位\s*[:：]/.test(content)) return null;
  const partsRaw = valueAfter("部位", content);
  const parts = parseParts(partsRaw && partsRaw !== "-" ? partsRaw.split(/[\/／,、]/).map((x) => x.trim()) : []);
  const conditionBlock = content.match(/【今日の体調】\s*\n([^\n【]+)/);
  const condition = labelToCondition((conditionBlock?.[1] ?? "").trim());
  const menuBlock = content.match(/【本日のメニュー】\s*\n([\s\S]*?)(?:\n【|$)/);
  const menuLines = (menuBlock?.[1] ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x && x !== "-");
  const conceptBlock = content.match(/【トレーニングコンセプト】\s*\n([^\n【]+)/);
  const noteParts = [conceptBlock?.[1]?.trim(), menuLines.slice(0, 6).join(" ")].filter(Boolean);
  const note = noteParts.length ? noteParts.join(" / ").slice(0, 180) : null;
  if (parts.length === 0 && !note && !condition) return null;
  return {
    id: `karte:${meta.id}`,
    log_date: meta.log_date,
    kind: "gym",
    parts,
    duration_min: null,
    condition,
    note,
    source: "karte",
  };
}

export function parseTrainingFromClientNote(
  content: string,
  meta: { id: string; log_date: string }
): ParsedTrainingLog | null {
  return parseMemberTrainingNote(content, meta) ?? parseKarteSessionTraining(content, meta);
}

export function mergeTrainingLogs(tableLogs: ParsedTrainingLog[], noteLogs: ParsedTrainingLog[]): ParsedTrainingLog[] {
  const byKey = new Map<string, ParsedTrainingLog>();
  for (const log of tableLogs) {
    byKey.set(`${log.log_date}|${log.kind}`, { ...log, source: log.source ?? "app" });
  }
  const memberNotes = noteLogs.filter((log) => log.source !== "karte");
  const karteNotes = noteLogs.filter((log) => log.source === "karte");
  for (const log of [...memberNotes, ...karteNotes]) {
    const key = `${log.log_date}|${log.kind}`;
    if (byKey.has(key)) continue;
    byKey.set(key, log);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.log_date === b.log_date) {
      if (a.kind === "gym") return -1;
      if (b.kind === "gym") return 1;
      return a.kind.localeCompare(b.kind);
    }
    return a.log_date < b.log_date ? 1 : -1;
  });
}
