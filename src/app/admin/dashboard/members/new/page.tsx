import { DashboardShell } from "../../_components/DashboardShell";
import { memberCodePrefixForStoreName, nextMemberCodeForStore } from "@/lib/memberRegistration";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { NewMemberClient } from "./newMemberClient";

function storeSortRank(storeName: string): number {
  if (storeName === "恵比寿") return 1;
  if (storeName === "上野") return 2;
  if (storeName === "桜木町") return 3;
  if (storeName === "新宿") return 4;
  return 99;
}

export default async function AdminDashboardNewMemberPage() {
  const supabase = createSupabaseServiceClient();
  const { data: stores } = await supabase.from("stores").select("id, name").eq("is_active", true).order("name", { ascending: true });

  const sortedStores = [...(stores ?? [])].sort(
    (a, b) => storeSortRank(a.name) - storeSortRank(b.name) || a.name.localeCompare(b.name, "ja")
  );

  const nextCodesByStoreId: Record<string, string> = {};
  for (const store of sortedStores) {
    if (!memberCodePrefixForStoreName(store.name)) continue;
    try {
      nextCodesByStoreId[store.id] = await nextMemberCodeForStore(supabase, store.name);
    } catch {
      // 表示用のため、失敗時はクライアント側で再取得
    }
  }

  return (
    <DashboardShell title="新規会員登録">
      <NewMemberClient
        stores={sortedStores.map((s) => ({ id: s.id, name: s.name }))}
        initialNextCodesByStoreId={nextCodesByStoreId}
      />
    </DashboardShell>
  );
}
