import { z } from "zod";
import { memberCodePrefixForStoreName, nextMemberCodeForStore, registerMember } from "@/lib/memberRegistration";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { campaignNeedsReferrer, ENROLLMENT_BONUS_KOMA_OPTIONS, YMD_RE } from "@/lib/memberEnrollment";
import { ENROLLMENT_COURSE_PLANS } from "@/lib/memberPlans";

const createMemberSchema = z.object({
  store_id: z.string().uuid(),
  name: z.string().trim().min(1, "氏名を入力してください"),
  email: z.string().trim().min(1, "メールアドレスを入力してください").email("メールアドレスの形式が正しくありません"),
  joined_at: z.string().regex(YMD_RE, "入会日は YYYY-MM-DD 形式で入力してください"),
  min_commitment_months: z.number().int().min(0).nullable(),
  has_enrollment_fee: z.boolean(),
  enrollment_campaign: z.string().trim().min(1, "入会キャンペーンを入力してください").max(80),
  membership_plan: z.enum(ENROLLMENT_COURSE_PLANS),
  enrollment_bonus_koma: z
    .number()
    .int()
    .refine((n) => (ENROLLMENT_BONUS_KOMA_OPTIONS as readonly number[]).includes(n), "入会特典はなし、または4〜8コマから選んでください")
    .optional()
    .nullable(),
  referrer_member_id: z.string().uuid().nullable().optional(),
  has_changing_clothes_plan: z.boolean(),
  has_meal_personal: z.boolean(),
}).superRefine((data, ctx) => {
  if (campaignNeedsReferrer(data.enrollment_campaign) && !data.referrer_member_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "紹介者を選択してください",
      path: ["referrer_member_id"],
    });
  }
});

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET(request: Request) {
  try {
    const storeId = new URL(request.url).searchParams.get("store_id")?.trim();
    if (!storeId) {
      return jsonResponse({ error: "店舗を指定してください" }, 400);
    }

    const supabase = createSupabaseServiceClient();
    const { data: store, error: storeErr } = await supabase.from("stores").select("id, name").eq("id", storeId).maybeSingle();
    if (storeErr) return jsonResponse({ error: storeErr.message }, 400);
    if (!store) return jsonResponse({ error: "店舗が見つかりません" }, 404);

    const prefix = memberCodePrefixForStoreName(store.name);
    if (!prefix) {
      return jsonResponse({ error: `未対応の店舗です: ${store.name}` }, 400);
    }

    const next_member_code = await nextMemberCodeForStore(supabase, store.name);
    return jsonResponse({
      store_id: store.id,
      store_name: store.name,
      prefix,
      next_member_code,
    });
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message ?? e) }, 400);
  }
}

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = createMemberSchema.safeParse(json);
    if (!parsed.success) {
      return jsonResponse({ error: parsed.error.flatten() }, 400);
    }

    const supabase = createSupabaseServiceClient();
    const member = await registerMember(supabase, parsed.data);
    return jsonResponse({ member });
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message ?? e) }, 400);
  }
}
