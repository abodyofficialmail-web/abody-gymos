import { getAllMembersFromSheet } from "@/lib/sheets";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mustAuth(req: Request): boolean {
  const serviceKey = req.headers.get("x-service-role-key") ?? "";
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (expected && serviceKey === expected) return true;
  const cronSecret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (cronSecret && bearer === cronSecret) return true;
  return false;
}

/** Google Sheets data!A:F から会員プラン一覧（CI / スクリプト用） */
export async function GET(req: Request) {
  try {
    if (!mustAuth(req)) return json({ error: "unauthorized" }, 401);

    if (!process.env.GOOGLE_SHEET_ID?.trim()) {
      return json({ error: "GOOGLE_SHEET_ID が未設定です" }, 503);
    }

    const members = await getAllMembersFromSheet();
    return json({
      source: "google_sheets",
      count: members.length,
      plans: members.map((m) => ({
        memberCode: String(m.memberId ?? "").trim().toUpperCase(),
        plan: m.plan,
        name: m.name,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}
