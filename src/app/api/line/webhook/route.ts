import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendGoalHearingInviteForMember } from "@/lib/goalHearingInviteSend";
import { recordLineFollowEvent } from "@/lib/marketing/lineFollowEvents";
import type { LineChannelKey } from "@/lib/lineChannel";
import {
  opsKindLabel,
  parseTrainerOpsCommand,
  saveTrainerOpsMessage,
  trainerOpsHelpText,
  notifyTrainerOpsMessage,
} from "@/lib/trainerOpsMessages";
import {
  isTrainerLineSessionCode,
  normalizeTrainerName,
  parseTrainerLinkCommand,
  trainerIdFromSessionCode,
  trainerSessionCode,
  TRAINER_LINE_DEMO_NAME,
} from "@/lib/trainerLineLink";

export const runtime = "nodejs";

type LineWebhookBody = {
  destination?: string;
  events?: Array<{
    type: string;
    timestamp?: number;
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

type TrainerLineRow = {
  id: string;
  display_name: string;
  is_active: boolean;
  line_user_id: string | null;
};

async function findTrainerByLineUserId(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<TrainerLineRow | null> {
  const { data, error } = await supabase
    .from("trainers")
    .select("id, display_name, is_active, line_user_id")
    .eq("line_user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[line-webhook] trainer line lookup", error.message);
    return null;
  }
  if (!data || !data.is_active) return null;
  return data as TrainerLineRow;
}

async function findActiveTrainersForLink(supabase: SupabaseClient<Database>): Promise<TrainerLineRow[]> {
  const { data, error } = await supabase
    .from("trainers")
    .select("id, display_name, is_active, line_user_id")
    .eq("is_active", true);
  if (error) {
    console.warn("[line-webhook] trainers list lookup", error.message);
    return [];
  }
  return (data ?? []).filter((t) => String(t.display_name ?? "").trim() !== TRAINER_LINE_DEMO_NAME) as TrainerLineRow[];
}

async function linkTrainerLine(
  supabase: SupabaseClient<Database>,
  trainerId: string,
  userId: string,
  channelKey: ChannelKey
) {
  const { error } = await supabase
    .from("trainers")
    .update({
      line_user_id: userId,
      line_channel_key: channelKey,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", trainerId);
  if (error) throw error;
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
    if (event.type === "follow" || event.type === "unfollow") {
      const userId = event.source?.userId;
      if (userId) {
        try {
          await recordLineFollowEvent({
            supabase,
            channelKey: channelKey as LineChannelKey,
            lineUserId: userId,
            eventType: event.type === "unfollow" ? "unfollow" : "follow",
            timestampMs: event.timestamp ?? null,
          });
        } catch (e) {
          console.error("line follow event record failed", e);
        }
      }
      continue;
    }
    if (event.type !== "message") continue;
    if (event.message?.type !== "text") continue;

    const replyToken = event.replyToken;
    const userId = event.source?.userId;
    const text = event.message.text ?? "";
    if (!replyToken || !userId) continue;

    try {
      // セッション取得
      const session = await getSession(supabase, userId);

      // ① 確認ステップ（会員番号 or トレーナー名のあと「はい」で確定）
      if (session?.status === "confirm") {
        if (isTrainerLineSessionCode(session.temp_member_code)) {
          if (isAffirmative(text)) {
            const trainerId = trainerIdFromSessionCode(session.temp_member_code ?? "");
            if (!trainerId) {
              await clearSession(supabase, userId);
              await replyMessage(
                replyTokenForChannel,
                replyToken,
                "セッションが切れました。もう一度「トレーナー だいき」のように送ってください。"
              );
              continue;
            }
            if (channelKey !== "default") {
              await clearSession(supabase, userId);
              await replyMessage(
                replyTokenForChannel,
                replyToken,
                "運営報告のLINE連携は、恵比寿店の公式アカウントからお願いします。"
              );
              continue;
            }
            const asMember = await findMemberByLineUserId(supabase, userId);
            if (asMember) {
              await clearSession(supabase, userId);
              await replyMessage(
                replyTokenForChannel,
                replyToken,
                `このLINEは会員番号 ${asMember.member_code} と連携済みです。トレーナー連携はできません。`
              );
              continue;
            }
            const { data: trainer, error: trErr } = await supabase
              .from("trainers")
              .select("id, display_name, is_active, line_user_id")
              .eq("id", trainerId)
              .maybeSingle();
            if (trErr) throw trErr;
            if (!trainer || !trainer.is_active) {
              await clearSession(supabase, userId);
              await replyMessage(
                replyTokenForChannel,
                replyToken,
                "トレーナー情報が見つかりませんでした。店舗までお問い合わせください。"
              );
              continue;
            }
            if (trainer.line_user_id && trainer.line_user_id !== userId) {
              await clearSession(supabase, userId);
              await replyMessage(
                replyTokenForChannel,
                replyToken,
                `トレーナー「${trainer.display_name}」は別のLINEと既に連携済みです。店舗までお問い合わせください。`
              );
              continue;
            }
            await linkTrainerLine(supabase, trainer.id, userId, channelKey);
            await clearSession(supabase, userId);
            await replyMessage(
              replyTokenForChannel,
              replyToken,
              `トレーナーLINE連携が完了しました（${trainer.display_name}）。\n日報や予約フォローの報告が届きます。会員向けの案内は届きません。`
            );
            continue;
          }
          if (isNegative(text)) {
            await clearSession(supabase, userId);
            await replyMessage(
              replyTokenForChannel,
              replyToken,
              "連携をキャンセルしました。再度行う場合は「トレーナー だいき」のように送ってください。"
            );
            continue;
          }
          await replyMessage(
            replyTokenForChannel,
            replyToken,
            "トレーナー連携の確認中です。\n\n「はい」と送ると連携が完了します。\nやり直す場合は「キャンセル」と送ってください。"
          );
          continue;
        }

        if (isAffirmative(text)) {
          if (!session.temp_member_id) {
            await clearSession(supabase, userId);
            await replyMessage(replyTokenForChannel, replyToken, "セッションが切れました。もう一度会員番号を送ってください。");
            continue;
          }

          const { data: member, error: memErr } = await supabase
            .from("members")
            .select("id, member_code, name, is_active, line_user_id, line_channel_key, store_id")
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

          const asTrainer = await findTrainerByLineUserId(supabase, userId);
          if (asTrainer) {
            await clearSession(supabase, userId);
            await replyMessage(
              replyTokenForChannel,
              replyToken,
              `このLINEはトレーナー「${asTrainer.display_name}」と連携済みです。会員連携はできません。別のLINEを使ってください。`
            );
            continue;
          }

          const isFirstLink = !member.line_user_id;
          await linkLine(supabase, member.id, userId, channelKey);
          await clearSession(supabase, userId);
          await replyMessage(
            replyTokenForChannel,
            replyToken,
            isFirstLink
              ? "LINE連携が完了しました！\n続いて目標ヒアリングをお送りしますので、ご回答をお願いいたします。"
              : "LINE連携が完了しました！"
          );

          // 初回連携時のみ目標ヒアリングを自動送信（失敗しても連携自体は成功扱い）
          if (isFirstLink) {
            try {
              const inviteResult = await sendGoalHearingInviteForMember(supabase, {
                member: {
                  ...member,
                  line_user_id: userId,
                  line_channel_key: channelKey,
                },
                skipIfRecentlySentDays: 7,
              });
              if (!inviteResult.sent && !inviteResult.skipped) {
                console.error("[line-webhook] goal hearing auto-send failed", {
                  member_code: member.member_code,
                  error: inviteResult.error,
                  detail: inviteResult.detail,
                });
              }
            } catch (e) {
              console.error("[line-webhook] goal hearing auto-send error", e);
            }
          }
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

      // ② 既にトレーナー連携済み
      const linkedTrainer = await findTrainerByLineUserId(supabase, userId);
      if (linkedTrainer) {
        const trainerCmd = parseTrainerLinkCommand(text);
        if (trainerCmd) {
          await replyMessage(
            replyTokenForChannel,
            replyToken,
            `このLINEはトレーナー「${linkedTrainer.display_name}」と連携済みです。`
          );
          continue;
        }
        const maybeMemberCode = normalizeMemberCodeInput(text);
        if (maybeMemberCode && isPlausibleMemberCode(maybeMemberCode)) {
          await replyMessage(
            replyTokenForChannel,
            replyToken,
            `このLINEはトレーナー「${linkedTrainer.display_name}」用です。会員番号では連携できません。`
          );
          continue;
        }
        const ops = parseTrainerOpsCommand(text);
        if (ops?.kind === "help") {
          await replyMessage(replyTokenForChannel, replyToken, trainerOpsHelpText());
          continue;
        }
        if (ops && "body" in ops) {
          if (!ops.body) {
            await replyMessage(
              replyTokenForChannel,
              replyToken,
              `${opsKindLabel(ops.kind)}の内容を続けて送ってください。\n例: 発注 プロテインがなくなりました`
            );
            continue;
          }
          try {
            const saved = await saveTrainerOpsMessage(supabase, linkedTrainer, ops);
            if (ops.kind === "order" || ops.kind === "feedback") {
              await notifyTrainerOpsMessage({
                supabase,
                trainerName: linkedTrainer.display_name,
                kind: ops.kind,
                body: ops.body,
                storeName: saved.storeName,
                fromLineUserId: userId,
              });
            }
            const share =
              saved.storeName && (ops.kind === "order" || ops.kind === "feedback")
                ? `${saved.storeName}の責任者と運営に共有しました。`
                : "朝の業務LINEに載せます。";
            await replyMessage(
              replyTokenForChannel,
              replyToken,
              `${opsKindLabel(ops.kind)}を受け付けました。${share}`
            );
          } catch (e) {
            console.error("[line-webhook] trainer ops save failed", e);
            await replyMessage(
              replyTokenForChannel,
              replyToken,
              "受け付けに失敗しました。もう一度送るか、店舗まで連絡してください。"
            );
          }
          continue;
        }
        continue;
      }

      // ③ 会員番号入力（trim + uppercase の完全一致で検索）
      const linkedMember = await findMemberByLineUserId(supabase, userId);
      if (linkedMember) {
        const trainerCmd = parseTrainerLinkCommand(text);
        if (trainerCmd) {
          await replyMessage(
            replyTokenForChannel,
            replyToken,
            `このLINEは会員番号 ${linkedMember.member_code} と連携済みです。\nトレーナー連携は別のLINEを使うか、店舗までご相談ください。`
          );
          continue;
        }
        const memberCode = normalizeMemberCodeInput(text);
        if (memberCode && isPlausibleMemberCode(memberCode)) {
          if (linkedMember.member_code.toUpperCase() === memberCode) {
            await replyMessage(
              replyTokenForChannel,
              replyToken,
              `会員番号 ${linkedMember.member_code} は既にこのLINEと連携済みです。`
            );
          } else {
            await replyMessage(
              replyTokenForChannel,
              replyToken,
              `このLINEアカウントは既に会員番号 ${linkedMember.member_code} と連携済みです。\n別の会員番号（${memberCode}）で連携する場合は店舗までお問い合わせください。`
            );
          }
        }
        continue;
      }

      // ④ トレーナー連携（会員番号フローとは別。恵比寿公式のみ）
      const trainerCmd = parseTrainerLinkCommand(text);
      if (trainerCmd) {
        if (channelKey !== "default") {
          await replyMessage(
            replyTokenForChannel,
            replyToken,
            "運営報告のLINE連携は、恵比寿店の公式アカウントを追加して、そこから「トレーナー だいき」のように送ってください。"
          );
          continue;
        }
        if (trainerCmd.kind === "need_name") {
          await replyMessage(
            replyTokenForChannel,
            replyToken,
            "トレーナー連携ですね。ひらがなの名前をつけて送ってください。\n例: トレーナー だいき"
          );
          continue;
        }
        const trainers = await findActiveTrainersForLink(supabase);
        const needle = normalizeTrainerName(trainerCmd.name);
        const hits = trainers.filter((t) => normalizeTrainerName(t.display_name) === needle);
        if (hits.length === 0) {
          await replyMessage(
            replyTokenForChannel,
            replyToken,
            `トレーナー「${trainerCmd.name}」が見つかりませんでした。\nひらがなの名前で「トレーナー だいき」のように送ってください。`
          );
          continue;
        }
        if (hits.length > 1) {
          await replyMessage(
            replyTokenForChannel,
            replyToken,
            "同名のトレーナーが複数います。店舗までお問い合わせください。"
          );
          continue;
        }
        const trainer = hits[0];
        if (trainer.line_user_id && trainer.line_user_id !== userId) {
          await replyMessage(
            replyTokenForChannel,
            replyToken,
            `トレーナー「${trainer.display_name}」は別のLINEと既に連携済みです。店舗までお問い合わせください。`
          );
          continue;
        }
        await saveSession(supabase, userId, {
          status: "confirm",
          temp_member_id: null,
          temp_member_code: trainerSessionCode(trainer.id),
        });
        await replyMessage(
          replyTokenForChannel,
          replyToken,
          `このトレーナーでよろしいですか？\n${trainer.display_name}\n\n「はい」で確定します。会員向けの案内は届きません。`
        );
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
      console.log("member検索結果", { memberCode, found: !!member, channelKey });
      if (!member) {
        await replyMessage(
          replyTokenForChannel,
          replyToken,
          `会員番号 ${memberCode} が見つかりませんでした。番号をご確認のうえ、もう一度お送りください。`
        );
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
      console.error("LINE webhook error", { channelKey, userId, text, error: e });
    }
  }

  return jsonResponse({ ok: true }, 200);
}
