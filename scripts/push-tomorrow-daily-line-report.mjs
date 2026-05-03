/**
 * 本番 .env.production.local（vercel env pull 済み）のトークンで
 * 「明日分」全店舗日報を LINE プッシュするワンショット。
 * API の REPORT_CRON_SECRET が未設定でも送れる。
 *
 * usage: node scripts/push-tomorrow-daily-line-report.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import fs from "fs";
import path from "path";

const TZ = "Asia/Tokyo";
const MAX = 4800;

/** 既に環境変数が入っているキーは上書きしない（CLI で渡した LINE トークンを vercel pull の空値で潰さない） */
function loadEnvFile(name) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (process.env[k] !== undefined && process.env[k] !== "") continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
}

function chunkText(body) {
  const t = body.trimEnd();
  if (t.length <= MAX) return [t];
  const chunks = [];
  let rest = t;
  while (rest.length > MAX) {
    const slice = rest.slice(0, MAX);
    const lastNl = slice.lastIndexOf("\n");
    const cut = lastNl > MAX * 0.4 ? lastNl : MAX;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length) chunks.push(rest);
  if (chunks.length <= 1) return chunks;
  return chunks.map((c, i) => `【${i + 1}/${chunks.length}】\n${c}`);
}

function formatDateJa(ymd) {
  const dt = DateTime.fromISO(ymd, { zone: TZ });
  return dt.isValid ? dt.setLocale("ja").toFormat("yyyy年M月d日（ccc）") : ymd;
}
function formatTimeJa(utcIso) {
  return DateTime.fromISO(utcIso).setZone(TZ).toFormat("HH:mm");
}
function sliceHhmm(t) {
  const s = String(t ?? "");
  return s.length >= 5 ? s.slice(0, 5) : s;
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env.production.local"); // 本番トークンで上書き

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です。");
    process.exit(1);
  }
  if (!lineToken) {
    console.error("LINE_CHANNEL_ACCESS_TOKEN が必要です（.env.production.local）。");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: mRow, error: mErr } = await supabase
    .from("members")
    .select("line_user_id")
    .eq("member_code", "EBI020")
    .eq("is_active", true)
    .maybeSingle();
  if (mErr) {
    console.error("members:", mErr.message);
    process.exit(1);
  }
  const to = mRow?.line_user_id ? String(mRow.line_user_id).trim() : "";
  if (!to) {
    console.error("会員 EBI020 の line_user_id がありません。");
    process.exit(1);
  }

  const target = "tomorrow";
  const nowJst = DateTime.now().setZone(TZ);
  const dateYmd = (target === "today" ? nowJst : nowJst.plus({ days: 1 })).toISODate();

  const { data: storeRows, error: storeErr } = await supabase
    .from("stores")
    .select("id,name")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (storeErr) {
    console.error("stores:", storeErr.message);
    process.exit(1);
  }
  const stores = storeRows ?? [];
  if (stores.length === 0) {
    console.error("有効店舗なし");
    process.exit(1);
  }

  const dayStartUtc = DateTime.fromISO(dateYmd, { zone: TZ }).startOf("day").toUTC();
  const dayEndUtc = dayStartUtc.plus({ days: 1 });

  const { data: reservations, error: resErr } = await supabase
    .from("reservations")
    .select("id, store_id, trainer_id, member_id, start_at, end_at, status, session_type")
    .neq("status", "cancelled")
    .gte("start_at", dayStartUtc.toISO())
    .lt("start_at", dayEndUtc.toISO());
  if (resErr) {
    console.error("reservations:", resErr.message);
    process.exit(1);
  }

  const { data: shifts, error: shiftsErr } = await supabase
    .from("trainer_shifts")
    .select("id, store_id, trainer_id, shift_date, start_local, end_local, status, is_break")
    .eq("shift_date", dateYmd)
    .neq("status", "draft");
  if (shiftsErr) {
    console.error("shifts:", shiftsErr.message);
    process.exit(1);
  }

  let events = [];
  const evQ = await supabase
    .from("trainer_events")
    .select("store_id,trainer_id,start_local,end_local,title,notes,block_booking")
    .eq("event_date", dateYmd);
  if (!evQ.error && evQ.data) events = evQ.data;

  const reservationsFiltered = (reservations ?? []).filter((r) => stores.some((st) => st.id === String(r.store_id)));

  const memberIds = [...new Set(reservationsFiltered.map((r) => String(r.member_id)).filter(Boolean))];
  const trainerIds = [
    ...new Set(
      [
        ...reservationsFiltered.map((r) => String(r.trainer_id || "")).filter(Boolean),
        ...(shifts ?? []).map((s) => String(s.trainer_id || "")).filter(Boolean),
        ...events.map((e) => String(e.trainer_id || "")).filter(Boolean),
      ].filter(Boolean)
    ),
  ];

  const membersQ = memberIds.length
    ? await supabase.from("members").select("id,member_code,name,display_name").in("id", memberIds)
    : { data: [], error: null };
  const trainersQ = trainerIds.length
    ? await supabase.from("trainers").select("id,display_name").in("id", trainerIds)
    : { data: [], error: null };
  if (membersQ.error || trainersQ.error) {
    console.error(membersQ.error?.message || trainersQ.error?.message);
    process.exit(1);
  }

  const memberById = new Map();
  for (const m of membersQ.data ?? []) {
    memberById.set(String(m.id), {
      member_code: String(m.member_code ?? ""),
      name: String(m.display_name ?? m.name ?? ""),
    });
  }
  const trainerNameById = new Map();
  for (const t of trainersQ.data ?? []) {
    trainerNameById.set(String(t.id), String(t.display_name ?? ""));
  }

  const timingLabel =
    target === "tomorrow"
      ? "明日の業務サマリ（前日22時・JST送信／対象は翌日）"
      : "本日の業務サマリ（当日8時・JST送信／対象は当日）";

  const lines = [`【全店舗】${formatDateJa(dateYmd)}｜${timingLabel}`, ``];

  for (const st of stores) {
    const sid = st.id;
    const shiftList = (shifts ?? [])
      .filter((s) => String(s.store_id) === sid && s.is_break !== true)
      .sort((a, b) => String(a.start_local).localeCompare(String(b.start_local)));
    const shiftLines =
      shiftList.length === 0
        ? ["（勤務予定なし）"]
        : shiftList.map((s) => {
            const trainerName = trainerNameById.get(String(s.trainer_id)) ?? String(s.trainer_id);
            return `・${trainerName} ${sliceHhmm(String(s.start_local))}〜${sliceHhmm(String(s.end_local))}`;
          });

    const storeEvents = events.filter((e) => String(e.store_id) === sid);
    const eventLines =
      storeEvents.length === 0
        ? ["（予定なし）"]
        : storeEvents
            .sort((a, b) => sliceHhmm(a.start_local).localeCompare(sliceHhmm(b.start_local)))
            .map((e) => {
              const trainerName = trainerNameById.get(String(e.trainer_id)) ?? String(e.trainer_id);
              const title = String(e.title ?? "").trim() || "（無題）";
              const blockLabel = e.block_booking ? "抑える" : "抑えない";
              const note = e.notes?.trim() ? `｜${e.notes.trim()}` : "";
              return `・${sliceHhmm(e.start_local)}〜${sliceHhmm(e.end_local)} ${trainerName}｜${title}（予約枠: ${blockLabel}）${note}`;
            });

    const resList = reservationsFiltered
      .filter((r) => String(r.store_id) === sid)
      .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
    const resLines =
      resList.length === 0
        ? ["（予約なし）"]
        : resList.map((r) => {
            const member = memberById.get(String(r.member_id));
            const memberCode = member?.member_code ? member.member_code : String(r.member_id);
            const memberName = member?.name ? member.name : "";
            const tName = r.trainer_id ? trainerNameById.get(String(r.trainer_id)) ?? "" : "";
            const time = `${formatTimeJa(String(r.start_at))}〜${formatTimeJa(String(r.end_at))}`;
            const who = `${memberCode} ${memberName}`.trim();
            const stype = String(r.session_type ?? "store") === "online" ? "オンライン" : "店舗";
            const trainerSuffix = tName || "—";
            return `・${time}  ${who}（${stype}｜${trainerSuffix}）`;
          });

    lines.push(
      `━━ ${st.name} ━━`,
      `■ 勤務予定`,
      ...shiftLines,
      ``,
      `■ 予定（MTG/撮影/作業など）`,
      ...eventLines,
      ``,
      `■ 予約一覧（${resList.length}件）`,
      ...resLines,
      ``
    );
  }

  const text = lines.join("\n").trimEnd();
  const chunks = chunkText(text);

  for (let i = 0; i < chunks.length; i++) {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lineToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, messages: [{ type: "text", text: chunks[i] }] }),
    });
    const raw = await res.text();
    if (!res.ok) {
      console.error("LINE push failed", res.status, raw);
      process.exit(1);
    }
  }
  console.log("ok", { target, dateYmd, chunks: chunks.length, stores: stores.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
