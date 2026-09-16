import type { SupabaseClient } from "@supabase/supabase-js";
import { KARTE_TRAINING_PARTS } from "@/lib/karteSession";
import { tokyoTodayYmd } from "@/lib/memberMealLogs";

export const TRAINING_LOG_TZ = "Asia/Tokyo";
export const TRAINING_PARTS = KARTE_TRAINING_PARTS;

export const TRAINING_KINDS = [
  { id: "gym", label: "パーソナル" },
  { id: "self", label: "自主トレ" },
  { id: "cardio", label: "有酸素" },
  { id: "rest", label: "休養" },
] as const;

export const TRAINING_CONDITIONS = [
  { id: "good", label: "良い" },
  { id: "normal", label: "普通" },
  { id: "hard", label: "きつい" },
] as const;

export type TrainingKind = (typeof TRAINING_KINDS)[number]["id"];
export type TrainingCondition = (typeof TRAINING_CONDITIONS)[number]["id"];

export type MemberTrainingLogView = {
  id: string;
  log_date: string;
  kind: TrainingKind;
  parts: string[];
  duration_min: number | null;
  condition: TrainingCondition | null;
  note: string | null;
  source?: "app" | "karte";
};

function isMissingTable(err: { code?: string; message?: string } | null | undefined) {
  const c = String(err?.code ?? "");
  const m = String(err?.message ?? "");
  return (
    c === "PGRST205" ||
    m.includes("member_training_logs") ||
    m.includes("Could not find the table") ||
    (m.includes("does not exist") && m.includes("training"))
  );
}

export function isTrainingKind(v: unknown): v is TrainingKind {
  return TRAINING_KINDS.some((k) => k.id === v);
}

export function isTrainingCondition(v: unknown): v is TrainingCondition {
  return TRAINING_CONDITIONS.some((k) => k.id === v);
}

const PART_IDS = new Set<string>(TRAINING_PARTS.map((p) => p.id));

export function parseTrainingParts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x).trim()).filter((x) => PART_IDS.has(x)))];
}

export function parseDurationMin(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 0 || rounded > 600) return null;
  return rounded;
}

function toView(row: {
  id: string;
  log_date: string;
  kind: string;
  parts?: string[] | null;
  duration_min?: number | null;
  condition?: string | null;
  note?: string | null;
}): MemberTrainingLogView | null {
  if (!isTrainingKind(row.kind)) return null;
  return {
    id: row.id,
    log_date: row.log_date,
    kind: row.kind,
    parts: Array.isArray(row.parts) ? row.parts.filter((p) => PART_IDS.has(p)) : [],
    duration_min: row.duration_min ?? null,
    condition: isTrainingCondition(row.condition) ? row.condition : null,
    note: row.note ?? null,
  };
}

export function trainingKindLabel(kind: TrainingKind) {
  return TRAINING_KINDS.find((k) => k.id === kind)?.label ?? kind;
}

export function trainingConditionLabel(condition: TrainingCondition | null) {
  if (!condition) return null;
  return TRAINING_CONDITIONS.find((c) => c.id === condition)?.label ?? condition;
}

export function trainingPartsLabel(parts: string[]) {
  return parts
    .map((id) => TRAINING_PARTS.find((p) => p.id === id)?.label ?? id)
    .filter(Boolean)
    .join("・");
}

export async function getMemberTrainingLog(
  supabase: SupabaseClient,
  memberId: string,
  logDate = tokyoTodayYmd()
): Promise<{ ok: true; log: MemberTrainingLogView | null } | { ok: false; error: string; missingTable?: boolean }> {
  const { data, error } = await supabase
    .from("member_training_logs" as never)
    .select("id, log_date, kind, parts, duration_min, condition, note")
    .eq("member_id", memberId)
    .eq("log_date", logDate)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: error.message, missingTable: true };
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: true, log: null };
  return { ok: true, log: toView(data as never) };
}

export async function listMemberTrainingLogs(
  supabase: SupabaseClient,
  memberId: string,
  limit = 40
): Promise<{ ok: true; logs: MemberTrainingLogView[] } | { ok: false; error: string; missingTable?: boolean }> {
  const { data, error } = await supabase
    .from("member_training_logs" as never)
    .select("id, log_date, kind, parts, duration_min, condition, note")
    .eq("member_id", memberId)
    .order("log_date", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 1000));
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: error.message, missingTable: true };
    return { ok: false, error: error.message };
  }
  const logs = (data ?? [])
    .map((row) => toView(row as never))
    .filter((row): row is MemberTrainingLogView => row != null);
  return { ok: true, logs };
}

export async function upsertMemberTrainingLog(
  supabase: SupabaseClient,
  params: {
    memberId: string;
    logDate: string;
    kind: TrainingKind;
    parts: string[];
    durationMin: number | null;
    condition: TrainingCondition | null;
    note: string | null;
  }
): Promise<{ ok: true; log: MemberTrainingLogView } | { ok: false; error: string; missingTable?: boolean }> {
  const { data, error } = await supabase
    .from("member_training_logs" as never)
    .upsert(
      {
        member_id: params.memberId,
        log_date: params.logDate,
        kind: params.kind,
        parts: params.kind === "rest" ? [] : params.parts,
        duration_min: params.kind === "rest" ? null : params.durationMin,
        condition: params.condition,
        note: params.note,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "member_id,log_date" }
    )
    .select("id, log_date, kind, parts, duration_min, condition, note")
    .single();
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: error.message, missingTable: true };
    return { ok: false, error: error.message };
  }
  const view = toView(data as never);
  if (!view) return { ok: false, error: "保存結果の読み取りに失敗しました" };
  return { ok: true, log: view };
}
