import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { z } from "zod";
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

function tokenForStoreName(storeName: string): string | null {
  if (storeName === "上野") return process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO ?? null;
  if (storeName === "桜木町") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO ?? null;
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
}

async function pushLineMessage(params: { to: string; text: string; token: string | null; debug?: any }) {
  const { to, text, token, debug } = params;
  if (!token) {
    console.error("LINE access token is not set", debug ?? {});
    return;
  }
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("LINE push failed", { status: res.status, body: t, debug });
  }
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
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = getQuerySchema.safeParse({
      member_id: url.searchParams.get("member_id") ?? undefined,
      store_id: url.searchParams.get("store_id") ?? undefined,
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

    return jsonResponse({ notes }, 200);
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
    try {
      const { data: member, error: mErr } = await (supabase as any)
        .from("members")
        .select("id, line_user_id, is_active")
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
          const token = tokenForStoreName(storeName);
          const text = line_message?.trim()
            ? line_message.trim()
            : messageForClientNote({ storeName, dateYmd: date, content });
          await pushLineMessage({
            to: String(member.line_user_id),
            text,
            token,
            debug: { storeName, hasToken: Boolean(token) },
          });
        }
      }
    } catch (e) {
      console.error("LINE push unexpected error", e);
    }

    return jsonResponse({ note: data }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "カルテの保存中にエラーが発生しました", detail: message }, 500);
  }
}

