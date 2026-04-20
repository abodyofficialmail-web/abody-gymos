import { GymShell } from "@/components/gym/GymShell";

export default function LoginStub() {
  return (
    <GymShell title="ログイン" nav={[]}>
      <p className="text-sm text-slate-700">
        この分離版プロジェクトでは認証UIは省略しています。Supabase Auth を利用する場合はここを実装してください。
      </p>
    </GymShell>
  );
}

