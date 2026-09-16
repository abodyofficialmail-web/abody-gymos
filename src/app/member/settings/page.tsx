import { GymShell } from "@/components/gym/GymShell";
import { MemberSettingsPanel } from "@/components/member/MemberSettingsPanel";

export default function MemberSettingsPage() {
  return (
    <GymShell
      title="設定"
      nav={[
        { href: "/member", label: "マイページ" },
        { href: "/booking", label: "予約" },
        { href: "/login", label: "ログイン" },
      ]}
    >
      <MemberSettingsPanel />
    </GymShell>
  );
}
