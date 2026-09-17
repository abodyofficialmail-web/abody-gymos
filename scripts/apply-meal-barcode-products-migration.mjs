/**
 * JANマスタテーブルを作成する。
 *
 *   SUPABASE_DB_PASSWORD='...' node scripts/apply-meal-barcode-products-migration.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const sqlPath = path.join(root, "supabase/migrations/20260917120000_meal_barcode_products.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

function loadEnvLocal() {
  for (const name of [".env.local", ".env.production.local", ".env.prod.query", ".env.vercel.production"]) {
    const envPath = path.join(root, name);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const k = t.slice(0, i);
      let v = t.slice(i + 1);
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k] || !String(process.env[k]).trim()) process.env[k] = v;
    }
  }
}

async function tableExists(serviceKey, supabaseUrl) {
  const res = await fetch(`${supabaseUrl}/rest/v1/meal_barcode_products?select=barcode&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  return res.ok;
}

async function applyWithPg() {
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if ((!password || !url) && !databaseUrl) return false;
  let connectionString = databaseUrl;
  if (!connectionString) {
    const ref = new URL(url).hostname.split(".")[0];
    const host = process.env.SUPABASE_DB_HOST?.trim() || "aws-0-ap-northeast-1.pooler.supabase.com";
    connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`;
  }
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.log("OK: meal_barcode_products");
    return true;
  } finally {
    await client.end();
  }
}

async function main() {
  loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceKey && supabaseUrl && (await tableExists(serviceKey, supabaseUrl))) {
    console.log("meal_barcode_products は既に存在します。");
    return;
  }
  if (await applyWithPg()) return;
  console.log("=== JANマスタ マイグレーション（手動） ===\n");
  console.log("Supabase Dashboard → SQL → New query に貼り付けて Run:\n");
  console.log(sql);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
