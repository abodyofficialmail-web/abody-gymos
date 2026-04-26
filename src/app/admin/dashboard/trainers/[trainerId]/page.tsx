import { DashboardShell } from "../../_components/DashboardShell";
import { TrainerDetailClient } from "./trainerDetailClient";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { isProtectedTrainerName, trainerGateCookieName, verifyTrainerGateToken } from "@/lib/trainerGate";
import { TrainerGateClient } from "@/app/admin/_components/TrainerGateClient";

export default async function AdminDashboardTrainerDetailPage({ params }: { params: { trainerId: string } }) {
  const supabase = createSupabaseServiceClient();
  const { data: t, error } = await supabase
    .from("trainers")
    .select("id, display_name")
    .eq("id", params.trainerId)
    .maybeSingle();
  // trainer が取れない時は従来どおり client がエラーを出すが、ここは安全側で通す
  const protectedTrainer = t ? isProtectedTrainerName(t.display_name) : false;
  const cookieStore = await cookies();
  const token = cookieStore.get(trainerGateCookieName())?.value;
  const authed = t ? (protectedTrainer ? verifyTrainerGateToken(token, t.id) : true) : true;

  return (
    <DashboardShell title="トレーナー詳細">
      {authed ? (
        <TrainerDetailClient trainerId={params.trainerId} />
      ) : (
        <TrainerGateClient trainerId={params.trainerId} trainerName={t?.display_name ?? ""} />
      )}
    </DashboardShell>
  );
}

