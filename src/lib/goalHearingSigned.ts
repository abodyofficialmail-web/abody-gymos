import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signingSecret(): string | null {
  const s =
    process.env.GOAL_HEARING_SIGN_SECRET?.trim() ||
    process.env.PRE_SESSION_SURVEY_SIGN_SECRET?.trim() ||
    process.env.SESSION_SURVEY_SIGN_SECRET?.trim() ||
    process.env.TRAINER_GATE_SECRET?.trim() ||
    "";
  return s || null;
}

export type GoalHearingSignedPayload = {
  member_id: string;
  invite_id?: string | null;
  exp: number;
};

function canonical(p: GoalHearingSignedPayload): string {
  return [p.member_id, p.invite_id ?? "", String(p.exp)].join("|");
}

export function signGoalHearingPayload(
  payload: Omit<GoalHearingSignedPayload, "exp"> & { exp?: number }
): { s: string; sig: string } | null {
  const secret = signingSecret();
  if (!secret) return null;
  const full: GoalHearingSignedPayload = {
    member_id: payload.member_id,
    invite_id: payload.invite_id ?? null,
    exp: payload.exp ?? Date.now() + DEFAULT_TTL_MS,
  };
  const s = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(canonical(full)).digest("base64url");
  return { s, sig };
}

export function verifyGoalHearingSigned(s: string, sig: string): GoalHearingSignedPayload | null {
  const secret = signingSecret();
  if (!secret || !s || !sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as GoalHearingSignedPayload;
    if (!payload?.member_id) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    const expected = createHmac("sha256", secret).update(canonical(payload)).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function goalHearingSignedQuery(params: Omit<GoalHearingSignedPayload, "exp">): string {
  const signed = signGoalHearingPayload(params);
  if (!signed) return "";
  return `s=${encodeURIComponent(signed.s)}&sig=${encodeURIComponent(signed.sig)}`;
}

export function goalHearingPageUrl(appUrl: string, params: Omit<GoalHearingSignedPayload, "exp">): string {
  const q = goalHearingSignedQuery(params);
  const base = appUrl.replace(/\/$/, "");
  return q ? `${base}/goal-hearing?${q}` : `${base}/goal-hearing`;
}

export function tokenKeyFromSigned(payload: GoalHearingSignedPayload): string {
  return payload.invite_id || `m_${payload.member_id.slice(0, 8)}_${payload.exp}`;
}
