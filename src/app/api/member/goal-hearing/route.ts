import { z } from "zod";
import { DateTime } from "luxon";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  ACTIVITY_OPTIONS,
  CHALLENGE_OPTIONS,
  DEADLINE_OPTIONS,
  FOCUS_AREA_OPTIONS,
  FREQUENCY_OPTIONS,
  GOAL_REASON_OPTIONS,
  MEAL_CHANGE_OPTIONS,
  PAIN_OPTIONS,
  PREFERRED_TIME_OPTIONS,
  PRIMARY_GOAL_OPTIONS,
  SEX_OPTIONS,
  SLEEP_OPTIONS,
  TRAINING_STYLE_OPTIONS,
  WEIGHT_DIRECTION_OPTIONS,
  buildGoalHearingKarteContent,
  type GoalHearingFormPayload,
} from "@/lib/goalHearing";
import { tokenKeyFromSigned, verifyGoalHearingSigned } from "@/lib/goalHearingSigned";
import { sendGoalHearingSummaryLine } from "@/lib/goalHearingSummaryLine";
import { upsertNutritionFromGoalHearing } from "@/lib/memberNutritionTargets";

const TZ = "Asia/Tokyo";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  const c = String(err?.code ?? "");
  const m = String(err?.message ?? "");
  return c === "PGRST205" || m.includes("goal_hearing") || m.includes("Could not find the table");
}

const primaryIds = PRIMARY_GOAL_OPTIONS.map((o) => o.id) as [string, ...string[]];
const deadlineIds = DEADLINE_OPTIONS.map((o) => o.id) as [string, ...string[]];
const reasonIds = GOAL_REASON_OPTIONS.map((o) => o.id) as [string, ...string[]];
const sexIds = SEX_OPTIONS.map((o) => o.id) as ["female", "male"];
const activityIds = ACTIVITY_OPTIONS.map((o) => o.id) as [string, ...string[]];
const frequencyIds = FREQUENCY_OPTIONS.map((o) => o.id) as [string, ...string[]];
const sleepIds = SLEEP_OPTIONS.map((o) => o.id) as [string, ...string[]];
const mealIds = MEAL_CHANGE_OPTIONS.map((o) => o.id) as [string, ...string[]];
const weightDirectionIds = WEIGHT_DIRECTION_OPTIONS.map((o) => o.id) as [string, ...string[]];

const postSchema = z.object({
  s: z.string().min(1),
  sig: z.string().min(1),
  primary_goal: z.enum(primaryIds),
  primary_goal_other: z.string().max(200).optional(),
  secondary_goal: z.enum(primaryIds),
  tertiary_goal: z.enum(primaryIds),
  focus_areas: z.array(z.string()).min(1).max(10),
  weight_direction: z.enum(weightDirectionIds),
  current_weight_kg: z.number().min(0).max(300).nullable().optional(),
  target_weight_kg: z.number().min(0).max(300).nullable().optional(),
  current_body_fat_pct: z.number().min(0).max(60).nullable().optional(),
  target_body_fat_pct: z.number().min(0).max(60).nullable().optional(),
  current_waist_cm: z.number().min(0).max(200).nullable().optional(),
  target_waist_cm: z.number().min(0).max(200).nullable().optional(),
  deadline_type: z.enum(deadlineIds),
  deadline_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  goal_reason: z.enum(reasonIds).nullable().optional(),
  goal_reason_other: z.string().max(200).nullable().optional(),
  sex: z.enum(sexIds),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  age_years: z.number().int().min(10).max(100).nullable().optional(),
  height_cm: z.number().min(100).max(230),
  weight_unknown: z.boolean().optional(),
  activity_level: z.enum(activityIds),
  ideal_frequency: z.enum(frequencyIds),
  preferred_slots: z.array(z.string()).min(1).max(8),
  sleep_hours: z.enum(sleepIds),
  challenges: z.array(z.string()).min(1).max(3),
  meal_change: z.enum(mealIds).nullable().optional(),
  pain_areas: z.array(z.string()).min(1),
  training_styles: z.array(z.string()).min(1).max(5),
  medical_restrictions: z.string().max(2000).nullable().optional(),
  free_comment: z.string().max(4000).nullable().optional(),
  goal_photo_paths: z.array(z.string().min(1)).min(1).max(3),
});

async function resolveMemberContext(s: string, sig: string) {
  const signed = verifyGoalHearingSigned(s, sig);
  if (!signed) return { ok: false as const, status: 400, error: "リンクが無効または期限切れです" };

  const supabase = createSupabaseServiceClient();
  const { data: member, error } = await supabase
    .from("members")
    .select("id, member_code, name, display_name, store_id, is_active")
    .eq("id", signed.member_id)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: "会員の取得に失敗しました" };
  if (!member?.id || !member.is_active) return { ok: false as const, status: 404, error: "会員が見つかりません" };

  let storeName = "";
  if (member.store_id) {
    const { data: store } = await supabase.from("stores").select("name").eq("id", member.store_id).maybeSingle();
    storeName = store?.name ?? "";
  }

  let alreadyResponded = false;
  let inviteId = signed.invite_id ?? null;

  if (inviteId) {
    const { data: invite, error: invErr } = await supabase
      .from("goal_hearing_invites")
      .select("id, responded_at, expires_at")
      .eq("id", inviteId)
      .eq("member_id", member.id)
      .maybeSingle();
    if (!isMissingTable(invErr) && invite) {
      if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
        return { ok: false as const, status: 400, error: "リンクの有効期限が切れています" };
      }
      alreadyResponded = Boolean(invite.responded_at);
    }
  }

  if (!alreadyResponded) {
    const sinceIso = DateTime.now().setZone(TZ).minus({ days: 7 }).toUTC().toISO();
    const { data: existing, error: existErr } = await supabase
      .from("goal_hearing_responses")
      .select("id")
      .eq("member_id", member.id)
      .gte("created_at", sinceIso ?? "")
      .limit(1)
      .maybeSingle();
    if (!isMissingTable(existErr) && existing?.id) alreadyResponded = true;

    if (!alreadyResponded) {
      const { data: recentNote } = await supabase
        .from("client_notes")
        .select("id, content")
        .eq("member_id", member.id)
        .gte("date", DateTime.now().setZone(TZ).minus({ days: 7 }).toFormat("yyyy-MM-dd"))
        .order("created_at", { ascending: false })
        .limit(20);
      alreadyResponded = Boolean(recentNote?.some((n) => String(n.content ?? "").includes("【目標ヒアリング")));
    }
  }

  return {
    ok: true as const,
    supabase,
    member,
    store_name: storeName,
    signed,
    invite_id: inviteId,
    token_key: tokenKeyFromSigned(signed),
    already_responded: alreadyResponded,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const s = url.searchParams.get("s") ?? "";
    const sig = url.searchParams.get("sig") ?? "";
    if (!s || !sig) return json({ error: "リンクが不正です" }, 400);

    const ctx = await resolveMemberContext(s, sig);
    if (!ctx.ok) return json({ error: ctx.error }, ctx.status);

    return json({
      survey: {
        member_code: ctx.member.member_code,
        member_name: ctx.member.display_name || ctx.member.name || "",
        store_name: ctx.store_name,
        already_responded: ctx.already_responded,
        token_key: ctx.token_key,
      },
      options: {
        primary_goals: PRIMARY_GOAL_OPTIONS,
        focus_areas: FOCUS_AREA_OPTIONS,
        deadlines: DEADLINE_OPTIONS,
        goal_reasons: GOAL_REASON_OPTIONS,
        sexes: SEX_OPTIONS,
        activities: ACTIVITY_OPTIONS,
        frequencies: FREQUENCY_OPTIONS,
        preferred_times: PREFERRED_TIME_OPTIONS,
        sleeps: SLEEP_OPTIONS,
        challenges: CHALLENGE_OPTIONS,
        meal_changes: MEAL_CHANGE_OPTIONS,
        pains: PAIN_OPTIONS,
        training_styles: TRAINING_STYLE_OPTIONS,
        weight_directions: WEIGHT_DIRECTION_OPTIONS,
      },
      submit: { s, sig },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "読み込みに失敗しました" }, 500);
  }
}

async function resolveTrainerId(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  storeId: string | null | undefined
): Promise<string | null> {
  if (storeId) {
    const { data } = await supabase
      .from("trainers")
      .select("id")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  const { data } = await supabase.from("trainers").select("id").eq("is_active", true).limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: "入力内容を確認してください", detail: parsed.error.flatten() }, 400);
    }

    const form = parsed.data;
    if (!form.birth_date && form.age_years == null) {
      return json({ error: "生年月日または年齢を入力してください" }, 400);
    }
    if (!form.weight_unknown && (form.current_weight_kg == null || Number.isNaN(form.current_weight_kg))) {
      return json({ error: "体重を入力するか「わからない」を選んでください" }, 400);
    }
    if (form.deadline_type === "date" && !form.deadline_date) {
      return json({ error: "期限の日付を入力してください" }, 400);
    }
    if (form.primary_goal === "other" && !form.primary_goal_other?.trim()) {
      return json({ error: "その他の目標を入力してください" }, 400);
    }
    for (const slot of form.preferred_slots) {
      if (!(PREFERRED_TIME_OPTIONS as readonly string[]).includes(slot)) {
        return json({ error: "通いやすい時間の選択が不正です" }, 400);
      }
    }
    for (const area of form.focus_areas) {
      if (!(FOCUS_AREA_OPTIONS as readonly string[]).includes(area)) {
        return json({ error: "変えたい部位の選択が不正です" }, 400);
      }
    }
    for (const c of form.challenges) {
      if (!(CHALLENGE_OPTIONS as readonly string[]).includes(c)) {
        return json({ error: "課題の選択が不正です" }, 400);
      }
    }
    for (const p of form.pain_areas) {
      if (!(PAIN_OPTIONS as readonly string[]).includes(p)) {
        return json({ error: "痛み・不安の選択が不正です" }, 400);
      }
    }
    for (const style of form.training_styles) {
      if (!(TRAINING_STYLE_OPTIONS as readonly string[]).includes(style)) {
        return json({ error: "トレーニングの進め方希望の選択が不正です" }, 400);
      }
    }

    const ctx = await resolveMemberContext(form.s, form.sig);
    if (!ctx.ok) return json({ error: ctx.error }, ctx.status);
    if (ctx.already_responded) return json({ error: "すでに回答済みです" }, 409);

    const answeredAt = DateTime.now().setZone(TZ);
    const answeredAtYmd = answeredAt.toFormat("yyyy-MM-dd");
    const payload: GoalHearingFormPayload = {
      ...form,
      secondary_goal: form.secondary_goal,
      tertiary_goal: form.tertiary_goal,
      preferred_slots: form.preferred_slots,
      numeric_goals_undecided: false,
      weight_unknown: Boolean(form.weight_unknown),
      training_styles: form.training_styles,
    };

    const content = buildGoalHearingKarteContent({
      memberCode: ctx.member.member_code,
      memberName: ctx.member.display_name || ctx.member.name,
      answeredAtYmd,
      form: payload,
      photoCount: form.goal_photo_paths.length,
    });

    const trainerId = await resolveTrainerId(ctx.supabase, ctx.member.store_id);
    if (!trainerId) return json({ error: "担当トレーナーを解決できませんでした" }, 500);
    if (!ctx.member.store_id) return json({ error: "所属店舗が未設定です" }, 500);

    const { data: note, error: noteErr } = await ctx.supabase
      .from("client_notes")
      .insert({
        member_id: ctx.member.id,
        store_id: ctx.member.store_id,
        trainer_id: trainerId,
        date: answeredAtYmd,
        content,
      })
      .select("id")
      .single();

    if (noteErr || !note?.id) {
      return json({ error: "カルテ保存に失敗しました", detail: noteErr?.message }, 500);
    }

    const responseRow = {
      invite_id: ctx.invite_id,
      member_id: ctx.member.id,
      store_id: ctx.member.store_id,
      client_note_id: note.id,
      primary_goal: form.primary_goal,
      secondary_goal: form.secondary_goal,
      tertiary_goal: form.tertiary_goal,
      focus_areas: form.focus_areas,
      weight_direction: form.weight_direction,
      current_weight_kg: form.weight_unknown ? null : form.current_weight_kg ?? null,
      target_weight_kg: form.target_weight_kg ?? null,
      current_body_fat_pct: form.current_body_fat_pct ?? null,
      target_body_fat_pct: form.target_body_fat_pct ?? null,
      current_waist_cm: form.current_waist_cm ?? null,
      target_waist_cm: form.target_waist_cm ?? null,
      numeric_goals_undecided: false,
      deadline_type: form.deadline_type,
      deadline_date: form.deadline_date ?? null,
      goal_reason: form.goal_reason ?? null,
      goal_reason_other: form.goal_reason_other ?? null,
      sex: form.sex,
      birth_date: form.birth_date ?? null,
      age_years: form.age_years ?? null,
      height_cm: form.height_cm,
      weight_unknown: Boolean(form.weight_unknown),
      activity_level: form.activity_level,
      ideal_frequency: form.ideal_frequency,
      preferred_slots: form.preferred_slots,
      sleep_hours: form.sleep_hours,
      challenges: form.challenges,
      meal_change: form.meal_change ?? null,
      pain_areas: form.pain_areas,
      training_styles: form.training_styles,
      medical_restrictions: form.medical_restrictions?.trim() || null,
      free_comment: form.free_comment?.trim() || null,
      goal_photo_paths: form.goal_photo_paths,
    };

    let responseId: string | null = null;
    let { data: respInserted, error: respErr } = await ctx.supabase
      .from("goal_hearing_responses")
      .insert(responseRow)
      .select("id")
      .maybeSingle();
    // 本番未適用の weight_direction カラム欠落時は落とさず再試行
    if (respErr?.message?.includes("weight_direction")) {
      const { weight_direction: _omit, ...withoutDirection } = responseRow;
      const retry = await ctx.supabase
        .from("goal_hearing_responses")
        .insert(withoutDirection)
        .select("id")
        .maybeSingle();
      respErr = retry.error;
      respInserted = retry.data;
      if (!respErr) {
        console.warn("goal_hearing_responses inserted without weight_direction (column missing)");
      }
    }
    if (!respErr && respInserted?.id) responseId = respInserted.id;

    if (respErr && !isMissingTable(respErr)) {
      // カルテは残す。構造化保存失敗はログのみ
      console.error("goal_hearing_responses insert failed", respErr);
    }

    // 栄養目標（消費・摂取・PFC）を会員レコードへ保存（カルテ／マイページ同期）
    // 再ヒアリング時は最新の計算値で上書き（トレーナーはカルテから再編集可）
    try {
      const nutrition = await upsertNutritionFromGoalHearing(ctx.supabase, {
        memberId: ctx.member.id,
        form: payload,
        goalHearingResponseId: responseId,
      });
      if (!nutrition.ok && !nutrition.skipped) {
        console.error("member_nutrition_targets upsert failed", nutrition.error);
      }
    } catch (e) {
      console.error("member_nutrition_targets upsert error", e);
    }

    if (ctx.invite_id) {
      await ctx.supabase
        .from("goal_hearing_invites")
        .update({
          responded_at: answeredAt.toUTC().toISO(),
          client_note_id: note.id,
        })
        .eq("id", ctx.invite_id);
    }

    let lineSummary: { ok: boolean; detail?: string } | null = null;
    try {
      const sent = await sendGoalHearingSummaryLine(ctx.supabase, {
        memberId: ctx.member.id,
        answeredAtYmd,
        form: payload,
        photoCount: form.goal_photo_paths.length,
        storeName: ctx.store_name || null,
      });
      lineSummary = { ok: sent.ok, detail: sent.ok ? undefined : sent.detail || sent.error };
      if (!sent.ok) console.error("goal hearing summary line failed", sent);
    } catch (e) {
      console.error("goal hearing summary line error", e);
      lineSummary = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }

    return json({ ok: true, client_note_id: note.id, line_summary: lineSummary });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "送信に失敗しました" }, 500);
  }
}
