# 実装プロンプト：週3回予約ペース調整（休養日）

> 会員が検討中。実装依頼時にこのファイルをそのまま AI / 開発者に渡す。

## 依頼の要約

abody-gymos の会員予約に「週3回ペース調整」を追加する。  
**会員向け画面にルールの説明・ボタン・メッセージは一切出さない。**  
スタッフ用会員カルテにのみ ON/OFF トグルを付ける。

---

## 確定仕様

### ルール

| 項目 | 内容 |
|------|------|
| 週の定義 | 月曜 00:00 〜 日曜（店舗 TZ = `stores.timezone`、通常 `Asia/Tokyo`） |
| 発動条件 | その週の **会員自身の予約が3件以上**（同日2枠 = 2件） |
| 店舗 | **全店舗合算**（上野だけ3件でも、他店舗含めて3件でも発動） |
| カウント対象 | `status = confirmed` かつ `booking_source = 'member_portal'` のみ |
| カウント除外 | **管理画面からの予約**（`booking_source = 'admin'`） |
| 体験予約 | 未決定 → 実装時に確認。暫定推奨: `blocks_capacity = false` は数えない |
| 休養 | **1日のみ**：その週の **最終予約日（start_at の日付）の翌日** だけ × |
| ローリング | 週内でさらに予約があると `last` が変わり、休養日も付け替わる（例: 月火水→木× → 金予約→土×、木は再開放されうる） |
| 週3未満 | 休養日なし |
| キャンセル・リスケ | 都度再計算 |

### 会員への見え方（厳守）

- 休養日は **今と同じ × または枠が少ない** 見た目のみ
- **「週3回のため…」等のメッセージ・バナー・ツールチップ・専用エラー文は禁止**
- 会員向け API レスポンスに `rest_reason` / `weekly_rest` 等のフラグを返さない
- 予約画面・マイページに **ON/OFF ボタンや設定 UI を付けない**

### スタッフ向け

- `/admin/dashboard/members/[memberId]`（会員カルテ）にトグル1つ  
  - 例ラベル: 「予約ペース調整（週3回）」  
  - `members.weekly_rest_rule_enabled`（boolean、デフォルト `true`）  
  - OFF の会員はルール完全スキップ
- 任意: スタッフのみ「今週 N 件 / 休養日 YYYY-MM-DD」をカルテに表示（会員には非表示）
- 任意: `stores.weekly_rest_rule_enabled` で店舗全体の緊急 OFF

### デフォルト運用

- **全員 ON**（新規会員も `true`）
- 例外はカルテで **OFF** のみ（会員ごとに ON を付ける運用はしない）

---

## 技術方針（既存を壊さない）

### 触るファイル（想定）

- `lib/booking/weeklyRestRule.ts`（新規）— 判定を1か所に集約
- `src/app/api/booking-v2/available-dates/route.ts`
- `src/app/api/booking-v2/available-slots/route.ts`
- `src/app/api/booking-v2/reservations/route.ts`（POST + insert に `booking_source`）
- `src/app/api/admin/reservations/route.ts`（`booking_source = 'admin'`）
- `src/app/booking/page.tsx` — **メール先 → カレンダー**（`email` または `member_id` 付きで空き再取得）
- `src/app/admin/dashboard/members/[memberId]/memberDetailClient.tsx` — トグル
- `src/app/api/admin/members/[memberId]/route.ts` — PATCH 拡張
- Supabase migration

### 判定の鉄則

1. `available-dates` / `available-slots` / `POST reservations` で **同一関数**を使う
2. 店舗空き（シフト・capacity・締切）は **既存ロジックの後** に会員フィルタをかける
3. `weekly_rest_rule_enabled === false` または店舗マスター OFF → 現状どおり

### DB（migration）

```sql
-- members
weekly_rest_rule_enabled boolean NOT NULL DEFAULT true;

-- reservations
booking_source text NOT NULL DEFAULT 'member_portal'
  CHECK (booking_source IN ('member_portal', 'admin'));

-- stores（任意）
weekly_rest_rule_enabled boolean NOT NULL DEFAULT true;
```

既存 `reservations` は `member_portal` にバックフィル（管理由来が判別不能なら方針をコメントに残す）。

---

## 実装フェーズ（推奨順）

1. **Phase 1** — DB + `weeklyRestRule.ts` + 単体テスト  
2. **Phase 2** — API（dates / slots / POST）+ `booking_source`（会員UIは未変更でも POST は防御）  
3. **Phase 3** — 予約画面: メール先 → カレンダー、メッセージなし  
4. **Phase 4** — カルテトグル + PATCH + 店舗マスター（任意）  
5. **Phase 5** — 本番・監視・店舗マスターでロールバック可能に  

---

## 受け入れテスト

- [ ] ルール OFF 会員 → 従来と同じ ○△×・予約成功  
- [ ] 週2件 → 休養なし  
- [ ] 週3件（複数店舗含む）→ 最終日の翌日1日のみ ×  
- [ ] 管理予約3件 → 会員ルールは発動しない  
- [ ] キャンセルで2件 → 休養解除  
- [ ] 表示が取れる枠 → POST 成功／× → POST 409（理由文に週3回と出さない）  
- [ ] 会員画面にボタン・説明・週3回文言がない  
- [ ] カルテトグル OFF → 即ルール無効  
- [ ] ローリング: 月火水→木×、金予約後→土×（木の再開放は仕様どおりか確認）

---

## 将来の拡張（今回はやらない）

- 休養2日に変更（`rest_days_after_limit` を設定化）
- 休養日を「終日×」ではなく「最終予約時刻 ±90分」の枠だけ ×
- 週の予約件数上限（3件で休養だけでなく、4件目以降禁止）

---

## 実装依頼時の一言プロンプト（コピペ用）

```
@docs/prompts/weekly-rest-booking-rule.md の仕様どおりに実装してください。

要点:
- 週3件（会員予約・全店舗合算）で最終予約日の翌日1日だけブロック（ローリング）
- 管理予約はカウントしない（booking_source）
- 会員画面にメッセージ・ボタン・ルール説明は一切出さない
- 会員カルテにのみ weekly_rest_rule_enabled の ON/OFF
- available-dates / available-slots / POST で同一判定
- 予約画面はメール先に会員特定してからカレンダー取得

既存のシフト・capacity・締切ロジックは壊さず、上に会員フィルタを足すこと。
Phase 1 から順に進め、各フェーズでテストを書くか手動チェックリストを実行すること。
```
