import { createHmac, timingSafeEqual } from "crypto";
import { getAppUrl } from "@/lib/constants";

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function signingSecret(): string | null {
  const s =
    process.env.GOAL_HEARING_SIGN_SECRET?.trim() ||
    process.env.PRE_SESSION_SURVEY_SIGN_SECRET?.trim() ||
    process.env.SESSION_SURVEY_SIGN_SECRET?.trim() ||
    process.env.TRAINER_GATE_SECRET?.trim() ||
    "";
  return s || null;
}

export type MemberWeightLogSignedPayload = {
  member_id: string;
  kind: "weight_log";
  exp: number;
};

function canonical(p: MemberWeightLogSignedPayload): string {
  return [p.kind, p.member_id, String(p.exp)].join("|");
}

export function signMemberWeightLogPayload(
  payload: Omit<MemberWeightLogSignedPayload, "exp" | "kind"> & { exp?: number }
): { s: string; sig: string } | null {
  const secret = signingSecret();
  if (!secret) return null;
  const full: MemberWeightLogSignedPayload = {
    kind: "weight_log",
    member_id: payload.member_id,
    exp: payload.exp ?? Date.now() + DEFAULT_TTL_MS,
  };
  const s = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(canonical(full)).digest("base64url");
  return { s, sig };
}

export function verifyMemberWeightLogSigned(s: string, sig: string): MemberWeightLogSignedPayload | null {
  const secret = signingSecret();
  if (!secret || !s || !sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as MemberWeightLogSignedPayload;
    if (payload?.kind !== "weight_log" || !payload.member_id) return null;
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

export function memberWeightLogPageUrl(appUrl: string, memberId: string): string {
  const signed = signMemberWeightLogPayload({ member_id: memberId });
  const base = (appUrl || getAppUrl()).replace(/\/$/, "");
  if (!signed) return `${base}/member?tab=weight`;
  return `${base}/weight-log?s=${encodeURIComponent(signed.s)}&sig=${encodeURIComponent(signed.sig)}`;
}
