/**
 * members.weight_reminder_line_enabled を追加する。
 *
 *   SUPABASE_DB_PASSWORD='...' node scripts/apply-weight-reminder-setting-migration.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const sqlPath = path.join(
  root,
  "supabase/migrations/20260904120000_members_weight_reminder_line_enabled.sql"
);
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

async function columnExists(serviceKey, supabaseUrl) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/members?select=id,weight_reminder_line_enabled&limit=1`,
    {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    }
  );
  return res.ok;
}

async function applyWithPg() {
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!password && !process.env.DATABASE_URL?.trim()) return false;

  const { default: pg } = await import("pg");
  const ref = url ? projectRefFromUrl(url) : null;
  const host = process.env.SUPABASE_DB_HOST?.trim() || `aws-0-ap-northeast-1.pooler.supabase.com`;
  const connectionString =
    process.env.DATABASE_URL?.trim() ||
    (ref && password
      ? `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`
      : "");
  if (!connectionString) return false;

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'members'
        and column_name = 'weight_reminder_line_enabled'
    `);
    console.log("OK: マイグレーション適用済み", rows[0] ?? null);
    return true;
  } finally {
    await client.end();
  }
}

async function main() {
  loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (serviceKey && supabaseUrl && (await columnExists(serviceKey, supabaseUrl))) {
    console.log("weight_reminder_line_enabled は既に存在します。");
    return;
  }

  if (process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_URL) {
    await applyWithPg();
    return;
  }

  console.log("=== weight_reminder_line_enabled マイグレーション（手動） ===\n");
  console.log("Supabase Dashboard → SQL → New query に貼り付けて Run:\n");
  console.log(sql);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
