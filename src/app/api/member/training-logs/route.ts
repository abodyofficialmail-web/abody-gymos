import { z } from "zod";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { getMemberIdFromCookie } from "@/app/api/member/_cookies";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { loadMemberMealPersonalGate } from "@/lib/memberMealPersonalPass";
import { verifyMemberMealLogSigned } from "@/lib/memberMealLogSigned";
import { isLogDateAllowed, tokyoTodayYmd } from "@/lib/memberWeightLogs";
import {
  isTrainingCondition,
  isTrainingKind,
  parseDurationMin,
  parseTrainingParts,
  upsertMemberTrainingLog,
} from "@/lib/memberTrainingLogs";
import { listMergedTrainingLogs, upsertMemberTrainingClientNote } from "@/lib/karteTrainingSync";

async function resolveMember(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  signed?: { s?: string; sig?: string }
): Promise<
  | { ok: true; memberId: string }
  | { ok: false; status: number; error: string }
> {
  const s = signed?.s?.trim() ?? "";
  const sig = signed?.sig?.trim() ?? "";
  if (s && sig) {
    const payload = verifyMemberMealLogSigned(s, sig);
    if (!payload) return { ok: false, status: 400, error: "リンクが無効または期限切れです" };
    try {
      const gate = await loadMemberMealPersonalGate(supabase, payload.member_id);
      if (!gate || gate.is_active === false) return { ok: false, status: 401, error: "未ログイン" };
      if (!gate.full) return { ok: false, status: 403, error: "この機能は現在ご利用いただけません" };
      return { ok: true, memberId: gate.id };
    } catch {
      return { ok: false, status: 500, error: "会員の取得に失敗しました" };
    }
  }

  const memberId = getMemberIdFromCookie();
  if (!memberId) return { ok: false, status: 401, error: "未ログイン" };
  try {
    const gate = await loadMemberMealPersonalGate(supabase, memberId);
    if (!gate || !gate.is_active) return { ok: false, status: 401, error: "未ログイン" };
    if (!gate.full) return { ok: false, status: 403, error: "この機能は現在ご利用いただけません" };
    return { ok: true, memberId: gate.id };
  } catch {
    return { ok: false, status: 500, error: "会員の取得に失敗しました" };
  }
}

export async function OPTIONS() {
  return jsonResponse({}, 200);
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
    const listed = await listMergedTrainingLogs(supabase, resolved.memberId, 40);
    if (!listed.ok) return jsonResponse({ error: "トレーニング記録の取得に失敗しました" }, 500);
    const todayLog =
      listed.logs.find((row) => row.log_date === today && row.source !== "karte") ??
      listed.logs.find((row) => row.log_date === today) ??
      null;
    return jsonResponse({ today, today_log: todayLog, logs: listed.logs });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}

const postSchema = z.object({
  s: z.string().optional(),
  sig: z.string().optional(),
  log_date: z.string().optional(),
  kind: z.string(),
  parts: z.array(z.unknown()).optional(),
  duration_min: z.union([z.number(), z.string(), z.null()]).optional(),
  condition: z.union([z.string(), z.null()]).optional(),
  note: z.union([z.string(), z.null()]).optional(),
});

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "入力内容が不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    const resolved = await resolveMember(supabase, { s: parsed.data.s, sig: parsed.data.sig });
    if (!resolved.ok) return jsonResponse({ error: resolved.error }, resolved.status);

    const today = tokyoTodayYmd();
    const logDate = (parsed.data.log_date ?? today).trim();
    if (!isLogDateAllowed(logDate, today)) {
      return jsonResponse({ error: "記録できる日付は今日から30日前までです" }, 400);
    }
    if (!isTrainingKind(parsed.data.kind)) {
      return jsonResponse({ error: "トレーニングの種類を選んでください" }, 400);
    }
    const condition =
      parsed.data.condition == null || parsed.data.condition === ""
        ? null
        : isTrainingCondition(parsed.data.condition)
          ? parsed.data.condition
          : null;
    if (parsed.data.condition && parsed.data.condition !== "" && !condition) {
      return jsonResponse({ error: "調子の選択が不正です" }, 400);
    }
    const durationMin = parseDurationMin(parsed.data.duration_min);
    if (parsed.data.duration_min != null && parsed.data.duration_min !== "" && durationMin == null) {
      return jsonResponse({ error: "時間は 0〜600 分で入力してください" }, 400);
    }
    const note = parsed.data.note == null ? null : String(parsed.data.note).trim() || null;

    const saved = await upsertMemberTrainingLog(supabase, {
      memberId: resolved.memberId,
      logDate,
      kind: parsed.data.kind,
      parts: parseTrainingParts(parsed.data.parts),
      durationMin,
      condition,
      note,
    });
    if (!saved.ok) {
      if (saved.missingTable) {
        const fallback = await upsertMemberTrainingClientNote(supabase, {
          memberId: resolved.memberId,
          logDate,
          kind: parsed.data.kind,
          parts: parseTrainingParts(parsed.data.parts),
          durationMin,
          condition,
          note,
        });
        if (!fallback.ok) return jsonResponse({ error: fallback.error }, 500);
        return jsonResponse({ ok: true, today, today_log: fallback.log });
      }
      return jsonResponse({ error: "保存に失敗しました", detail: saved.error }, 500);
    }
    if (parsed.data.kind !== "gym") {
      const noteSync = await upsertMemberTrainingClientNote(supabase, {
        memberId: resolved.memberId,
        logDate,
        kind: parsed.data.kind,
        parts: parseTrainingParts(parsed.data.parts),
        durationMin,
        condition,
        note,
      }).catch(() => null);
      if (noteSync && !noteSync.ok) {
        console.error("training client note sync failed", noteSync.error);
      }
    }
    return jsonResponse({ ok: true, today, today_log: saved.log });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "保存中にエラーが発生しました", detail: message }, 500);
  }
}
