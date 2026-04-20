import { GymShell } from "@/components/gym/GymShell";

export default function HomePage() {
  return (
    <GymShell
      title="管理ホーム"
      nav={[
        { href: "/admin/trainers", label: "トレーナー" },
      ]}
    >
      <p className="text-sm text-slate-700">Gym OS（分離版）</p>
    </GymShell>
  );
}

