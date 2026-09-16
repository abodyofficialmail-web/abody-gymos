import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatMemberTrainingNote,
  isMemberTrainingNote,
  mergeTrainingLogs,
  parseKarteSessionTraining,
  parseMemberTrainingNote,
  parseTrainingFromClientNote,
} from "./karteTrainingParse";
import {
  getMemberTrainingLog,
  listMemberTrainingLogs,
  parseTrainingParts,
  upsertMemberTrainingLog,
  type MemberTrainingLogView,
  type TrainingCondition,
  type TrainingKind,
} from "./memberTrainingLogs";

export {
  formatMemberTrainingNote,
  isMemberTrainingNote,
  MEMBER_TRAINING_NOTE_HEADING,
  mergeTrainingLogs,
  parseKarteSessionTraining,
  parseMemberTrainingNote,
  parseTrainingFromClientNote,
} from "./karteTrainingParse";

function asView(row: ReturnType<typeof parseTrainingFromClientNote>): MemberTrainingLogView | null {
  if (!row) return null;
  return row;
}

export async function listTrainingFromClientNotes(
  supabase: SupabaseClient,
  memberId: string,
  limit = 60
): Promise<MemberTrainingLogView[]> {
  const { data, error } = await supabase
    .from("client_notes")
    .select("id, date, content")
    .eq("member_id", memberId)
    .order("date", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) return [];
  return (data ?? [])
    .map((row) =>
      asView(
        parseTrainingFromClientNote(String((row as { content?: string }).content ?? ""), {
          id: String((row as { id: string }).id),
          log_date: String((row as { date: string }).date),
        })
      )
    )
    .filter((row): row is MemberTrainingLogView => row != null);
}

async function resolveNoteAnchors(supabase: SupabaseClient, memberId: string) {
  const { data: member } = await supabase.from("members").select("id, store_id").eq("id", memberId).maybeSingle();
  let storeId = (member as { store_id?: string | null } | null)?.store_id ?? null;
  let trainerId: string | null = null;

  const { data: lastNote } = await supabase
    .from("client_notes")
    .select("trainer_id, store_id")
    .eq("member_id", memberId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastNote) {
    trainerId = String((lastNote as { trainer_id?: string }).trainer_id ?? "") || null;
    storeId = storeId || String((lastNote as { store_id?: string }).store_id ?? "") || null;
  }

  if (!trainerId || !storeId) {
    const { data: lastRes } = await supabase
      .from("reservations")
      .select("trainer_id, store_id")
      .eq("member_id", memberId)
      .neq("status", "cancelled")
      .order("start_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastRes) {
      trainerId = trainerId || String((lastRes as { trainer_id?: string }).trainer_id ?? "") || null;
      storeId = storeId || String((lastRes as { store_id?: string }).store_id ?? "") || null;
    }
  }

  if (!trainerId && storeId) {
    const { data: trainer } = await supabase
      .from("trainers")
      .select("id")
      .eq("store_id", storeId)
      .limit(1)
      .maybeSingle();
    trainerId = (trainer as { id?: string } | null)?.id ?? null;
  }

  if (!trainerId) {
    const { data: trainer } = await supabase.from("trainers").select("id").limit(1).maybeSingle();
    trainerId = (trainer as { id?: string } | null)?.id ?? null;
  }

  if (!storeId) {
    const { data: store } = await supabase.from("stores").select("id").eq("is_active", true).limit(1).maybeSingle();
    storeId = (store as { id?: string } | null)?.id ?? null;
  }

  return { storeId, trainerId };
}

export async function upsertMemberTrainingClientNote(
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
): Promise<{ ok: true; log: MemberTrainingLogView } | { ok: false; error: string }> {
  const anchors = await resolveNoteAnchors(supabase, params.memberId);
  if (!anchors.storeId || !anchors.trainerId) {
    return { ok: false, error: "所属店舗または担当トレーナーがまだないため、記録できません" };
  }
  const content = formatMemberTrainingNote({
    kind: params.kind,
    parts: params.parts,
    duration_min: params.durationMin,
    condition: params.condition,
    note: params.note,
  });
  const { data: existing } = await supabase
    .from("client_notes")
    .select("id, content")
    .eq("member_id", params.memberId)
    .eq("date", params.logDate)
    .order("created_at", { ascending: false });
  const current = (existing ?? []).find((row) => isMemberTrainingNote(String((row as { content?: string }).content ?? "")));
  if (current) {
    const { data, error } = await supabase
      .from("client_notes")
      .update({ content } as never)
      .eq("id", (current as { id: string }).id)
      .select("id, date")
      .single();
    if (error) return { ok: false, error: error.message };
    const log = parseMemberTrainingNote(content, {
      id: String((data as { id: string }).id),
      log_date: params.logDate,
    });
    if (!log) return { ok: false, error: "保存結果の読み取りに失敗しました" };
    return { ok: true, log };
  }
  const { data, error } = await supabase
    .from("client_notes")
    .insert({
      member_id: params.memberId,
      store_id: anchors.storeId,
      trainer_id: anchors.trainerId,
      date: params.logDate,
      content,
    } as never)
    .select("id, date")
    .single();
  if (error) return { ok: false, error: error.message };
  const log = parseMemberTrainingNote(content, {
    id: String((data as { id: string }).id),
    log_date: params.logDate,
  });
  if (!log) return { ok: false, error: "保存結果の読み取りに失敗しました" };
  return { ok: true, log };
}

export async function listMergedTrainingLogs(supabase: SupabaseClient, memberId: string, limit = 40) {
  const fromNotes = await listTrainingFromClientNotes(supabase, memberId, Math.max(limit, 60));
  const listed = await listMemberTrainingLogs(supabase, memberId, limit);
  if (!listed.ok) {
    if (listed.missingTable) return { ok: true as const, logs: fromNotes, missingTable: true };
    return listed;
  }
  return { ok: true as const, logs: mergeTrainingLogs(listed.logs, fromNotes), missingTable: false };
}

export async function syncKarteNoteToTrainingLog(
  supabase: SupabaseClient,
  params: {
    memberId: string;
    logDate: string;
    content: string;
    parts?: string[];
    condition?: string | null;
  }
) {
  const parsed = parseKarteSessionTraining(params.content, { id: "karte", log_date: params.logDate });
  const parts = parseTrainingParts(params.parts?.length ? params.parts : parsed?.parts ?? []);
  const conditionRaw = params.condition ?? "";
  const condition =
    conditionRaw === "良い" || conditionRaw === "good"
      ? ("good" as const)
      : conditionRaw === "普通" || conditionRaw === "normal"
        ? ("normal" as const)
        : conditionRaw === "きつい" || conditionRaw === "やや不調" || conditionRaw === "不調" || conditionRaw === "hard"
          ? ("hard" as const)
          : parsed?.condition ?? null;
  if (parts.length === 0 && !parsed) return;
  const existing = await getMemberTrainingLog(supabase, params.memberId, params.logDate);
  if (!existing.ok) return;
  if (existing.log && existing.log.kind !== "gym") return;
  await upsertMemberTrainingLog(supabase, {
    memberId: params.memberId,
    logDate: params.logDate,
    kind: "gym",
    parts,
    durationMin: existing.log?.duration_min ?? null,
    condition: condition ?? existing.log?.condition ?? null,
    note: parsed?.note ?? existing.log?.note ?? null,
  });
}
