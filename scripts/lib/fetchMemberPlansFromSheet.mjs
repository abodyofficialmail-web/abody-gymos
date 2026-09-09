/**
 * Google Sheets data!A:F から会員プランを取得（C列=プラン）
 * 'unlimited' / 60分通い放題 等 → 60分通い放題プラン
 *
 * 取得順: ローカルSheets → Supabase members.plan → 本番API → スナップショットJSON
 */
import { google } from "googleapis";
import fs from "fs";
import path from "path";

const DATA_SHEET = "data";
const MEMBERS_RANGE = `${DATA_SHEET}!A2:F`;
const SNAPSHOT_PATH = path.join(process.cwd(), "scripts/data/member-plans.json");
const DEFAULT_PRODUCTION_API =
  process.env.MEMBER_PLANS_API_URL?.trim() || "https://abody-gymos.vercel.app";

function loadCredentialsFromJson() {
  const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  if (!jsonPath?.trim()) return null;
  const resolved = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);
  if (!fs.existsSync(resolved)) return null;
  const json = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const email = json.client_email?.trim();
  const privateKey = json.private_key?.trim();
  return email && privateKey ? { email, privateKey } : null;
}

function getAuthClient() {
  const fromFile = loadCredentialsFromJson();
  if (fromFile) {
    return new google.auth.JWT({
      email: fromFile.email,
      key: fromFile.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim() || "";
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1).trim();
  }
  privateKey = privateKey.replace(/\r/g, "");
  if (privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  if (!email || !privateKey) {
    throw new Error(
      "Google Sheets 認証情報がありません（GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY または JSON_PATH）",
    );
  }

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

/** @returns {boolean} */
export function isUnlimited60Plan(planRaw) {
  const p = String(planRaw ?? "").trim().toLowerCase();
  if (!p) return false;
  if (p === "unlimited") return true;
  if (p.includes("通い放")) return true;
  if (p.includes("60分通")) return true;
  if (p.includes("60分") && p.includes("放")) return true;
  return false;
}

function rowsToPlanMap(rows) {
  const planByCode = new Map();
  for (const row of rows) {
    const memberCode = String(row.memberCode ?? row[0] ?? "").trim().toUpperCase();
    if (!memberCode) continue;
    const plan = String(row.plan ?? row[2] ?? "").trim();
    planByCode.set(memberCode, {
      plan,
      isUnlimited60: isUnlimited60Plan(plan),
    });
  }
  return planByCode;
}

/**
 * @returns {Promise<Map<string, { plan: string, isUnlimited60: boolean }>>}
 */
export async function fetchMemberPlansFromSheet() {
  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!sheetId) {
    return null;
  }

  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: MEMBERS_RANGE,
  });

  const rows = response.data.values ?? [];
  const planByCode = new Map();

  for (const row of rows) {
    const memberCode = String(row[0] ?? "").trim().toUpperCase();
    if (!memberCode) continue;
    const plan = String(row[2] ?? "").trim();
    planByCode.set(memberCode, {
      plan,
      isUnlimited60: isUnlimited60Plan(plan),
    });
  }

  return planByCode;
}

/**
 * Supabase members.plan 等（存在する場合）
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function fetchMemberPlansFromSupabase(supabase) {
  for (const col of ["plan", "member_plan", "subscription_plan"]) {
    const { data, error } = await supabase.from("members").select(`member_code, ${col}`);
    if (error) continue;
    const planByCode = new Map();
    for (const row of data ?? []) {
      const memberCode = String(row.member_code ?? "").trim().toUpperCase();
      if (!memberCode) continue;
      const plan = String(row[col] ?? "").trim();
      planByCode.set(memberCode, {
        plan,
        isUnlimited60: isUnlimited60Plan(plan),
      });
    }
    if (planByCode.size) return { planByCode, source: `members.${col}` };
  }

  const { data: sample } = await supabase.from("members").select("*").limit(1);
  if (sample?.[0]) {
    console.error("members columns:", Object.keys(sample[0]).sort().join(", "));
  }

  return null;
}

/** 本番 Vercel（Google Sheets 認証済み）経由 */
async function fetchMemberPlansFromProductionApi() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) return null;

  const baseUrl = DEFAULT_PRODUCTION_API.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/api/admin/member-plans`, {
    headers: { "x-service-role-key": serviceKey },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`本番API プラン取得失敗: HTTP ${res.status} (${baseUrl})`, text.slice(0, 300));
    return null;
  }

  const body = await res.json();
  if (!Array.isArray(body?.plans) || !body.plans.length) return null;

  const planByCode = rowsToPlanMap(body.plans);
  return { planByCode, source: `production_api:${baseUrl}` };
}

/** scripts/data/member-plans.json（export-member-plans-snapshot.mjs で更新） */
function fetchMemberPlansFromSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
    const rows = raw.plans ?? raw;
    if (!Array.isArray(rows) || !rows.length) return null;
    const planByCode = rowsToPlanMap(rows);
    if (!planByCode.size) return null;
    return { planByCode, source: "snapshot_json" };
  } catch (e) {
    console.warn("スナップショット読み込み失敗:", e?.message ?? e);
    return null;
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{ planByCode: Map<string, { plan: string, isUnlimited60: boolean }>, source: string, warning?: string }>}
 */
export async function fetchMemberPlans(supabase) {
  if (process.env.GOOGLE_SHEET_ID?.trim()) {
    try {
      const planByCode = await fetchMemberPlansFromSheet();
      if (planByCode?.size) {
        return { planByCode, source: "google_sheets" };
      }
    } catch (e) {
      console.warn("Google Sheets プラン取得失敗:", e?.message ?? e);
    }
  }

  const fromDb = await fetchMemberPlansFromSupabase(supabase);
  if (fromDb) return fromDb;

  const fromApi = await fetchMemberPlansFromProductionApi();
  if (fromApi) return fromApi;

  const fromSnapshot = fetchMemberPlansFromSnapshot();
  if (fromSnapshot) return fromSnapshot;

  console.warn(
    "会員プランを取得できませんでした。60分通い放題の除外はスキップされます。" +
      " GOOGLE_SHEET_ID + 認証、members.plan 列、本番APIデプロイ、または scripts/data/member-plans.json を設定してください。",
  );

  return {
    planByCode: new Map(),
    source: "unavailable",
    warning: "plan_data_unavailable",
  };
}
