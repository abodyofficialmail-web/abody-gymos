/**
 * member_nutrition_targets を作成する。
 *
 *   SUPABASE_DB_PASSWORD='...' node scripts/apply-member-nutrition-targets-migration.mjs
 *   DATABASE_URL='postgresql://...' node scripts/apply-member-nutrition-targets-migration.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const sqlPath = path.join(root, "supabase/migrations/20260806120000_member_nutrition_targets.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

function loadEnvLocal() {
  for (const name of [
    ".env.local",
    ".env.production.local",
    ".env.prod.query",
    ".env.local.bak-before-vercel-run",
    ".env.vercel.production",
  ]) {
    const envPath = path.join(root, name);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const k = t.slice(0, i);
      let v = t.slice(i + 1);
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k] || !String(process.env[k]).trim()) process.env[k] = v;
    }
  }
}

function projectRefFromUrl(url) {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
}

async function applyWithPg() {
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if ((!password || !url) && !databaseUrl) return false;

  let connectionString = databaseUrl;
  if (!connectionString) {
    const ref = projectRefFromUrl(url);
    if (!ref) throw new Error("NEXT_PUBLIC_SUPABASE_URL が不正です");
    const host = process.env.SUPABASE_DB_HOST?.trim() || `aws-0-ap-northeast-1.pooler.supabase.com`;
    connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`;
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query("select to_regclass('public.member_nutrition_targets') as t");
    console.log("OK: マイグレーション適用済み", rows[0]);
    return true;
  } finally {
    await client.end();
  }
}

async function checkTable(serviceKey, supabaseUrl) {
  const res = await fetch(`${supabaseUrl}/rest/v1/member_nutrition_targets?select=member_id&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  return res.ok;
}

async function main() {
  loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (serviceKey && supabaseUrl && (await checkTable(serviceKey, supabaseUrl))) {
    console.log("member_nutrition_targets テーブルは既に存在します。");
    return;
  }

  if (process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_URL) {
    await applyWithPg();
    if (serviceKey && supabaseUrl && (await checkTable(serviceKey, supabaseUrl))) {
      console.log("確認OK: REST からも参照できます。");
    }
    return;
  }

  console.log("=== member_nutrition_targets マイグレーション（手動） ===\n");
  console.log("DBパスワードが未設定です。次のどちらかで実行してください:\n");
  console.log("1) SUPABASE_DB_PASSWORD='あなたのDBパスワード' node scripts/apply-member-nutrition-targets-migration.mjs");
  console.log("2) Supabase Dashboard → SQL → New query に以下を貼って Run:\n");
  console.log(sql);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
