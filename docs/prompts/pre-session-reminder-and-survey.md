# 実装プロンプト：予約前LINEリマインド（60分前）＋ セッション前ヒアリングアンケート

> まず **EBI020 だけ**でテスト送信し、文面・タイミング・フォームを確認してから本実装に進む。  
> このファイルは実装前の仕様・手順書。現時点では本番 Cron / DB / マイページは実装しない。

### 確定済み（2026-06-23）

| 項目 | 決定 |
|------|------|
| 送信タイミング | **60分前のみ**（2時間前・30分前は不要） |
| OFF時のヒアリング | **リマインドとセットで止める** |
| 文面・項目 | **変更なし** |

---

## 依頼の要約

会員がセッション予約を忘れないよう、**開始60分前**に LINE でリマインドを送る。  
同じタイミングで、トレーナーが事前に把握したい内容の**ヒアリングアンケート**も一緒に送る。

| タイミング | 送るもの |
|------------|----------|
| **60分前** | 予約リマインド ＋ セッション前ヒアリングアンケート |

会員マイページ `/member` から **リマインド通知の ON/OFF** を切り替えられるようにする。

---

## 前提・既存資産

| 既存 | 状態 |
|------|------|
| 予約データ | `reservations`（`status = confirmed`, `start_at`） |
| 会員LINE連携 | `members.line_user_id`, `members.line_channel_key` |
| 店舗別LINE token | `LINE_CHANNEL_ACCESS_TOKEN`, `_UENO`, `_SAKURAGICHO`, `_SHINJUKU` |
| 送信先解決 | `linePushTokenForMember()` — 予約店舗ではなく**会員が連携したLINE**へ送る |
| セッション後アンケート | `/survey` + `session_survey_*`（別機能・混同しない） |
| 会員マイページ | `/member` + `GET/PATCH /api/member/me` |
| 類似実装 | `daiki-event-reminders` cron（60分前ウィンドウ + dispatch 重複防止） |
| テスト送信パターン | `scripts/send-session-survey-line-test.mjs`（EBI020 向け） |

---

## 確定仕様（今回の依頼）

### 1. 60分前リマインド文面

```
【ご予約リマインド】
本日 {M月d日（曜）} {HH:mm} からセッション予定です。

店舗：{storeName}
担当：{trainerName}
セッション種別：{店舗/オンライン}

お気をつけてお越しください！
```

### 2. ヒアリングアンケート（リマインド直後に別メッセージ or Flex）

```
【セッション前ヒアリング】
本日の体調やご希望を事前に教えてください。
トレーナーがセッション内容を準備します。

［ヒアリングに回答する］
```

- セッション後アンケート（`/survey`）とは**別画面・別テーブル**
- Flex Message 推奨（セッション後アンケートと同じ UX）

### 3. 会員側 ON/OFF

会員マイページ `/member` に追加:

```
予約リマインドLINE
[ON/OFF トグル]
セッション開始60分前にLINEでお知らせします。
```

| 設定 | 60分前リマインド | 60分前ヒアリング |
|------|------------------|------------------|
| ON | 送る | 送る |
| OFF | 送らない | **送らない**（リマインドとセットで止める） |

**OFF 対象外（常に送る）:** 予約確定・変更・キャンセル LINE、カルテ共有、セッション後アンケート

> 旧案では「リマインドOFFでもヒアリングだけ送る」案があったが、今回は**セットで ON/OFF** とする（会員体験がシンプル）。

---

## ヒアリング項目（LIFF 1画面）

| # | 項目 | 形式 | DBカラム案 |
|---|------|------|------------|
| 1 | 今日の調子 | 5段階（1=つらい 〜 5=絶好調） | `condition_score` |
| 2 | 食事 | 食べた / 食べていない / 軽くだけ | `meal_status` enum |
| 3 | トレーニングの強度感 | 軽め / ちょうどいい / しっかり追い込みたい | `intensity_preference` enum |
| 4 | 今日重点的にやりたい部位・種目 | 自由記述（任意） | `request_focus` text |
| 5 | 痛み・違和感・避けたいこと | 自由記述（任意） | `concern` text |
| 6 | その他伝えたいこと | 自由記述（任意） | `free_comment` text |

---

## DB設計

### 1. members にリマインド設定

```sql
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS reservation_reminder_line_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.members.reservation_reminder_line_enabled IS
  '会員向け予約リマインドLINE（60分前）のON/OFF。予約確定・変更・カルテ等は対象外';
```

### 2. 送信済み管理（重複防止・必須）

Cron は 10分ごとに動くため、同じ予約に二重送信しない。

```sql
CREATE TABLE IF NOT EXISTS public.reservation_line_reminder_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('60m_reminder', '60m_pre_session_survey')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, kind)
);

CREATE INDEX IF NOT EXISTS reservation_line_reminder_dispatches_reservation_idx
  ON public.reservation_line_reminder_dispatches (reservation_id);
```

### 3. ヒアリング回答テーブル（新規）

```sql
CREATE TABLE IF NOT EXISTS public.pre_session_survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE REFERENCES public.reservations (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  trainer_id uuid REFERENCES public.trainers (id) ON DELETE SET NULL,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE RESTRICT,
  session_start_at timestamptz NOT NULL,
  condition_score smallint CHECK (condition_score >= 1 AND condition_score <= 5),
  meal_status text CHECK (meal_status IN ('eaten', 'not_eaten', 'light_only')),
  intensity_preference text CHECK (intensity_preference IN ('light', 'moderate', 'hard')),
  request_focus text,
  concern text,
  free_comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pre_session_survey_responses_member_created_idx
  ON public.pre_session_survey_responses (member_id, created_at DESC);
```

---

## URL / LIFF

| 用途 | URL |
|------|-----|
| セッション後評価 | `/survey` |
| セッション前ヒアリング | `/pre-session-survey` |

- LIFF 新規: `NEXT_PUBLIC_LIFF_PRE_SESSION_SURVEY_ID`
- エンドポイント: `https://abody-gymos.vercel.app/pre-session-survey`
- **Phase 0 テスト**では LIFF なしの通常 URL でも可（署名付き `reservation_id`）

---

## バックエンド設計

### Cron

`vercel.json` に追加:

```json
{
  "path": "/api/cron/reservation-line-reminders",
  "schedule": "*/10 * * * *"
}
```

10分ごとに実行（`daiki-event-reminders` と同様）。

### 対象予約の抽出

`/api/cron/reservation-line-reminders`:

| kind | 対象ウィンドウ |
|------|----------------|
| `60m_reminder` | `start_at` が now + **55〜65分** |
| `60m_pre_session_survey` | 同上（リマインド送信成功後） |

条件:

- `reservations.status = 'confirmed'`
- `member_id IS NOT NULL`
- `members.is_active = true`
- `members.line_user_id IS NOT NULL`
- `members.reservation_reminder_line_enabled = true`
- `reservation_line_reminder_dispatches` に同じ `reservation_id + kind` がない

### LINE送信

```ts
const line = linePushTokenForMember({
  lineChannelKey: member.line_channel_key,
  memberCode: member.member_code,
  fallbackStoreName: store.name,
});
await pushLineTextChunks({ token: line.token, toUserId: member.line_user_id, chunks });
// 続けて Flex（ヒアリング）
```

---

## Phase 0: EBI020 テスト送信（本実装前）

実予約の60分前を待たずに文面・URLを確認する。

### 方式 A: スタンドアロンスクリプト（推奨・既存パターン踏襲）

`scripts/send-pre-session-reminder-line-test.mjs` を新規作成。

```bash
# 文面だけ確認（送信しない）
node scripts/send-pre-session-reminder-line-test.mjs --dry-run

# EBI020 に本番トークンで送信
npx vercel env run --environment=production -- node scripts/send-pre-session-reminder-line-test.mjs

# 別会員
node scripts/send-pre-session-reminder-line-test.mjs SAK050
```

送信内容:

1. テキスト: 60分前リマインド文面（ダミー日時・店舗・担当）
2. Flex: ヒアリング案内 + `/pre-session-survey?...` URL（署名付き、DB未作成でも動く）

### 方式 B: 管理API（Phase 1 以降）

`POST /api/admin/send-reservation-reminder-test`  
認証: `x-reservation-reminder-test-key: TRAINER_GATE_SECRET`

```json
{
  "member_codes": ["EBI020"],
  "kind": "60m_all"
}
```

---

## 会員マイページ（Phase 2）

### API

`GET /api/member/me` に `reservation_reminder_line_enabled` を追加。

`PATCH /api/member/me` または `PATCH /api/member/reminder-settings`:

```json
{ "reservation_reminder_line_enabled": false }
```

### UI

`src/app/member/page.tsx` にトグル追加。OFF でも重要通知は届く旨を明記。

---

## 実装対象ファイル

| ファイル | 内容 |
|----------|------|
| `supabase/migrations/YYYYMMDD_reservation_line_reminders.sql` | members 設定 + dispatch + responses |
| `src/lib/reservationReminderLine.ts` | 文面・抽出・送信 |
| `src/lib/preSessionSurveySigned.ts` | 署名 URL |
| `src/app/pre-session-survey/page.tsx` | ヒアリングフォーム |
| `src/app/api/member/pre-session-survey/route.ts` | GET/POST |
| `src/app/api/cron/reservation-line-reminders/route.ts` | Cron |
| `src/app/api/admin/send-reservation-reminder-test/route.ts` | 管理テスト API（任意） |
| `scripts/send-pre-session-reminder-line-test.mjs` | **Phase 0 テスト送信** |
| `src/app/api/member/me/route.ts` | 設定取得 |
| `src/app/member/page.tsx` | ON/OFF トグル |
| `vercel.json` | Cron 追加 |
| `src/types/database.ts` | 型更新 |

---

## 実装順序

### Phase 0: EBI020 テストだけ ← **まずここ**

- [ ] `scripts/send-pre-session-reminder-line-test.mjs` 作成
- [ ] `--dry-run` で文面・URL 確認
- [ ] EBI020 にリマインド + ヒアリング Flex を送信
- [ ] 文面・項目・ボタン URL を関係者で確認

### Phase 1: DB / フォーム

- [ ] migration 作成・適用
- [ ] `/pre-session-survey` 実装
- [ ] 回答が `pre_session_survey_responses` に保存されること

### Phase 2: 会員 ON/OFF

- [ ] `members.reservation_reminder_line_enabled`
- [ ] `/api/member/me` PATCH
- [ ] `/member` トグル UI

### Phase 3: Cron 本実装

- [ ] `/api/cron/reservation-line-reminders`
- [ ] dispatch 重複防止
- [ ] `vercel.json` cron 追加
- [ ] 本番デプロイ

### Phase 4: 本番確認

- [ ] EBI020 の実予約で60分前が届く
- [ ] リマインド OFF で届かない
- [ ] SAK 会員の恵比寿予約 → 桜木町 LINE に届く
- [ ] 管理画面カルテでヒアリング回答が見える（任意）

---

## 受け入れテスト

- [ ] EBI020 にテスト送信 → リマインド + ヒアリング Flex が届く
- [ ] ヒアリング URL タップ → フォーム表示（LIFF or ブラウザ）
- [ ] 回答送信 → DB 保存
- [ ] EBI020 リマインド OFF → Cron で送信対象外
- [ ] 同一予約に同じ kind が2回送られない

---

## 注意点

1. **ぴったり60分前に送らない** — Cron 遅延のため 55〜65分ウィンドウで拾う（`daiki-event-reminders` と同じ考え方）
2. **dispatch テーブル必須** — 10分 cron では重複防止がないと二重送信する
3. **LINE 送信先** — 必ず `linePushTokenForMember()`（予約店舗の Bot ではない）
4. **セッション後アンケートと分離** — テーブル・URL・LIFF を別にする
5. **EBI020** — 日報デフォルト受信者。`members.line_user_id` があればテスト可能

---

## コピペ用：AIへの依頼文（Phase 0）

```
docs/prompts/pre-session-reminder-and-survey.md を読んで、Phase 0 の EBI020 テスト送信だけ実装してください。

要点:
- セッション開始60分前: リマインド + セッション前ヒアリング（セット）
- ヒアリング項目: 調子・食事・強度希望・部位要望・痛み/避けたいこと・自由記述
- scripts/send-pre-session-reminder-line-test.mjs を作成（send-session-survey-line-test.mjs 踏襲）
- LINE送信先は linePushTokenForMember() を使う
- まず --dry-run、問題なければ EBI020 に送信
- DB / Cron / マイページ ON/OFF は Phase 1 以降
```
