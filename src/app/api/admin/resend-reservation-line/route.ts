import { DateTime } from "luxon";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { linePushTokenForMember, normalizeLineChannelKey } from "@/lib/lineChannel";
import { lineMessageWithReservationDetails } from "@/lib/lineReservationMessage";

const TZ = "Asia/Tokyo";

function isAuthorized(req: Request): boolean {
  const reportSecret = process.env.REPORT_CRON_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (reportSecret && got === reportSecret) return true;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const serviceKey = req.headers.get("x-service-role-key") ?? "";
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (expected && serviceKey === expected) return true;
  return false;
}

async function pushLineMessage(params: { to: string; text: string; token: string | null }) {
  const { to, text, token } = params;
  if (!token) {
    return { ok: false as const, status: 0, body: "LINE access token is not set" };
  }
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

const bodySchema = z.object({
  member_codes: z.array(z.string().min(1)).optional(),
  reservation_ids: z.array(z.string().uuid()).optional(),
  only_upcoming: z.boolean().optional().default(true),
});

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function POST(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
    }

    const tokenProbe = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() ?? "";
    if (!tokenProbe) {
      return jsonResponse({ error: "LINE_CHANNEL_ACCESS_TOKEN is not configured" }, 500);
    }

    const supabase = createSupabaseServiceClient();
    const nowIso = DateTime.now().setZone(TZ).toISO()!;
    const results: Array<Record<string, unknown>> = [];

    const memberCodes = parsed.data.member_codes ?? [];
    const reservationIds = parsed.data.reservation_ids ?? [];

    let reservations: Array<{
      id: string;
      start_at: string;
      end_at: string;
      session_type: string | null;
      member_id: string | null;
      stores: { name: string } | null;
    }> = [];

    if (reservationIds.length > 0) {
      const { data, error } = await (supabase as any)
        .from("reservations")
        .select("id, start_at, end_at, session_type, status, member_id, stores(name)")
        .in("id", reservationIds)
        .eq("status", "confirmed");
      if (error) return jsonResponse({ error: error.message }, 500);
      reservations = data ?? [];
    } else if (memberCodes.length > 0) {
      for (const codeRaw of memberCodes) {
        const code = codeRaw.trim().toUpperCase();
        const { data: member, error: mErr } = await (supabase as any)
          .from("members")
          .select("id, member_code, line_user_id, line_channel_key")
          .eq("member_code", code)
          .maybeSingle();
        if (mErr) return jsonResponse({ error: mErr.message }, 500);
        if (!member?.line_user_id) {
          results.push({ member_code: code, ok: false, error: "no line_user_id" });
          continue;
        }
        let q = (supabase as any)
          .from("reservations")
          .select("id, start_at, end_at, session_type, status, member_id, stores(name)")
          .eq("member_id", member.id)
          .eq("status", "confirmed")
          .order("start_at", { ascending: true });
        if (parsed.data.only_upcoming) q = q.gte("start_at", nowIso);
        const { data: rows, error: rErr } = await q;
        if (rErr) return jsonResponse({ error: rErr.message }, 500);
        for (const r of rows ?? []) {
          const storeName = r.stores?.name ?? "恵比寿";
          const sessionType: "store" | "online" = r.session_type === "online" ? "online" : "store";
          const text = lineMessageWithReservationDetails({
            storeName,
            startAtUtcIso: r.start_at,
            endAtUtcIso: r.end_at,
            sessionType,
          });
          const push = await pushLineMessage({
            to: member.line_user_id,
            text,
            token: linePushTokenForMember({
              lineChannelKey: normalizeLineChannelKey(member.line_channel_key),
              memberCode: member.member_code,
              fallbackStoreName: storeName,
            }).token,
          });
          results.push({
            member_code: code,
            reservation_id: r.id,
            start_at: r.start_at,
            ok: push.ok,
            line_status: push.status,
            line_body: push.body,
          });
        }
      }
      return jsonResponse({ token_configured: true, results }, 200);
    }

    return jsonResponse({ error: "member_codes or reservation_ids required" }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: message }, 500);
  }
}

/** GET: トークン疎通確認（bot profile） */
export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() ?? "";
    if (!token) {
      return jsonResponse({ ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN missing" }, 500);
    }
    const res = await fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.text();
    return jsonResponse(
      {
        ok: res.ok,
        status: res.status,
        token_length: token.length,
        body,
      },
      res.ok ? 200 : 502
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: message }, 500);
  }
}
