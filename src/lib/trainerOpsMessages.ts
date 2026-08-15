import type { SupabaseClient } from "@supabase/supabase-js";
import { primaryManagedStore, pushOpsTexts } from "@/lib/trainerOpsScope";

export type TrainerOpsKind = "order" | "report" | "feedback" | "other";

export type ParsedTrainerOps = {
  kind: TrainerOpsKind;
  body: string;
};

const KIND_LABEL: Record<TrainerOpsKind, string> = {
  order: "発注",
  report: "報告",
  feedback: "意見",
  other: "連絡",
};

export function opsKindLabel(kind: TrainerOpsKind): string {
  return KIND_LABEL[kind] ?? kind;
}

export function trainerOpsHelpText(): string {
  return [
    "運営連絡の送り方",
    "発注 プロテインがなくなりました",
    "報告 掃除と棚卸しをしました",
    "意見 UEN013さんが膝が痛いと言っていました",
    "",
    "店舗責任者の朝のLINEに載ります。",
  ].join("\n");
}

export function parseTrainerOpsCommand(raw: string): ParsedTrainerOps | { kind: "help" } | null {
  const t = raw.normalize("NFKC").trim();
  if (!t) return null;
  const compact = t.replace(/[！!。．.\s]+$/u, "");
  if (compact === "使い方" || compact === "ヘルプ" || compact.toLowerCase() === "help") {
    return { kind: "help" };
  }

  const m = t.match(/^(発注|注文|報告|今日やった|今日やったこと|意見|会員の声|連絡)[\s　]*(.*)$/u);
  if (!m) return null;
  const head = m[1];
  const body = (m[2] ?? "").trim();
  const kind: TrainerOpsKind =
    head === "発注" || head === "注文"
      ? "order"
      : head === "意見" || head === "会員の声"
        ? "feedback"
        : head === "連絡"
          ? "other"
          : "report";
  return { kind, body };
}

export async function saveTrainerOpsMessage(
  supabase: SupabaseClient,
  trainer: { id: string; display_name: string },
  parsed: ParsedTrainerOps
): Promise<{ storeName: string | null }> {
  const store = await primaryManagedStore(supabase, trainer.id, trainer.display_name);
  const { error } = await supabase.from("trainer_ops_messages" as any).insert({
    trainer_id: trainer.id,
    store_id: store?.id ?? null,
    kind: parsed.kind,
    body: parsed.body,
    status: "open",
  });
  if (error) throw error;
  return { storeName: store?.name ?? null };
}

export async function notifyTrainerOpsMessage(params: {
  supabase: SupabaseClient;
  trainerName: string;
  kind: TrainerOpsKind;
  body: string;
  storeName: string | null;
  fromLineUserId: string;
}): Promise<void> {
  const label = opsKindLabel(params.kind);
  const store = params.storeName ?? "店舗未設定";
  const text = [`【${store} ${label}】${params.trainerName}`, params.body].join("\n");
  await pushOpsTexts(params.supabase as any, (r) => {
    if (r.line_user_id === params.fromLineUserId) return null;
    if (r.all_stores) return text;
    if (params.storeName && r.store_names.includes(params.storeName)) return text;
    if (params.kind === "order" && r.kind === "store_manager") return text;
    return null;
  });
}
