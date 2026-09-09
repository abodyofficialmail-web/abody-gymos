/**
 * 会員プランを Google Sheets / 本番API から取得し scripts/data/member-plans.json に保存
 *
 *   node --env-file=.env.local scripts/export-member-plans-snapshot.mjs
 *   node --env-file=.env.local scripts/export-member-plans-snapshot.mjs --from-production
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import {
  fetchMemberPlansFromSheet,
  isUnlimited60Plan,
} from "./lib/fetchMemberPlansFromSheet.mjs";

const OUT_PATH = path.join(process.cwd(), "scripts/data/member-plans.json");
const fromProduction = process.argv.includes("--from-production");

async function fetchFromProduction() {
  const url = process.env.MEMBER_PLANS_API_URL?.trim() || "https://abody-gymos.vercel.app";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY が未設定");

  const res = await fetch(`${url.replace(/\/$/, "")}/api/admin/member-plans`, {
    headers: { "x-service-role-key": serviceKey },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`本番API失敗 HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  return { plans: body.plans ?? [], source: `production_api:${url}` };
}

async function main() {
  let plans = [];
  let source = "unknown";

  if (fromProduction) {
    ({ plans, source } = await fetchFromProduction());
  } else if (process.env.GOOGLE_SHEET_ID?.trim()) {
    const planByCode = await fetchMemberPlansFromSheet();
    if (!planByCode?.size) throw new Error("Sheets からプランを取得できませんでした");
    plans = [...planByCode.entries()].map(([memberCode, info]) => ({
      memberCode,
      plan: info.plan,
      isUnlimited60: info.isUnlimited60,
    }));
    source = "google_sheets";
  } else {
    throw new Error("GOOGLE_SHEET_ID または --from-production を指定してください");
  }

  const unlimitedCount = plans.filter((p) => isUnlimited60Plan(p.plan)).length;
  const payload = {
    exportedAt: new Date().toISOString(),
    source,
    count: plans.length,
    unlimitedCount,
    plans,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`保存: ${OUT_PATH}`);
  console.log(`件数: ${plans.length} / 60分通い放題: ${unlimitedCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
