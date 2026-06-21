# 実装プロンプト：予約前LINEリマインド ＋ セッション前ヒアリングアンケート

> まず **EBI020 だけ**でテスト送信し、文面・タイミング・LINE内フォームを確認してから本実装に進む。  
> このファイルは実装前の仕様・手順書。現時点では実装しない。

---

## 依頼の要約

予約開始前に会員へ LINE 通知を送る。

| タイミング | 送るもの |
|------------|----------|
| **2時間前** | 予約リマインド + セッション前ヒアリングアンケート |
| **30分前** | 予約リマインドのみ |

さらに、会員マイページで **リマインド通知を受け取る / 受け取らない** を切り替えられるようにする。

---

## 前提・既存資産

| 既存 | 状態 |
|------|------|
| 予約データ | `reservations` |
| 会員LINE連携 | `members.line_user_id` |
| 店舗別LINE token | `LINE_CHANNEL_ACCESS_TOKEN`, `_UENO`, `_SAKURAGICHO` |
| 他店舗来店時のLINE送信 | `linePushTokenForMember()` で会員番号ベースに送信先LINEを解決済み |
| セッション後アンケートLIFF | `/survey` + `session_survey_*` |
| 会員マイページ | `/member` + `/api/member/me` |
| Vercel Cron | `vercel.json` に日報cronあり |

---

## 確定仕様

### 通知種別

#### 1. 2時間前リマインド

```
【ご予約リマインド】
本日 {M月d日（曜）} {HH:mm} からセッション予定です。

店舗：{storeName}
担当：{trainerName}
セッション種別：{店舗/オンライン}

お気をつけてお越しください！
```

#### 2. 30分前リマインド

```
【まもなくセッションです】
{HH:mm} からセッション予定です。

店舗：{storeName}
担当：{trainerName}

よろしくお願いします！
```

#### 3. 2時間前ヒアリングアンケート

2時間前のリマインドに続けて、別メッセージまたはFlexで送る。

```
【セッション前ヒアリング】
本日の体調やご希望を事前に教えてください。

［ヒアリングに回答する］
```

### 会員側ON/OFF

会員マイページ `/member` に以下を追加:

- 「予約リマインドLINE」
- ON: 2時間前・30分前リマインドを受け取る
- OFF: リマインドを受け取らない

**注意:** OFF の対象は「リマインド通知」のみ。予約確定LINE・変更LINE・キャンセルLINE・カルテ・セッション後アンケートは止めない。

### ヒアリングアンケートの扱い

初期仕様では、リマインドOFFでも **ヒアリングアンケートは送る** かどうかを決める必要がある。

推奨:

| 設定 | 2時間前リマインド | 30分前リマインド | 2時間前ヒアリング |
|------|------------------|------------------|-------------------|
| ON | 送る | 送る | 送る |
| OFF | 送らない | 送らない | **送る** |

理由: ヒアリングは業務上必要な事前確認で、単なるリマインドとは目的が違うため。

ただし、ユーザー体験を優先するなら OFF 時はヒアリングも止める。実装前に最終確認すること。

---

## DB設計

### 1. members にリマインド設定

```sql
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS reservation_reminder_line_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.members.reservation_reminder_line_enabled IS
  '会員向け予約リマインドLINE（2時間前/30分前）のON/OFF。予約確定・変更・カルテ等は対象外';
```

### 2. 送信済み管理テーブル

同じ予約に重複送信しないため必須。

```sql
CREATE TABLE IF NOT EXISTS public.reservation_line_reminder_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('2h_reminder', '30m_reminder', '2h_pre_session_survey')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, kind)
);

CREATE INDEX IF NOT EXISTS reservation_line_reminder_dispatches_reservation_idx
  ON public.reservation_line_reminder_dispatches (reservation_id);
```

### 3. ヒアリング回答テーブル（新規）

セッション後アンケートと分ける。

```sql
CREATE TABLE IF NOT EXISTS public.pre_session_survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE REFERENCES public.reservations (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  trainer_id uuid REFERENCES public.trainers (id) ON DELETE SET NULL,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE RESTRICT,
  session_start_at timestamptz NOT NULL,
  condition_score smallint CHECK (condition_score >= 1 AND condition_score <= 5),
  sleep_quality text CHECK (sleep_quality IN ('good', 'normal', 'bad')),
  soreness text,
  request_focus text,
  concern text,
  free_comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pre_session_survey_responses_member_created_idx
  ON public.pre_session_survey_responses (member_id, created_at DESC);
```

---

## ヒアリング項目案

LIFF 1画面で回答。

| # | 項目 | 形式 |
|---|------|------|
| 1 | 今日の体調 | 5段階 |
| 2 | 睡眠 | よい / 普通 / 悪い |
| 3 | 筋肉痛・痛みがある部位 | 自由記述 |
| 4 | 今日重点的にやりたいこと | 自由記述 |
| 5 | 不安なこと・避けたいこと | 自由記述 |
| 6 | その他伝えたいこと | 自由記述 |

---

## URL / LIFF

セッション後アンケートとは別画面にする。

| 用途 | URL |
|------|-----|
| セッション後評価 | `/survey` |
| セッション前ヒアリング | `/pre-session-survey` |

LIFFは既存のアンケートLIFFを使い回してもよいが、エンドポイントが1つしか持てないため、基本は **通常URL** または **別LIFF ID** 推奨。

推奨:

- `NEXT_PUBLIC_LIFF_PRE_SESSION_SURVEY_ID` を新規作成
- エンドポイント: `https://abody-gymos.vercel.app/pre-session-survey`

最初のEBI020テストでは、LIFFを作らず通常URLで検証してもよい。

---

## バックエンド設計

### 1. Cron

Vercel Cron は短い間隔で実行し、対象時間帯に入った予約を拾う。

`vercel.json`:

```json
{
  "path": "/api/cron/reservation-line-reminders",
  "schedule": "*/10 * * * *"
}
```

10分ごとに実行。

### 2. 対象予約の抽出

`/api/cron/reservation-line-reminders`:

| kind | 対象 |
|------|------|
| `2h_reminder` | `start_at` が now + 110〜130分 |
| `30m_reminder` | `start_at` が now + 20〜40分 |
| `2h_pre_session_survey` | `start_at` が now + 110〜130分 |

条件:

- `reservations.status = 'confirmed'`
- `member_id IS NOT NULL`
- `members.is_active = true`
- `members.line_user_id IS NOT NULL`
- `reservation_line_reminder_dispatches` に同じ `reservation_id + kind` がない
- リマインドは `members.reservation_reminder_line_enabled = true`
- ヒアリングは上記方針に従う（推奨: OFFでも送る）

### 3. LINE送信

送信先 token は必ず `linePushTokenForMember()` を使う。

```ts
const line = linePushTokenForMember({
  memberCode: member.member_code,
  fallbackStoreName: store.name,
});
await pushLineTextAsChunks(line.token, member.line_user_id, text);
```

これにより、SAK会員が恵比寿・上野で予約しても、桜木町LINEトークへ届く。

### 4. ヒアリング送信

Flex Message:

- タイトル: `セッション前ヒアリング`
- 本文: `本日の体調やご希望を事前に教えてください`
- ボタン: `ヒアリングに回答する`
- URL: 予約ID署名付きURL

署名方式はセッション後アンケートと同様に `s + sig` 推奨。

---

## テストAPI（EBI020専用）

本実装前に、実際の予約時刻を待たずに EBI020 に送るテストAPIを作る。

### API案

`POST /api/admin/send-reservation-reminder-test`

認証:

- `x-reservation-reminder-test-key: TRAINER_GATE_SECRET`

Body:

```json
{
  "member_codes": ["EBI020"],
  "kind": "2h_all"
}
```

`kind`:

| kind | 送信内容 |
|------|----------|
| `2h_all` | 2時間前リマインド + ヒアリング |
| `30m_reminder` | 30分前リマインドのみ |
| `pre_session_survey` | ヒアリングのみ |

レスポンス:

```json
{
  "ok": true,
  "results": [
    {
      "member_code": "EBI020",
      "sent": true,
      "kind": "2h_all",
      "survey_url": "https://..."
    }
  ]
}
```

### テストコマンド

```bash
GATE=$(grep '^TRAINER_GATE_SECRET=' .env.local | cut -d= -f2-)
curl -X POST "https://abody-gymos.vercel.app/api/admin/send-reservation-reminder-test" \
  -H "Content-Type: application/json" \
  -H "x-reservation-reminder-test-key: $GATE" \
  -d '{"member_codes":["EBI020"],"kind":"2h_all"}'
```

---

## 会員マイページ実装

### API

`GET /api/member/me` に追加:

```json
{
  "member": {
    "reservation_reminder_line_enabled": true
  }
}
```

`PATCH /api/member/me` または新規 `PATCH /api/member/reminder-settings`:

```json
{
  "reservation_reminder_line_enabled": false
}
```

### UI

`src/app/member/page.tsx` の会員情報セクションに追加:

```
予約リマインドLINE
[ON/OFF トグル]
2時間前・30分前にLINEでお知らせします。
```

文言注意:

- OFFにしても予約確定・変更・キャンセル等の重要通知は届くことを明記

---

## 管理画面表示（任意）

会員カルテに設定状態を表示。

```
予約リマインドLINE: ON / OFF
```

スタッフが切り替えられるUIは Phase 2 で検討。

---

## 実装対象ファイル

| ファイル | 内容 |
|----------|------|
| `supabase/migrations/YYYYMMDD_reservation_line_reminders.sql` | members設定 + dispatch + pre_session_survey_responses |
| `src/lib/reservationReminderLine.ts` | 文面、対象抽出、送信処理 |
| `src/lib/preSessionSurveySigned.ts` | 署名URL |
| `src/app/pre-session-survey/page.tsx` | ヒアリングフォーム |
| `src/app/api/member/pre-session-survey/route.ts` | GET/POST |
| `src/app/api/cron/reservation-line-reminders/route.ts` | 10分ごとcron |
| `src/app/api/admin/send-reservation-reminder-test/route.ts` | EBI020テスト送信 |
| `src/app/api/member/me/route.ts` | 設定取得 |
| `src/app/api/member/reminder-settings/route.ts` | 設定更新 |
| `src/app/member/page.tsx` | ON/OFFトグル |
| `vercel.json` | Cron追加 |
| `src/types/database.ts` | 型更新 |

---

## 実装順序

### Phase 0: EBI020テストだけ

- [ ] テストAPI `send-reservation-reminder-test` を作成
- [ ] 2時間前リマインド文面を EBI020 に送る
- [ ] 30分前リマインド文面を EBI020 に送る
- [ ] ヒアリングアンケートURLを EBI020 に送る
- [ ] ヒアリング回答がDB保存されることを確認

### Phase 1: DB / フォーム

- [ ] migration作成
- [ ] `/pre-session-survey` 実装
- [ ] `pre_session_survey_responses` 保存

### Phase 2: 会員ON/OFF

- [ ] `members.reservation_reminder_line_enabled`
- [ ] `/api/member/reminder-settings`
- [ ] `/member` トグル

### Phase 3: Cron本実装

- [ ] `/api/cron/reservation-line-reminders`
- [ ] dispatch重複防止
- [ ] `vercel.json` に `*/10 * * * *`
- [ ] 本番デプロイ

### Phase 4: 本番確認

- [ ] EBI020の実予約で2時間前・30分前が届く
- [ ] リマインドOFFでリマインドが止まる
- [ ] 他店舗予約でも連携済みLINEに届く

---

## 受け入れテスト

- [ ] EBI020に `2h_all` テスト送信 → リマインド + ヒアリングが届く
- [ ] EBI020に `30m_reminder` テスト送信 → リマインドだけ届く
- [ ] ヒアリング回答 → DB保存
- [ ] EBI020のリマインドOFF → テストAPIまたはCronでリマインド送信対象外
- [ ] SAK会員が恵比寿予約 → 桜木町LINEに届く
- [ ] 同一予約に同じkindが2回送られない

---

## 注意点

1. **予約開始時刻ぴったり2時間前に送る実装にしない**  
   Cron遅延があるため、110〜130分など幅で拾う。

2. **dispatchテーブル必須**  
   Cronが10分ごとに動くため、重複送信防止が必要。

3. **LINE送信先は予約店舗ではなく会員の連携LINE**  
   `linePushTokenForMember()` を必ず使う。

4. **リマインドOFFの範囲を明確にする**  
   予約確定・変更・キャンセルは重要通知なのでOFF対象外。

5. **ヒアリングをOFF対象に含めるか最終確認**  
   推奨は「リマインドOFFでもヒアリングは送る」だが、運用方針次第。

---

## コピペ用：AIへの依頼文

```
docs/prompts/pre-session-reminder-and-survey.md を読んで、まず Phase 0 の EBI020 テスト送信だけ実装してください。

要点:
- 予約の2時間前: リマインド + セッション前ヒアリング
- 予約の30分前: リマインドのみ
- 会員マイページでリマインドON/OFFを切り替えられるようにするのは Phase 2
- LINE送信先は linePushTokenForMember() を使い、予約店舗ではなく会員が連携したLINEへ送る
- まず EBI020 にテストAPIで送って、問題なければ Cron 本実装へ進む
- dispatchテーブルで重複送信を防ぐ
```
