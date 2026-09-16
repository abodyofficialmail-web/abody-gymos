/**
 * 朝の体重測定案内を EBI020 へテスト送信
 *
 *   node scripts/send-morning-weight-reminder-line-test.mjs --dry-run
 *   npx vercel env run --environment=production -- node scripts/send-morning-weight-reminder-line-test.mjs
 */
import fs from "fs";
import path from "path";

const DEFAULT_MEMBER_CODE = "EBI020";
const DEFAULT_APP_URL = "https://abody-gymos.vercel.app";

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
    const cur = process.env[k];
    if (cur !== undefined && cur !== "") continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!v) continue;
    process.env[k] = v;
  }
}

async function main() {
  for (const name of [".env.local", ".env.vercel.production", ".env.prod.query"]) loadEnvFile(name);

  const dryRun = process.argv.includes("--dry-run");
  const codesArg = process.argv.find((a) => a.startsWith("--codes="));
  const memberCodes = codesArg
    ? codesArg
        .slice("--codes=".length)
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
    : [DEFAULT_MEMBER_CODE];

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
  const secret = process.env.TRAINER_GATE_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("TRAINER_GATE_SECRET または CRON_SECRET がありません");
    process.exit(1);
  }

  const res = await fetch(`${appUrl}/api/admin/send-morning-weight-reminder-test`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-weight-log-test-key": secret,
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ member_codes: memberCodes, dry_run: dryRun }),
  });
  const json = await res.json().catch(() => ({}));
  console.log(JSON.stringify({ status: res.status, ...json }, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
