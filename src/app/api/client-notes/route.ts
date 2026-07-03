import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { z } from "zod";
import { lineChannelLabel, normalizeLineChannelKey, type LineChannelKey } from "@/lib/lineChannel";
import { pushLineTextForMember } from "@/lib/lineMessagingPush";
import { isSessionSurveyLineEnabled } from "@/lib/sessionSurvey";
import { fetchPreSessionSurveysForMember } from "@/lib/preSessionSurveyForKarte";
import { fetchSessionSurveysForMember } from "@/lib/sessionSurveyForKarte";
import { sendSessionSurveyAfterClientNote } from "@/lib/sessionSurveyLine";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

function jsonResponse(body: any, status: number = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function createServiceSupabase(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function pushLineMessage(params: {
  to: string;
  text: string;
  memberCode?: string | null;
  lineChannelKey?: LineChannelKey | null;
  storeName?: string | null;
  debug?: Record<string, unknown>;
}) {
  const result = await pushLineTextForMember({
    toUserId: params.to,
    text: params.text,
    memberCode: params.memberCode,
    lineChannelKey: params.lineChannelKey,
    storeName: params.storeName,
  });
  if (!result.ok) {
    console.error("LINE push failed", { ...params.debug, ...result });
  }
  return result;
}

function messageForClientNote(params: { storeName: string; dateYmd: string; content: string }): string {
  const { storeName, dateYmd, content } = params;
  const date = DateTime.fromISO(dateYmd, { zone: "Asia/Tokyo" });
  const dateLabel = date.isValid ? date.setLocale("ja").toFormat("M月d日（ccc）") : dateYmd;
  const body = String(content ?? "").trim();
  return `
【カルテを共有しました】
店舗：${storeName}
日付：${dateLabel}

${body}
`.trim();
}

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const getQuerySchema = z.object({
  member_id: z.string().uuid("member_id は有効なUUIDである必要があります"),
  store_id: z.string().uuid("store_id は有効なUUIDである必要があります").optional(),
  include_survey: z.enum(["0", "1"]).optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = getQuerySchema.safeParse({
      member_id: url.searchParams.get("member_id") ?? undefined,
      store_id: url.searchParams.get("store_id") ?? undefined,
      include_survey: url.searchParams.get("include_survey") ?? "1",
    });
    if (!parsed.success) {
      return jsonResponse({ error: "クエリが不正です", detail: parsed.error.flatten() }, 400);
    }

    const { member_id, store_id } = parsed.data;
    const supabase = createServiceSupabase();

    // NOTE: Database 型定義にリレーションが無い場合でも JOIN できるよう any 経由で実行
    let q = (supabase as any)
      .from("client_notes")
      .select(
        `
          id,
          member_id,
          store_id,
          trainer_id,
          date,
          content,
          created_at,
          stores(
            id,
            name
          ),
          trainers(
            id,
            display_name
          )
        `
      )
      .eq("member_id", member_id)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });

    if (store_id) q = q.eq("store_id", store_id);

    const { data, error } = await q;
    if (error) {
      return jsonResponse({ error: "カルテの取得に失敗しました", detail: error.message }, 500);
    }

    const rows = (data ?? []) as any[];
    const notes = rows.map((r) => ({
      id: r.id,
      member_id: r.member_id,
      store_id: r.store_id,
      trainer_id: r.trainer_id,
      date: r.date,
      content: r.content,
      created_at: r.created_at,
      store_name: r.stores?.name ?? "",
      trainer_name: r.trainers?.display_name ?? "",
    }));

    const includeSurvey = parsed.data.include_survey !== "0";
    const [surveyPayload, preSessionPayload] = includeSurvey
      ? await Promise.all([
          fetchSessionSurveysForMember(supabase, member_id),
          fetchPreSessionSurveysForMember(supabase, member_id),
        ])
      : [
          {
            survey_by_date: {},
            latest_survey: null,
            survey_stats: { invite_count: 0, response_count: 0, response_rate: null },
            invite_by_date: {},
          },
          {
            pre_session_by_date: {},
            latest_pre_session: null,
            pre_session_stats: { invite_count: 0, response_count: 0, response_rate: null },
            pre_session_invite_by_date: {},
          },
        ];

    return jsonResponse({ notes, ...surveyPayload, ...preSessionPayload }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "カルテの取得中にエラーが発生しました", detail: message }, 500);
  }
}

const postBodySchema = z.object({
  member_id: z.string().uuid(),
  store_id: z.string().uuid(),
  trainer_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  content: z.string().min(1),
  // LINEへ送る文面をUI側で組み立てたい場合に利用（未指定なら content を送る）
  line_message: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = postBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse({ error: "リクエストが不正です", detail: parsed.error.flatten() }, 400);
    }
    const { member_id, store_id, trainer_id, date, content, line_message } = parsed.data;

    console.log("カルテ保存", { member_id, store_id, trainer_id });

    const supabase = createServiceSupabase();
    const insertRow: Database["public"]["Tables"]["client_notes"]["Insert"] = {
      member_id,
      store_id,
      trainer_id,
      date,
      content,
    };

    const { data, error } = await (supabase as any)
      .from("client_notes")
      .insert(insertRow)
      .select("id, member_id, store_id, trainer_id, date, content, created_at")
      .single();

    if (error) {
      const msg = String((error as any)?.message ?? "");
      if (msg.includes("client_notes") && msg.includes("schema cache")) {
        return jsonResponse(
          {
            error: "カルテ保存の準備ができていません（client_notes テーブルが未作成の可能性）",
            detail: msg,
          },
          500
        );
      }
      return jsonResponse({ error: "カルテの保存に失敗しました", detail: error.message }, 500);
    }

    // 保存後に会員へLINE送信（line_user_id がある場合のみ）
    let lineDelivery: {
      karte?: { sent: boolean; channel?: string | null; source?: string; error?: string };
      survey?: { sent: boolean; invite_id?: string; mode?: string };
    } = {};

    try {
      const { data: member, error: mErr } = await (supabase as any)
        .from("members")
        .select("id, member_code, line_user_id, line_channel_key, is_active")
        .eq("id", member_id)
        .maybeSingle();
      if (!mErr && member?.is_active && member?.line_user_id) {
        const { data: store, error: sErr } = await (supabase as any)
          .from("stores")
          .select("id, name")
          .eq("id", store_id)
          .maybeSingle();
        if (!sErr) {
          const storeName = String(store?.name ?? "");
          const text = line_message?.trim()
            ? line_message.trim()
            : messageForClientNote({ storeName, dateYmd: date, content });
          const karteResult = await pushLineMessage({
            to: String(member.line_user_id),
            text,
            memberCode: String(member.member_code ?? ""),
            lineChannelKey: normalizeLineChannelKey((member as any)?.line_channel_key),
            storeName,
            debug: { storeName, memberCode: member.member_code },
          });
          lineDelivery.karte = {
            sent: karteResult.ok,
            channel: lineChannelLabel(karteResult.channelKey),
            source: karteResult.source,
            error: karteResult.ok ? undefined : karteResult.body,
          };
        }
      } else if (member && !member.line_user_id) {
        lineDelivery.karte = { sent: false, channel: null, source: "no_line_user_id" };
      } else if (member && !member.is_active) {
        lineDelivery.karte = { sent: false, channel: null, source: "member_inactive" };
      }
    } catch (e) {
      console.error("LINE push unexpected error", e);
    }

    if (isSessionSurveyLineEnabled()) {
      try {
        const { data: member, error: mErr } = await (supabase as any)
          .from("members")
          .select("id, member_code, line_user_id, line_channel_key, is_active")
          .eq("id", member_id)
          .maybeSingle();
        if (!mErr && member?.is_active && member?.line_user_id) {
          const [{ data: store }, { data: trainer }] = await Promise.all([
            (supabase as any).from("stores").select("id, name").eq("id", store_id).maybeSingle(),
            (supabase as any).from("trainers").select("id, display_name").eq("id", trainer_id).maybeSingle(),
          ]);
          const storeName = String(store?.name ?? "");
          if (storeName) {
            const surveyOut = await sendSessionSurveyAfterClientNote(supabase as SupabaseClient, {
              member_id,
              trainer_id,
              store_id,
              session_date: date,
              client_note_id: data?.id ?? null,
              line_user_id: String(member.line_user_id),
              member_code: String(member.member_code ?? ""),
              line_channel_key: (member as any)?.line_channel_key ?? null,
              store_name: storeName,
              trainer_display_name: String(trainer?.display_name ?? ""),
            });
            lineDelivery.survey = {
              sent: surveyOut.sent,
              invite_id: surveyOut.invite_id,
              mode: surveyOut.mode,
            };
          }
        }
      } catch (e) {
        console.error("session survey LINE unexpected error", e);
      }
    }

    return jsonResponse({ note: data, line: lineDelivery }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "カルテの保存中にエラーが発生しました", detail: message }, 500);
  }
}

