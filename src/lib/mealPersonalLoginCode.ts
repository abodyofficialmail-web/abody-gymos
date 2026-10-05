import { createHash, randomInt, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { sendMealPersonalLoginCode } from "@/lib/email";
import { createMealPersonalAccount, findMemberByEmail } from "@/lib/mealPersonalAccount";
import { isMealPersonalStandaloneAccount } from "@/lib/memberMealPersonalRollout";

type Db = SupabaseClient<Database>;

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function issueMealPersonalLoginCode(
  supabase: Db,
  params: { email: string; displayName?: string | null }
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const email = params.email.trim().toLowerCase();
  const displayName = params.displayName?.trim() || null;
  const existing = await findMemberByEmail(supabase, email);
  if (existing === "error") return { ok: false, error: "メールアドレスの確認に失敗しました", status: 500 };
  if (existing === "multiple" || (existing && !isMealPersonalStandaloneAccount(existing.member_code))) {
    return {
      ok: false,
      error: "このメールアドレスはジムの会員に使われています。食事パーソナル用には別のアドレスを入れてください",
      status: 409,
    };
  }

  const recent = await (supabase as any)
    .from("meal_personal_login_codes")
    .select("created_at")
    .eq("email", email)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent.error && /meal_personal_login_codes|does not exist|schema cache/i.test(String(recent.error.message ?? ""))) {
    return { ok: false, error: "確認コードの準備ができていません", status: 503 };
  }
  const createdAt = Date.parse(String(recent.data?.created_at ?? ""));
  if (Number.isFinite(createdAt) && Date.now() - createdAt < RESEND_MS) {
    return { ok: true };
  }

  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const sent = await sendMealPersonalLoginCode({ to: email, code });
  if (!sent) return { ok: false, error: "確認コードのメールを送れませんでした", status: 503 };

  const { error } = await (supabase as any).from("meal_personal_login_codes").insert({
    email,
    code_hash: hashCode(code),
    display_name: displayName,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) return { ok: false, error: "確認コードを保存できませんでした", status: 500 };
  return { ok: true };
}

export async function verifyMealPersonalLoginCode(
  supabase: Db,
  params: { email: string; code: string }
): Promise<{ ok: true; memberId: string; memberCode: string } | { ok: false; error: string; status: number }> {
  const email = params.email.trim().toLowerCase();
  const code = params.code.trim();
  if (!/^\d{6}$/u.test(code)) return { ok: false, error: "確認コードは6桁です", status: 400 };

  const { data: row, error } = await (supabase as any)
    .from("meal_personal_login_codes")
    .select("id, code_hash, display_name, expires_at, used_at, attempts")
    .eq("email", email)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: "確認コードの確認に失敗しました", status: 500 };
  if (!row) return { ok: false, error: "確認コードが見つかりません。もう一度送ってください", status: 401 };
  if (Date.parse(String(row.expires_at)) < Date.now() || Number(row.attempts ?? 0) >= 5) {
    await (supabase as any).from("meal_personal_login_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: false, error: "確認コードの期限が切れました。もう一度送ってください", status: 401 };
  }
  if (!hashesEqual(hashCode(code), String(row.code_hash))) {
    const attempts = Number(row.attempts ?? 0) + 1;
    await (supabase as any)
      .from("meal_personal_login_codes")
      .update({ attempts, ...(attempts >= 5 ? { used_at: new Date().toISOString() } : {}) })
      .eq("id", row.id);
    return { ok: false, error: attempts >= 5 ? "確認コードを無効にしました。もう一度送ってください" : "確認コードが違います", status: 401 };
  }

  await (supabase as any).from("meal_personal_login_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id);

  const displayName = String(row.display_name ?? "").trim();
  const existing = await findMemberByEmail(supabase, email);
  if (existing === "error") return { ok: false, error: "アカウントの確認に失敗しました", status: 500 };
  if (existing === "multiple" || (existing && !isMealPersonalStandaloneAccount(existing.member_code))) {
    return { ok: false, error: "このメールアドレスでは食事パーソナルに入れません", status: 409 };
  }
  if (existing) {
    if (displayName) {
      await (supabase as any).from("members").update({ display_name: displayName, name: displayName }).eq("id", existing.id);
    }
    return { ok: true, memberId: existing.id, memberCode: existing.member_code };
  }
  if (!displayName) return { ok: false, error: "ニックネームを入れて、確認コードを送り直してください", status: 400 };
  const account = await createMealPersonalAccount(supabase, { displayName, email });
  return { ok: true, memberId: account.id, memberCode: account.member_code };
}
