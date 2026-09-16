/**
 * member_training_logs を作成する。
 *
 *   node scripts/apply-member-training-logs-migration.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const sqlPath = path.join(root, "supabase/migrations/20260911120000_member_training_logs.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

function loadEnvLocal() {
  const files = fs.readdirSync(root).filter((f) => f.startsWith(".env"));
  for (const name of files) {
    const envPath = path.join(root, name);
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
    const { rows } = await client.query("select to_regclass('public.member_training_logs') as t");
    console.log("OK: マイグレーション適用済み", rows[0]);
    return true;
  } finally {
    await client.end();
  }
}

async function main() {
  loadEnvLocal();
  console.log("has_database_url", Boolean(process.env.DATABASE_URL?.trim()));
  console.log("has_db_password", Boolean(process.env.SUPABASE_DB_PASSWORD?.trim()));
  console.log("has_supabase_url", Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()));
  if (await applyWithPg()) return;
  console.error("DB接続情報がなく、適用できませんでした");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
