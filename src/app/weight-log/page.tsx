import { GymShell } from "@/components/gym/GymShell";
import { WeightLogPanel } from "@/components/member/WeightLogPanel";

export default function WeightLogPage({
  searchParams,
}: {
  searchParams?: { s?: string; sig?: string };
}) {
  const s = searchParams?.s?.trim() ?? "";
  const sig = searchParams?.sig?.trim() ?? "";
  const signed = s && sig ? { s, sig } : null;

  return (
    <GymShell title="体重・体脂肪" nav={[{ href: "/member", label: "マイページ" }]}>
      <div className="space-y-4">
        {!signed ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            このページはLINEの案内から開くか、
            <a href="/member?tab=weight" className="mx-1 font-semibold underline">
              マイページの体重・体脂肪
            </a>
            から記録してください。
          </div>
        ) : (
          <WeightLogPanel signed={signed} />
        )}
      </div>
    </GymShell>
  );
}
