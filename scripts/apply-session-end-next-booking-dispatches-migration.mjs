/**
 * session_end_next_booking_dispatches を作成する。
 *
 *   SUPABASE_DB_PASSWORD='...' node scripts/apply-session-end-next-booking-dispatches-migration.mjs
 *   DATABASE_URL='postgresql://...' node scripts/apply-session-end-next-booking-dispatches-migration.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const sqlPath = path.join(
  root,
  "supabase/migrations/20260820120000_session_end_next_booking_dispatches.sql"
);
const sql = fs.readFileSync(sqlPath, "utf8");

function loadEnvLocal() {
  for (const name of [".env.local", ".env.production.local", ".env.prod.query", ".env.local.bak-before-vercel-run"]) {
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
    const { rows } = await client.query(
      "select to_regclass('public.session_end_next_booking_dispatches') as table"
    );
    console.log("OK: マイグレーション適用済み", rows[0]);
    return true;
  } finally {
    await client.end();
  }
}

async function tableExists(serviceKey, supabaseUrl) {
  const res = await fetch(`${supabaseUrl}/rest/v1/session_end_next_booking_dispatches?select=id&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  return res.ok;
}

async function main() {
  loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (serviceKey && supabaseUrl && (await tableExists(serviceKey, supabaseUrl))) {
    console.log("session_end_next_booking_dispatches は既に存在します。");
    return;
  }

  if (await applyWithPg()) return;

  console.log("=== session_end_next_booking_dispatches マイグレーション（手動） ===\n");
  console.log("Supabase Dashboard → SQL → New query に貼り付けて Run:\n");
  console.log(sql);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
