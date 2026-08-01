/**
 * 月次レポート LINE 送信（スクリプト用）
 * 退会のみ除外。休会（hiatus）にも送る。
 */

function nonEmptyToken(v) {
  const t = String(v ?? "").trim();
  return t || null;
}

function normalizeChannelKey(raw) {
  const k = String(raw ?? "");
  if (k === "default" || k === "ueno" || k === "sakuragicho" || k === "shinjuku" || k === "fukuoka") return k;
  return null;
}

function inferChannelFromCode(memberCode) {
  const code = String(memberCode ?? "").trim().toUpperCase();
  if (code.startsWith("SAK")) return "sakuragicho";
  if (code.startsWith("UEN")) return "ueno";
  if (code.startsWith("SHI") || code.startsWith("SHJ")) return "shinjuku";
  if (code.startsWith("FUK")) return "fukuoka";
  if (code.startsWith("EBI") || code.startsWith("ON") || code.startsWith("ZAI")) return "default";
  return null;
}

function tokenForChannel(key) {
  if (key === "ueno") return nonEmptyToken(process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO);
  if (key === "sakuragicho") return nonEmptyToken(process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO);
  if (key === "shinjuku") return nonEmptyToken(process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU);
  if (key === "fukuoka") return nonEmptyToken(process.env.LINE_CHANNEL_ACCESS_TOKEN_FUKUOKA);
  if (key === "default") return nonEmptyToken(process.env.LINE_CHANNEL_ACCESS_TOKEN);
  return null;
}

function resolveToken(member) {
  const explicit = normalizeChannelKey(member.line_channel_key);
  if (explicit) {
    const token = tokenForChannel(explicit);
    if (token) return { token, channelKey: explicit, source: "explicit" };
  }
  const inferred = inferChannelFromCode(member.member_code);
  if (inferred) {
    const token = tokenForChannel(inferred);
    if (token) return { token, channelKey: inferred, source: "inferred" };
  }
  const fallback = tokenForChannel("default");
  if (fallback) return { token: fallback, channelKey: "default", source: "default" };
  return { token: null, channelKey: null, source: "missing" };
}

async function pushMessages({ token, toUserId, messages }) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: toUserId, messages }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 */
export async function sendMonthlyProgressLineLocal(sb, params) {
  const memberCode = String(params.memberCode || "").trim().toUpperCase();
  const { data: member, error } = await sb
    .from("members")
    .select("id, member_code, name, display_name, line_user_id, line_channel_key, is_active, membership_status")
    .eq("member_code", memberCode)
    .maybeSingle();
  if (error) throw error;
  if (!member) return { member_code: memberCode, ok: false, error: "member_not_found" };

  const membershipStatus = String(member.membership_status ?? "").toLowerCase();
  if (membershipStatus === "withdrawn") {
    return { member_code: memberCode, ok: false, error: "withdrawn" };
  }
  if (!member.line_user_id) return { member_code: memberCode, ok: false, error: "no_line_user_id" };

  const line = resolveToken(member);
  if (!line.token) {
    return {
      member_code: memberCode,
      ok: false,
      error: "missing_line_token",
      channel: line.channelKey,
      source: line.source,
    };
  }

  const name = member.display_name || member.name;
  if (params.dryRun) {
    return {
      member_code: memberCode,
      ok: true,
      dry_run: true,
      name,
      membership_status: membershipStatus || null,
      image_count: (params.imageUrls || []).length,
      has_pdf: Boolean(params.pdfUrl),
      channel: line.channelKey,
      source: line.source,
    };
  }

  const batches = [];
  let current = [{ type: "text", text: params.text }];
  for (const imageUrl of params.imageUrls || []) {
    const imageMsg = {
      type: "image",
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    };
    if (current.length >= 5) {
      batches.push(current);
      current = [imageMsg];
    } else {
      current.push(imageMsg);
    }
  }
  if (current.length) batches.push(current);

  const pushResults = [];
  for (const messages of batches) {
    const pushed = await pushMessages({
      token: line.token,
      toUserId: member.line_user_id,
      messages,
    });
    pushResults.push(pushed);
    if (!pushed.ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const ok = pushResults.length > 0 && pushResults.every((r) => r.ok);
  const last = pushResults[pushResults.length - 1];
  return {
    member_code: memberCode,
    ok,
    name,
    membership_status: membershipStatus || null,
    channel: line.channelKey,
    source: line.source,
    batches: batches.length,
    status: last?.status,
    error: ok ? undefined : "line_push_failed",
    detail: ok ? undefined : last?.body,
  };
}
