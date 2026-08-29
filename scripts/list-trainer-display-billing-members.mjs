/** 担当トレーナー表示: DB列調査 + トレーナー指定予約会員の抽出 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // members テーブルの全カラムを1行サンプルで確認
  const { data: sample } = await supabase.from("members").select("*").limit(1);
  const memberColumns = sample?.[0] ? Object.keys(sample[0]).sort() : [];

  const trainerRelatedCols = memberColumns.filter((c) =>
    /trainer|display|billing|subscription|addon|option|plan|fee|charge|課金/i.test(c),
  );

  const now = new Date().toISOString();

  // 未来予約で trainer_id 指定がある会員
  const { data: futureWithTrainer } = await supabase
    .from("reservations")
    .select("member_id, trainer_id, start_at, store_id, status")
    .gt("start_at", now)
    .neq("status", "cancelled")
    .not("member_id", "is", null)
    .not("trainer_id", "is", null);

  const memberIds = [...new Set((futureWithTrainer ?? []).map((r) => r.member_id))];
  let membersWithTrainerFuture = [];
  if (memberIds.length) {
    const { data: members } = await supabase
      .from("members")
      .select("id, member_code, name, display_name, email, membership_status, store_id")
      .in("id", memberIds);
    const { data: stores } = await supabase.from("stores").select("id, name");
    const { data: trainers } = await supabase.from("trainers").select("id, display_name");
    const storeName = Object.fromEntries((stores ?? []).map((s) => [s.id, s.name]));
    const trainerName = Object.fromEntries((trainers ?? []).map((t) => [t.id, t.display_name]));

    membersWithTrainerFuture = (members ?? []).map((m) => {
      const res = (futureWithTrainer ?? []).filter((r) => r.member_id === m.id);
      const trainerIds = [...new Set(res.map((r) => r.trainer_id))];
      return {
        memberCode: m.member_code,
        name: m.display_name || m.name,
        store: storeName[m.store_id] ?? null,
        status: m.membership_status,
        futureTrainerBookings: res.length,
        trainers: trainerIds.map((id) => trainerName[id] ?? id),
      };
    });
    membersWithTrainerFuture.sort((a, b) => a.memberCode.localeCompare(b.memberCode));
  }

  // 全期間: 会員予約のうち trainer_id 付きが1件以上ある会員数
  const { data: allWithTrainer } = await supabase
    .from("reservations")
    .select("member_id")
    .neq("status", "cancelled")
    .not("member_id", "is", null)
    .not("trainer_id", "is", null);

  const everTrainerMemberIds = new Set((allWithTrainer ?? []).map((r) => r.member_id));

  console.log(
    JSON.stringify(
      {
        note: "担当トレーナー表示システムの課金フラグは members テーブルに見当たりません",
        memberColumns,
        trainerRelatedColumns: trainerRelatedCols,
        membersWithFutureTrainerAssigned: membersWithTrainerFuture.length,
        membersEverHadTrainerAssignedReservation: everTrainerMemberIds.size,
        futureTrainerAssignedMembers: membersWithTrainerFuture,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
