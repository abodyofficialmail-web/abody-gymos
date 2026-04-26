import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

type Missing = { trainer_id: string; store_id: string; shift_count: number };

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get("limit") ?? "500")));

    const supabase = createSupabaseServiceClient();
    const [{ data: trainers, error: tErr }, { data: shifts, error: sErr }] = await Promise.all([
      supabase.from("trainers").select("id").limit(limit),
      supabase.from("trainer_shifts").select("trainer_id, store_id").limit(limit),
    ]);
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

    const trainerIds = new Set((trainers ?? []).map((t: any) => String(t.id)));
    const counts = new Map<string, Missing>();
    for (const r of shifts ?? []) {
      const tid = String((r as any).trainer_id ?? "");
      const sid = String((r as any).store_id ?? "");
      if (!tid) continue;
      if (trainerIds.has(tid)) continue;
      const cur = counts.get(tid) ?? { trainer_id: tid, store_id: sid, shift_count: 0 };
      cur.shift_count += 1;
      if (!cur.store_id && sid) cur.store_id = sid;
      counts.set(tid, cur);
    }

    const missing_trainers = Array.from(counts.values()).sort((a, b) => b.shift_count - a.shift_count);
    return NextResponse.json({
      ok: true,
      trainers_checked: (trainers ?? []).length,
      shifts_checked: (shifts ?? []).length,
      missing_trainer_ids_count: missing_trainers.length,
      missing_trainers,
      note:
        "missing_trainers に出た trainer_id は trainer_shifts に存在するが trainers に存在しません。POST で trainers を補完できます。",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const dry_run = Boolean((body as any).dry_run);

    const supabase = createSupabaseServiceClient();
    const { data: shifts, error: sErr } = await supabase
      .from("trainer_shifts")
      .select("trainer_id, store_id")
      .limit(5000);
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

    const { data: trainers, error: tErr } = await supabase.from("trainers").select("id").limit(5000);
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

    const trainerIds = new Set((trainers ?? []).map((t: any) => String(t.id)));
    const missing = new Map<string, { trainer_id: string; store_id: string }>();
    for (const r of shifts ?? []) {
      const tid = String((r as any).trainer_id ?? "");
      const sid = String((r as any).store_id ?? "");
      if (!tid) continue;
      if (trainerIds.has(tid)) continue;
      if (!missing.has(tid)) missing.set(tid, { trainer_id: tid, store_id: sid });
    }

    const toInsert = Array.from(missing.values()).map((m) => ({
      id: m.trainer_id,
      store_id: m.store_id,
      display_name: `(imported:${m.trainer_id.slice(0, 8)})`,
      hourly_rate_yen: null,
      is_active: true,
      user_id: null,
      email: null,
    }));

    if (dry_run) {
      return NextResponse.json({ ok: true, dry_run: true, will_insert: toInsert.length, rows: toInsert });
    }

    if (toInsert.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0 });
    }

    const { data, error } = await supabase
      .from("trainers")
      .insert(toInsert as any)
      .select("id, display_name, store_id, is_active");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, inserted: (data ?? []).length, inserted_rows: data ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

