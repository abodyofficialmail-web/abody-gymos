import { z } from "zod";
import { DateTime } from "luxon";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { sendSessionSurveyAfterClientNote } from "@/lib/sessionSurveyLine";

const TZ = "Asia/Tokyo";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mustCronAuth(req: Request): boolean {
  const reportSecret = process.env.REPORT_CRON_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const gateSecret = process.env.TRAINER_GATE_SECRET?.trim();
  const got = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const testKey = req.headers.get("x-session-survey-test-key") ?? "";
  if (reportSecret && got === reportSecret) return true;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (gateSecret && testKey === gateSecret) return true;
  return false;
}

const bodySchema = z.object({
  member_codes: z.array(z.string()).min(1).optional(),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: Request) {
  try {
    if (!mustCronAuth(req)) return json({ error: "unauthorized" }, 401);

    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const memberCodes = parsed.data.member_codes ?? ["EBI020"];
    const sessionDate = parsed.data.session_date ?? DateTime.now().setZone(TZ).toISODate()!;

    const supabase = createSupabaseServiceClient();
    const results: Array<Record<string, unknown>> = [];

    for (const memberCode of memberCodes) {
      const { data: member, error: mErr } = await supabase
        .from("members")
        .select("id, member_code, line_user_id, is_active")
        .eq("member_code", memberCode)
        .maybeSingle();
      if (mErr || !member?.is_active || !member.line_user_id) {
        results.push({ member_code: memberCode, sent: false, error: "member_or_line_missing" });
        continue;
      }

      const { data: note } = await supabase
        .from("client_notes")
        .select("id, trainer_id, store_id, trainers(display_name), stores(name)")
        .eq("member_id", member.id)
        .eq("date", sessionDate)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let trainerId = note?.trainer_id;
      let storeId = note?.store_id;
      let trainerName = (note as { trainers?: { display_name?: string } })?.trainers?.display_name ?? "トレーナー";
      let storeName = (note as { stores?: { name?: string } })?.stores?.name ?? "恵比寿";

      if (!trainerId || !storeId) {
        const { data: tr } = await supabase.from("trainers").select("id, display_name, store_id").eq("is_active", true).limit(1).maybeSingle();
        const { data: st } = await supabase.from("stores").select("id, name").eq("name", "恵比寿").eq("is_active", true).maybeSingle();
        trainerId = tr?.id;
        storeId = st?.id ?? tr?.store_id;
        trainerName = tr?.display_name ?? trainerName;
        storeName = st?.name ?? storeName;
      }

      if (!trainerId || !storeId) {
        results.push({ member_code: memberCode, sent: false, error: "trainer_or_store_missing" });
        continue;
      }

      const out = await sendSessionSurveyAfterClientNote(supabase, {
        member_id: member.id,
        trainer_id: trainerId,
        store_id: storeId,
        session_date: sessionDate,
        client_note_id: note?.id ?? null,
        line_user_id: String(member.line_user_id),
        member_code: String(member.member_code ?? memberCode),
        store_name: storeName,
        trainer_display_name: trainerName,
      });
      results.push({ member_code: memberCode, ...out });
    }

    return json({ ok: true, session_date: sessionDate, results }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}
