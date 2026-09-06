/**
 * Google Sheets data!A:F から会員プランを取得（C列=プラン）
 * 'unlimited' / 60分通い放題 等 → 60分通い放題プラン
 */
import { google } from "googleapis";
import fs from "fs";
import path from "path";

const DATA_SHEET = "data";
const MEMBERS_RANGE = `${DATA_SHEET}!A2:F`;

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

/**
 * @returns {Promise<Map<string, { plan: string, isUnlimited60: boolean }>>}
 */
export async function fetchMemberPlansFromSheet() {
  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!sheetId) {
    throw new Error("GOOGLE_SHEET_ID が未設定です");
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
