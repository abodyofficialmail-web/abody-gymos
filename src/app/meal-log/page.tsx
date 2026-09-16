import { GymShell } from "@/components/gym/GymShell";
import { MealLogClient } from "@/app/meal-log/mealLogClient";
import type { MealSlot } from "@/lib/memberMealLogs";

export default function MealLogPage({
  searchParams,
}: {
  searchParams?: { s?: string; sig?: string; slot?: string };
}) {
  const s = searchParams?.s?.trim() ?? "";
  const sig = searchParams?.sig?.trim() ?? "";
  const signed = s && sig ? { s, sig } : null;
  const slotRaw = searchParams?.slot?.trim();
  const initialSlot =
    slotRaw === "breakfast" || slotRaw === "lunch" || slotRaw === "dinner" || slotRaw === "snack"
      ? (slotRaw as MealSlot)
      : null;

  return (
    <GymShell
      title="食事パーソナル"
      nav={[
        { href: "/member", label: "マイページ" },
        { href: "/booking", label: "予約" },
        { href: "/member/settings", label: "設定" },
        { href: "/login", label: "ログイン" },
      ]}
      mainClassName="pb-0 pt-4"
    >
      <MealLogClient signed={signed} initialSlot={initialSlot} />
    </GymShell>
  );
}
