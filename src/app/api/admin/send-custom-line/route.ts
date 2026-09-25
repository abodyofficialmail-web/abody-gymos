import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mustAuth(req: Request): boolean {
  const gateSecret = process.env.TRAINER_GATE_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const testKey =
    req.headers.get("x-goal-hearing-test-key") ?? req.headers.get("x-reservation-reminder-test-key") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (gateSecret && (testKey === gateSecret || bearer === gateSecret)) return true;
  if (cronSecret && (testKey === cronSecret || bearer === cronSecret)) return true;
  return false;
}

async function pushLine(params: { token: string; to: string; text: string }) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: params.to, messages: [{ type: "text", text: params.text }] }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

const bodySchema = z.object({
  dry_run: z.boolean().optional().default(false),
  items: z
    .array(
      z
        .object({
          member_code: z.string().min(1).optional(),
          trainer_name: z.string().min(1).optional(),
          text: z.string().min(1),
        })
        .refine((x) => Boolean(x.member_code || x.trainer_name), {
          message: "member_code または trainer_name が必要です",
        })
    )
    .min(1),
});

export async function POST(req: Request) {
  try {
    if (!mustAuth(req)) return json({ error: "unauthorized" }, 401);
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const results: Array<Record<string, unknown>> = [];

    for (const item of parsed.data.items) {
      if (item.trainer_name) {
        const name = item.trainer_name.trim();
        const { data: trainer, error: tErr } = await supabase
          .from("trainers")
          .select("id, display_name, line_user_id, is_active")
          .eq("display_name", name)
          .eq("is_active", true)
          .maybeSingle();
        if (tErr || !trainer) {
          results.push({ trainer_name: name, ok: false, error: tErr?.message ?? "trainer_not_found" });
          continue;
        }
        if (!trainer.line_user_id) {
          results.push({ trainer_name: name, ok: false, error: "no_line_user_id" });
          continue;
        }
        if (parsed.data.dry_run) {
          results.push({ trainer_name: name, ok: true, dry_run: true });
          continue;
        }
        const token = process.env.LINE_DAILY_REPORT_CHANNEL_TOKEN?.trim() || process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
        if (!token) {
          results.push({ trainer_name: name, ok: false, error: "token_missing" });
          continue;
        }
        const push = await pushLine({ token, to: trainer.line_user_id, text: item.text });
        results.push({
          trainer_name: name,
          ok: push.ok,
          status: push.status,
          body: push.body.slice(0, 200),
        });
        continue;
      }

      const code = item.member_code!.trim().toUpperCase();
      const { data: member, error: mErr } = await supabase
        .from("members")
        .select("id, member_code, name, line_user_id, line_channel_key, is_active")
        .eq("member_code", code)
        .maybeSingle();
      if (mErr || !member) {
        results.push({ member_code: code, ok: false, error: mErr?.message ?? "member_not_found" });
        continue;
      }
      if (!member.line_user_id) {
        results.push({ member_code: code, name: member.name, ok: false, error: "no_line_user_id" });
        continue;
      }

      if (parsed.data.dry_run) {
        results.push({ member_code: code, name: member.name, ok: true, dry_run: true });
        continue;
      }

      const line = linePushTokenForMemberRow(member as any, "桜木町");
      if (!line.token) {
        results.push({ member_code: code, name: member.name, ok: false, error: "token_missing", channelKey: line.channelKey });
        continue;
      }
      const push = await pushLine({ token: line.token, to: member.line_user_id, text: item.text });
      results.push({
        member_code: code,
        name: member.name,
        ok: push.ok,
        status: push.status,
        body: push.body.slice(0, 200),
        channelKey: line.channelKey,
      });
    }

    return json({ ok: true, results }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
