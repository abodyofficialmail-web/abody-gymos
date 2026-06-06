import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function signingSecret(): string | null {
  const s =
    process.env.SESSION_SURVEY_SIGN_SECRET?.trim() ||
    process.env.TRAINER_GATE_SECRET?.trim() ||
    "";
  return s || null;
}

export type SessionSurveySignedPayload = {
  member_id: string;
  trainer_id: string;
  store_id: string;
  session_date: string;
  client_note_id?: string | null;
  exp: number;
};

function canonical(p: SessionSurveySignedPayload): string {
  return [p.member_id, p.trainer_id, p.store_id, p.session_date, p.client_note_id ?? "", String(p.exp)].join("|");
}

export function signSessionSurveyPayload(
  payload: Omit<SessionSurveySignedPayload, "exp"> & { exp?: number }
): { s: string; sig: string } | null {
  const secret = signingSecret();
  if (!secret) return null;
  const full: SessionSurveySignedPayload = {
    ...payload,
    client_note_id: payload.client_note_id ?? null,
    exp: payload.exp ?? Date.now() + DEFAULT_TTL_MS,
  };
  const s = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(canonical(full)).digest("base64url");
  return { s, sig };
}

export function verifySessionSurveySigned(s: string, sig: string): SessionSurveySignedPayload | null {
  const secret = signingSecret();
  if (!secret || !s || !sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as SessionSurveySignedPayload;
    if (!payload?.member_id || !payload?.trainer_id || !payload?.store_id || !payload?.session_date) return null;
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

export function sessionSurveySignedQuery(params: Omit<SessionSurveySignedPayload, "exp">): string {
  const signed = signSessionSurveyPayload(params);
  if (!signed) return "";
  return `s=${encodeURIComponent(signed.s)}&sig=${encodeURIComponent(signed.sig)}`;
}
