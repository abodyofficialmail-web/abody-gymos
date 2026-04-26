import crypto from "crypto";

const COOKIE_NAME = "trainer_gate";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

export function trainerGateCookieName() {
  return COOKIE_NAME;
}

export function parseTrainerPayrollPasswordsEnv(): Record<string, string> {
  const raw = process.env.TRAINER_PAYROLL_PASSWORDS;
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const name = String(k ?? "").trim();
      const pass = String(v ?? "").trim();
      if (name && pass) out[name] = pass;
    }
    return out;
  } catch {
    return {};
  }
}

export function isProtectedTrainerName(displayName: string): boolean {
  const map = parseTrainerPayrollPasswordsEnv();
  return Boolean(map[String(displayName ?? "").trim()]);
}

export function verifyTrainerPassword(displayName: string, password: string): boolean {
  const map = parseTrainerPayrollPasswordsEnv();
  const expected = map[String(displayName ?? "").trim()];
  if (!expected) return false;
  return String(password ?? "") === expected;
}

function base64url(input: Buffer | string) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function hmac(secret: string, data: string) {
  return base64url(crypto.createHmac("sha256", secret).update(data).digest());
}

export function issueTrainerGateToken(trainerId: string): string {
  const secret = process.env.TRAINER_GATE_SECRET;
  if (!secret) throw new Error("TRAINER_GATE_SECRET is not set");
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${trainerId}.${exp}`;
  const sig = hmac(secret, payload);
  return `${base64url(payload)}.${sig}`;
}

export function verifyTrainerGateToken(token: string | undefined | null, trainerId: string): boolean {
  if (!token) return false;
  const secret = process.env.TRAINER_GATE_SECRET;
  if (!secret) return false;
  const parts = String(token).split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  let payload: string;
  try {
    payload = Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return false;
  }
  const [tid, expStr] = payload.split(".");
  if (tid !== trainerId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expectedSig = hmac(secret, payload);
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
}

