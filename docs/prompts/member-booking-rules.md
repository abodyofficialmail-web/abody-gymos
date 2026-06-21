# 実装プロンプト：会員別予約ルール（2コマ保持上限 + 週3回休養）

> **目的**: 会員ごとに予約ルールを ON/OFF し、スタッフが会員カルテから設定する。  
> **2コマ保持上限** と **週3回ペース調整（休養日）** を **同一フレームワーク** で実装し、他店舗・オンライン併用も **週単位で全件合算** する。  
> 実装前の設計メモ。本ファイルを AI / 開発者に渡して実装する。

---

## できるか？

**すべてできる。** 一緒に実装して問題ない。

| 要件 | 可否 |
|------|------|
| 2コマ以上保持できない人だけ制限 | ○ 会員ごと ON/OFF |
| 週3回で翌日×（他店舗・オンライン含む合算） | ○ 週3回ルール仕様どおり |
| キャンペーン等ルールなし（EBI030） | ○ 両方 OFF |
| EBI025: 2コマ + 週3 / EBI028: 2コマのみ | ○ トグル独立 |
| 会員カルテから設定 | ○ |
| 会員一覧でざっくり確認 | ○ 任意バッジ |
| 既存予約システムを壊さない | ○ 後段フィルタ + POST 防御 + 段階リリース |

**現状**: どちらのルールも **未実装**。会員の未来予約件数チェックも **なし**（同一時刻の重複のみ拒否）。

**関連ドキュメント**（別件だが同時リリース可）:

- `docs/prompts/weekly-rest-booking-rule.md` — 週3回の詳細（本ファイルに統合）
- `docs/prompts/line-linked-channel-push.md` — LINE 通知（触るファイルがほぼ別）

---

## ルール一覧（会員ごとに独立 ON/OFF）

| ルール ID | DB カラム | デフォルト | スタッフ UI ラベル（案） |
|-----------|-----------|------------|--------------------------|
| **A. 2コマ保持上限** | `members.max_hold_rule_enabled` | `true` | 「同時保持上限（2コマ）」 |
| **B. 週3回休養** | `members.weekly_rest_rule_enabled` | `true` | 「予約ペース調整（週3回）」 |

### 設定例

| 会員 | max_hold | weekly_rest | 挙動 |
|------|----------|-------------|------|
| EBI025 | ON | ON | 未来2件まで + 週3件で翌日× |
| EBI030 | OFF | OFF | **現状と同じ**（キャンペーン等） |
| EBI028 | ON | OFF | 未来2件までのみ |

---

## ルール A：2コマ保持上限（同時ストック）

### 仕様

| 項目 | 内容 |
|------|------|
| 上限 | **2件**（`members.max_hold_limit` は将来用。初期は定数 `2` でよい） |
| カウント対象 | `status = confirmed` かつ `booking_source = 'member_portal'` |
| 時間 | **`start_at > now()`** の未来予約のみ（過去・実施済みは含めない） |
| 店舗 | **全店舗合算** |
| オンライン | **合算**（`session_type = 'online'` も 1件として数える） |
| 体験予約 | `blocks_capacity = false` は **数えない**（週3回と揃える） |
| 管理画面予約 | **カウントしない** かつ **上限チェックをスキップ**（スタッフは強制予約可） |
| キャンセル | 件数減 → 再予約可 |

### 会員への見え方

- 上限到達時: カレンダー／枠は **× または空**（既存 UI と同じ見た目）
- **「2コマ上限です」等のメッセージ・バナーは禁止**
- POST 409 も汎用文のみ: `"この時間は予約できません"` または `"予約を受け付けられません"`

### 判定

```ts
activeHoldCount >= 2  → 新規予約不可（ルール A が ON の会員のみ）
```

---

## ルール B：週3回ペース調整（休養日）

`weekly-rest-booking-rule.md` の仕様を **そのまま採用**。以下を明記:

| 項目 | 内容 |
|------|------|
| 週 | 月曜 00:00 〜 日曜（`Asia/Tokyo`） |
| 発動 | その週の会員予約 **3件以上** |
| 合算範囲 | **恵比寿 + 上野 + 桜木町 + オンライン** すべて |
| 休養 | その週 **最終予約日の翌日** 1日だけ × |
| ローリング | 週内に追加予約で最終日・休養日が付け替わる |
| 管理予約 | カウントしない |
| 会員 UI | 理由文・フラグ返却禁止 |

---

## 技術方針（バグを起こさない）

### 鉄則

1. **判定は 1 ファイルに集約** — `src/lib/booking/memberBookingRules.ts`（新規）
2. **3 箇所で同じ関数** — `available-dates` / `available-slots` / `POST reservations`
3. **既存ロジックの「後」にだけ足す** — シフト・capacity・締切・重複チェックは触らない
4. **ルール OFF = 現状完全維持** — 分岐の最初で return
5. **POST は必ず防御** — UI 改修前でも API 直叩きを防ぐ
6. **管理予約はルール外** — `booking_source = 'admin'`
7. **段階リリース** — Phase ごとに本番確認。問題時は会員単位 OFF で即回避

### 共通型（案）

```ts
export type MemberBookingRuleFlags = {
  max_hold_rule_enabled: boolean;
  weekly_rest_rule_enabled: boolean;
};

export type MemberRuleContext = {
  memberId: string;
  flags: MemberBookingRuleFlags;
  now: DateTime; // inject for tests
  zone: string;  // Asia/Tokyo
};

// 会員の confirmed member_portal 予約を一括取得（週・保持判定で使い回す）
export async function fetchMemberPortalReservations(
  supabase, memberId, opts?: { from?: string; to?: string }
): Promise<ReservationRow[]>;

export function countActiveHolds(reservations, now): number;

export function computeWeeklyRestBlockedDates(
  reservations, weekStart, zone
): Set<string>; // YYYY-MM-DD

export function isDateBlockedByMemberRules(
  ctx, targetYmd, reservations
): boolean;

export function canMemberBookSlot(
  ctx, targetStartAt, targetEndAt, reservations
): boolean;
```

### 適用順（1 日・1 枠）

```
既存: 店舗締切 / シフト / capacity / トレーナー重複
  ↓
新規: ルール A（保持2件に達していれば全拒否）
  ↓
新規: ルール B（その日が休養日なら拒否）
```

---

## DB（migration）

```sql
-- 会員別ルール（デフォルト ON = 新規も既存もルール対象）
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS max_hold_rule_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS weekly_rest_rule_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.members.max_hold_rule_enabled IS
  'ON: 未来の会員予約は最大2件まで（全店舗・オンライン合算）';
COMMENT ON COLUMN public.members.weekly_rest_rule_enabled IS
  'ON: 週3件（会員予約・全店舗合算）で最終日の翌日1日をブロック';

-- 予約の出自（管理画面はルール対象外）
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS booking_source text NOT NULL DEFAULT 'member_portal';

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_booking_source_check;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_booking_source_check
  CHECK (booking_source IN ('member_portal', 'admin'));

-- 既存行は member_portal にバックフィル（管理由来は判別不能ならコメントのみ）
UPDATE public.reservations SET booking_source = 'member_portal' WHERE booking_source IS NULL;

-- 任意: 店舗マスター緊急 OFF
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS weekly_rest_rule_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS max_hold_rule_enabled boolean NOT NULL DEFAULT true;
```

### キャンペーン会員の初期データ（例）

```sql
UPDATE public.members SET max_hold_rule_enabled = false, weekly_rest_rule_enabled = false
WHERE member_code = 'EBI030';
```

---

## 予約画面の変更（重要・週3/2コマ共通）

**現状**: `available-dates` / `available-slots` は **会員未特定**（店舗・月だけ）。

**変更**: メール入力 **後** に会員特定してから空き再取得（weekly-rest Phase 3 と同一）。

### 推奨 UX フロー

```
1. 店舗選択
2. メール入力 → GET /api/booking-v2/member?email=... で会員確認
3. カレンダー表示（available-dates に email または member_id を付与）
4. 枠表示（available-slots に同上）
5. 予約 POST（既存 + サーバー側ルール防御）
```

### API クエリ拡張

```
GET /api/booking-v2/available-dates?store_id=&month=&email=
GET /api/booking-v2/available-slots?store_id=&date=&email=
```

- `email` 省略時 → **現状どおり**（ルール適用なし）。後方互換。
- `email` あり → 会員 lookup → ルール適用。
- 会員がルール両方 OFF → 現状どおり。

---

## スタッフ UI：会員カルテ

### 場所

`/admin/dashboard/members/[memberId]` — 基本情報セクションの下に **「予約ルール設定」** カードを追加。

### 内容

```
┌ 予約ルール設定 ─────────────────────┐
│ [ON/OFF] 同時保持上限（2コマ）       │
│   未来の会員予約を最大2件まで         │
│                                      │
│ [ON/OFF] 予約ペース調整（週3回）      │
│   週3件で最終予約日の翌日1日を制限    │
│                                      │
│ （スタッフのみ）今週: 2件 / 休養日: なし │
│ （スタッフのみ）保持中: 1件            │
│                                      │
│ [保存]                               │
└──────────────────────────────────────┘
```

- トグル変更 → `PATCH /api/admin/members/[memberId]` で保存
- 会員には **一切表示しない**

### PATCH API 拡張

```ts
// src/app/api/admin/members/[memberId]/route.ts
const bodySchema = z.object({
  email: z.string()...optional(),
  max_hold_rule_enabled: z.boolean().optional(),
  weekly_rest_rule_enabled: z.boolean().optional(),
});
```

GET（会員詳細）でも両フラグを返す。

---

## 会員一覧（任意）

`membersClient.tsx` に小さなバッジ:

| 状態 | 表示 |
|------|------ panel |
| 両方 ON | `2コマ・週3` |
| 2コマのみ | `2コマ` |
| 週3のみ | `週3` |
| 両方 OFF | `ルールなし` |

一覧 API / page.tsx の select に 2 カラム追加。

---

## 触るファイル

| ファイル | 内容 |
|----------|------|
| `supabase/migrations/YYYYMMDD_member_booking_rules.sql` | 上記 DB |
| `src/lib/booking/memberBookingRules.ts` | **新規** 判定集約 |
| `src/lib/booking/memberBookingRules.test.ts` | **新規** 単体テスト（推奨） |
| `src/app/api/booking-v2/available-dates/route.ts` | email 対応 + ルール後段フィルタ |
| `src/app/api/booking-v2/available-slots/route.ts` | 同上 |
| `src/app/api/booking-v2/reservations/route.ts` | POST 防御 + `booking_source` |
| `src/app/api/admin/reservations/route.ts` | `booking_source = 'admin'` |
| `src/app/booking/page.tsx` | メール先 → カレンダー |
| `src/app/admin/dashboard/members/[memberId]/memberDetailClient.tsx` | 設定 UI |
| `src/app/api/admin/members/[memberId]/route.ts` | PATCH / GET |
| `src/app/admin/dashboard/members/page.tsx` | select 拡張（任意） |
| `src/app/admin/dashboard/members/membersClient.tsx` | バッジ（任意） |

**触らない**: シフト計算
ift import、capacity 計算、管理画面の空きカレンダー（会員ルールは会員ポータルのみ）。

---

## 実装フェーズ（安全な順序）

### Phase 0 — 準備

- migration 実行（カラム追加のみ、挙動変化なし）
- `memberBookingRules.ts` + 単体テスト
- EBI030 等キャンペーン会員を SQL で OFF

### Phase 1 — POST 防御のみ

- `booking-v2/reservations` POST にルールチェック
- `admin/reservations` に `booking_source = 'admin'`
- **UI 未変更** → ルール ON 会員は POST 409（直叩き・既存 UI から防御開始）
- 本番で EBI030 OFF を確認

### Phase 2 — 空き API + 予約画面

- `available-dates/slots` に email パラメータ
- `booking/page.tsx` メール先フロー
- 会員画面にルール文言なし

### Phase 3 — 会員カルテ UI

- トグル + PATCH + スタッフ向けステータス表示
- 一覧バッジ（任意）

### Phase 4 — LINE 連携チャネル（別ドキュメント）

- `line-linked-channel-push.md` — 予約ルールと独立。同じスプリントでも Phase 4 以降推奨

---

## 受け入れテスト

### ルール A（2コマ）

- [ ] ON 会員: 未来0件 → 予約可
- [ ] ON 会員: 未来2件 → 3件目不可（全店舗・オンライン合算）
- [ ] 1件キャンセル → 再予約可
- [ ] OFF 会員（EBI030）: 3件以上保持可
- [ ] 管理予約: 保持上限無視・件数に含めない
- [ ] 会員画面に「2コマ」文言なし

### ルール B（週3）

- [ ] ON: 週3件（恵比寿2 + 上野1 等）→ 休養日×
- [ ] オンライン1 + 店舗2 → 3件として発動
- [ ] OFF 会員: 週4件でも休養なし
- [ ] ローリング付け替え
- [ ] 管理予約はカウント外

### 組み合わせ

- [ ] EBI025 相当（両方 ON）: 両方適用
- [ ] EBI028 相当（2コマのみ）: 週4件でも休養なし、保持2は適用
- [ ] 両方 OFF: 完全に現状同等

### 回帰

- [ ] 両方 OFF の会員 → カレンダー・POST が従来と同じ
- [ ] email なしの available API → 従来と同じ
- [ ] シフトなし日・capacity 満杯 → 従来どおり ×

---

## リスクと対策

| リスク | 対策 |
|--------|------|
| 既存会員が急に予約できなくなる | デフォルト ON 前にキャンペーン会員を OFF。問題会員はカルテで OFF |
| UI と POST の不整合 | POST を先に入れる（Phase 1） |
| email 未入力でルールすり抜け | POST では必ず email から会員特定してチェック |
| 管理予約が member_portal になる | admin route で明示 `admin` |
| パフォーマンス | 会員1人あたり予約クエリ1回を dates/slots/POST で使い回し |

---

## 初期設定スクリプト（実装フェーズ用）

`scripts/seed-member-booking-rules.mjs`（案）

```js
#!/usr/bin/env node
/**
 * 会員別予約ルールの一括設定
 *
 * Usage:
 *   node scripts/seed-member-booking-rules.mjs EBI030 --no-rules
 *   node scripts/seed-member-booking-rules.mjs EBI028 --max-hold-only
 *   node scripts/seed-member-booking-rules.mjs EBI025 --all-rules
 *
 * --no-rules       : 両方 OFF（キャンペーン）
 * --max-hold-only  : 2コマのみ ON
 * --weekly-only    : 週3のみ ON
 * --all-rules      : 両方 ON（デフォルト）
 */
```

---

## 他機能との同時実装

| 組み合わせ | 可否 | 注意 |
|------------|------|------|
| 週3 + 2コマ + カルテトグル | ○ | 本ドキュメント |
| + LINE 連携チャネル push | ○ | 別 Phase。予約ルール Phase 3 完了後推奨 |
| + セッション後アンケート LINE | ○ | 予約ルールとは無関係 |

**触るファイル被り**: `booking-v2/reservations/route.ts` のみ LINE push と共有。  
→ 予約ルール PR を先にマージし、LINE push をその上に載せるとコンフリクトが少ない。

---

## 実装依頼時の一言プロンプト（コピペ用）

```
@docs/prompts/member-booking-rules.md の仕様どおりに実装してください。

要点:
- members.max_hold_rule_enabled / weekly_rest_rule_enabled を会員カルテから ON/OFF
- 2コマ上限: 未来の member_portal 予約が2件でブロック（全店舗・オンライン合算）
- 週3回: 同週3件で最終日翌日×（全店舗・オンライン合算、管理予約除外）
- 判定は memberBookingRules.ts に集約し dates/slots/POST で同一関数
- 会員画面にルール説明・理由文は出さない
- booking/page.tsx はメール入力後に空き再取得
- admin 予約は booking_source=admin でルール外
- Phase 0→1→2→3 の順。既存シフト・capacity ロジックは壊さない
- EBI030 は両方 OFF、EBI028 は2コマのみ、EBI025 は両方 ON をテスト

単体テストを書き、受け入れテストチェックリストを実行すること。
```
