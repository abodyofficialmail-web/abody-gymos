/**
 * members.line_channel_key マイグレーション適用
 *
 *   SUPABASE_DB_PASSWORD='...' node scripts/apply-line-channel-key-migration.mjs
 *   DATABASE_URL='postgresql://...' node scripts/apply-line-channel-key-migration.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "../supabase/migrations/20260529120000_members_line_channel_key.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

function loadEnvLocal() {
  const names = [".env.local", ".env.production.local", ".env.vercel.production"];
  for (const name of names) {
    const envPath = path.join(__dirname, "..", name);
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
      if (!process.env[k] || process.env[k].length < 3) process.env[k] = v;
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

async function main() {
  loadEnvLocal();
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const direct = process.env.DATABASE_URL?.trim();

  let connectionString = direct;
  if (!connectionString && password && url) {
    const ref = projectRefFromUrl(url);
    const host = process.env.SUPABASE_DB_HOST?.trim() || "aws-0-ap-northeast-1.pooler.supabase.com";
    connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`;
  }

  if (!connectionString) {
    console.log("DB接続情報がありません。Supabase SQL Editor で以下を実行してください:\n");
    console.log(sql);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(
      "SELECT member_code, line_channel_key FROM members WHERE member_code = 'UEN018'"
    );
    console.log("OK", rows[0] ?? "(UEN018 not found)");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
