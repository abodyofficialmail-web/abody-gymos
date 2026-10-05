import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import {
  isActiveFromMembershipStatus,
  MEMBERSHIP_STATUSES,
  resolveMembershipStatus,
  type MembershipStatus,
} from "@/lib/memberMembershipStatus";
import { campaignNeedsReferrer } from "@/lib/memberEnrollment";
import { notifyWithdrawalToOpsLine } from "@/lib/withdrawalLineNotify";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const bodySchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(254)
      .optional()
      .transform((v) => (v === "" ? null : v ?? null))
      .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "email が不正です" }),
    membership_status: z.enum(MEMBERSHIP_STATUSES).optional(),
    withdrawn_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, "退会日は YYYY-MM-DD 形式で入力してください")
      .optional()
      .nullable(),
    withdrawn_trainer_id: z.string().uuid("担当トレーナーを選択してください").optional().nullable(),
    hiatus_start_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, "休会開始日は YYYY-MM-DD 形式で入力してください")
      .optional()
      .nullable(),
    hiatus_end_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, "休会終了日は YYYY-MM-DD 形式で入力してください")
      .optional()
      .nullable(),
    joined_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, "入会日は YYYY-MM-DD 形式で入力してください")
      .optional()
      .nullable(),
    min_commitment_months: z.number().int().min(0).optional().nullable(),
    has_enrollment_fee: z.boolean().optional().nullable(),
    enrollment_campaign: z.string().max(80).optional().nullable(),
    referrer_member_id: z.string().uuid().nullable().optional(),
    has_changing_clothes_plan: z.boolean().nullable().optional(),
    has_meal_personal: z.boolean().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.membership_status === "withdrawn") {
      if (!data.withdrawn_at) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "退会日を入力してください", path: ["withdrawn_at"] });
      }
      if (!data.withdrawn_trainer_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "退会時担当トレーナーを選択してください",
          path: ["withdrawn_trainer_id"],
        });
      }
    }
    if (data.membership_status === "hiatus") {
      if (!data.hiatus_start_at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "休会開始日を入力してください",
          path: ["hiatus_start_at"],
        });
      }
      if (!data.hiatus_end_at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "休会終了日を入力してください",
          path: ["hiatus_end_at"],
        });
      }
      if (data.hiatus_start_at && data.hiatus_end_at && data.hiatus_start_at > data.hiatus_end_at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "休会終了日は開始日以降にしてください",
          path: ["hiatus_end_at"],
        });
      }
    }
  });

const memberSelect =
  "id, member_code, name, display_name, email, is_active, membership_status, withdrawn_at, withdrawn_trainer_id, hiatus_start_at, hiatus_end_at, joined_at, min_commitment_months, has_enrollment_fee, enrollment_campaign, referrer_member_id, has_changing_clothes_plan, has_meal_personal, line_user_id, store_id";

const memberSelectFallback =
  "id, member_code, name, display_name, email, is_active, membership_status, withdrawn_at, withdrawn_trainer_id, hiatus_start_at, hiatus_end_at, line_user_id, store_id";

const memberSelectBefore =
  "id, member_code, name, display_name, is_active, membership_status, store_id";

async function fetchTrainerName(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  trainerId: string | null | undefined
): Promise<string | null> {
  if (!trainerId) return null;
  const { data } = await supabase.from("trainers").select("display_name").eq("id", trainerId).maybeSingle();
  return data?.display_name ?? null;
}

async function selectMemberAfterUpdate(supabase: ReturnType<typeof createSupabaseServiceClient>, memberId: string) {
  const first = await (supabase as any).from("members").select(memberSelect).eq("id", memberId).maybeSingle();
  if (!first.error && first.data) return first.data as Record<string, unknown>;

  const msg = String(first.error?.message ?? "");
  if (
    msg.includes("joined_at") ||
    msg.includes("min_commitment") ||
    msg.includes("enrollment_") ||
    msg.includes("referrer_member_id") ||
    msg.includes("has_changing_clothes_plan") ||
    msg.includes("has_meal_personal")
  ) {
    const second = await (supabase as any)
      .from("members")
      .select(memberSelectFallback)
      .eq("id", memberId)
      .maybeSingle();
    if (!second.error && second.data) return second.data as Record<string, unknown>;
  }
  if (msg.includes("hiatus_")) {
    const second = await (supabase as any)
      .from("members")
      .select(memberSelectFallback)
      .eq("id", memberId)
      .maybeSingle();
    if (!second.error && second.data) return second.data as Record<string, unknown>;
  }
  if (msg.includes("withdrawn_") || msg.includes("hiatus_")) {
    const third = await (supabase as any)
      .from("members")
      .select("id, member_code, name, email, is_active, membership_status, line_user_id")
      .eq("id", memberId)
      .maybeSingle();
    return (third.data as Record<string, unknown> | null) ?? null;
  }

  const fallback = await (supabase as any).from("members").select(memberSelectFallback).eq("id", memberId).maybeSingle();
  return (fallback.data as Record<string, unknown> | null) ?? null;
}

async function mapMemberResponse(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  member: Record<string, unknown> | null
) {
  if (!member) return null;
  const withdrawnTrainerId = (member.withdrawn_trainer_id as string | null) ?? null;
  const withdrawnTrainerName = await fetchTrainerName(supabase, withdrawnTrainerId);
  return {
    id: member.id,
    member_code: member.member_code,
    name: member.name,
    email: member.email,
    is_active: member.is_active,
    membership_status: resolveMembershipStatus(
      member.membership_status as MembershipStatus | null | undefined,
      member.is_active !== false
    ),
    withdrawn_at: (member.withdrawn_at as string | null) ?? null,
    withdrawn_trainer_id: withdrawnTrainerId,
    withdrawn_trainer_name: withdrawnTrainerName,
    hiatus_start_at: (member.hiatus_start_at as string | null) ?? null,
    hiatus_end_at: (member.hiatus_end_at as string | null) ?? null,
    joined_at: (member.joined_at as string | null) ?? null,
    min_commitment_months:
      typeof member.min_commitment_months === "number" ? member.min_commitment_months : null,
    has_enrollment_fee: typeof member.has_enrollment_fee === "boolean" ? member.has_enrollment_fee : null,
    enrollment_campaign: (member.enrollment_campaign as string | null) ?? null,
    referrer_member_id: (member.referrer_member_id as string | null) ?? null,
    has_changing_clothes_plan:
      typeof member.has_changing_clothes_plan === "boolean" ? member.has_changing_clothes_plan : null,
    has_meal_personal: typeof member.has_meal_personal === "boolean" ? member.has_meal_personal : null,
    line_user_id: member.line_user_id,
  };
}

export async function PATCH(request: Request, ctx: { params: { memberId: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      const first =
        fieldErrors.joined_at?.[0] ??
        fieldErrors.min_commitment_months?.[0] ??
        fieldErrors.has_enrollment_fee?.[0] ??
        fieldErrors.enrollment_campaign?.[0] ??
        fieldErrors.referrer_member_id?.[0] ??
        fieldErrors.has_changing_clothes_plan?.[0] ??
        fieldErrors.has_meal_personal?.[0] ??
        fieldErrors.hiatus_start_at?.[0] ??
        fieldErrors.hiatus_end_at?.[0] ??
        fieldErrors.withdrawn_at?.[0] ??
        fieldErrors.withdrawn_trainer_id?.[0] ??
        fieldErrors.membership_status?.[0] ??
        fieldErrors.email?.[0];
      return jsonResponse({ error: first ?? "リクエストが不正です", detail: parsed.error.flatten() }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.email !== undefined) updates.email = parsed.data.email;

    if (parsed.data.membership_status !== undefined) {
      updates.membership_status = parsed.data.membership_status;
      updates.is_active = isActiveFromMembershipStatus(parsed.data.membership_status);

      if (parsed.data.membership_status === "withdrawn") {
        updates.withdrawn_at = parsed.data.withdrawn_at ?? null;
        updates.withdrawn_trainer_id = parsed.data.withdrawn_trainer_id ?? null;
        updates.hiatus_start_at = null;
        updates.hiatus_end_at = null;
      } else if (parsed.data.membership_status === "hiatus") {
        updates.hiatus_start_at = parsed.data.hiatus_start_at ?? null;
        updates.hiatus_end_at = parsed.data.hiatus_end_at ?? null;
        updates.withdrawn_at = null;
        updates.withdrawn_trainer_id = null;
      } else {
        updates.withdrawn_at = null;
        updates.withdrawn_trainer_id = null;
        updates.hiatus_start_at = null;
        updates.hiatus_end_at = null;
      }
    } else if (parsed.data.withdrawn_at !== undefined || parsed.data.withdrawn_trainer_id !== undefined) {
      updates.withdrawn_at = parsed.data.withdrawn_at ?? null;
      updates.withdrawn_trainer_id = parsed.data.withdrawn_trainer_id ?? null;
    } else if (parsed.data.hiatus_start_at !== undefined || parsed.data.hiatus_end_at !== undefined) {
      updates.hiatus_start_at = parsed.data.hiatus_start_at ?? null;
      updates.hiatus_end_at = parsed.data.hiatus_end_at ?? null;
    }

    if (parsed.data.joined_at !== undefined) updates.joined_at = parsed.data.joined_at ?? null;
    if (parsed.data.min_commitment_months !== undefined) {
      updates.min_commitment_months = parsed.data.min_commitment_months ?? null;
    }
    if (parsed.data.has_enrollment_fee !== undefined) {
      updates.has_enrollment_fee = parsed.data.has_enrollment_fee;
    }
    if (parsed.data.enrollment_campaign !== undefined) {
      const campaign = String(parsed.data.enrollment_campaign ?? "").trim();
      updates.enrollment_campaign = campaign || null;
      if (campaign && !campaignNeedsReferrer(campaign) && parsed.data.referrer_member_id === undefined) {
        updates.referrer_member_id = null;
      }
    }
    if (parsed.data.referrer_member_id !== undefined) {
      if (parsed.data.referrer_member_id && parsed.data.referrer_member_id === ctx.params.memberId) {
        return jsonResponse({ error: "紹介者に本人は選べません" }, 400);
      }
      updates.referrer_member_id = parsed.data.referrer_member_id ?? null;
    }
    if (parsed.data.has_changing_clothes_plan !== undefined) {
      updates.has_changing_clothes_plan = parsed.data.has_changing_clothes_plan;
    }
    if (parsed.data.has_meal_personal !== undefined) {
      updates.has_meal_personal = parsed.data.has_meal_personal;
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: "更新項目がありません" }, 400);
    }

    const supabase = createSupabaseServiceClient();

    if (
      typeof updates.enrollment_campaign === "string" &&
      campaignNeedsReferrer(updates.enrollment_campaign) &&
      !updates.referrer_member_id
    ) {
      return jsonResponse({ error: "紹介者を選択してください" }, 400);
    }
    if (typeof updates.referrer_member_id === "string") {
      const { data: referrer, error: referrerErr } = await supabase
        .from("members")
        .select("id")
        .eq("id", updates.referrer_member_id)
        .maybeSingle();
      if (referrerErr) return jsonResponse({ error: "紹介者の確認に失敗しました", detail: referrerErr.message }, 400);
      if (!referrer) return jsonResponse({ error: "紹介者が見つかりません" }, 400);
    }

    const beforeRes = await (supabase as any)
      .from("members")
      .select(memberSelectBefore)
      .eq("id", ctx.params.memberId)
      .maybeSingle();
    const before = (beforeRes.data ?? null) as Record<string, unknown> | null;
    if (!before) return jsonResponse({ error: "会員が見つかりません" }, 404);

    const prevStatus = resolveMembershipStatus(
      before.membership_status as MembershipStatus | null | undefined,
      before.is_active !== false
    );

    let { error } = await (supabase as any).from("members").update(updates).eq("id", ctx.params.memberId);
    if (error && String(error.message ?? "").includes("hiatus_")) {
      if (parsed.data.membership_status === "hiatus") {
        return jsonResponse(
          {
            error: "休会期間の保存準備ができていません（DBマイグレーション未適用の可能性）",
            detail: error.message,
          },
          500
        );
      }
      const withoutHiatus = { ...updates };
      delete withoutHiatus.hiatus_start_at;
      delete withoutHiatus.hiatus_end_at;
      const retry = await (supabase as any).from("members").update(withoutHiatus).eq("id", ctx.params.memberId);
      error = retry.error;
    }
    if (error) {
      const msg = String(error.message ?? "");
      if (msg.toLowerCase().includes("email")) {
        return jsonResponse(
          {
            error: "メール保存の準備ができていません（members.email カラムが未追加の可能性）",
            detail: error.message,
          },
          500
        );
      }
      if (msg.includes("membership_status") || msg.includes("withdrawn_") || msg.includes("hiatus_")) {
        return jsonResponse(
          {
            error: "会員ステータスの保存準備ができていません（DBマイグレーション未適用の可能性）",
            detail: error.message,
          },
          500
        );
      }
      if (
        msg.includes("joined_at") ||
        msg.includes("min_commitment") ||
        msg.includes("has_enrollment_fee") ||
        msg.includes("enrollment_campaign") ||
        msg.includes("referrer_member_id") ||
        msg.includes("has_changing_clothes_plan") ||
        msg.includes("has_meal_personal")
      ) {
        return jsonResponse(
          {
            error: "入会情報の保存準備ができていません（DBマイグレーション未適用の可能性）",
            detail: error.message,
          },
          500
        );
      }
      return jsonResponse({ error: "更新に失敗しました", detail: error.message }, 500);
    }

    const member = await selectMemberAfterUpdate(supabase, ctx.params.memberId);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);

    const mapped = await mapMemberResponse(supabase, member);
    let withdrawal_line: Awaited<ReturnType<typeof notifyWithdrawalToOpsLine>> | null = null;

    const becameWithdrawn =
      parsed.data.membership_status === "withdrawn" && prevStatus !== "withdrawn";
    if (becameWithdrawn && mapped) {
      let storeName: string | null = null;
      const storeId = (member.store_id as string | null) ?? null;
      if (storeId) {
        const { data: store } = await supabase.from("stores").select("name").eq("id", storeId).maybeSingle();
        storeName = store?.name ?? null;
      }
      const memberName =
        String((member.display_name as string | null) ?? "").trim() ||
        String((member.name as string | null) ?? "").trim() ||
        null;
      withdrawal_line = await notifyWithdrawalToOpsLine(supabase, {
        memberCode: String(member.member_code ?? ""),
        memberName,
        storeName,
        withdrawnAt: mapped.withdrawn_at,
        trainerName: mapped.withdrawn_trainer_name,
      });
    }

    revalidatePath("/admin/dashboard/members");
    revalidatePath(`/admin/dashboard/members/${ctx.params.memberId}`);

    return jsonResponse({ member: mapped, withdrawal_line }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "更新中にエラーが発生しました", detail: message }, 500);
  }
}
