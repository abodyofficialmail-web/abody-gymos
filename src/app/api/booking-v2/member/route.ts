import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database";
import { jsonResponse } from "../_cors";
import { pickBookableMember } from "@/lib/memberMembershipStatus";
import {
  fetchTrainerVisibilityPassForMemberId,
  isTrainerVisibilityTestAccount,
  trainerVisibilityPassPriceLabel,
} from "@/lib/trainerVisibilityPass";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const querySchema = z.object({
  email: z.string().min(1, "email は必須です").email("メールアドレスの形式が不正です"),
  store_id: z.string().uuid().optional(),
});

type MemberRow = {
  id: string;
  member_code: string;
  name: string | null;
  is_active: boolean | null;
  membership_status?: string | null;
  store_id?: string | null;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const storeIdRaw = url.searchParams.get("store_id");
    const parsed = querySchema.safeParse({
      email: url.searchParams.get("email"),
      store_id: storeIdRaw && storeIdRaw.trim() ? storeIdRaw.trim() : undefined,
    });
    if (!parsed.success) {
      return jsonResponse({ error: "クエリが不正です", detail: parsed.error.flatten() }, 400);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        {
          error:
            "サーバー設定が不足しています。NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。",
        },
        500
      );
    }

    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const email = parsed.data.email.trim();
    const selectWithStatus = "id, member_code, name, is_active, membership_status, store_id";
    const selectLegacy = "id, member_code, name, is_active, store_id";
    const first = await supabase.from("members").select(selectWithStatus).ilike("email", email).limit(10);
    let rows: MemberRow[] = [];
    let error = first.error;
    if (error && /membership_status/i.test(error.message ?? "")) {
      const retry = await supabase.from("members").select(selectLegacy).ilike("email", email).limit(10);
      rows = (retry.data ?? []) as MemberRow[];
      error = retry.error;
    } else {
      rows = (first.data ?? []) as MemberRow[];
    }

    if (error) {
      return jsonResponse({ error: "会員の取得に失敗しました", detail: error.message }, 500);
    }

    const member = pickBookableMember(rows, parsed.data.store_id);
    if (!member) {
      return jsonResponse({ error: "会員が見つかりません" }, 404);
    }

    let trainerVisibilityPass = {
      active: false,
      status: "inactive",
      current_period_end: null as string | null,
      subscribe_url: null as string | null,
    };
    try {
      trainerVisibilityPass = await fetchTrainerVisibilityPassForMemberId(supabase, member.id, email);
    } catch (e) {
      console.error("trainer visibility pass lookup failed", e);
    }
    if (!trainerVisibilityPass.active && isTrainerVisibilityTestAccount(email, member.member_code)) {
      trainerVisibilityPass = { active: true, status: "test", current_period_end: null, subscribe_url: null };
    }

    return jsonResponse(
      {
        member: {
          id: member.id,
          member_code: member.member_code,
          name: member.name ?? "",
        },
        trainer_visibility_pass: {
          ...trainerVisibilityPass,
          price_label: trainerVisibilityPassPriceLabel(),
        },
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "会員の取得中にエラーが発生しました", detail: message }, 500);
  }
}
