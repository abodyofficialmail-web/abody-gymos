# 実装プロンプト：セッション後アンケート（LINE）

> まず `scripts/send-session-survey-line-test.mjs` で EBI020 にテスト送信し、文面・URL・タイミングを確認してから本実装に進む。

## 依頼の要約

各会員のトレーニングセッション終了後に、**セッション評価アンケート**への案内を LINE で送る。  
現状、アンケート機能・Flex Message・セッション完了ステータスは **未実装**。LINE テキスト push と既存の会員連携（`members.line_user_id`）は利用可能。

---

## 現状（調査結果）

| 項目 | 状態 |
|------|------|
| LINE push | `src/lib/lineMessagingPush.ts`、店舗別トークン（恵比寿 / 上野 / 桜木町） |
| 会員 ↔ LINE | Webhook 連携で `members.line_user_id` |
| セッション終了の自動検知 | **なし**（`reservations.end_at` 経過後も `confirmed` のまま） |
| セッション後に近いフック | **カルテ保存** `POST /api/client-notes` → 会員へカルテ共有 LINE |
| アンケート | **なし**（外部フォーム URL を案内する想定） |
| EBI020 | 日報デフォルト受信者。`line_user_id` があればテスト送信先に使える |

---

## アンケート方式の比較（LINEネイティブ含む）

| 方式 | 会員の使いやすさ | 会員番号と回答の紐付け | セッション後の自動送信 |
|------|------------------|------------------------|------------------------|
| **A. LIFF 自社アンケート**（推奨） | ◎ LINE内ブラウザで完結 | ◎ `member_id` で保存可能 | ◎ Messaging API + 既存LIFF |
| **B. LINE公式「リサーチ」** | ◎ トーク内で回答 | △ 匿名寄り（個人紐付け弱い） | × 管理画面から手動配信が中心 |
| **C. Lステップ等の拡張ツール** | ◎ | ○ ツール次第 | △ 別システム連携が必要 |
| **D. Googleフォーム URL** | △ 外部ブラウザへ遷移 | × URLパラメータ工夫が必要 | ○ URLを push するだけ |

### LINE公式「リサーチ」について

- **LINE Official Account Manager** の標準機能（選択式は無料、**自由記述は認証済アカウント**）
- 質問は最大10個程度、回答は LINE アプリ内で完結しやすい
- **デメリット（abody-gymos 向け）**
  - Messaging API から「リサーチ付きメッセージ」を **プログラムで送る公式手段がない**（カルテ保存後の自動 push とは相性が悪い）
  - **誰が答えたか**を会員マスタと結びつけにくい（セグメント配信向け）
  - 店舗 Bot が3つある構成では、リサーチも **店舗ごとに管理**が必要

### 推奨：LIFF 自社アンケート（方式 A）

既に `NEXT_PUBLIC_LIFF_ID` と `/line-entry`（LINEログイン）があるため、次を追加するのが最も現実的。

1. `/survey`（LIFF・Gym OS 本体 `/` とは別エントリ）— 満足度・トレーナー・自由記述など
2. Flex Message またはテキスト + URL で「アンケートに回答」ボタン
3. 回答を `session_survey_responses` テーブルに `member_id` + `date` で保存
4. カルテ保存後に push（重複防止テーブルは従来どおり）

Google フォームは **最短で試す用**、本番は LIFF を推奨。

### LIFF 設定（LINE内完結に必須）

1. [LINE Developers](https://developers.line.biz/) → LIFF → 追加（または既存を編集）
2. **エンドポイント URL**: `https://abody-gymos.vercel.app/survey`（`/member/session-survey` は旧URLで `/survey` へリダイレクト）
3. **サイズ**: Full 推奨
4. Vercel **Production** に `NEXT_PUBLIC_LIFF_SURVEY_ID` = `2010170005-nA0X3FPY`（設定済み・2026-05-23）
5. ボタン URL は `https://liff.line.me/{LIFF_ID}?liff.state=%3Fs%3D...`（`liff.state` は先頭に `?` 必須。`s=...` だけだと `/surveys=...` で 404）

ログイン用 LIFF（`/line-entry`）のエンドポイントにアンケートが来た場合も、`liff.state` / `token` / `s`+`sig` を検知して `/survey` へ転送する。

### 見やすく答えたくなる LINE 側の組み合わせ（確定案）

| 役割 | LINE / 実装 | 理由 |
|------|-------------|------|
| 届け方 | **Flex Message**（カード + 大きいボタン） | テキストだけよりタップしやすい |
| 回答画面 | **LIFF**（LINE内ブラウザ） | 5段階・複数選択・3つの自由記述。`liff.line.me` で開き Vercel ログインは出ない |
| 自動送信 | **Messaging API push**（カルテ保存後） | 担当トレーナー名を差し込める |
| 使わない | リサーチ / チャット逐次質問 | 自動化・会員紐付け・質問数に不向き |

**チャットで1問ずつ**（Webhook + クイックリプライ）も LINE ネイティブだが、質問が6ブロック以上あると離脱しやすく、複数選択・長文の UX が悪い。**招待だけ LINE、回答は LIFF** がバランス最良。

---

## 確定仕様：質問項目（2026-05 ヒアリング）

### 自動送信文面（push / Flex の本文）

```
担当トレーナーの{trainer_display_name}です。
本日のセッションはいかがでしたでしょうか？
次回のセッションに活かしたいのでご回答お願いします。

［アンケートに回答する］← ボタン（LIFF URL）
```

- トリガー: `POST /api/client-notes` 成功後（`trainer_id` / `date` / `member_id` あり）
- カルテ共有 LINE とは **別メッセージ**（または Flex 1通にまとめても可）

### LIFF フォーム項目

| # | ラベル | 形式 | 保存 |
|---|--------|------|------|
| 1 | セッション評価 | **5段階**（1〜5、星または大きいボタン） | `rating` smallint |
| 2 | よかったところ | **複数選択**（チェックボックス） | `highlights` text[] |
| | | たのしかった / しっかり効いた / 勉強になった / ストレス発散できた / なし | |
| 3 | 追い込みはいかがでしたか？ | **単一選択**（ラジオ） | `intensity_feedback` enum |
| | | きつすぎた / ちょうどいい / もう少し追い込みたい | |
| 4 | 感想やご意見 | 自由記述（任意） | `comment_general` |
| 5 | 嫌だったこと・次回こうして欲しい | 自由記述（任意） | `comment_improve` |
| 6 | わからなかったこと・次回聞きたいこと | 自由記述（任意） | `comment_questions` |

### DB（案）

`session_survey_responses`

- `id`, `member_id`, `trainer_id`, `store_id`, `session_date` (date), `client_note_id` (nullable)
- 上記回答カラム + `created_at`
- UNIQUE (`member_id`, `session_date`) — 1日1回

`session_survey_line_dispatches` — 送信済み管理（従来案）

### トレーナー別集計

- 管理画面: `/admin/dashboard/trainers/[trainerId]` または新タブ「セッション評価」
- 表示: 平均評価、件数、直近コメント、追い込み分布、ハイライト集計
- `trainer_id` で GROUP BY（`session_survey_responses`）

### 評価 2 以下 → ヒアリング

- 保存時 `rating <= 2` なら `needs_followup = true`（または別テーブル `session_survey_followups`）
- 管理画面に **要ヒアリング一覧**（未対応 / 対応済み、担当者メモ、対応日）
- （任意）スタッフ LINE（EBI020 等）へ「{会員名} 評価{rating} — 要ヒアリング」通知

---

## 確定前に決めること（テストで確認）

1. **アンケート本体**: **LIFF自社**（推奨） / LINEリサーチ（手動運用） / Googleフォーム（暫定）
2. **送信タイミング**（推奨順）
   - **A. カルテ保存直後**（推奨）— トレーナーがセッション記録を保存したタイミング＝業務上の「セッション終了」
   - **B. 予約 `end_at` + Cron** — カルテ未保存でも送る可能性あり
   - **C. 管理画面の手動送信** — 運用負荷大、自動化に不向き
3. **文面**: カルテ共有と **別メッセージ** か、**1通にまとめる** か（テストで見た目を決める）
4. **重複防止**: 同一予約日・同一会員に1回だけ（下記 dispatch テーブル）

---

## 推奨仕様（本実装）

### トリガー

`POST /api/client-notes` でカルテ保存が成功したあと、既存のカルテ共有 LINE に続けて（または設定で切替）、アンケート案内を **追加 push** する。

- `line_user_id` がない会員はスキップ（既存カルテ LINE と同じ）
- `store_id` から店舗名 → `lineChannelTokenForStoreName`（既存と同じ）

### 文面（初期案・テストスクリプトと同一）

```
【セッション後アンケートのお願い】
{会員名} 様

本日のトレーニングはいかがでしたか？
2〜3分程度のアンケートにご協力ください。

▼回答はこちら
{SESSION_SURVEY_URL}

ご意見は今後のセッション改善に活用させていただきます。
よろしくお願いいたします。
```

- 日付・店舗を入れる場合: カルテ保存の `date` / `storeName` を差し込む
- URL 未設定時は送信しない（エラーログのみ）

### 重複防止

`trainer_event_reminder_dispatches` と同様のパターンで新テーブル:

```sql
CREATE TABLE public.session_survey_line_dispatches (
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  session_date date NOT NULL,  -- カルテの date（JST 日付）
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, session_date)
);
```

- 同一日にカルテを複数回保存してもアンケートは1通まで
- 再送が必要なら管理用 API または `scripts/` から PK を削除して再実行

### 環境変数

| 変数 | 用途 |
|------|------|
| `SESSION_SURVEY_URL` | アンケートフォーム URL（必須・本番） |
| `SESSION_SURVEY_LINE_ENABLED` | `true` のときのみ本番送信（段階ロールアウト） |
| `SESSION_SURVEY_SKIP_MEMBER_CODES` | カンマ区切り除外（例: 体験・社内） |
| 既存 LINE トークン | 店舗別 `LINE_CHANNEL_ACCESS_TOKEN*` |

### コード変更箇所（本実装時）

1. `src/lib/sessionSurveyLine.ts`（新規）
   - `messageForSessionSurvey({ memberName, dateYmd, storeName, surveyUrl })`
   - `shouldSendSessionSurvey(memberCode): boolean`
2. `src/app/api/client-notes/route.ts`
   - カルテ LINE 成功後、`SESSION_SURVEY_LINE_ENABLED` かつ dispatch 未送信なら push + insert dispatch
3. `supabase/migrations/YYYYMMDD_session_survey_line_dispatches.sql`
4. （任意）`POST /api/admin/send-session-survey-line` — 手動・再送用、`REPORT_CRON_SECRET` 認証
5. （任意）会員カルテ UI に「アンケート送信をスキップ」チェック → `members` フラグ or 除外リスト

### ロールアウト手順

1. `SESSION_SURVEY_URL` を本番に設定
2. `node scripts/send-session-survey-line-test.mjs` で **EBI020** にテスト（`vercel env run` 推奨）
3. 問題なければ `SESSION_SURVEY_LINE_ENABLED=true` で本番デプロイ
4. 1店舗・数名で様子見 → 全員

### テストコマンド

```bash
# 文面のみ確認
node scripts/send-session-survey-line-test.mjs --dry-run

# EBI020 に送信（本番トークン）
SESSION_SURVEY_URL='https://forms.gle/xxxx' \
  npx vercel env run --environment=production -- \
  node scripts/send-session-survey-line-test.mjs

# 別会員で試す（店舗 Bot は直近予約の店舗名から自動。EBI020 のみ既定で恵比寿トークン）
npx vercel env run --environment=production -- \
  node scripts/send-session-survey-line-test.mjs EBI027

# トークン店舗を明示（会員が連携した Bot と一致させる）
node scripts/send-session-survey-line-test.mjs EBI027 --token-store 上野
```

---

## 代替案：Cron（カルテ保存と独立）

- `vercel.json` に `*/15 * * * *` などで `/api/cron/session-survey-line`
- 条件: `end_at` が過去30分以内、`status=confirmed`、`line_user_id` あり、当日 dispatch なし
- 欠点: キャンセル・無断キャンセル・体験のみの枠でも送りうる → **カルテ連動の方が安全**

---

## 受け入れ条件

- [ ] EBI020 の LINE にテスト文面が届く（URL タップ可能）
- [ ] `line_user_id` 未連携会員では送らない
- [ ] 同一 `member_id` + `session_date` で2通目は送らない
- [ ] 店舗 Bot トークンが正しい（上野会員は上野トークン）
- [ ] `SESSION_SURVEY_LINE_ENABLED` が false のとき本番 API は送らない
