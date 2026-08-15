export const TRAINER_LINE_SESSION_PREFIX = "TRN:";
export const TRAINER_LINE_DEMO_NAME = "デモトレーナー";

export function isTrainerLineSessionCode(code: string | null | undefined): boolean {
  return Boolean(code && code.startsWith(TRAINER_LINE_SESSION_PREFIX));
}

export function trainerSessionCode(trainerId: string): string {
  return `${TRAINER_LINE_SESSION_PREFIX}${trainerId}`;
}

export function trainerIdFromSessionCode(code: string): string | null {
  if (!isTrainerLineSessionCode(code)) return null;
  const id = code.slice(TRAINER_LINE_SESSION_PREFIX.length).trim();
  return id || null;
}

export function normalizeTrainerName(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/[\s　]+/g, "").toLowerCase();
}

export function parseTrainerLinkCommand(
  raw: string
): { kind: "need_name" } | { kind: "name"; name: string } | null {
  const t = raw.normalize("NFKC").trim();
  const m = t.match(/^トレーナー[\s　]*(.*)$/u);
  if (!m) return null;
  const name = (m[1] ?? "").trim();
  if (!name) return { kind: "need_name" };
  return { kind: "name", name };
}
