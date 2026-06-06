import { z } from "zod";
import { linePushTokenForMember } from "@/lib/lineChannel";
import { pushLineTextAsChunks } from "@/lib/lineMessagingPush";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const patchSchema = z.object({
  followup_status: z.enum(["pending", "done"]).optional(),
  followup_note: z.string().max(4000).optional(),
});

const replySchema = z.object({
  message: z.string().trim().min(1).max(3000),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ responseId: string }> }) {
  try {
    const { responseId } = await ctx.params;
    const raw = await request.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body" }, 400);

    const supabase = createSupabaseServiceClient();
    const update: {
      followup_status?: "pending" | "done";
      followup_note?: string | null;
      followup_handled_at?: string;
    } = {};
    if (parsed.data.followup_status) {
      update.followup_status = parsed.data.followup_status;
      if (parsed.data.followup_status === "done") {
        update.followup_handled_at = new Date().toISOString();
      }
    }
    if (parsed.data.followup_note !== undefined) {
      update.followup_note = parsed.data.followup_note.trim() || null;
    }

    const { data, error } = await supabase
      .from("session_survey_responses")
      .update(update)
      .eq("id", responseId)
      .select("id, followup_status, followup_note, followup_handled_at")
      .single();

    if (error) return json({ error: error.message }, 500);
    return json({ response: data }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ responseId: string }> }) {
  try {
    const { responseId } = await ctx.params;
    const raw = await request.json().catch(() => ({}));
    const parsed = replySchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("session_survey_responses")
      .select(
        `
        id,
        session_date,
        stores ( name ),
        trainers ( display_name ),
        members ( id, member_code, name, line_user_id )
      `
      )
      .eq("id", responseId)
      .maybeSingle();

    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "response_not_found" }, 404);

    const member = firstRelation((data as any).members);
    const trainer = firstRelation((data as any).trainers);
    const store = firstRelation((data as any).stores);
    const lineUserId = String(member?.line_user_id ?? "").trim();
    if (!lineUserId) return json({ error: "member_line_missing" }, 400);

    const trainerName = String(trainer?.display_name ?? "トレーナー").trim() || "トレーナー";
    const text = `アンケート回答ありがとうございます。\n担当させていただきました${trainerName}です。\n\n${parsed.data.message}`;
    const line = linePushTokenForMember({
      memberCode: String(member?.member_code ?? ""),
      fallbackStoreName: String(store?.name ?? ""),
    });
    const ok = await pushLineTextAsChunks(line.token, lineUserId, text);
    if (!ok) {
      return json(
        {
          error: "line_push_failed",
          detail: {
            member_code: member?.member_code ?? null,
            line_channel_source: line.source,
            line_channel_key: line.channelKey,
            has_token: Boolean(line.token),
          },
        },
        502
      );
    }

    return json({ ok: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}

function firstRelation<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}
