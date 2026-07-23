/**
 * reservation_line_reminder_dispatches を作成する。
 *
 *   SUPABASE_DB_PASSWORD='...' node scripts/apply-reservation-line-reminder-dispatches-migration.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const sqlPath = path.join(
  root,
  "supabase/migrations/20260723130000_reservation_line_reminder_dispatches.sql"
);
const sql = fs.readFileSync(sqlPath, "utf8");

function loadEnvLocal() {
  for (const name of [".env.local", ".env.local.bak-before-vercel-run"]) {
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
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

async function tableExists(serviceKey, supabaseUrl) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/reservation_line_reminder_dispatches?select=id&limit=1`,
    {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    }
  );
  return res.ok;
}

async function main() {
  loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (serviceKey && supabaseUrl && (await tableExists(serviceKey, supabaseUrl))) {
    console.log("reservation_line_reminder_dispatches は既に存在します。");
    return;
  }

  console.log("=== reservation_line_reminder_dispatches マイグレーション（手動） ===\n");
  console.log("Supabase Dashboard → SQL → New query に貼り付けて Run:\n");
  console.log(sql);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
