import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { splitEnvList, dailyReportChannelToken } from "@/lib/dailyLineRecipients";
import { TRAINER_LINE_DEMO_NAME } from "@/lib/trainerLineLink";
import { chunkLinePushText, pushLineTextChunks } from "@/lib/lineMessagingPush";

export const OPS_OWNER_MEMBER_CODE = "EBI020";

/** 所属店舗と別に、責任店舗を名前で固定（DB未適用時のフォールバック） */
export const DEFAULT_STORE_MANAGERS: Record<string, string[]> = {
  ひろむ: ["上野"],
  せいや: ["上野"],
  りょう: ["桜木町"],
  ゆうと: ["新宿", "恵比寿"],
  ともき: ["福岡"],
};

/** メイン店舗に加え、全店舗の数字も見る */
export const DEFAULT_ALL_STORE_VIEWERS = new Set(["ゆうと"]);

export type OpsRecipientKind = "owner" | "store_manager" | "trainer";

export type OpsRecipient = {
  line_user_id: string;
  kind: OpsRecipientKind;
  trainer_id: string | null;
  display_name: string | null;
  /** 空配列は本人シフトのみ。owner は allStores=true */
  store_names: string[];
  all_stores: boolean;
};

type TrainerRow = {
  id: string;
  display_name: string;
  is_active: boolean;
  line_user_id: string | null;
};

export function recipientDedupeKey(r: OpsRecipient): string {
  return r.line_user_id;
}

function kindRank(k: OpsRecipientKind): number {
  return k === "owner" ? 3 : k === "store_manager" ? 2 : 1;
}

/** 同じLINEは広い権限を残す（owner > 責任者 > トレーナー） */
export function mergeOpsRecipients(rows: OpsRecipient[]): OpsRecipient[] {
  const byId = new Map<string, OpsRecipient>();
  for (const r of rows) {
    const uid = r.line_user_id.trim();
    if (!uid) continue;
    const prev = byId.get(uid);
    if (!prev) {
      byId.set(uid, { ...r, line_user_id: uid });
      continue;
    }
    const keep = kindRank(r.kind) >= kindRank(prev.kind) ? r : prev;
    const other = keep === r ? prev : r;
    const names = new Set([...keep.store_names, ...other.store_names]);
    byId.set(uid, {
      ...keep,
      line_user_id: uid,
      all_stores: keep.all_stores || other.all_stores,
      store_names: Array.from(names),
      trainer_id: keep.trainer_id ?? other.trainer_id,
      display_name: keep.display_name ?? other.display_name,
    });
  }
  return Array.from(byId.values());
}

async function loadManagedStoresByTrainerId(
  supabase: SupabaseClient<Database>
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  try {
    const { data, error } = await supabase
      .from("trainer_managed_stores" as any)
      .select("trainer_id, stores ( name )");
    if (error) {
      console.warn("[trainerOpsScope] managed stores lookup skipped", error.message);
      return out;
    }
    for (const row of data ?? []) {
      const tid = String((row as any).trainer_id ?? "");
      const name =
        (row as any).stores && typeof (row as any).stores === "object"
          ? String((row as any).stores.name ?? "")
          : "";
      if (!tid || !name) continue;
      const cur = out.get(tid) ?? [];
      cur.push(name);
      out.set(tid, cur);
    }
  } catch (e) {
    console.warn("[trainerOpsScope] managed stores lookup failed", e);
  }
  return out;
}

export async function resolveOpsRecipients(supabase: SupabaseClient<Database>): Promise<OpsRecipient[]> {
  const rows: OpsRecipient[] = [];

  const explicit: string[] = [];
  const rawUsers = process.env.LINE_DAILY_REPORT_USER_IDS?.trim();
  if (rawUsers) explicit.push(...splitEnvList(rawUsers));
  const legacy = process.env.LINE_EBI020_USER_ID?.trim();
  if (legacy) explicit.push(legacy);

  const codesEnv = process.env.LINE_DAILY_REPORT_MEMBER_CODES?.trim();
  const ownerCodes =
    codesEnv !== undefined && codesEnv !== "" ? splitEnvList(codesEnv) : [OPS_OWNER_MEMBER_CODE];

  if (ownerCodes.length > 0) {
    const { data, error } = await supabase
      .from("members")
      .select("member_code,line_user_id")
      .in("member_code", ownerCodes)
      .eq("is_active", true);
    if (error) throw new Error(`members_lookup_failed:${error.message}`);
    for (const code of ownerCodes) {
      const row = (data ?? []).find((r) => String(r.member_code) === code);
      const uid = row?.line_user_id ? String(row.line_user_id).trim() : "";
      if (!uid) continue;
      rows.push({
        line_user_id: uid,
        kind: "owner",
        trainer_id: null,
        display_name: null,
        store_names: [],
        all_stores: true,
      });
    }
  }

  for (const uid of explicit) {
    rows.push({
      line_user_id: uid,
      kind: "owner",
      trainer_id: null,
      display_name: null,
      store_names: [],
      all_stores: true,
    });
  }

  const managed = await loadManagedStoresByTrainerId(supabase);
  const { data: trainers, error: trainerErr } = await supabase
    .from("trainers")
    .select("id, display_name, is_active, line_user_id")
    .eq("is_active", true);
  if (trainerErr) {
    console.warn("[trainerOpsScope] trainers lookup skipped", trainerErr.message);
  } else {
    for (const t of (trainers ?? []) as TrainerRow[]) {
      if (String(t.display_name ?? "").trim() === TRAINER_LINE_DEMO_NAME) continue;
      const uid = t.line_user_id ? String(t.line_user_id).trim() : "";
      if (!uid) continue;
      const fromDb = managed.get(t.id) ?? [];
      const fromDefault = DEFAULT_STORE_MANAGERS[String(t.display_name ?? "").trim()] ?? [];
      const storeNames = Array.from(new Set([...fromDb, ...fromDefault]));
      const name = String(t.display_name ?? "").trim();
      const allStores = DEFAULT_ALL_STORE_VIEWERS.has(name);
      rows.push({
        line_user_id: uid,
        kind: allStores || storeNames.length > 0 ? "store_manager" : "trainer",
        trainer_id: t.id,
        display_name: name || null,
        store_names: storeNames,
        all_stores: allStores,
      });
    }
  }

  return mergeOpsRecipients(rows);
}

export function filterRecipientsForStore(recipients: OpsRecipient[], storeName: string): OpsRecipient[] {
  return recipients.filter((r) => r.all_stores || r.store_names.includes(storeName));
}

export async function primaryManagedStore(
  supabase: SupabaseClient<Database>,
  trainerId: string,
  displayName: string
): Promise<{ id: string; name: string } | null> {
  const managed = await loadManagedStoresByTrainerId(supabase);
  const names = managed.get(trainerId) ?? DEFAULT_STORE_MANAGERS[displayName.trim()] ?? [];
  const name = names[0];
  if (!name) return null;
  const { data } = await supabase.from("stores").select("id,name").eq("name", name).maybeSingle();
  if (!data) return null;
  return { id: String(data.id), name: String(data.name) };
}

export async function pushOpsTexts(
  supabase: SupabaseClient<Database>,
  buildText: (r: OpsRecipient) => string | null
): Promise<{ ok: boolean; sent: number; skipped: number; error?: string }> {
  const token = dailyReportChannelToken();
  if (!token) return { ok: false, sent: 0, skipped: 0, error: "missing_line_token" };
  const recipients = await resolveOpsRecipients(supabase);
  if (recipients.length === 0) return { ok: false, sent: 0, skipped: 0, error: "no_recipients" };
  let sent = 0;
  let skipped = 0;
  let allOk = true;
  for (const r of recipients) {
    const text = buildText(r);
    if (!text || !text.trim()) {
      skipped += 1;
      continue;
    }
    const chunks = chunkLinePushText(text);
    const results = await pushLineTextChunks({ token, toUserId: r.line_user_id, chunks });
    if (results.every((x) => x.ok)) sent += 1;
    else allOk = false;
  }
  return { ok: allOk, sent, skipped, error: allOk ? undefined : "ops_push_failed" };
}
