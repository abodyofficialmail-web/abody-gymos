import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type LineWebhookBody = {
  destination?: string;
  events?: Array<{
    type: string;
    replyToken?: string;
    source?: { type?: string; userId?: string };
    message?: { type?: string; text?: string };
  }>;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function verifyLineSignature(rawBody: string, signature: string | null, channelSecret: string): boolean {
  if (!signature) return false;
  const hmac = createHmac("sha256", channelSecret).update(rawBody, "utf8").digest("base64");
  try {
    const a = Buffer.from(hmac, "utf8");
    const b = Buffer.from(signature, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

type ChannelKey = "default" | "ueno" | "sakuragicho" | "shinjuku" | "fukuoka";

function getLineChannelConfigs(): Array<{ key: ChannelKey; secret?: string; token?: string }> {
  return [
    {
      key: "default",
      secret: process.env.LINE_CHANNEL_SECRET,
      token: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    },
    {
      key: "ueno",
      secret: process.env.LINE_CHANNEL_SECRET_UENO,
      token: process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO,
    },
    {
      key: "sakuragicho",
      secret: process.env.LINE_CHANNEL_SECRET_SAKURAGICHO,
      token: process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO,
    },
    {
      key: "shinjuku",
      secret: process.env.LINE_CHANNEL_SECRET_SHINJUKU,
      token: process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU,
    },
    {
      key: "fukuoka",
      secret: process.env.LINE_CHANNEL_SECRET_FUKUOKA,
      token: process.env.LINE_CHANNEL_ACCESS_TOKEN_FUKUOKA,
    },
  ];
}

function detectChannelBySignature(rawBody: string, signature: string | null): {
  ok: true;
  key: ChannelKey;
  token: string;
} | { ok: false } {
  for (const c of getLineChannelConfigs()) {
    if (!c.secret || !c.token) continue;
    if (verifyLineSignature(rawBody, signature, c.secret)) {
      return { ok: true, key: c.key, token: c.token };
    }
  }
  return { ok: false };
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

async function replyMessage(token: string, replyToken: string, text: string) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LINE reply failed: ${res.status} ${t}`);
  }
}

function normalizeMemberCodeInput(raw: string): string | null {
  // NFKC: 全角英数字→半角など（コピペ・IME由来の表記ゆれを吸収）
  const nfkc = raw.normalize("NFKC").trim();
  const stripped = nfkc.replace(/[\u200B-\u200D\uFEFF]/g, "");
  const code = stripped.toUpperCase();
  return code.length > 0 ? code : null;
}

/** 会員番号らしい英数字か（雑談等では DB を検索しない） */
function isPlausibleMemberCode(code: string): boolean {
  if (code.length < 4 || code.length > 24) return false;
  if (!/^[A-Z0-9]+$/.test(code)) return false;
  return /[A-Z]/.test(code) && /[0-9]/.test(code);
}

/** 確認ステップの「はい」判定（表記ゆれを許容） */
function isAffirmative(raw: string): boolean {
  const t = raw.normalize("NFKC").trim().replace(/[！!。．.\s]+$/u, "");
  if (!t) return false;
  const lower = t.toLowerCase();
  return t === "はい" || t === "ハイ" || lower === "yes" || lower === "ok" || t === "ＯＫ" || t === "OK";
}

function isNegative(raw: string): boolean {
  const t = raw.normalize("NFKC").trim();
  return t === "いいえ" || t === "キャンセル" || t.toLowerCase() === "no";
}

type LineSessionRow = Database["public"]["Tables"]["line_sessions"]["Row"];

async function getSession(supabase: SupabaseClient<Database>, userId: string): Promise<LineSessionRow | null> {
  const { data, error } = await supabase.from("line_sessions").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return (data as any) ?? null;
}

async function saveSession(
  supabase: SupabaseClient<Database>,
  userId: string,
  data: { status: "idle" | "confirm"; temp_member_id?: string | null; temp_member_code?: string | null }
) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("line_sessions")
    .upsert(
      {
        user_id: userId,
        status: data.status,
        temp_member_id: data.temp_member_id ?? null,
        temp_member_code: data.temp_member_code ?? null,
        updated_at: now,
      } as any,
      { onConflict: "user_id" }
    );
  if (error) throw error;
}

async function clearSession(supabase: SupabaseClient<Database>, userId: string) {
  const { error } = await supabase.from("line_sessions").delete().eq("user_id", userId);
  if (error) throw error;
}

async function findMemberByMemberCode(supabase: SupabaseClient<Database>, memberCode: string) {
  const { data, error } = await supabase
    .from("members")
    .select("id, member_code, name, is_active, line_user_id")
    .eq("member_code", memberCode)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.is_active) return null;
  return data;
}

async function findMemberByLineUserId(supabase: SupabaseClient<Database>, userId: string) {
  const { data, error } = await supabase
    .from("members")
    .select("id, member_code, name, is_active, line_user_id")
    .eq("line_user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.is_active) return null;
  return data;
}

async function linkLine(
  supabase: SupabaseClient<Database>,
  memberId: string,
  userId: string,
  channelKey: ChannelKey
) {
  const { error } = await supabase
    .from("members")
    .update({
      line_user_id: userId,
      line_channel_key: channelKey,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", memberId);
  if (error) throw error;
}

export async function GET() {
  return new Response("LINE webhook OK", { status: 200 });
}

export async function POST(request: Request) {
  const signature = request.headers.get("x-line-signature");

  const rawBody = await request.text().catch(() => "");
  if (!rawBody) return new Response(null, { status: 400 });

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return new Response(null, { status: 400 });
  }

  console.log("LINE webhook received", body);

  // チャネル（Bot）ごとに secret/token を切り替える（署名検証で判定）
  const detected = detectChannelBySignature(rawBody, signature);
  if (!detected.ok) {
    console.log("channel判定", { destination: body.destination ?? null, matched: null });
    return new Response(null, { status: 401 });
  }
  const channelKey = detected.key;
  const replyTokenForChannel = detected.token;

  // 現時点では store_id をチャネルに紐付けていない（予約時に店舗選択する仕様）
  console.log("channel判定", { channelId: body.destination ?? null, store_id: null, channelKey });

  let supabase: SupabaseClient<Database>;
  try {
    supabase = createServiceSupabase();
  } catch (e) {
    console.error(e);
    return new Response(null, { status: 500 });
  }

  const events = body.events ?? [];
  for (const event of events) {
    if (event.type !== "message") continue;
    if (event.message?.type !== "text") continue;

    const replyToken = event.replyToken;
    const userId = event.source?.userId;
    const text = event.message.text ?? "";
    if (!replyToken || !userId) continue;

    try {
      // セッション取得
      const session = await getSession(supabase, userId);

      // ① 確認ステップ（会員番号送信後に「はい」で確定）
      if (session?.status === "confirm") {
        if (isAffirmative(text)) {
          if (!session.temp_member_id) {
            await clearSession(supabase, userId);
            await replyMessage(replyTokenForChannel, replyToken, "セッションが切れました。もう一度会員番号を送ってください。");
            continue;
          }

          const { data: member, error: memErr } = await supabase
            .from("members")
            .select("id, member_code, name, is_active, line_user_id")
            .eq("id", session.temp_member_id)
            .maybeSingle();
          if (memErr) throw memErr;
          if (!member || !member.is_active) {
            await clearSession(supabase, userId);
            await replyMessage(
              replyTokenForChannel,
              replyToken,
              "会員情報が見つかりませんでした。店舗までお問い合わせください。"
            );
            continue;
          }
          if (member.line_user_id && member.line_user_id !== userId) {
            await clearSession(supabase, userId);
            await replyMessage(
              replyTokenForChannel,
              replyToken,
              `この会員番号（${member.member_code}）は別のLINEアカウントと既に連携済みです。店舗までお問い合わせください。`
            );
            continue;
          }

          await linkLine(supabase, member.id, userId, channelKey);
          await clearSession(supabase, userId);
          await replyMessage(replyTokenForChannel, replyToken, "LINE連携が完了しました！");
          continue;
        }

        if (isNegative(text)) {
          await clearSession(supabase, userId);
          await replyMessage(replyTokenForChannel, replyToken, "連携をキャンセルしました。再度行う場合は会員番号を送ってください。");
          continue;
        }

        const codeHint = session.temp_member_code ? `（会員番号: ${session.temp_member_code}）` : "";
        await replyMessage(
          replyTokenForChannel,
          replyToken,
          `連携の確認中です${codeHint}\n\n「はい」と送ると連携が完了します。\nやり直す場合は「キャンセル」と送ってください。`
        );
        continue;
      }

      // ② 会員番号入力（trim + uppercase の完全一致で検索）
      // 連携済みの人が通常トークを送った場合は無反応（リプライしない）
      const linkedMember = await findMemberByLineUserId(supabase, userId);
      if (linkedMember) {
        continue;
      }
      const memberCode = normalizeMemberCodeInput(text);
      if (!memberCode) {
        continue;
      }

      if (!isPlausibleMemberCode(memberCode)) {
        continue;
      }

      const member = await findMemberByMemberCode(supabase, memberCode);
      console.log("member検索結果", member);
      if (!member) {
        continue;
      }

      // セッション保存（確認待ち）
      await saveSession(supabase, userId, {
        status: "confirm",
        temp_member_id: member.id,
        temp_member_code: member.member_code,
      });

      const nameLine = member.name?.trim() ? member.name.trim() : "(お名前未登録)";
      await replyMessage(
        replyTokenForChannel,
        replyToken,
        `この会員でよろしいですか？\n${nameLine}\n会員番号:${member.member_code}\n\n「はい」で確定します`
      );
    } catch (e) {
      console.error("LINE webhook error", e);
    }
  }

  return jsonResponse({ ok: true }, 200);
}
