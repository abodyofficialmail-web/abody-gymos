import { GymShell } from "@/components/gym/GymShell";

const DASH_NAV = [
  { href: "/admin/dashboard", label: "ダッシュボード" },
  { href: "/admin/dashboard/trainers", label: "トレーナー" },
  { href: "/admin/dashboard/shifts", label: "シフト" },
  { href: "/admin/dashboard/reservations", label: "予約" },
  { href: "/admin/dashboard/members", label: "会員" },
  { href: "/admin/dashboard/session-surveys", label: "セッション評価" },
  { href: "/admin/dashboard/marketing", label: "広告レポート" },
  { href: "/admin/dashboard/manual", label: "使い方" },
] as const;

export function DashboardShell({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <GymShell title={title} nav={[...DASH_NAV]} wide={wide}>
      {children}
    </GymShell>
  );
}

