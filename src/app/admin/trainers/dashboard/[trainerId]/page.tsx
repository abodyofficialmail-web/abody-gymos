import { notFound } from "next/navigation";
import { GymShell } from "@/components/gym/GymShell";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { TrainerDetailClient } from "./trainerDetailClient";
import { TrainerGateClient } from "@/app/admin/_components/TrainerGateClient";
import { cookies } from "next/headers";
import { isProtectedTrainerName, trainerGateCookieName, verifyTrainerGateToken } from "@/lib/trainerGate";

export default async function AdminTrainerDashboardDetailPage({ params }: { params: { trainerId: string } }) {
  const supabase = createSupabaseServiceClient();
  const { data: t } = await supabase
    .from("trainers")
    .select("id, display_name, store_id")
    .eq("id", params.trainerId)
    .maybeSingle();
  if (!t) notFound();
  const storeId = (t as { store_id: string }).store_id;
  const { data: st } = await supabase.from("stores").select("name").eq("id", storeId).maybeSingle();
  const cookieStore = await cookies();
  const token = cookieStore.get(trainerGateCookieName())?.value;
  const protectedTrainer = isProtectedTrainerName(t.display_name);
  const authed = protectedTrainer ? verifyTrainerGateToken(token, t.id) : true;

  return (
    <GymShell
      title={`${t.display_name} — 詳細`}
      nav={[
        { href: "/admin/dashboard", label: "ホーム" },
        { href: "/admin/stores", label: "店舗" },
        { href: "/admin/trainers", label: "トレーナー" },
        { href: "/admin/members", label: "会員" },
      ]}
    >
      {authed ? (
        <TrainerDetailClient
          trainer={{
            id: t.id,
            display_name: t.display_name,
            store_id: storeId,
            store_name: st?.name ?? "",
          }}
        />
      ) : (
        <TrainerGateClient trainerId={t.id} trainerName={t.display_name} />
      )}
    </GymShell>
  );
}
