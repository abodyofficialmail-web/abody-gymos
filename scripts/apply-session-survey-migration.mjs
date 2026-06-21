/**
 * session_survey テーブルを Supabase に作成する。
 *
 * 使い方（DBパスワードがある場合）:
 *   SUPABASE_DB_PASSWORD='your-db-password' node scripts/apply-session-survey-migration.mjs
 *
 * パスワードがない場合: SQL を表示するので Dashboard → SQL Editor で実行。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const sqlPath = path.join(root, "supabase/migrations/20260523120000_session_survey.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
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
    if (!process.env[k]) process.env[k] = v;
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
  if (!password || !url) return false;

  const ref = projectRefFromUrl(url);
  if (!ref) throw new Error("NEXT_PUBLIC_SUPABASE_URL が不正です");

  const host = process.env.SUPABASE_DB_HOST?.trim() || `aws-0-ap-northeast-1.pooler.supabase.com`;
  const connectionString =
    process.env.DATABASE_URL?.trim() ||
    `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`;

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(
      "select to_regclass('public.session_survey_invites') as invites, to_regclass('public.session_survey_responses') as responses"
    );
    console.log("OK: マイグレーション適用済み", rows[0]);
    return true;
  } finally {
    await client.end();
  }
}

async function checkTables(serviceKey, supabaseUrl) {
  const res = await fetch(`${supabaseUrl}/rest/v1/session_survey_invites?select=id&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  return res.ok;
}

async function main() {
  loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (serviceKey && supabaseUrl && (await checkTables(serviceKey, supabaseUrl))) {
    console.log("session_survey テーブルは既に存在します。");
    return;
  }

  if (process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_URL) {
    await applyWithPg();
    return;
  }

  console.log("=== session_survey マイグレーション（手動） ===\n");
  console.log("本番DBにテーブルがありません。Supabase Dashboard → SQL → New query に貼り付けて Run:\n");
  console.log(sql);
  console.log(
    "\nまたは DB パスワードを指定して再実行:\n  SUPABASE_DB_PASSWORD='...' node scripts/apply-session-survey-migration.mjs"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
