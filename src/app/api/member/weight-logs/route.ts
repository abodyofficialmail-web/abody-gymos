import { z } from "zod";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { getMemberIdFromCookie } from "@/app/api/member/_cookies";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { isMemberWeightLogEnabled } from "@/lib/memberWeightLogRollout";
import { verifyMemberMealLogSigned } from "@/lib/memberMealLogSigned";
import { verifyMemberWeightLogSigned } from "@/lib/memberWeightLogSigned";
import { fetchOrBackfillNutritionTarget } from "@/lib/memberNutritionTargets";
import {
  buildWeightLogStats,
  isEmptyBodyFatInput,
  isLogDateAllowed,
  listMemberWeightLogs,
  parseBodyFatPct,
  parseWeightKg,
  tokyoTodayYmd,
  upsertMemberWeightLog,
} from "@/lib/memberWeightLogs";

async function loadNutrition(supabase: ReturnType<typeof createSupabaseServiceClient>, memberId: string) {
  const result = await fetchOrBackfillNutritionTarget(supabase, memberId);
  if (!result.ok) return null;
  return result.target;
}

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const postSchema = z.object({
  s: z.string().optional(),
  sig: z.string().optional(),
  log_date: z.string().optional(),
  weight_kg: z.union([z.number(), z.string()]),
  body_fat_pct: z.union([z.number(), z.string(), z.null()]).optional(),
});

async function resolveMember(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  signed?: { s?: string; sig?: string }
): Promise<
  | { ok: true; memberId: string; memberCode: string }
  | { ok: false; status: number; error: string }
> {
  const s = signed?.s?.trim() ?? "";
  const sig = signed?.sig?.trim() ?? "";
  if (s && sig) {
    const payload = verifyMemberWeightLogSigned(s, sig) ?? verifyMemberMealLogSigned(s, sig);
    if (!payload) return { ok: false, status: 400, error: "リンクが無効または期限切れです" };
    const { data: member, error } = await supabase
      .from("members")
      .select("id, member_code, is_active, membership_status")
      .eq("id", payload.member_id)
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: "会員の取得に失敗しました" };
    if (!member || member.is_active === false) return { ok: false, status: 401, error: "未ログイン" };
    if (!isMemberWeightLogEnabled(member.member_code)) {
      return { ok: false, status: 403, error: "この機能は現在ご利用いただけません" };
    }
    return { ok: true, memberId: member.id, memberCode: String(member.member_code ?? "") };
  }

  const memberId = getMemberIdFromCookie();
  if (!memberId) return { ok: false, status: 401, error: "未ログイン" };
  const { data: member, error } = await supabase
    .from("members")
    .select("id, member_code, is_active")
    .eq("id", memberId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "会員の取得に失敗しました" };
  if (!member || !member.is_active) return { ok: false, status: 401, error: "未ログイン" };
  if (!isMemberWeightLogEnabled(member.member_code)) {
    return { ok: false, status: 403, error: "この機能は現在ご利用いただけません" };
  }
  return { ok: true, memberId: member.id, memberCode: String(member.member_code ?? "") };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const supabase = createSupabaseServiceClient();
    const resolved = await resolveMember(supabase, {
      s: url.searchParams.get("s") ?? undefined,
      sig: url.searchParams.get("sig") ?? undefined,
    });
    if (!resolved.ok) return jsonResponse({ error: resolved.error }, resolved.status);

    const today = tokyoTodayYmd();
    const [listed, nutrition] = await Promise.all([
      listMemberWeightLogs(supabase, resolved.memberId, today),
      loadNutrition(supabase, resolved.memberId),
    ]);
    if (!listed.ok) {
      if (listed.missingTable) {
        return jsonResponse({
          enabled: true,
          today,
          today_log: null,
          logs: [],
          stats: buildWeightLogStats([], today),
          nutrition,
        });
      }
      return jsonResponse({ error: "体重記録の取得に失敗しました", detail: listed.error }, 500);
    }

    const todayLog = listed.logs.find((l) => l.log_date === today) ?? null;
    return jsonResponse({
      enabled: true,
      today,
      today_log: todayLog,
      logs: listed.logs,
      stats: buildWeightLogStats(listed.logs, today),
      nutrition,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "入力内容が不正です", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const resolved = await resolveMember(supabase, { s: parsed.data.s, sig: parsed.data.sig });
    if (!resolved.ok) return jsonResponse({ error: resolved.error }, resolved.status);

    const today = tokyoTodayYmd();
    const logDate = (parsed.data.log_date ?? today).trim();
    if (!isLogDateAllowed(logDate, today)) {
      return jsonResponse({ error: "記録できる日付は今日から30日前までです" }, 400);
    }
    const weightKg = parseWeightKg(parsed.data.weight_kg);
    if (weightKg == null) {
      return jsonResponse({ error: "体重は 15.0〜300.0 kg で入力してください" }, 400);
    }
    let bodyFatPct: number | null = null;
    if (!isEmptyBodyFatInput(parsed.data.body_fat_pct)) {
      bodyFatPct = parseBodyFatPct(parsed.data.body_fat_pct);
      if (bodyFatPct == null) {
        return jsonResponse({ error: "体脂肪は 3.0〜60.0 % で入力するか、空欄にしてください" }, 400);
      }
    }

    const saved = await upsertMemberWeightLog(supabase, {
      memberId: resolved.memberId,
      logDate,
      weightKg,
      bodyFatPct,
    });
    if (!saved.ok) {
      if (saved.missingTable) {
        return jsonResponse({ error: "体重記録の準備ができていません。しばらくしてからお試しください。" }, 503);
      }
      return jsonResponse({ error: "体重の保存に失敗しました", detail: saved.error }, 500);
    }

    const [listed, nutrition] = await Promise.all([
      listMemberWeightLogs(supabase, resolved.memberId, today),
      loadNutrition(supabase, resolved.memberId),
    ]);
    const logs = listed.ok ? listed.logs : [saved.log];
    return jsonResponse({
      ok: true,
      today,
      today_log: logs.find((l) => l.log_date === today) ?? (saved.log.log_date === today ? saved.log : null),
      log: saved.log,
      logs,
      stats: buildWeightLogStats(logs, today),
      nutrition,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "保存中にエラーが発生しました", detail: message }, 500);
  }
}
