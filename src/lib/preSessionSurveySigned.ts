import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function signingSecret(): string | null {
  const s =
    process.env.PRE_SESSION_SURVEY_SIGN_SECRET?.trim() ||
    process.env.SESSION_SURVEY_SIGN_SECRET?.trim() ||
    process.env.TRAINER_GATE_SECRET?.trim() ||
    "";
  return s || null;
}

export type PreSessionSurveySignedPayload = {
  reservation_id: string;
  member_id: string;
  exp: number;
};

function canonical(p: PreSessionSurveySignedPayload): string {
  return [p.reservation_id, p.member_id, String(p.exp)].join("|");
}

export function signPreSessionSurveyPayload(
  payload: Omit<PreSessionSurveySignedPayload, "exp"> & { exp?: number }
): { s: string; sig: string } | null {
  const secret = signingSecret();
  if (!secret) return null;
  const full: PreSessionSurveySignedPayload = {
    ...payload,
    exp: payload.exp ?? Date.now() + DEFAULT_TTL_MS,
  };
  const s = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(canonical(full)).digest("base64url");
  return { s, sig };
}

export function verifyPreSessionSurveySigned(s: string, sig: string): PreSessionSurveySignedPayload | null {
  const secret = signingSecret();
  if (!secret || !s || !sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as PreSessionSurveySignedPayload;
    if (!payload?.reservation_id || !payload?.member_id) return null;
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

export function preSessionSurveySignedQuery(params: Omit<PreSessionSurveySignedPayload, "exp">): string {
  const signed = signPreSessionSurveyPayload(params);
  if (!signed) return "";
  return `s=${encodeURIComponent(signed.s)}&sig=${encodeURIComponent(signed.sig)}`;
}
