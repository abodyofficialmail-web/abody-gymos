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
  });

const memberSelect =
  "id, member_code, name, email, is_active, membership_status, withdrawn_at, withdrawn_trainer_id, line_user_id";

const memberSelectFallback =
  "id, member_code, name, email, is_active, membership_status, line_user_id";

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
  if (msg.includes("withdrawn_")) {
    const second = await (supabase as any)
      .from("members")
      .select("id, member_code, name, email, is_active, membership_status, line_user_id")
      .eq("id", memberId)
      .maybeSingle();
    return (second.data as Record<string, unknown> | null) ?? null;
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
      } else {
        updates.withdrawn_at = null;
        updates.withdrawn_trainer_id = null;
      }
    } else if (parsed.data.withdrawn_at !== undefined || parsed.data.withdrawn_trainer_id !== undefined) {
      updates.withdrawn_at = parsed.data.withdrawn_at ?? null;
      updates.withdrawn_trainer_id = parsed.data.withdrawn_trainer_id ?? null;
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: "更新項目がありません" }, 400);
    }

    const supabase = createSupabaseServiceClient();
    const { error } = await (supabase as any).from("members").update(updates).eq("id", ctx.params.memberId);
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
      if (msg.includes("membership_status") || msg.includes("withdrawn_")) {
        return jsonResponse(
          {
            error: "会員ステータスの保存準備ができていません（DBマイグレーション未適用の可能性）",
            detail: error.message,
          },
          500
        );
      }
      return jsonResponse({ error: "更新に失敗しました", detail: error.message }, 500);
    }

    const member = await selectMemberAfterUpdate(supabase, ctx.params.memberId);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);

    revalidatePath("/admin/dashboard/members");
    revalidatePath(`/admin/dashboard/members/${ctx.params.memberId}`);

    return jsonResponse({ member: await mapMemberResponse(supabase, member) }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "更新中にエラーが発生しました", detail: message }, 500);
  }
}
