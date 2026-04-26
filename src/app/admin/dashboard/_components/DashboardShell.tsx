import { GymShell } from "@/components/gym/GymShell";

const DASH_NAV = [
  { href: "/admin/dashboard", label: "ダッシュボード" },
  { href: "/admin/dashboard/trainers", label: "トレーナー" },
  { href: "/admin/dashboard/shifts", label: "シフト" },
  { href: "/admin/dashboard/reservations", label: "予約" },
  { href: "/admin/dashboard/members", label: "会員" },
] as const;

export function DashboardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <GymShell title={title} nav={[...DASH_NAV]}>
      {children}
    </GymShell>
  );
}

