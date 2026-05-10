import { DateTime } from "luxon";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { getMemberIdFromCookie } from "../_cookies";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const TZ = "Asia/Tokyo";

export async function GET() {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return json({ error: "未ログイン" }, 401);

    const supabase = createSupabaseServiceClient();

    const { data: member, error: mErr } = await (supabase as any)
      .from("members")
      .select("id, member_code, name, email, line_user_id, is_active")
      .eq("id", memberId)
      .maybeSingle();
    if (mErr) return json({ error: "会員の取得に失敗しました", detail: mErr.message }, 500);
    if (!member || !member.is_active) return json({ error: "未ログイン" }, 401);

    // マイページは「当月」だけだと月末に翌月予約が見えないため、今月〜翌月の2ヶ月分を返す
    const monthKey = DateTime.now().setZone(TZ).toFormat("yyyy-MM");
    const start = DateTime.fromISO(`${monthKey}-01`, { zone: TZ }).startOf("month");
    const end = start.plus({ months: 2 });

    const reservationSelectFull =
      "id, start_at, end_at, session_type, trainer_id, member_id, store_id, status, created_at, reschedule_count";
    const reservationSelectLegacy =
      "id, start_at, end_at, session_type, trainer_id, member_id, store_id, status, created_at";

    let resQuery = (supabase as any)
      .from("reservations")
      .select(reservationSelectFull)
      .eq("member_id", memberId)
      .neq("status", "cancelled")
      .gte("start_at", start.toUTC().toISO()!)
      .lt("start_at", end.toUTC().toISO()!)
      .order("start_at", { ascending: true });
    let { data: resRows, error: rErr } = await resQuery;
    if (rErr) {
      const msg = String(rErr.message ?? "");
      const retry =
        /reschedule_count|does not exist|column/i.test(msg) || (/PGRST/i.test(msg) && /column/i.test(msg));
      if (retry) {
        const second = await (supabase as any)
          .from("reservations")
          .select(reservationSelectLegacy)
          .eq("member_id", memberId)
          .neq("status", "cancelled")
          .gte("start_at", start.toUTC().toISO()!)
          .lt("start_at", end.toUTC().toISO()!)
          .order("start_at", { ascending: true });
        resRows = second.data;
        rErr = second.error;
      }
    }
    if (rErr) return json({ error: "予約の取得に失敗しました", detail: rErr.message }, 500);

    const rows = (resRows ?? []) as any[];
    const storeIds = Array.from(new Set(rows.map((r) => r.store_id).filter(Boolean)));
    const trainerIds = Array.from(new Set(rows.map((r) => r.trainer_id).filter(Boolean))) as string[];
    const [storesRes, trainersRes] = await Promise.all([
      storeIds.length
        ? (supabase as any).from("stores").select("id, name").in("id", storeIds)
        : Promise.resolve({ data: [], error: null }),
      trainerIds.length
        ? (supabase as any).from("trainers").select("id, display_name").in("id", trainerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const storeById = new Map<string, string>((storesRes.data ?? []).map((s: any) => [s.id, String(s.name ?? "")]));
    const trainerById = new Map<string, string>(
      (trainersRes.data ?? []).map((t: any) => [t.id, String(t.display_name ?? "")])
    );
    const reservations = rows.map((r: any) => ({
      ...r,
      stores: { name: storeById.get(r.store_id) ?? "" },
      trainers: r.trainer_id ? { display_name: trainerById.get(r.trainer_id) ?? "" } : null,
    }));

    // client_notes は環境によって未作成/スキーマキャッシュ未反映の場合があるため、失敗しても予約表示は継続する
    let notes: any[] = [];
    {
      const { data: notesData, error: nErr } = await (supabase as any)
        .from("client_notes")
        .select(
          `
            id,
            member_id,
            store_id,
            trainer_id,
            date,
            content,
            created_at,
            trainers(id, display_name),
            stores(id, name)
          `
        )
        .eq("member_id", memberId)
        .order("date", { ascending: false })
        .limit(30);
      if (nErr) {
        const msg = String(nErr.message ?? "");
        const isMissingTable = msg.includes("Could not find the table") || msg.includes("does not exist");
        if (!isMissingTable) return json({ error: "カルテの取得に失敗しました", detail: nErr.message }, 500);
        notes = [];
      } else {
        notes = notesData ?? [];
      }
    }

    return json(
      {
        member: {
          id: member.id,
          member_code: member.member_code,
          name: member.name ?? "",
          email: (member as any).email ?? null,
          line_user_id: member.line_user_id ?? null,
        },
        reservations: (reservations ?? []).map((r: any) => ({
          id: r.id,
          start_at: r.start_at,
          end_at: r.end_at,
          session_type: r.session_type ?? "store",
          reschedule_count: (r as any)?.reschedule_count ?? 0,
          store_id: r.store_id,
          store_name: r.stores?.name ?? "",
          trainer_id: r.trainer_id,
          trainer_name: r.trainers?.display_name ?? "",
          status: r.status,
        })),
        notes: (notes ?? []).map((n: any) => ({
          id: n.id,
          date: n.date,
          store_id: n.store_id,
          store_name: n.stores?.name ?? "",
          trainer_id: n.trainer_id,
          trainer_name: n.trainers?.display_name ?? "",
          content: n.content,
        })),
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "エラーが発生しました", detail: message }, 500);
  }
}

