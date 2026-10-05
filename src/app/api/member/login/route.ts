import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { setMemberIdCookie } from "../_cookies";
import { canBookOrLogin } from "@/lib/memberMembershipStatus";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type LoginMember = {
  id: string;
  is_active?: boolean | null;
  membership_status?: string | null;
  email?: string | null;
};

async function findLoginMember(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  params: { member_code: string; email: string }
): Promise<LoginMember | "multiple" | "error" | null> {
  if (params.member_code) {
    let { data: member, error } = await (supabase as any)
      .from("members")
      .select("id, is_active, membership_status, email")
      .eq("member_code", params.member_code)
      .maybeSingle();
    if (error && /membership_status/i.test(String(error.message ?? ""))) {
      const retry = await (supabase as any)
        .from("members")
        .select("id, is_active, email")
        .eq("member_code", params.member_code)
        .maybeSingle();
      member = retry.data;
      error = retry.error;
    }
    if (error) return "error";
    return (member as LoginMember | null) ?? null;
  }

  const normalized = params.email.toLowerCase();
  const pattern = normalized.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  const { data, error } = await (supabase as any)
    .from("members")
    .select("id, is_active, membership_status, email")
    .ilike("email", pattern)
    .limit(5);
  if (error) return "error";
  const matches = ((data ?? []) as LoginMember[]).filter(
    (row) => String(row.email ?? "").trim().toLowerCase() === normalized
  );
  if (matches.length > 1) return "multiple";
  return matches[0] ?? null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = z
      .object({
        member_code: z.string().optional(),
        email: z.string().optional(),
      })
      .safeParse(body);
    if (!parsed.success) return json({ error: "リクエストが不正です", detail: parsed.error.flatten() }, 400);

    const member_code = String(parsed.data.member_code ?? "").trim().toUpperCase();
    const email = String(parsed.data.email ?? "").trim();
    if (!member_code && !email) return json({ error: "会員番号かメールアドレスを入力してください" }, 400);
    if (member_code && !/^[A-Z]{2,3}\d{3}$/u.test(member_code)) return json({ error: "会員番号の形式が不正です" }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return json({ error: "メールアドレスの形式が不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    const member = await findLoginMember(supabase, { member_code, email });
    if (member === "multiple") {
      return json({ error: "同じメールアドレスの会員が複数います。会員番号でログインしてください" }, 409);
    }
    if (member === "error") return json({ error: "照会に失敗しました" }, 500);
    if (!member || !canBookOrLogin({ membershipStatus: member.membership_status, isActive: member.is_active })) {
      return json({ error: "ログインに失敗しました" }, 401);
    }
    if (member_code && email) {
      const dbEmail = String(member.email ?? "").trim();
      if (!dbEmail || dbEmail.toLowerCase() !== email.toLowerCase()) return json({ error: "ログインに失敗しました" }, 401);
    }

    setMemberIdCookie(member.id);
    return json({ ok: true, member_id: member.id }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "エラーが発生しました", detail: message }, 500);
  }
}

