import { createClient } from "@supabase/supabase-js";

const RAW = `
EBI001｜寺谷匠磨｜｜s_nemuiyo0426@icloud.com
EBI002｜中田光哉｜｜Mitsuya.nakata@gmail.com
EBI003｜市川龍太郎｜｜ryu19900234@gmail.com
EBI004｜青島さやか｜｜sayaka22.alice@gmail.com
EBI005｜高田千尋｜｜entiritidis@gmail.com
EBI006｜菊橋孔明｜｜koumei19790719@gmail.com
EBI007｜赤須みほ子｜｜spes.amiho@icloud.com
EBI008｜中村誠｜｜ceramicboy0616@gmail.com
EBI009｜和田叡｜｜wadac8n@gmail.com
EBI010｜宗本龍享｜｜ryuuki123b456@i.softbank.jp
EBI012｜頓田良平｜｜r.ton.tm@gmail.com
EBI014｜柿沼裕介｜｜dream_k_21@yahoo.co.jp
EBI015｜藤野ひかる｜｜to5the9top-10jump@ezweb.ne.jp
EBI016｜福島二三枝｜｜nemu_cco@yahoo.co.jp
EBI017｜島崎泰至｜｜shimazaki.yasuyuki.jp@gmail.com
EBI021｜安川豊｜｜close-2u@i.softbank.jp
EBI023｜米須なつき｜｜mekealoha.mermaid.lino.elsa.laki9@gmail.com
EBI024｜福内皇斗｜｜outo323@icloud.com
EBI025｜石橋憲武｜｜sunflower_himawari_taiyou@yahoo.co.jp
EBI026｜平林沙希子｜｜s.hirabayashi1001@gmail.com

UEN001｜佐藤晃哉｜｜koya.sato508@gmail.com
UEN002｜倉澤香澄｜｜k.kurasawa3215@gmail.com
UEN003｜伊藤象二郎｜｜fcba01220309@gmail.com
UEN004｜高林希望｜｜gsn1029@icloud.com
UEN005｜中馬｜｜umauma0625@gmail.com
UEN006｜相川利沙｜｜o_s.m_d.da-21@docomo.ne.jp
UEN007｜大村啓示｜｜omkgra@gmail.com
UEN008｜yamagata tadashi｜｜tadashi1140@icloud.com
UEN009｜立原昌幸｜｜msnymkc27@gmail.com
UEN010｜澤木武明｜｜t.sawaki17@gmail.com
UEN011｜広瀬奈菜子｜｜conana.0203@gmail.com
UEN012｜鈴木旭｜｜gogo_asahi_3z0@yahoo.co.jp
UEN013｜高木桂一｜｜takakei19551026@gmail.com
UEN014｜井口誠｜｜iguch1-mac@docomo.ne.jp
UEN017｜常盤亮太｜｜rt20011129@gmail.com
UEN018｜本多祐也｜｜away-yo2zu2@docomo.ne.jp
UEN022｜岡田強志｜｜okada.tsuyoshi@internet.ac.jp
UEN023｜うだがわまお｜｜mao.0222.mei@gmail.com
UEN024｜長谷川｜｜
UEN026｜金子容子｜｜soleil0720@gmail.com
UEN029｜山本祐也｜｜sinbunuiui@yahoo.co.jp
UEN031｜立野久美子｜｜s06a2045@yahoo.co.jp
UEN033｜秋葉潤｜｜jun.akiba0019@gmail.com
UEN034｜白石翔｜｜ryukyu0202.ss@gmail.com
UEN035｜原田風雅｜｜fugafuga090609@gmail.com
UEN037｜坂田求｜｜tomtommotomu@gmail.com
UEN038｜宮崎優子｜｜
UEN039｜高橋明久｜｜kurae6kanohara@yahoo.co.jp
UEN040｜中園健太｜｜stitchgachooooon@yahoo.co.jp
UEN041｜奥迫伸治｜｜radical.so@icloud.com
UEN042｜井上昌彦｜｜masahiko.inoue1129@gmail.com
UEN043｜梅本｜｜

SAK001｜堤｜｜pirm@yahoo.co.jp
SAK002｜林芳男｜｜tarutokun.yh@gmail.com
SAK004｜中野國昭｜｜92top.bb@yahoo.ne.jp
SAK008｜中井善翔｜｜nigiri859z@icloud.com
SAK009｜前田範之｜｜ddd13292y@gmail.com
SAK011｜石倉りえ｜｜09055333302g@gmail.com
SAK012｜飯島彰忍｜｜ayus.yokohama@gmail.com
SAK013｜吉野和城｜｜un_limited_k@yahoo.co.jp
SAK014｜湯上正隆｜｜masataka_ygm1210@yahoo.co.jp
SAK016｜下田｜｜ken111low@docomo.ne.jp
SAK017｜早川恭平｜｜kh.ponta4.24@ezweb.ne.jp
SAK018｜中島美早｜｜misaki19850107@icloud.com
SAK019｜見城玲｜｜reirei.k710@gmail.com
SAK020｜早坂彩｜｜cocolo420irie@gmail.com
SAK023｜大谷茄保｜｜kaho89@ezweb.ne.jp
SAK024｜山田梨香｜｜neon0609@yahoo.co.jp
SAK025｜住田篤紀｜｜asumida5@gmail.com
SAK026｜David Chen｜｜bluedc@gmail.com
SAK027｜早坂三輝｜｜54mmisaki@au.com
SAK028｜神野優志｜｜manawalea-6s2671@docomo.ne.jp
SAK029｜原貴由樹｜｜taka1976@mac.com
SAK030｜松本瑞生｜｜mizukimatsumoto8l@gmail.com
SAK031｜工藤燦志郎｜｜touch_kown@icloud.com
SAK033｜吉田りべか｜｜ribeka.26.y@gmail.com
SAK034｜大山剛｜｜tsuyoshi.4060@gmail.com
SAK035｜澤谷薫｜｜kaoru.sawa.21@gmail.com
SAK036｜森田尚文｜｜saemundr56@yahoo.co.jp
SAK037｜森麻子｜｜d.d.l0ve206@gmail.com
SAK038｜かねなみひでみ｜｜o8o11114312@gmail.com
SAK040｜木村太茂｜｜hirohiro0303bot@gmail.com
SAK041｜高瀬｜｜lilpapi79@yahoo.co.jp
SAK042｜楠田｜｜skyred0109@gmail.com
SAK043｜森下樹｜｜1212.pooh@gmail.com
SAK044｜安田宏子｜｜xxxpeace924@icloud.com
SAK046｜山口｜｜

ON001｜今井浩美｜｜hiro35.mtkh@docomo.ne.jp
ZAI001｜川畠絢子｜｜ao0128ao@gmail.com
`.trim();

function norm(s) {
  return String(s ?? "")
    .replace(/\u3000/g, " ")
    .trim();
}

function nextCode(base, used) {
  // base: e.g. SAK045
  const m = /^([A-Z]{3})(\d{3})$/.exec(base);
  if (!m) return null;
  const prefix = m[1];
  let n = Number(m[2]);
  while (n < 999) {
    const c = `${prefix}${String(n).padStart(3, "0")}`;
    if (!used.has(c)) return c;
    n += 1;
  }
  return null;
}

function parseLines(raw) {
  const used = new Set();
  const rows = [];
  for (const line of raw.split("\n")) {
    const l = norm(line);
    if (!l) continue;
    const parts = l.split("｜");
    const member_code_raw = norm(parts[0]);
    const name = norm(parts[1]);
    const email_raw = norm(parts[3] ?? "");
    if (!member_code_raw || !name) continue;

    let member_code = member_code_raw.toUpperCase();

    // 重複対応: SAK045 が2件ある場合は片方を SAK046 に
    if (member_code === "SAK045" && used.has("SAK045") && !used.has("SAK046")) {
      member_code = "SAK046";
    }

    // 汎用重複回避（万一）
    if (used.has(member_code)) {
      const candidate = nextCode(member_code, used);
      if (!candidate) throw new Error(`member_code の重複を解決できません: ${member_code}`);
      member_code = candidate;
    }

    used.add(member_code);
    rows.push({
      member_code,
      name,
      display_name: name,
      email: email_raw ? email_raw : null,
      line_user_id: null,
    });
  }
  return rows;
}

function prefixToStoreName(member_code) {
  if (member_code.startsWith("EBI")) return "恵比寿";
  if (member_code.startsWith("UEN")) return "上野";
  if (member_code.startsWith("SAK")) return "桜木町";
  // ON / ZAI など店舗が明確でないものは暫定で恵比寿に寄せる（members.store_id が NOT NULL のため）
  return "恵比寿";
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: stores, error: storesError } = await supabase.from("stores").select("id, name");
  if (storesError) throw storesError;
  const storeIdByName = new Map((stores ?? []).map((s) => [s.name, s.id]));
  const defaultStoreId = storeIdByName.get("恵比寿") ?? (stores?.[0]?.id ?? null);
  if (!defaultStoreId) throw new Error("stores が取得できませんでした。stores テーブルを確認してください。");

  const rows = parseLines(RAW).map((r) => {
    const storeName = prefixToStoreName(r.member_code);
    const store_id = storeIdByName.get(storeName) ?? defaultStoreId;
    return { ...r, store_id };
  });
  if (rows.length === 0) throw new Error("取込対象が0件です。");

  // 既存会員の upsert で line_user_id などが NULL に上書きされないよう、既存行を取り込んでマージする
  const codes = Array.from(new Set(rows.map((r) => r.member_code)));
  const existingByCode = new Map();
  const chunkRead = 200;
  for (let i = 0; i < codes.length; i += chunkRead) {
    const part = codes.slice(i, i + chunkRead);
    const { data, error } = await supabase
      .from("members")
      .select("member_code, store_id, line_user_id, user_id, phone, needs_review, is_active")
      .in("member_code", part);
    if (error) throw error;
    for (const row of data ?? []) {
      existingByCode.set(String(row.member_code).toUpperCase(), row);
    }
  }

  const mergedRows = rows.map((r) => {
    const ex = existingByCode.get(r.member_code) ?? null;
    return {
      ...r,
      // 既存値を優先（メール取込で LINE 連携が消えないようにする）
      store_id: ex?.store_id ?? r.store_id,
      line_user_id: ex?.line_user_id ?? r.line_user_id ?? null,
      user_id: ex?.user_id ?? null,
      phone: ex?.phone ?? null,
      needs_review: typeof ex?.needs_review === "boolean" ? ex.needs_review : false,
      is_active: typeof ex?.is_active === "boolean" ? ex.is_active : true,
    };
  });

  // email カラムが存在しない環境でも落ちないよう、まず1件でカラム有無を判定する
  let supportsEmail = true;
  {
    const probe = mergedRows[0];
    const { error } = await supabase.from("members").upsert([probe], { onConflict: "member_code" });
    if (error && String(error.message || "").includes("email")) {
      supportsEmail = false;
    } else if (error) {
      throw error;
    }
  }

  const payload = supportsEmail
    ? mergedRows
    : mergedRows.map(({ email, ...rest }) => rest);

  const chunkSize = 200;
  let done = 0;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error } = await supabase.from("members").upsert(chunk, { onConflict: "member_code" });
    if (error) throw error;
    done += chunk.length;
  }

  console.log("members import done", done);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

