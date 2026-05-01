import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const querySchema = z.object({
  store_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
});

type ShiftDto = {
  id: string;
  trainer_id: string;
  trainer_name: string;
  store_id: string;
  date: string; // YYYY-MM-DD
  start_local: string; // HH:mm or HH:mm:ss
  end_local: string; // HH:mm or HH:mm:ss
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      store_id: url.searchParams.get("store_id") ?? undefined,
      date: url.searchParams.get("date") ?? undefined,
    });
    if (!parsed.success) return jsonResponse({ error: "クエリが不正です", detail: parsed.error.flatten() }, 400);

    const { store_id, date } = parsed.data;
    const supabase = createSupabaseServiceClient();

    // schema A: shift_date / start_local / end_local
    let shifts: any[] = [];
    let useSchemaB = false;
    const qA = await (supabase as any)
      .from("trainer_shifts")
      .select("id, trainer_id, store_id, shift_date, start_local, end_local, status, is_break")
      .eq("store_id", store_id)
      .eq("shift_date", date)
      .neq("status", "draft");
    if (qA?.error) {
      useSchemaB = true;
    } else {
      shifts = qA.data ?? [];
      const hasAny = shifts.some((s) => (s as any)?.start_local && (s as any)?.end_local);
      if (!hasAny) useSchemaB = true;
    }

    // schema B: date / start_time / end_time
    if (useSchemaB) {
      const qB = await (supabase as any)
        .from("trainer_shifts")
        .select("id, trainer_id, store_id, date, start_time, end_time, status, is_break")
        .eq("store_id", store_id)
        .eq("date", date)
        .neq("status", "draft");
      if (qB?.error) return jsonResponse({ error: "シフトの取得に失敗しました", detail: qB.error.message }, 500);
      shifts = qB.data ?? [];
    }

    const trainerIds = Array.from(new Set((shifts ?? []).map((s) => String((s as any).trainer_id ?? "")).filter(Boolean)));
    const { data: trainers, error: tErr } = await (supabase as any)
      .from("trainers")
      .select("id, display_name")
      .in("id", trainerIds);
    if (tErr) return jsonResponse({ error: "トレーナーの取得に失敗しました", detail: tErr.message }, 500);
    const nameById = new Map((trainers ?? []).map((t: any) => [String(t.id), String(t.display_name ?? "")]));

    const out: ShiftDto[] = (shifts ?? [])
      .filter((s) => !(s as any)?.is_break)
      .map((s) => {
        const start = String((s as any).start_local ?? (s as any).start_time ?? "");
        const end = String((s as any).end_local ?? (s as any).end_time ?? "");
        const trainerId = String((s as any).trainer_id ?? "");
        return {
          id: String((s as any).id),
          trainer_id: trainerId,
          trainer_name: String(nameById.get(trainerId) ?? ""),
          store_id: String((s as any).store_id ?? store_id),
          date,
          start_local: start,
          end_local: end,
        };
      })
      .filter((s) => s.id && s.trainer_id && s.start_local && s.end_local);

    // trainer_name あり優先、同名は時刻順
    out.sort((a, b) => (a.trainer_name || a.trainer_id).localeCompare(b.trainer_name || b.trainer_id, "ja"));

    return jsonResponse({ shifts: out }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "シフト取得でエラーが発生しました", detail: message }, 500);
  }
}

