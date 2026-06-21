# 実装プロンプト：LINE通知を「連携した公式アカウント」に送る

> **目的**: 桜木町LINEで連携した会員が、恵比寿・上野を予約したり、他店舗でセッションしてカルテ保存しても、**桜木町のLINEトーク**に確定通知・カルテ（フィードバック含む）が届くようにする。  
> 実装前の調査メモ。本ファイルを AI / 開発者に渡して実装する。

---

## できるか？

**できる。**

LINE Messaging API の push は次の組み合わせだけ有効:

| 項目 | 必須 |
|------|------|
| `to`（userId） | そのボットと友だちになったときに発行された ID |
| `Authorization` のトークン | **同じボット（公式アカウント）** のチャネルアクセストークン |

現状は **予約・カルテの店舗名** でトークンを選んでいるため、桜木町連携 × 恵比寿予約で失敗する。  
**トークンだけ「連携チャネル」に切り替え、文面の店舗名・住所は予約／セッション店舗のまま** にすれば要件を満たせる。

```
【変更前】push トークン = 予約店舗 / カルテ店舗
【変更後】push トークン = 会員が連携した LINE チャネル
         メッセージ本文 = これまでどおり（恵比寿予約なら恵比寿の日時・住所）
```

---

## 確定仕様

### 対象となる通知（会員向け push）

| 種別 | トリガー | 本文の店舗情報 |
|------|----------|----------------|
| 予約確定 | `POST booking-v2/reservations`, `POST admin/reservations` | **予約の `store_id`**（恵比寿なら恵比寿の住所） |
| 予約変更・キャンセル | `PATCH admin/reservations/[id]` | 同上 |
| カルテ・フィードバック | `POST client-notes` | **カルテの `store_id`**（実施店舗。`buildLineMessage` の「店舗：恵比寿店」等） |
| 予約確定の手動再送 | `admin/resend-reservation-line` | 同上 |

**対象外**（今回変えない）:

- スタッフ向け日報 `daily-all-stores-line-report`
- ダイキ予定リマインド `cron/daiki-event-reminders`
- Webhook の **reply**（もともと受信チャネルのトークン）

将来のセッション後アンケート（`session-survey-line.md`）も、実装時は **連携チャネルのトークン** を使うこと。

### 会員に保存する情報

Webhook 連携確定時に、検出済みの `channelKey` を会員に保存する。

| DB カラム | 型 | 値 |
|-----------|-----|-----|
| `members.line_channel_key` | `text` | `'default'` \| `'ueno'` \| `'sakuragicho'` |

既存の `line_user_id` と **必ずセット**で更新する（再連携でチャネルが変わったら両方更新）。

`line_channel_default_stores` テーブルは今回使わない（連携時点のチャネルが正）。

### トークン解決ルール（1か所に集約）

新規: `src/lib/lineChannel.ts`（名前は任意）

```ts
export type LineChannelKey = "default" | "ueno" | "sakuragicho";

export function lineAccessTokenForChannelKey(key: LineChannelKey): string | null;

/** 会員への push 用。連携チャネル優先、未設定時のみフォールバック */
export function linePushTokenForMember(params: {
  lineChannelKey: LineChannelKey | null | undefined;
  /** フォールバック: 旧挙動（店舗名）。未連携バックフィル前の会員用 */
  fallbackStoreName?: string;
}): string | null;
```

**優先順位**:

1. `member.line_channel_key` がある → そのチャネルのトークン
2. ない（既存データ）→ `fallbackStoreName` で `lineChannelTokenForStoreName`（現状と同じ）
3. それでも null → push しない + ログ

`src/lib/lineMessagingPush.ts` の `lineChannelTokenForStoreName` は **本文用・フォールバック用** として残す。

### Webhook 連携

`src/app/api/line/webhook/route.ts`:

- `linkLine()` に `channelKey` を渡し、`line_user_id` と `line_channel_key` を同時 UPDATE
- 別チャネルで再連携した場合: 新しい `userId` + 新しい `channelKey` で上書き（現状の「別LINEと連携済み」チェックは維持）

### 予約・カルテ API の変更パターン

**Before**:

```ts
const token = tokenForStoreName(storeRow.name);
await pushLineMessage({ to: lineUserId, text, token });
```

**After**:

```ts
const token = linePushTokenForMember({
  lineChannelKey: member.line_channel_key,
  fallbackStoreName: storeRow.name,
});
await pushLineTextAsChunks(token, lineUserId, text); // 既存共通関数へ寄せると重複削減
```

`select` に `line_channel_key` を追加。各 route 内のローカル `tokenForStoreName` / `pushLineMessage` は削除して共通 lib に統一。

---

## DB（migration）

```sql
-- members: 連携した LINE 公式アカウント（チャネル）
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS line_channel_key text;

ALTER TABLE public.members
  DROP CONSTRAINT IF EXISTS members_line_channel_key_check;

ALTER TABLE public.members
  ADD CONSTRAINT members_line_channel_key_check
  CHECK (
    line_channel_key IS NULL
    OR line_channel_key IN ('default', 'ueno', 'sakuragicho')
  );

COMMENT ON COLUMN public.members.line_channel_key IS
  'LINE Webhook 連携時に検出したチャネル。push はこのトークンを使う（予約店舗とは独立）';
```

### 既存会員のバックフィル（推奨）

`line_user_id` がある会員のみ、**会員番号プレフィックス**で暫定推定（再連携が理想だが運用負荷を下げる）:

| 会員番号 | `line_channel_key` |
|----------|-------------------|
| `SAK*` | `sakuragicho` |
| `UEN*` | `ueno` |
| `EBI*` その他 | `default` |

スクリプト案: `scripts/backfill-members-line-channel-key.mjs`（実装フェーズで追加）

```js
// 疑似コード
// UPDATE members SET line_channel_key = 'sakuragicho'
//   WHERE line_user_id IS NOT NULL AND member_code LIKE 'SAK%'
//     AND line_channel_key IS NULL;
// （UEN / default も同様）
// 終了時に line_user_id あり & line_channel_key NULL の件数を表示
```

**注意**: 恵比寿会員番号だが桜木町LINEで連携している例は推定が外れる → カルテに「再連携を促す」運用 or 管理画面で `line_channel_key` 手修正（任意 UI）。

---

## 触るファイル（想定）

| ファイル | 変更内容 |
|----------|----------|
| `supabase/migrations/YYYYMMDD_members_line_channel_key.sql` | 上記カラム |
| `src/lib/lineChannel.ts` | **新規** チャネル key ↔ トークン、会員向け解決 |
| `src/lib/lineMessagingPush.ts` | `lineChannelTokenForStoreName` 維持、必要なら re-export |
| `src/app/api/line/webhook/route.ts` | 連携時に `line_channel_key` 保存 |
| `src/app/api/booking-v2/reservations/route.ts` | push トークン解決 |
| `src/app/api/admin/reservations/route.ts` | 同上 |
| `src/app/api/admin/reservations/[reservationId]/route.ts` | 変更・キャンセル |
| `src/app/api/client-notes/route.ts` | カルテ・フィードバック |
| `src/app/api/admin/resend-reservation-line/route.ts` | 再送 |
| `scripts/resend-reservation-line.mjs` | 同上（CLI） |
| `src/types/database.ts` | 型生成 or 手動追記 |
| `src/app/admin/dashboard/members/[memberId]/memberDetailClient.tsx` | 任意: 「連携LINE: 桜木町」表示 |

**変えない**: `booking-v2/stores`（全店舗予約は継続）、予約画面の店舗選択 UI。

---

## 受け入れテスト

- [ ] 桜木町LINE連携（`line_channel_key=sakuragicho`）+ 恵比寿予約 → **桜木町トーク**に【ご予約確定】、本文は恵比寿の日時・住所
- [ ] 同上 + 上野予約 → 桜木町トークに届く、本文は上野
- [ ] 桜木町LINE連携 + 恵比寿店舗でカルテ保存 → 桜木町トークにカルテ・フィードバック、本文に「店舗：恵比寿店」
- [ ] 桜木町LINE連携 + 桜木町予約 → 従来どおり届く（回帰）
- [ ] 恵比寿LINE連携 + 恵比寿予約 → 従来どおり（回帰）
- [ ] `line_channel_key` NULL の旧会員 → フォールバック（店舗名トークン）で従来挙動
- [ ] push 失敗時ログに `line_channel_key` と `reservationStoreName` が出る
- [ ] 別LINEで既連携の会員番号 → 従来どおり拒否

### 手動確認コマンド（実装後）

```bash
# バックフィル（dry-run オプションがあれば先に）
node scripts/backfill-members-line-channel-key.mjs

# 特定会員の予約確定再送（管理 API または）
node scripts/resend-reservation-line.mjs SAK049
```

---

## 実装フェーズ（推奨順）

1. **Phase 1** — migration + `lineChannel.ts` + webhook で連携時保存  
2. **Phase 2** — 予約確定・変更・キャンセル・再送の push を `linePushTokenForMember` に統一  
3. **Phase 3** — `client-notes`（カルテ・フィードバック）  
4. **Phase 4** — バックフィルスクリプト + 本番実行 + ログ監視  
5. **Phase 5（任意）** — カルテに連携チャネル表示、誤推定会員の手修正 UI  

---

## エッジケース

| ケース | 方針 |
|--------|------|
| 複数店舗の公式LINEを両方友だち追加 | 会員レコードは1つの `line_user_id` のみ。最後に連携したチャネルが有効 |
| 桜木町LINEと恵比寿LINEの両方で連携したい | 現スキーマでは不可。将来 `member_line_identities` テーブル化が必要 |
| トークン env 未設定 | ログ + push スキップ（現状同様） |
| 会員が恵比寿LINEで連携しているのに桜木町予約 | **恵比寿トーク**に届く（連携チャネル優先）。意図どおり |

---

## 実装依頼時の一言プロンプト（コピペ用）

```
@docs/prompts/line-linked-channel-push.md の仕様どおりに実装してください。

要点:
- members.line_channel_key を Webhook 連携時に保存（default / ueno / sakuragicho）
- 会員向け LINE push のトークンは line_channel_key 優先（予約・カルテの店舗名は本文のみ）
- 予約確定・変更・キャンセル・カルテ・再送を linePushTokenForMember に統一
- 既存会員は SAK→sakuragicho, UEN→ueno 等でバックフィル
- 全店舗予約 UI はそのまま

Phase 1 から順に進め、受け入れテストを実行すること。
```
