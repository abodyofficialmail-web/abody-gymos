/**
 * 食事パーソナル案内を EBI020 へテスト送信
 *
 *   node scripts/send-meal-personal-reminder-line-test.mjs --dry-run
 *   node scripts/send-meal-personal-reminder-line-test.mjs --slot=lunch
 */
import fs from "fs";
import path from "path";

const DEFAULT_MEMBER_CODE = "EBI020";
const DEFAULT_APP_URL = "https://abody-gymos.vercel.app";

function loadEnvFile(name) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (process.env[k]) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v) process.env[k] = v;
  }
}

async function main() {
  for (const name of [".env.local", ".env.vercel.production", ".env.prod.query"]) loadEnvFile(name);
  const dryRun = process.argv.includes("--dry-run");
  const slotArg = process.argv.find((a) => a.startsWith("--slot="));
  const slot = slotArg ? slotArg.slice("--slot=".length) : undefined;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
  const secret = process.env.TRAINER_GATE_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("TRAINER_GATE_SECRET または CRON_SECRET がありません");
    process.exit(1);
  }
  const res = await fetch(`${appUrl}/api/admin/send-meal-personal-reminder-test`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-meal-personal-test-key": secret,
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ member_codes: [DEFAULT_MEMBER_CODE], slot, dry_run: dryRun }),
  });
  const text = await res.text();
  console.log(res.status, text);
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
