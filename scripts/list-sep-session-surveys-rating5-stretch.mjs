/**
 * 9月のセッション評価: 評価5 かつ 自由記述に「ストレッチ」を含む
 * node scripts/list-sep-session-surveys-rating5-stretch.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MONTH_START = "2026-09-01";
const MONTH_END = "2026-09-30";
const STRETCH = "ストレッチ";

const highlightLabel = {
  fun: "たのしかった",
  effective: "しっかり効いた",
  learned: "勉強になった",
  stress_relief: "ストレス発散できた",
  none: "なし",
};
const intensityLabel = {
  too_hard: "きつすぎた",
  just_right: "ちょうどいい",
  more_push: "もう少し追い込みたい",
};

function responseText(row) {
  const parts = [
    row.comment_general,
    row.comment_improve,
    row.comment_questions,
    row.followup_note,
  ];
  for (const id of row.highlights ?? []) {
    parts.push(highlightLabel[id] ?? id);
  }
  return parts.filter(Boolean).join("\n");
}

function hasStretch(row) {
  return responseText(row).includes(STRETCH);
}

function snippet(row) {
  const text = responseText(row);
  const i = text.indexOf(STRETCH);
  if (i === -1) return "";
  const start = Math.max(0, i - 20);
  const end = Math.min(text.length, i + STRETCH.length + 40);
  return text.slice(start, end).replace(/\n/g, " ");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [surveysResult, membersResult, trainersResult, storesResult] = await Promise.all([
    fetchAllChecked(
      supabase,
      "session_survey_responses",
      "id, member_id, trainer_id, store_id, session_date, rating, highlights, intensity_feedback, comment_general, comment_improve, comment_questions, followup_note, created_at",
      (q) => q.gte("session_date", MONTH_START).lte("session_date", MONTH_END).eq("rating", 5),
      "session_survey_responses.sep.rating5",
    ),
    fetchAllChecked(supabase, "members", "id, member_code, display_name, name", undefined, "members"),
    fetchAllChecked(supabase, "trainers", "id, display_name", undefined, "trainers"),
    fetchAllChecked(supabase, "stores", "id, name", undefined, "stores"),
  ]);

  const memberById = Object.fromEntries(membersResult.rows.map((m) => [m.id, m]));
  const trainerById = Object.fromEntries(trainersResult.rows.map((t) => [t.id, t.display_name]));
  const storeById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));

  const matched = [];
  for (const row of surveysResult.rows) {
    if (!hasStretch(row)) continue;
    const member = memberById[row.member_id];
    matched.push({
      responseId: row.id,
      sessionDate: row.session_date,
      memberCode: String(member?.member_code ?? "").toUpperCase() || "—",
      memberName: member?.display_name ?? member?.name ?? "—",
      trainerName: trainerById[row.trainer_id] ?? "—",
      storeName: storeById[row.store_id] ?? "—",
      rating: row.rating,
      highlights: (row.highlights ?? []).map((id) => highlightLabel[id] ?? id),
      intensity: intensityLabel[row.intensity_feedback] ?? row.intensity_feedback,
      commentGeneral: row.comment_general?.trim() || null,
      commentImprove: row.comment_improve?.trim() || null,
      commentQuestions: row.comment_questions?.trim() || null,
      stretchSnippet: snippet(row),
      createdAt: row.created_at,
    });
  }

  matched.sort(
    (a, b) =>
      a.sessionDate.localeCompare(b.sessionDate) ||
      a.memberCode.localeCompare(b.memberCode),
  );

  console.log(
    JSON.stringify(
      {
        criteria: {
          sessionDate: `${MONTH_START}〜${MONTH_END}`,
          rating: 5,
          stretchIn: "comment_general / comment_improve / comment_questions / followup_note / highlightsラベル",
        },
        rating5InSeptember: surveysResult.count,
        matchedCount: matched.length,
        items: matched,
      },
      null,
      2,
    ),
  );

  console.log("\n--- サマリー ---");
  console.log(`9月・評価5: ${surveysResult.count}件 / うち「${STRETCH}」含む: ${matched.length}件\n`);

  console.log("| # | セッション日 | 会員 | トレーナー | 店 | 抜粋 |");
  console.log("|---:|---|---|---|---|---|");
  matched.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.sessionDate} | ${r.memberCode} ${r.memberName} | ${r.trainerName} | ${r.storeName} | ${r.stretchSnippet.replace(/\|/g, "｜")} |`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
