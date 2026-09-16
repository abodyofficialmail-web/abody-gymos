import { DateTime } from "luxon";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { parseFeedback } from "@/lib/monthlyProgressReport/buildReport";
import {
  buildWeightProgressBundle,
  commentSourceHash,
  type WeightProgressNote,
} from "@/lib/weightProgress/buildWeightProgress";
import { generateWeightAiComments } from "@/lib/weightProgress/generateWeightAiComments";
import type { WeightPredictSex } from "@/lib/weightProgress/predictNextMax";

const TZ = "Asia/Tokyo";

function isMissingAiTable(err: { message?: string } | null | undefined): boolean {
  const msg = String(err?.message ?? "");
  return /member_weight_progress_ai_comments/i.test(msg) && (/does not exist|schema cache|PGRST/i.test(msg) || /Could not find/i.test(msg));
}

async function loadHearingAndNotes(memberId: string) {
  const supabase = createSupabaseServiceClient();
  const [{ data: notes, error: nErr }, hearingRes] = await Promise.all([
    (supabase as any)
      .from("client_notes")
      .select("date, content")
      .eq("member_id", memberId)
      .order("date", { ascending: true }),
    (supabase as any)
      .from("goal_hearing_responses")
      .select("sex, current_weight_kg, height_cm, age_years, birth_date")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (nErr) throw new Error(nErr.message || "カルテの取得に失敗しました");
  const hearing = hearingRes.error ? null : hearingRes.data;
  return {
    supabase,
    notes: (notes ?? []) as WeightProgressNote[],
    hearing,
  };
}

/**
 * ルール数字は即時。LLMコメントは DB キャッシュから読むだけ（表示を重くしない）。
 */
export async function loadMemberWeightProgress(memberId: string, preferredYearMonth?: string) {
  const yearMonthPreferred =
    preferredYearMonth || DateTime.now().setZone(TZ).toFormat("yyyy-MM");
  const { supabase, notes, hearing } = await loadHearingAndNotes(memberId);

  const sex = (hearing?.sex as WeightPredictSex) ?? null;
  const hearingWeight =
    hearing?.current_weight_kg != null ? Number(hearing.current_weight_kg) : null;
  const heightCm = hearing?.height_cm != null ? Number(hearing.height_cm) : null;
  const ageYears = hearing?.age_years != null ? Number(hearing.age_years) : null;
  const birthDate = hearing?.birth_date ? String(hearing.birth_date) : null;

  const bundle = buildWeightProgressBundle({
    notes,
    preferredYearMonth: yearMonthPreferred,
    sex,
    hearingWeightKg: hearingWeight,
    heightCm,
    ageYears,
    birthDate,
  });

  // キャッシュ読込（テーブル未作成でも落とさない）
  let cached: any[] = [];
  const { data: commentRows, error: cErr } = await (supabase as any)
    .from("member_weight_progress_ai_comments")
    .select("exercise, next_target, rule_reason, ai_rationale, trainer_tip, source_hash, model, generated_at")
    .eq("member_id", memberId)
    .eq("year_month", bundle.yearMonth);
  if (cErr && !isMissingAiTable(cErr)) {
    console.warn("weight ai comments load failed", cErr.message);
  } else if (!cErr) {
    cached = commentRows ?? [];
  }

  const byEx = new Map<string, any>((cached ?? []).map((c: any) => [String(c.exercise), c]));
  let matched = 0;
  const rows = bundle.rows.map((r) => {
    const c = byEx.get(r.exercise);
    if (!c) return r;
    const expectedHash = commentSourceHash({
      exercise: r.exercise,
      nextTarget: r.nextTarget ?? r.monthMax,
      monthMax: r.monthMax,
      prevMonthMax: r.prevMonthMax,
      nextReason: r.nextReason || "",
      sex: bundle.profile.sex,
      bodyWeightKg: bundle.profile.bodyWeightKg,
      heightCm: bundle.profile.heightCm,
      ageYears: bundle.profile.ageYears,
    });
    // hash 不一致なら古いコメントは出さず pending 扱い
    if (String(c.source_hash) !== expectedHash) return r;
    matched += 1;
    return {
      ...r,
      aiRationale: String(c.ai_rationale || ""),
      trainerTip: String(c.trainer_tip || ""),
      aiCommentModel: c.model ? String(c.model) : null,
    };
  });

  const withTarget = rows.filter((r) => r.nextTarget != null).length;
  const aiCommentStatus =
    withTarget === 0 ? "ready" : matched === 0 ? "pending" : matched >= Math.min(8, withTarget) ? "ready" : "partial";

  // 未生成なら裏で生成開始（表示は待たない）
  if (aiCommentStatus !== "ready") {
    scheduleWeightProgressAiRefresh(memberId, bundle.yearMonth);
  }

  return { ...bundle, rows, aiCommentStatus };
}

/**
 * 裏で実行する事前生成。表示APIからは待たない。
 */
export async function refreshMemberWeightProgressAiComments(
  memberId: string,
  preferredYearMonth?: string
): Promise<{
  yearMonth: string;
  upserted: number;
  skipped: number;
  model: string | null;
  tableMissing?: boolean;
}> {
  const yearMonthPreferred =
    preferredYearMonth || DateTime.now().setZone(TZ).toFormat("yyyy-MM");
  const { supabase, notes, hearing } = await loadHearingAndNotes(memberId);

  const sex = (hearing?.sex as WeightPredictSex) ?? null;
  const hearingWeight =
    hearing?.current_weight_kg != null ? Number(hearing.current_weight_kg) : null;
  const heightCm = hearing?.height_cm != null ? Number(hearing.height_cm) : null;
  const ageYears = hearing?.age_years != null ? Number(hearing.age_years) : null;
  const birthDate = hearing?.birth_date ? String(hearing.birth_date) : null;

  const bundle = buildWeightProgressBundle({
    notes,
    preferredYearMonth: yearMonthPreferred,
    sex,
    hearingWeightKg: hearingWeight,
    heightCm,
    ageYears,
    birthDate,
  });

  const { data: existing, error: eErr } = await (supabase as any)
    .from("member_weight_progress_ai_comments")
    .select("exercise, source_hash")
    .eq("member_id", memberId)
    .eq("year_month", bundle.yearMonth);

  if (eErr && isMissingAiTable(eErr)) {
    return { yearMonth: bundle.yearMonth, upserted: 0, skipped: 0, model: null, tableMissing: true };
  }
  if (eErr) throw new Error(eErr.message);

  const existingHash = new Map<string, string>(
    (existing ?? []).map((r: any) => [String(r.exercise), String(r.source_hash)])
  );

  const candidates = bundle.rows.filter((r) => r.nextTarget != null).slice(0, 8);
  const needGenerate = candidates.filter((r) => {
    const hash = commentSourceHash({
      exercise: r.exercise,
      nextTarget: r.nextTarget!,
      monthMax: r.monthMax,
      prevMonthMax: r.prevMonthMax,
      nextReason: r.nextReason || "",
      sex: bundle.profile.sex,
      bodyWeightKg: bundle.profile.bodyWeightKg,
      heightCm: bundle.profile.heightCm,
      ageYears: bundle.profile.ageYears,
    });
    return existingHash.get(r.exercise) !== hash;
  });

  if (!needGenerate.length) {
    return { yearMonth: bundle.yearMonth, upserted: 0, skipped: candidates.length, model: null };
  }

  const recentFeedbacks = notes
    .filter((n) => n.date.startsWith(bundle.yearMonth) || n.date.startsWith(bundle.prevYearMonth))
    .map((n) => parseFeedback(n.content))
    .filter(Boolean)
    .slice(-5);

  // 変更があった種目だけ再生成（コスト抑制）。ただし LLM はバッチしやすいので候補全体を渡す
  const generated = await generateWeightAiComments({
    rows: needGenerate,
    profile: bundle.profile,
    nextMonthLabel: bundle.nextMonthLabel,
    recentFeedbacks,
    limit: 8,
  });

  const rowsToUpsert = generated.map((g) => ({
    member_id: memberId,
    year_month: bundle.yearMonth,
    exercise: g.exercise,
    next_target: g.nextTarget,
    rule_reason: g.ruleReason,
    ai_rationale: g.aiRationale,
    trainer_tip: g.trainerTip,
    source_hash: g.sourceHash,
    model: g.model,
    generated_at: new Date().toISOString(),
  }));

  const { error: uErr } = await (supabase as any)
    .from("member_weight_progress_ai_comments")
    .upsert(rowsToUpsert, { onConflict: "member_id,year_month,exercise" });

  if (uErr && isMissingAiTable(uErr)) {
    return { yearMonth: bundle.yearMonth, upserted: 0, skipped: 0, model: null, tableMissing: true };
  }
  if (uErr) throw new Error(uErr.message);

  return {
    yearMonth: bundle.yearMonth,
    upserted: rowsToUpsert.length,
    skipped: candidates.length - needGenerate.length,
    model: generated[0]?.model ?? null,
  };
}

/** 同一会員の並行再生成を抑止（サーバレス内の簡易ロック） */
const inflightAiRefresh = new Set<string>();

/** レスポンスを待たせず裏で回す */
export function scheduleWeightProgressAiRefresh(memberId: string, yearMonth?: string) {
  const key = `${memberId}:${yearMonth || ""}`;
  if (inflightAiRefresh.has(key)) return;
  inflightAiRefresh.add(key);
  void refreshMemberWeightProgressAiComments(memberId, yearMonth)
    .catch((e) => {
      console.warn("weight progress AI refresh failed", memberId, e);
    })
    .finally(() => {
      inflightAiRefresh.delete(key);
    });
}
