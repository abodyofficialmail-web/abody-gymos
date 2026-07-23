import { DateTime } from "luxon";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";

const TZ = "Asia/Tokyo";
const SLOT_MINUTES = 30;

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .optional(),
});

type ShiftDto = {
  trainer_id: string;
  trainer_name: string;
  start_local: string;
  end_local: string;
};

type StoreOverviewDto = {
  store_id: string;
  store_name: string;
  reservation_count: number;
  available_slot_count: number;
  available_minutes: number;
  shifts: ShiftDto[];
};

function formatTimeHhMm(t: unknown): string {
  const s = String(t ?? "");
  return s.length >= 5 ? s.slice(0, 5) : s;
}

async function fetchAvailableSlotsCount(params: { origin: string; storeId: string; dateYmd: string }): Promise<number> {
  const { origin, storeId, dateYmd } = params;
  const url = new URL("/api/booking-v2/available-slots", origin);
  url.searchParams.set("store_id", storeId);
  url.searchParams.set("date", dateYmd);
  url.searchParams.set("ignore_cutoff", "1");
  // 当日サマリ用: 時刻経過で消えないよう過去の空き枠も含める
  url.searchParams.set("include_past", "1");
  const res = await fetch(url.toString(), { cache: "no-store" });
  const j = await res.json().catch(() => []);
  if (!res.ok) return 0;
  return Array.isArray(j) ? j.length : 0;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      date: url.searchParams.get("date") ?? undefined,
    });
    if (!parsed.success) return jsonResponse({ error: "クエリが不正です", detail: parsed.error.flatten() }, 400);

    const dateYmd = parsed.data.date ?? DateTime.now().setZone(TZ).toISODate()!;
    const supabase = createSupabaseServiceClient();

    const { data: stores, error: storeErr } = await supabase
      .from("stores")
      .select("id,name")
      .order("created_at", { ascending: true });
    if (storeErr) return jsonResponse({ error: "店舗の取得に失敗しました", detail: storeErr.message }, 500);

    const dayStartUtc = DateTime.fromISO(dateYmd, { zone: TZ }).startOf("day").toUTC();
    const dayEndUtc = dayStartUtc.plus({ days: 1 });

    const [resQ, shiftsQ] = await Promise.all([
      supabase
        .from("reservations")
        .select("id, store_id")
        .neq("status", "cancelled")
        .gte("start_at", dayStartUtc.toISO()!)
        .lt("start_at", dayEndUtc.toISO()!),
      supabase
        .from("trainer_shifts")
        .select("id, store_id, trainer_id, shift_date, start_local, end_local, status, is_break")
        .eq("shift_date", dateYmd)
        .neq("status", "draft"),
    ]);

    if (resQ.error) return jsonResponse({ error: "予約の取得に失敗しました", detail: resQ.error.message }, 500);
    if (shiftsQ.error) return jsonResponse({ error: "シフトの取得に失敗しました", detail: shiftsQ.error.message }, 500);

    const trainerIds = Array.from(
      new Set((shiftsQ.data ?? []).map((s: any) => String(s.trainer_id ?? "")).filter(Boolean))
    );
    const trainersQ = trainerIds.length
      ? await supabase.from("trainers").select("id,display_name").in("id", trainerIds)
      : ({ data: [], error: null } as any);
    if (trainersQ.error) return jsonResponse({ error: "トレーナーの取得に失敗しました", detail: trainersQ.error.message }, 500);

    const trainerNameById = new Map<string, string>();
    for (const t of trainersQ.data ?? []) {
      trainerNameById.set(String((t as any).id), String((t as any).display_name ?? ""));
    }

    const reservationCountByStore = new Map<string, number>();
    for (const r of resQ.data ?? []) {
      const sid = String((r as any).store_id ?? "");
      if (!sid) continue;
      reservationCountByStore.set(sid, (reservationCountByStore.get(sid) ?? 0) + 1);
    }

    const shiftsByStore = new Map<string, ShiftDto[]>();
    for (const s of shiftsQ.data ?? []) {
      if ((s as any).is_break === true) continue;
      const sid = String((s as any).store_id ?? "");
      if (!sid) continue;
      const trainerId = String((s as any).trainer_id ?? "");
      const arr = shiftsByStore.get(sid) ?? [];
      arr.push({
        trainer_id: trainerId,
        trainer_name: trainerNameById.get(trainerId) || trainerId,
        start_local: formatTimeHhMm((s as any).start_local),
        end_local: formatTimeHhMm((s as any).end_local),
      });
      shiftsByStore.set(sid, arr);
    }
    for (const [, list] of shiftsByStore) {
      list.sort((a, b) => a.start_local.localeCompare(b.start_local) || a.trainer_name.localeCompare(b.trainer_name, "ja"));
    }

    const origin = url.origin;
    const storeList = (stores ?? []) as Array<{ id: string; name: string }>;
    const overviews: StoreOverviewDto[] = await Promise.all(
      storeList.map(async (st) => {
        const storeId = String(st.id);
        const available_slot_count = await fetchAvailableSlotsCount({ origin, storeId, dateYmd });
        return {
          store_id: storeId,
          store_name: String(st.name ?? ""),
          reservation_count: reservationCountByStore.get(storeId) ?? 0,
          available_slot_count,
          available_minutes: available_slot_count * SLOT_MINUTES,
          shifts: shiftsByStore.get(storeId) ?? [],
        };
      })
    );

    return jsonResponse({ date: dateYmd, stores: overviews }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "ダッシュボード概要の取得に失敗しました", detail: message }, 500);
  }
}
