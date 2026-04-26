import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { GymShell } from "@/components/gym/GymShell";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { MemberMemoClient } from "./memberMemoClient";

const TZ = "Asia/Tokyo";

export default async function AdminMemberKartePage({ params }: { params: { memberId: string } }) {
  const supabase = createSupabaseServiceClient();

  const { data: member } = await supabase
    .from("members")
    .select("id, member_code, name, is_active")
    .eq("id", params.memberId)
    .maybeSingle();
  if (!member) notFound();

  const monthKey = DateTime.now().setZone(TZ).toFormat("yyyy-MM");
  const start = DateTime.fromISO(`${monthKey}-01`, { zone: TZ }).startOf("month").toUTC().toISO()!;
  const end = DateTime.fromISO(`${monthKey}-01`, { zone: TZ }).startOf("month").plus({ months: 1 }).toUTC().toISO()!;

  const { data: reservations } = await supabase
    .from("reservations")
    .select("id, store_id, trainer_id, start_at, end_at, status, created_at")
    .eq("member_id", member.id)
    .neq("status", "cancelled")
    .gte("start_at", start)
    .lt("start_at", end)
    .order("start_at", { ascending: false });

  const storeIds = Array.from(new Set((reservations ?? []).map((r) => r.store_id).filter(Boolean)));
  const trainerIds = Array.from(new Set((reservations ?? []).map((r) => r.trainer_id).filter((x): x is string => !!x)));

  const [{ data: storeRows }, { data: trainerRows }] = await Promise.all([
    storeIds.length ? supabase.from("stores").select("id, name").in("id", storeIds) : Promise.resolve({ data: [] as any[] } as any),
    trainerIds.length
      ? supabase.from("trainers").select("id, display_name").in("id", trainerIds)
      : Promise.resolve({ data: [] as any[] } as any),
  ]);

  const storeNameById = new Map((storeRows ?? []).map((s: any) => [s.id, String(s.name ?? "")]));
  const trainerNameById = new Map((trainerRows ?? []).map((t: any) => [t.id, String(t.display_name ?? "")]));

  const storeName: string =
    (reservations ?? [])[0]?.store_id ? String(storeNameById.get((reservations ?? [])[0]!.store_id) ?? "") : "";

  return (
    <GymShell
      title="会員カルテ"
      nav={[
        { href: "/admin/dashboard", label: "ダッシュボード" },
        { href: "/admin/dashboard/members", label: "会員" },
        { href: "/admin/dashboard/reservations", label: "予約" },
      ]}
    >
      <div className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-2">
          <div className="text-lg font-bold text-slate-900">{member.name ?? "（名前未設定）"}</div>
          <div className="text-sm text-slate-700">{member.member_code}</div>
          <div className="text-xs text-slate-500">店舗: {storeName || "—"}</div>
          <div className="text-xs text-slate-500">{member.is_active ? "有効" : "無効"}</div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
          <div className="text-sm font-bold text-slate-900">トレーニング履歴（今月）</div>
          {(reservations ?? []).length === 0 ? <div className="text-sm text-slate-600">履歴がありません。</div> : null}
          <div className="grid gap-2">
            {(reservations ?? []).map((r: any) => (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-sm font-bold text-slate-900">
                  {DateTime.fromISO(r.start_at).setZone(TZ).toFormat("M/d HH:mm")}〜
                  {DateTime.fromISO(r.end_at).setZone(TZ).toFormat("HH:mm")}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  トレーナー: {r.trainer_id ? trainerNameById.get(r.trainer_id) ?? r.trainer_id : "-"} / 店舗:{" "}
                  {storeNameById.get(r.store_id) ?? r.store_id}
                </div>
              </div>
            ))}
          </div>
        </section>

        <MemberMemoClient />
      </div>
    </GymShell>
  );
}

