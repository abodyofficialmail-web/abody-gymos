import Link from "next/link";
import { DashboardShell } from "../_components/DashboardShell";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export default async function AdminDashboardMembersPage() {
  const supabase = createSupabaseServiceClient();
  const { data: members } = await supabase
    .from("members")
    .select("id, member_code, name, line_user_id, is_active, created_at")
    .order("created_at", { ascending: false });

  return (
    <DashboardShell title="会員">
      <div className="space-y-3">
        <div className="text-sm text-slate-600">会員一覧</div>
        <div className="grid gap-2">
          {(members ?? []).map((m) => (
            <Link
              key={m.id}
              href={`/admin/dashboard/members/${m.id}`}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300"
            >
              <div className="text-base font-bold text-slate-900">{m.member_code}</div>
              <div className="pt-1 text-sm text-slate-700">{m.name ?? ""}</div>
              <div className="pt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">{m.is_active ? "有効" : "無効"}</span>
                <span
                  className={[
                    "rounded-full px-2 py-0.5 border",
                    m.line_user_id ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600",
                  ].join(" ")}
                >
                  {m.line_user_id ? "LINE連携済み" : "LINE未連携"}
                </span>
              </div>
            </Link>
          ))}
        </div>
        {(members ?? []).length === 0 ? <div className="text-sm text-slate-600">会員がいません。</div> : null}
      </div>
    </DashboardShell>
  );
}

