/**
 * 会員登録 + 初回カルテ投入（本番/ローカル共通）
 * Usage: node scripts/seed-members-with-chart.mjs UEN052 SAK049
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

/** 既に環境変数が入っているキーは上書きしない */
function loadEnvFile(name) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (process.env[k] !== undefined && process.env[k] !== "") continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env.production.local");

const MEMBERS = {
  UEN052: {
    name: "崔　智穎",
    email: "tomoeisai@gmail.com",
    storeName: "上野",
  },
  UEN053: {
    name: "中尾啓史",
    email: "hiro1210050779@gmail.com",
    storeName: "上野",
  },
  UEN054: {
    name: "水谷友彦",
    email: "anazawa.story@gmail.com",
    storeName: "上野",
  },
  SAK049: {
    name: "藤咲彩香",
    email: "ayaka19951016@yahoo.co.jp",
    storeName: "桜木町",
  },
  UEN055: {
    name: "小川真美",
    email: "pash_404@yahoo.co.jp",
    storeName: "上野",
  },
  UEN056: {
    name: "池野奨平",
    email: "ikeno.shohei@gmail.com",
    storeName: "上野",
  },
  SAK050: {
    name: "北山潤美",
    email: "uruminn@I.softbank.jp",
    storeName: "桜木町",
  },
  SAK051: {
    name: "川本順利",
    email: "ma55ma33@gmail.com",
    storeName: "桜木町",
  },
  EBI030: {
    name: "中井由奈",
    email: "yuna0825.lucy0122@gmail.com",
    storeName: "恵比寿",
  },
  EBI031: {
    name: "鈴木大輝",
    email: "oblsdi@icloud.com",
    storeName: "恵比寿",
  },
  SHI001: {
    name: "寺田真二郎",
    email: "shinjir000@yahoo.co.jp",
    storeName: "新宿",
  },
  SHI002: {
    name: "渡邉友哉",
    email: "wtnbtmy1119@gmail.com",
    storeName: "新宿",
  },
  UEN057: {
    name: "森貴昭",
    email: "takaaki.rug@icloud.com",
    storeName: "上野",
  },
  SHI003: {
    name: "相川翔",
    email: "good_again123@yahoo.co.jp",
    storeName: "新宿",
  },
  SHI004: {
    name: "川井えりか",
    email: "12sweet06@gmail.com",
    storeName: "新宿",
  },
  SHI005: {
    name: "宮川裕充",
    email: "myahrhr@gmail.com",
    storeName: "新宿",
  },
  SHI006: {
    name: "澤田有人夢",
    email: "yourenmengz@gmail.com",
    storeName: "新宿",
  },
};

async function ensureClientNote(supabase, memberId, storeId) {
  const { data: existing } = await supabase
    .from("client_notes")
    .select("id")
    .eq("member_id", memberId)
    .limit(1);
  if (existing?.length) return { skipped: true };

  const { data: trainers, error: tErr } = await supabase
    .from("trainers")
    .select("id")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .limit(1);
  if (tErr) throw tErr;
  let trainerId = trainers?.[0]?.id ?? null;
  if (!trainerId) {
    const { data: anyTrainer, error: anyErr } = await supabase
      .from("trainers")
      .select("id")
      .eq("is_active", true)
      .limit(1);
    if (anyErr) throw anyErr;
    trainerId = anyTrainer?.[0]?.id ?? null;
  }
  if (!trainerId) return { skipped: true, reason: "no_active_trainer" };

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("client_notes").insert({
    member_id: memberId,
    store_id: storeId,
    trainer_id: trainerId,
    date: today,
    content: "初回カルテ（自動投入）",
  });
  if (error) throw error;
  return { created: true };
}

async function main() {
  const codes = process.argv.slice(2).map((c) => c.trim().toUpperCase());
  if (codes.length === 0) {
    console.error("Usage: node scripts/seed-members-with-chart.mjs UEN052 SAK049");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: stores, error: sErr } = await supabase.from("stores").select("id, name");
  if (sErr) throw sErr;
  const storeIdByName = new Map((stores ?? []).map((s) => [s.name, s.id]));

  for (const code of codes) {
    const spec = MEMBERS[code];
    if (!spec) {
      console.warn("skip unknown code", code);
      continue;
    }
    const store_id = storeIdByName.get(spec.storeName);
    if (!store_id) throw new Error(`store not found: ${spec.storeName}`);

    const { data: existing } = await supabase
      .from("members")
      .select("line_user_id")
      .eq("member_code", code)
      .maybeSingle();

    const { data: member, error: uErr } = await supabase
      .from("members")
      .upsert(
        {
          member_code: code,
          name: spec.name,
          display_name: spec.name,
          email: spec.email,
          store_id,
          is_active: true,
          line_user_id: existing?.line_user_id ?? null,
        },
        { onConflict: "member_code" }
      )
      .select("id, member_code, email, line_user_id, store_id")
      .single();
    if (uErr) throw uErr;

    const note = await ensureClientNote(supabase, member.id, member.store_id ?? store_id);
    console.log(JSON.stringify({ member_code: code, member_id: member.id, email: member.email, chart: note }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
