import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

const monthQuerySchema = z.object({
  store_id: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/u),
  trainer_id: z.string().uuid().optional(),
});

/** 全店舗（store_id 省略）も許可する month クエリ */
const monthAllQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/u),
  store_id: z.string().uuid().optional(),
  trainer_id: z.string().uuid().optional(),
});

/** store_id なし: ダッシュボード用（trainer_id + month、month 省略時は JST 当月） */
const trainerMonthQuerySchema = z.object({
  trainer_id: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/u).optional(),
});

const dateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  store_id: z.string().uuid().optional(),
  trainer_id: z.string().uuid().optional(),
});

const bodySchema = z.object({
  trainer_id: z.string().uuid(),
  store_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
  is_break: z.boolean().optional().default(false),
  break_minutes: z.number().int().min(0).optional().default(0),
});

const patchBodySchema = z.object({
  id: z.string().uuid(),
  /** シフト日（trainer_shifts.shift_date） */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  start_at: z.string().min(1).optional(),
  end_at: z.string().min(1).optional(),
  is_break: z.boolean().optional(),
  break_minutes: z.number().int().min(0).optional(),
});

const deleteBodySchema = z.object({
  id: z.string().uuid(),
});

function normalizeLocalTime(t: string): string {
  const s = t.trim();
  if (/^\d{2}:\d{2}:\d{2}$/u.test(s)) return s;
  if (/^\d{1,2}:\d{2}$/u.test(s)) {
    const [h, m] = s.split(":");
    return `${String(Number(h)).padStart(2, "0")}:${m}:00`;
  }
  if (/^\d{1,2}:\d{2}:\d{2}$/u.test(s)) {
    const [h, m, sec] = s.split(":");
    return `${String(Number(h)).padStart(2, "0")}:${m}:${sec}`;
  }
  return s;
}

function currentMonthKeyJst(): string {
  const ymd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  return ymd.slice(0, 7);
}

const SHIFT_SELECT_WITH_BREAKS =
  "id, trainer_id, store_id, shift_date, start_local, end_local, break_minutes, status, is_break, breaks:trainer_shift_breaks(id,start_time,end_time)" as const;
const SHIFT_SELECT_NO_BREAKS =
  "id, trainer_id, store_id, shift_date, start_local, end_local, break_minutes, status, is_break" as const;
const SHIFT_SELECT_NO_BREAK =
  "id, trainer_id, store_id, shift_date, start_local, end_local, status, is_break" as const;

function isMissingBreakMinutesError(error: unknown): boolean {
  const msg = typeof error === "object" && error && "message" in error ? String((error as any).message) : "";
  // PostgREST: "column trainer_shifts.break_minutes does not exist"
  return msg.includes("break_minutes") && (msg.includes("does not exist") || msg.includes("column"));
}

function isMissingBreaksRelationError(error: unknown): boolean {
  const msg = typeof error === "object" && error && "message" in error ? String((error as any).message) : "";
  // relationship / table not found
  return msg.includes("trainer_shift_breaks") && (msg.includes("does not exist") || msg.includes("relationship") || msg.includes("column"));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const supabase = createSupabaseServiceClient();

    const dateParam = url.searchParams.get("date") ?? undefined;
    const storeIdParam = url.searchParams.get("store_id") ?? undefined;
    const trainerIdParam = url.searchParams.get("trainer_id") ?? undefined;
    const monthParam = url.searchParams.get("month") ?? undefined;
    console.log("API shifts params:", {
      date: dateParam,
      store_id: storeIdParam,
      trainer_id: trainerIdParam,
      month: monthParam,
    });

    const dateParsed = dateQuerySchema.safeParse({
      date: url.searchParams.get("date"),
      store_id: url.searchParams.get("store_id") ?? undefined,
      trainer_id: url.searchParams.get("trainer_id") ?? undefined,
    });
    if (dateParsed.success) {
      const { date, store_id, trainer_id } = dateParsed.data;
      console.log("query range:", { start: date, endYmd: date });
      let q = supabase
        .from("trainer_shifts")
        .select(SHIFT_SELECT_WITH_BREAKS)
        .eq("shift_date", date)
        .neq("status", "draft");
      if (store_id) q = q.eq("store_id", store_id);
      if (trainer_id) q = q.eq("trainer_id", trainer_id);
      const { data, error } = await q.order("start_local", { ascending: true });
      if (error) {
        if (isMissingBreaksRelationError(error)) {
          let q0 = supabase
            .from("trainer_shifts")
            .select(SHIFT_SELECT_NO_BREAKS)
            .eq("shift_date", date)
            .neq("status", "draft");
          if (store_id) q0 = q0.eq("store_id", store_id);
          if (trainer_id) q0 = q0.eq("trainer_id", trainer_id);
          const { data: data0, error: error0 } = await q0.order("start_local", { ascending: true });
          if (error0) return json({ error: error0.message }, 500);
          const patched = (data0 ?? []).map((s: any) => ({ ...s, breaks: [] }));
          return json({ shifts: patched }, 200);
        }
        if (isMissingBreakMinutesError(error)) {
          let q2 = supabase
            .from("trainer_shifts")
            .select(SHIFT_SELECT_NO_BREAK)
            .eq("shift_date", date)
            .neq("status", "draft");
          if (store_id) q2 = q2.eq("store_id", store_id);
          if (trainer_id) q2 = q2.eq("trainer_id", trainer_id);
          const { data: data2, error: error2 } = await q2.order("start_local", { ascending: true });
          if (error2) return json({ error: error2.message }, 500);
          const patched = (data2 ?? []).map((s: any) => ({ ...s, break_minutes: 0, breaks: [] }));
          return json({ shifts: patched }, 200);
        }
        console.error("API shifts error:", error);
        console.error("[api/shifts] fetch_failed (date)", { date, store_id, trainer_id, error });
        return json({ error: error.message }, 500);
      }
      return json({ shifts: data ?? [] }, 200);
    }

    const trainerMonthParsed = trainerMonthQuerySchema.safeParse({
      trainer_id: url.searchParams.get("trainer_id"),
      month: url.searchParams.get("month") ?? undefined,
    });
    if (trainerMonthParsed.success && !url.searchParams.get("store_id")) {
      const { trainer_id } = trainerMonthParsed.data;
      const month = trainerMonthParsed.data.month ?? currentMonthKeyJst();
      const start = `${month}-01`;
      const y = Number(month.slice(0, 4));
      const m = Number(month.slice(5, 7));
      const end = new Date(Date.UTC(y, m, 0));
      const endYmd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(end);
      console.log("query range:", { start, endYmd });
      const { data, error } = await supabase
        .from("trainer_shifts")
        .select(SHIFT_SELECT_WITH_BREAKS)
        .eq("trainer_id", trainer_id)
        .gte("shift_date", start)
        .lte("shift_date", endYmd)
        .neq("status", "draft")
        .order("shift_date", { ascending: true })
        .order("start_local", { ascending: true });
      if (error) {
        if (isMissingBreaksRelationError(error)) {
          const { data: data0, error: error0 } = await supabase
            .from("trainer_shifts")
            .select(SHIFT_SELECT_NO_BREAKS)
            .eq("trainer_id", trainer_id)
            .gte("shift_date", start)
            .lte("shift_date", endYmd)
            .neq("status", "draft")
            .order("shift_date", { ascending: true })
            .order("start_local", { ascending: true });
          if (error0) return json({ error: error0.message }, 500);
          const patched = (data0 ?? []).map((s: any) => ({ ...s, breaks: [] }));
          return json({ shifts: patched }, 200);
        }
        if (isMissingBreakMinutesError(error)) {
          const { data: data2, error: error2 } = await supabase
            .from("trainer_shifts")
            .select(SHIFT_SELECT_NO_BREAK)
            .eq("trainer_id", trainer_id)
            .gte("shift_date", start)
            .lte("shift_date", endYmd)
            .neq("status", "draft")
            .order("shift_date", { ascending: true })
            .order("start_local", { ascending: true });
          if (error2) return json({ error: error2.message }, 500);
          const patched = (data2 ?? []).map((s: any) => ({ ...s, break_minutes: 0, breaks: [] }));
          return json({ shifts: patched }, 200);
        }
        console.error("API shifts error:", error);
        console.error("[api/shifts] fetch_failed (trainer_month)", { trainer_id, month, start, endYmd, error });
        return json({ error: error.message }, 500);
      }
      return json({ shifts: data ?? [] }, 200);
    }

    const monthAllParsed = monthAllQuerySchema.safeParse({
      month: url.searchParams.get("month"),
      store_id: url.searchParams.get("store_id") ?? undefined,
      trainer_id: url.searchParams.get("trainer_id") ?? undefined,
    });
    if (monthAllParsed.success && !url.searchParams.get("date")) {
      const { month, store_id, trainer_id } = monthAllParsed.data;
      const start = `${month}-01`;
      const y = Number(month.slice(0, 4));
      const m = Number(month.slice(5, 7));
      const end = new Date(Date.UTC(y, m, 0));
      const endYmd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(end);
      console.log("query range:", { start, endYmd, store_id, trainer_id });

      let q = supabase
        .from("trainer_shifts")
        .select(SHIFT_SELECT_WITH_BREAKS)
        .gte("shift_date", start)
        .lte("shift_date", endYmd)
        .neq("status", "draft");
      if (store_id) q = q.eq("store_id", store_id);
      if (trainer_id) q = q.eq("trainer_id", trainer_id);
      const { data, error } = await q.order("shift_date", { ascending: true }).order("start_local", { ascending: true });
      if (error) {
        if (isMissingBreaksRelationError(error)) {
          let q0 = supabase
            .from("trainer_shifts")
            .select(SHIFT_SELECT_NO_BREAKS)
            .gte("shift_date", start)
            .lte("shift_date", endYmd)
            .neq("status", "draft");
          if (store_id) q0 = q0.eq("store_id", store_id);
          if (trainer_id) q0 = q0.eq("trainer_id", trainer_id);
          const { data: data0, error: error0 } = await q0
            .order("shift_date", { ascending: true })
            .order("start_local", { ascending: true });
          if (error0) return json({ error: error0.message }, 500);
          const patched = (data0 ?? []).map((s: any) => ({ ...s, breaks: [] }));
          return json({ shifts: patched }, 200);
        }
        if (isMissingBreakMinutesError(error)) {
          let q2 = supabase
            .from("trainer_shifts")
            .select(SHIFT_SELECT_NO_BREAK)
            .gte("shift_date", start)
            .lte("shift_date", endYmd)
            .neq("status", "draft");
          if (store_id) q2 = q2.eq("store_id", store_id);
          if (trainer_id) q2 = q2.eq("trainer_id", trainer_id);
          const { data: data2, error: error2 } = await q2.order("shift_date", { ascending: true }).order("start_local", { ascending: true });
          if (error2) return json({ error: error2.message }, 500);
          const patched = (data2 ?? []).map((s: any) => ({ ...s, break_minutes: 0, breaks: [] }));
          return json({ shifts: patched }, 200);
        }
        console.error("API shifts error:", error);
        console.error("[api/shifts] fetch_failed (month_all)", { month, start, endYmd, store_id, trainer_id, error });
        return json({ error: error.message }, 500);
      }
      return json({ shifts: data ?? [] }, 200);
    }

    const monthParsed = monthQuerySchema.safeParse({
      store_id: url.searchParams.get("store_id"),
      month: url.searchParams.get("month"),
      trainer_id: url.searchParams.get("trainer_id") ?? undefined,
    });
    if (!monthParsed.success) {
      return json({ error: "invalid_query", detail: monthParsed.error.flatten() }, 400);
    }
    const { store_id, month, trainer_id } = monthParsed.data;
    const start = `${month}-01`;
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const end = new Date(Date.UTC(y, m, 0));
    const endYmd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(end);
    console.log("query range:", { start, endYmd });

    let q = supabase
      .from("trainer_shifts")
      .select(SHIFT_SELECT_WITH_BREAKS)
      .eq("store_id", store_id)
      .gte("shift_date", start)
      .lte("shift_date", endYmd)
      .neq("status", "draft");
    if (trainer_id) q = q.eq("trainer_id", trainer_id);
    const { data, error } = await q.order("shift_date", { ascending: true }).order("start_local", { ascending: true });
    if (error) {
      if (isMissingBreaksRelationError(error)) {
        let q0 = supabase
          .from("trainer_shifts")
          .select(SHIFT_SELECT_NO_BREAKS)
          .eq("store_id", store_id)
          .gte("shift_date", start)
          .lte("shift_date", endYmd)
          .neq("status", "draft");
        if (trainer_id) q0 = q0.eq("trainer_id", trainer_id);
        const { data: data0, error: error0 } = await q0
          .order("shift_date", { ascending: true })
          .order("start_local", { ascending: true });
        if (error0) return json({ error: error0.message }, 500);
        const patched = (data0 ?? []).map((s: any) => ({ ...s, breaks: [] }));
        return json({ shifts: patched }, 200);
      }
      if (isMissingBreakMinutesError(error)) {
        let q2 = supabase
          .from("trainer_shifts")
          .select(SHIFT_SELECT_NO_BREAK)
          .eq("store_id", store_id)
          .gte("shift_date", start)
          .lte("shift_date", endYmd)
          .neq("status", "draft");
        if (trainer_id) q2 = q2.eq("trainer_id", trainer_id);
        const { data: data2, error: error2 } = await q2
          .order("shift_date", { ascending: true })
          .order("start_local", { ascending: true });
        if (error2) return json({ error: error2.message }, 500);
        const patched = (data2 ?? []).map((s: any) => ({ ...s, break_minutes: 0, breaks: [] }));
        return json({ shifts: patched }, 200);
      }
      console.error("API shifts error:", error);
      console.error("[api/shifts] fetch_failed (store_month)", { store_id, trainer_id, month, start, endYmd, error });
      return json({ error: error.message }, 500);
    }
    return json({ shifts: data ?? [] }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("API shifts error:", e);
    console.error("[api/shifts] unexpected_error", { message });
    return json({ error: "unexpected_error", detail: message }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
    }
    const { trainer_id, store_id, date, start_at, end_at, is_break, break_minutes } = parsed.data;

    const supabase = createSupabaseServiceClient();
    const insertRow = {
      trainer_id,
      store_id,
      shift_date: date,
      start_local: normalizeLocalTime(start_at),
      end_local: normalizeLocalTime(end_at),
      break_minutes,
      status: "confirmed",
      is_break,
    } as any;

    const { data, error } = await supabase
      .from("trainer_shifts")
      .insert(insertRow)
      .select(SHIFT_SELECT_WITH_BREAKS)
      .single();
    if (error) return json({ error: "insert_failed", detail: error.message }, 500);
    return json({ shift: data }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "unexpected_error", detail: message }, 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = patchBodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
    }
    const { id, date, start_at, end_at, is_break, break_minutes } = parsed.data;
    const update: Record<string, string | boolean | number> = {};
    if (date !== undefined) update.shift_date = date;
    if (start_at !== undefined) update.start_local = normalizeLocalTime(start_at);
    if (end_at !== undefined) update.end_local = normalizeLocalTime(end_at);
    if (is_break !== undefined) update.is_break = is_break;
    if (break_minutes !== undefined) update.break_minutes = break_minutes;
    if (Object.keys(update).length === 0) {
      return json({ error: "invalid_body", detail: "No fields to update" }, 400);
    }
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("trainer_shifts")
      .update(update as any)
      .eq("id", id)
      .select(SHIFT_SELECT_WITH_BREAKS)
      .single();
    if (error) return json({ error: "update_failed", detail: error.message }, 500);
    return json({ shift: data }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "unexpected_error", detail: message }, 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = deleteBodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
    }
    const { id } = parsed.data;
    const supabase = createSupabaseServiceClient();

    // breaks が存在する環境では先に消す（FK制約回避）。無い環境は無視。
    try {
      await supabase.from("trainer_shift_breaks").delete().eq("shift_id", id);
    } catch {
      // ignore
    }

    const { error } = await supabase.from("trainer_shifts").delete().eq("id", id);
    if (error) return json({ error: "delete_failed", detail: error.message }, 500);
    return json({ ok: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "unexpected_error", detail: message }, 500);
  }
}

