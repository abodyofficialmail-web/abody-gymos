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

export type MemberMealLogSignedPayload = {
  member_id: string;
  kind: "meal_log";
  slot?: string;
  exp: number;
};

function canonical(p: MemberMealLogSignedPayload): string {
  return [p.kind, p.member_id, p.slot ?? "", String(p.exp)].join("|");
}

export function signMemberMealLogPayload(
  payload: Omit<MemberMealLogSignedPayload, "exp" | "kind"> & { exp?: number }
): { s: string; sig: string } | null {
  const secret = signingSecret();
  if (!secret) return null;
  const full: MemberMealLogSignedPayload = {
    kind: "meal_log",
    member_id: payload.member_id,
    slot: payload.slot,
    exp: payload.exp ?? Date.now() + DEFAULT_TTL_MS,
  };
  const s = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(canonical(full)).digest("base64url");
  return { s, sig };
}

export function verifyMemberMealLogSigned(s: string, sig: string): MemberMealLogSignedPayload | null {
  const secret = signingSecret();
  if (!secret || !s || !sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as MemberMealLogSignedPayload;
    if (payload?.kind !== "meal_log" || !payload.member_id) return null;
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

export function memberMealLogPageUrl(appUrl: string, memberId: string, slot?: string): string {
  const signed = signMemberMealLogPayload({ member_id: memberId, slot });
  const base = (appUrl || getAppUrl()).replace(/\/$/, "");
  if (!signed) return `${base}/meal-log`;
  const slotQ = slot ? `&slot=${encodeURIComponent(slot)}` : "";
  return `${base}/meal-log?s=${encodeURIComponent(signed.s)}&sig=${encodeURIComponent(signed.sig)}${slotQ}`;
}
