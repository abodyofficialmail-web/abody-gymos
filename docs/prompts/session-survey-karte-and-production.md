# 実装プロンプト：セッション評価の本番ON ＋ 会員カルテへの表示

> EBI020 で LIFF 回答・DB 保存まで確認済み（2026-05-23）。  
> このファイルを AI / 開発者に渡して残りを実装する。

---

## 依頼の要約

1. **本番でカルテ保存後にアンケート LINE を自動送信**する（`SESSION_SURVEY_LINE_ENABLED=true`）
2. **会員カルテ画面**に、セッション評価（アンケート回答）を表示する  
   - 特に **直近の評価・回答内容** をトレーナーがすぐ確認できるようにする
   - 日付ごとのカルテと **同じ日付の評価** を並べて見えるようにする

---

## 1. `SESSION_SURVEY_LINE_ENABLED=true` の入れ方（Vercel）

### 手順（ダッシュボード）

1. [Vercel Dashboard](https://vercel.com/) → プロジェクト **abody-gymos**
2. 上部 **Settings** → 左 **Environment Variables**
3. **Add New** をクリック
4. 次を入力:

| 項目 | 値 |
|------|-----|
| **Key** | `SESSION_SURVEY_LINE_ENABLED` |
| **Value** | `true` |
| **Environment** | **Production** にチェック（Preview も試すなら両方） |

5. **Save**
6. **Deployments** → 最新の Production → **⋯** → **Redeploy**（環境変数反映のため再デプロイ）

### 確認

- カルテ保存（`POST /api/client-notes`）後、会員の LINE に **カルte共有** に続いて **セッションアンケート Flex** が届く
- `false` または未設定のときは **送らない**（既存コード: `src/lib/sessionSurvey.ts` → `isSessionSurveyLineEnabled()`）
- テスト再送は引き続き `POST /api/admin/send-session-survey-line`（`x-session-survey-test-key`）

### 関連する既存 env（参考・設定済み想定）

| Key | 用途 |
|-----|------|
| `NEXT_PUBLIC_LIFF_SURVEY_ID` | アンケート LIFF ID |
| `NEXT_PUBLIC_APP_URL` | `https://abody-gymos.vercel.app` |
| `LINE_CHANNEL_ACCESS_TOKEN` 等 | 店舗別 push |
| `TRAINER_GATE_SECRET` | テスト送信 API 認証 |

---

## 2. カルテに評価を表示する — 確定仕様

### 方針（推奨）

**`client_notes.content` には書き込まない。**  
回答は `session_survey_responses` に既に保存されているので、**カルテ UI で JOIN 表示**する（二重管理を避ける）。

| 方式 | 採用 |
|------|------|
| A. カルテ API / 画面で `session_survey_responses` を日付 JOIN 表示 | **◎ 推奨** |
| B. 回答 POST 時に `client_notes.content` 末尾へ追記 | × 非推奨（LINE 共有済みカルテとズレる） |

### 紐付けキー

| 優先 | 条件 |
|------|------|
| 1 | `session_survey_invites.client_note_id` = `client_notes.id`（カルテ保存後に送った招待） |
| 2 | `member_id` + `session_date` = `client_notes.date`（同日フォールバック） |

`session_survey_responses` には `session_date`, `member_id`, `trainer_id`, `invite_id` がある。

### 会員カルテでの見え方

**場所:** `/admin/dashboard/members/[memberId]`  
**ファイル:** `src/app/admin/dashboard/members/[memberId]/memberDetailClient.tsx`

#### (1) 直近評価サマリー（カルテセクション上部）

カルテ一覧の上に常時表示（最新1件。未回答なら非表示）:

```
直近のセッション評価
2026-05-23（恵比寿 / デモトレーナー）
★5  よかった: しっかり効いた  追い込み: きつすぎた
感想: 楽しかった
```

- 評価 **2以下** は背景を薄い赤（`needs_followup`）＋「要ヒアリング」バッジ
- タップで該当日のカルテ行までスクロール（任意）

#### (2) 日付ごとのカルテ行に評価ブロック

既存のカルテ1件:

```
2026-05-23 恵比寿（デモトレーナー）
[トレーニング内容テキスト…]

── セッション評価 ──
★5 / 効いた / きつすぎた
感想: 楽しかった
```

- 同日の評価が **ない** 日は評価ブロックを出さない
- 評価だけあってカルテがない日（未保存）は、カルテ一覧の下に「評価のみ」の行を薄く表示（任意・Phase 2）

### 会員マイページ（任意・Phase 2）

`src/app/member/page.tsx` のカルテ一覧にも同様の JOIN 表示（トレーナー向けが主目的なら Phase 1 は管理画面のみで可）。

---

## 3. 技術実装（触るファイル）

### 3-1. 表示用フォーマット（新規）

`src/lib/sessionSurveyDisplay.ts`（新規）

- `formatSurveyRating(rating: number): string` → `★5` 等
- `formatSurveyHighlights(ids: string[]): string` → ラベル列（`SESSION_SURVEY_HIGHLIGHTS` 利用）
- `formatSurveyIntensity(id: string): string` → `SESSION_SURVEY_INTENSITY` 利用
- `formatSurveySummary(response): string` → 1行サマリー
- `formatSurveyDetail(response): string` → カルテ埋め込み用（複数行）

### 3-2. API

**案 A（推奨）:** `GET /api/client-notes` を拡張

クエリ `include_survey=1` のとき、レスポンスに追加:

```json
{
  "notes": [ /* 既存 */ ],
  "survey_by_date": {
    "2026-05-23": {
      "id": "...",
      "rating": 5,
      "highlights": ["effective"],
      "intensity_feedback": "too_hard",
      "comment_general": "楽しかった",
      "comment_improve": null,
      "comment_questions": null,
      "needs_followup": false,
      "trainer_name": "デモトレーナー",
      "store_name": "恵比寿",
      "created_at": "..."
    }
  },
  "latest_survey": { /* 最新1件。survey_by_date から算出可 */ }
}
```

実装: `src/app/api/client-notes/route.ts` の GET 内で  
`session_survey_responses` を `member_id` で取得 → `session_date` をキーに map。

**案 B:** `GET /api/admin/members/[memberId]/session-surveys` を新規  
→ カルテ API とは別 fetch。UI で date マージ。

**Phase 1 推奨:** 案 A（カルテ画面は既に `/api/client-notes` だけ叩いているため変更が少ない）。

### 3-3. UI

`memberDetailClient.tsx`

1. `refreshNotes` のレスポンス型に `survey_by_date` / `latest_survey` を追加
2. 「カルテ（全店舗）」セクション直上に **直近評価サマリー** コンポーネント
3. 各カルテ行 `n.date` に対し `survey_by_date[n.date]` があれば評価ブロックを描画
4. スタイル: 評価ブロックは `border-l-4 border-rose-300 bg-rose-50/50 pl-3` 等でカルテ本文と区別

### 3-4. 既存管理画面との関係

- `/admin/dashboard/session-surveys` … 要ヒアリング一覧・全件横断（既存）
- 会員カルテ … **その会員の履歴**（今回追加）

---

## 4. データ例（EBI020・本番確認済み）

```
member_code: EBI020
session_date: 2026-05-23
rating: 5
highlights: ["effective"]
intensity_feedback: "too_hard"
comment_general: "楽しかった"
trainer: デモトレーナー
store: 恵比寿
```

---

## 5. 実装順序（チェックリスト）

### Phase 1（必須）

- [x] Vercel に `SESSION_SURVEY_LINE_ENABLED=true` → Redeploy（ユーザー設定済み）
- [x] `src/lib/sessionSurveyDisplay.ts` 追加
- [x] `src/lib/sessionSurveyForKarte.ts` 追加
- [x] `GET /api/client-notes` に `include_survey=1`（デフォルト ON）
- [x] `memberDetailClient.tsx` に直近サマリー + 日付別評価ブロック
- [ ] EBI020 カルテ画面で評価が見えることを確認

### Phase 2（任意）

- [ ] 会員マイページ `/member` にも同表示
- [ ] 評価のみ（カルテ未保存）の行
- [ ] トレーナー個人ダッシュボードに直近評価ウィジェット

---

## 6. テスト手順

1. **本番 ON 確認**  
   - テスト会員でカルte保存 → LINE にアンケート Flex が届く（EBI020 等）
2. **カルテ表示**  
   - 管理画面 → 会員 → EBI020 → 「直近のセッション評価」に ★5 が出る  
   - 2026-05-23 のカルテ行の下に評価ブロック
3. **要ヒアリング**  
   - 評価 1〜2 のテスト回答 → 赤バッジ + `/admin/dashboard/session-surveys` に載る

---

## 7. 触らないもの

- LIFF / `/survey` の回答フロー（動作確認済み）
- `session_survey_*` テーブル定義（Supabase 適用済み）
- 会員向け予約画面

---

## 8. コピペ用：AI への依頼文

```
docs/prompts/session-survey-karte-and-production.md を読んで実装してください。

1. SESSION_SURVEY_LINE_ENABLED の Vercel 設定手順はドキュメント通り案内済み。コード変更はカルテ表示が主。
2. GET /api/client-notes に session_survey_responses の JOIN（include_survey）を追加。
3. memberDetailClient のカルテセクションに「直近評価サマリー」と日付別評価ブロックを追加。
4. client_notes.content への追記はしない。
5. sessionSurveyDisplay.ts でラベル整形。既存 SESSION_SURVEY_HIGHLIGHTS / INTENSITY を再利用。
```
