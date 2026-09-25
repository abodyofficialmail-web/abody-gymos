import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";

const TZ = "Asia/Tokyo";

export type ReservationChangeAction = "cancel" | "reschedule" | "create";
export type ReservationChangeSource = "member_page" | "admin_dashboard" | "admin_bulk_line";
export type ReservationChangeActorType = "member" | "trainer" | "system";

export type ReservationChangeLogRow = {
  id: string;
  reservation_id: string;
  member_id: string | null;
  action: ReservationChangeAction;
  source: ReservationChangeSource;
  actor_type: ReservationChangeActorType;
  actor_id: string | null;
  actor_label: string | null;
  before_status: string | null;
  after_status: string | null;
  before_start_at: string | null;
  before_end_at: string | null;
  before_store_id: string | null;
  after_start_at: string | null;
  after_end_at: string | null;
  after_store_id: string | null;
  user_agent: string | null;
  created_at: string;
};

export async function insertReservationChangeLog(
  supabase: SupabaseClient,
  row: {
    reservation_id: string;
    member_id?: string | null;
    action: ReservationChangeAction;
    source: ReservationChangeSource;
    actor_type: ReservationChangeActorType;
    actor_id?: string | null;
    actor_label?: string | null;
    before_status?: string | null;
    after_status?: string | null;
    before_start_at?: string | null;
    before_end_at?: string | null;
    before_store_id?: string | null;
    after_start_at?: string | null;
    after_end_at?: string | null;
    after_store_id?: string | null;
    user_agent?: string | null;
  }
): Promise<void> {
  const { error } = await (supabase as any).from("reservation_change_logs").insert({
    reservation_id: row.reservation_id,
    member_id: row.member_id ?? null,
    action: row.action,
    source: row.source,
    actor_type: row.actor_type,
    actor_id: row.actor_id ?? null,
    actor_label: row.actor_label ?? null,
    before_status: row.before_status ?? null,
    after_status: row.after_status ?? null,
    before_start_at: row.before_start_at ?? null,
    before_end_at: row.before_end_at ?? null,
    before_store_id: row.before_store_id ?? null,
    after_start_at: row.after_start_at ?? null,
    after_end_at: row.after_end_at ?? null,
    after_store_id: row.after_store_id ?? null,
    user_agent: row.user_agent ? row.user_agent.slice(0, 400) : null,
  });
  if (error) {
    console.error("reservation_change_logs insert failed", error.message);
  }
}

export function requestUserAgent(req: Request): string | null {
  return req.headers.get("user-agent");
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = DateTime.fromISO(iso).setZone(TZ);
  if (!dt.isValid) return "—";
  return dt.setLocale("ja").toFormat("M/d HH:mm");
}

export function formatReservationChangeSummary(row: {
  action: string;
  source: string;
  actor_label?: string | null;
  created_at: string;
  before_start_at?: string | null;
  after_start_at?: string | null;
}): string {
  const when = DateTime.fromISO(row.created_at).setZone(TZ);
  const whenText = when.isValid ? when.toFormat("M/d HH:mm") : "";
  const who =
    row.source === "member_page"
      ? "マイページ"
      : row.source === "admin_bulk_line"
        ? "一括キャンセルAPI"
        : row.actor_label
          ? `担当トレーナー（${row.actor_label}）`
          : "管理画面";
  if (row.action === "cancel") return `${whenText} ${who}がキャンセル`;
  if (row.action === "create") return `${whenText} ${who}が予約追加`;
  if (row.action === "reschedule") {
    return `${whenText} ${who}が ${fmtTime(row.before_start_at)} → ${fmtTime(row.after_start_at)} に変更`;
  }
  return `${whenText} ${who}`;
}
