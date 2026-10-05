"use client";

import { MealPersonalEntry } from "@/components/member/MealPersonalEntry";
import { GymShell } from "@/components/gym/GymShell";

export default function MealPersonalNewStartPage() {
  return (
    <GymShell
      title="食事パーソナル"
      nav={[
        { href: "/meal-log", label: "ホーム" },
        { href: "/member", label: "マイページ" },
        { href: "/login", label: "ログイン" },
      ]}
      mainClassName="pb-0 pt-4"
    >
      <MealPersonalEntry initialView="questions" onLoggedIn={() => { window.location.href = "/meal-log"; }} />
    </GymShell>
  );
}
