"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { ReferrerMemberPicker, type ReferrerChoice } from "@/components/admin/ReferrerMemberPicker";
import {
  campaignNeedsReferrer,
  ENROLLMENT_BONUS_KOMA_OPTIONS,
  ENROLLMENT_CAMPAIGN_PRESETS,
  MIN_COMMITMENT_MONTH_OPTIONS,
} from "@/lib/memberEnrollment";
import { ENROLLMENT_COURSE_PLANS, MEMBERSHIP_PLAN_OPTIONS, type MembershipPlan } from "@/lib/memberPlans";

type Store = { id: string; name: string };

type NextCodeResponse = {
  next_member_code?: string;
  store_name?: string;
  error?: string;
};

type CreateResponse = {
  member?: {
    id: string;
    member_code: string;
    name: string;
    email: string | null;
    store_name: string;
  };
  error?: string | { fieldErrors?: Record<string, string[]> };
};

function storeSortRank(storeName: string): number {
  if (storeName === "恵比寿") return 1;
  if (storeName === "上野") return 2;
  if (storeName === "桜木町") return 3;
  if (storeName === "新宿") return 4;
  if (storeName === "福岡") return 5;
  return 99;
}

function todayYmd() {
  return DateTime.now().setZone("Asia/Tokyo").toISODate() ?? "";
}

export function NewMemberClient({
  stores,
  initialNextCodesByStoreId,
}: {
  stores: Store[];
  initialNextCodesByStoreId: Record<string, string>;
}) {
  const router = useRouter();
  const sortedStores = useMemo(
    () => [...stores].sort((a, b) => storeSortRank(a.name) - storeSortRank(b.name) || a.name.localeCompare(b.name, "ja")),
    [stores]
  );

  const [storeId, setStoreId] = useState(() => sortedStores[0]?.id ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [joinedAt, setJoinedAt] = useState(todayYmd);
  const [minCommitment, setMinCommitment] = useState("");
  const [hasEnrollmentFee, setHasEnrollmentFee] = useState<boolean | null>(null);
  const [campaignPreset, setCampaignPreset] = useState("");
  const [referrer, setReferrer] = useState<ReferrerChoice | null>(null);
  const [hasChangingClothes, setHasChangingClothes] = useState<boolean | null>(null);
  const [hasMealPersonal, setHasMealPersonal] = useState<boolean | null>(null);
  const [membershipPlan, setMembershipPlan] = useState<MembershipPlan | "">("");
  const [bonusKoma, setBonusKoma] = useState<number>(0);
  const [nextCode, setNextCode] = useState<string | null>(() => {
    const id = sortedStores[0]?.id ?? "";
    return initialNextCodesByStoreId[id] ?? null;
  });
  const [codeLoading, setCodeLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedStore = sortedStores.find((s) => s.id === storeId) ?? null;

  useEffect(() => {
    if (!storeId) {
      setNextCode(null);
      return;
    }
    const cached = initialNextCodesByStoreId[storeId];
    if (cached) {
      setNextCode(cached);
      return;
    }
    setCodeLoading(true);
    setErr(null);
    fetch(`/api/gym/admin/members?store_id=${encodeURIComponent(storeId)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as NextCodeResponse;
        if (!res.ok) throw new Error(String(json.error ?? "会員番号の取得に失敗しました"));
        setNextCode(json.next_member_code ?? null);
      })
      .catch((e: Error) => {
        setNextCode(null);
        setErr(String(e.message ?? "会員番号の取得に失敗しました"));
      })
      .finally(() => setCodeLoading(false));
  }, [storeId, initialNextCodesByStoreId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!joinedAt) {
      setErr("入会日を入力してください");
      return;
    }
    if (hasEnrollmentFee == null) {
      setErr("入会金のあり・なしを選んでください");
      return;
    }
    const campaign = campaignPreset.trim();
    if (!campaign) {
      setErr("入会キャンペーンを選んでください");
      return;
    }
    if (!membershipPlan) {
      setErr("コースを選択してください");
      return;
    }
    if (campaignNeedsReferrer(campaign) && !referrer) {
      setErr("紹介者を選択してください");
      return;
    }
    if (hasChangingClothes == null) {
      setErr("着替えプランのあり・なしを選んでください");
      return;
    }
    if (hasMealPersonal == null) {
      setErr("食事パーソナルのあり・なしを選んでください");
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/gym/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: storeId,
          name,
          email,
          joined_at: joinedAt,
          min_commitment_months: minCommitment ? Number(minCommitment) : null,
          has_enrollment_fee: hasEnrollmentFee,
          enrollment_campaign: campaign,
          membership_plan: membershipPlan,
          enrollment_bonus_koma: bonusKoma,
          referrer_member_id: campaignNeedsReferrer(campaign) ? referrer?.id ?? null : null,
          has_changing_clothes_plan: hasChangingClothes,
          has_meal_personal: hasMealPersonal,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as CreateResponse;
      if (!res.ok) {
        const detail = json.error;
        if (detail && typeof detail === "object" && detail.fieldErrors) {
          const first = Object.values(detail.fieldErrors).flat()[0];
          throw new Error(first ?? "登録に失敗しました");
        }
        throw new Error(String(detail ?? "登録に失敗しました"));
      }
      if (!json.member) throw new Error("登録に失敗しました");
      router.push(`/admin/dashboard/members/${json.member.id}/onboarding`);
    } catch (e) {
      setErr(String((e as Error)?.message ?? "登録に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !busy &&
    !codeLoading &&
    Boolean(storeId) &&
    Boolean(name.trim()) &&
    Boolean(email.trim()) &&
    Boolean(nextCode) &&
    Boolean(joinedAt) &&
    hasEnrollmentFee != null &&
    Boolean(campaignPreset) &&
    Boolean(membershipPlan) &&
    hasChangingClothes != null &&
    hasMealPersonal != null &&
    (!campaignNeedsReferrer(campaignPreset) || Boolean(referrer));

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="text-sm text-slate-600">
        店舗・氏名・メールと入会情報を入力して会員登録します。目標はヒアリングシートで取得するので、トレーナーが目標を記入する画面はありません。登録後は体験セッションの記録へ進みます。
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-700">店舗</span>
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
          required
        >
          {sortedStores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        付与予定の会員番号:{" "}
        <span className="font-mono font-bold text-slate-900">
          {codeLoading ? "取得中…" : nextCode ?? "—"}
        </span>
        {selectedStore ? <span className="ml-2 text-slate-500">（{selectedStore.name}店）</span> : null}
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-700">氏名</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 山田太郎"
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
          required
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-700">メール</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="example@gmail.com"
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
          required
        />
      </label>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-bold text-slate-900">入会情報</div>

        <label className="block space-y-1">
          <span className="text-sm font-semibold text-slate-700">入会日</span>
          <input
            type="date"
            value={joinedAt}
            onChange={(e) => setJoinedAt(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
            required
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-semibold text-slate-700">最低継続期間</span>
          <select
            value={minCommitment}
            onChange={(e) => setMinCommitment(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
          >
            <option value="">なし</option>
            {MIN_COMMITMENT_MONTH_OPTIONS.map((n) => (
              <option key={n} value={String(n)}>
                {n}ヶ月
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-700">入会金</div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: true, label: "あり" },
              { id: false, label: "なし" },
            ].map((opt) => (
              <button
                key={String(opt.id)}
                type="button"
                onClick={() => setHasEnrollmentFee(opt.id)}
                className={[
                  "rounded-full border px-4 py-2 text-sm font-semibold",
                  hasEnrollmentFee === opt.id
                    ? "border-slate-400 bg-slate-100 text-slate-900"
                    : "border-slate-200 bg-white text-slate-700",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-semibold text-slate-700">入会キャンペーン</span>
          <select
            value={campaignPreset}
            onChange={(e) => setCampaignPreset(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
            required
          >
            <option value="">選択してください</option>
            {ENROLLMENT_CAMPAIGN_PRESETS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {campaignNeedsReferrer(campaignPreset) ? (
          <ReferrerMemberPicker value={referrer} onChange={setReferrer} />
        ) : null}

        <label className="block space-y-1">
          <span className="text-sm font-semibold text-slate-700">コース</span>
          <select
            value={membershipPlan}
            onChange={(e) => setMembershipPlan((e.target.value || "") as MembershipPlan | "")}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
            required
          >
            <option value="">選択してください</option>
            {ENROLLMENT_COURSE_PLANS.map((id) => {
              const opt = MEMBERSHIP_PLAN_OPTIONS.find((o) => o.id === id);
              return (
                <option key={id} value={id}>
                  {opt?.label ?? id}
                </option>
              );
            })}
          </select>
          <div className="text-xs text-slate-500">
            {MEMBERSHIP_PLAN_OPTIONS.find((o) => o.id === membershipPlan)?.hint ??
              "30分が1コマ、60分が2コマです。月回数プランは1ヶ月のコマ数が上限です。"}
          </div>
        </label>

        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-700">着替えプラン</div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: true, label: "あり" },
              { id: false, label: "なし" },
            ].map((opt) => (
              <button
                key={String(opt.id)}
                type="button"
                onClick={() => setHasChangingClothes(opt.id)}
                className={[
                  "rounded-full border px-4 py-2 text-sm font-semibold",
                  hasChangingClothes === opt.id
                    ? "border-slate-400 bg-slate-100 text-slate-900"
                    : "border-slate-200 bg-white text-slate-700",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-700">食事パーソナル</div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: true, label: "あり" },
              { id: false, label: "なし" },
            ].map((opt) => (
              <button
                key={String(opt.id)}
                type="button"
                onClick={() => setHasMealPersonal(opt.id)}
                className={[
                  "rounded-full border px-4 py-2 text-sm font-semibold",
                  hasMealPersonal === opt.id
                    ? "border-slate-400 bg-slate-100 text-slate-900"
                    : "border-slate-200 bg-white text-slate-700",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="text-xs text-slate-500">入会時の契約有無です。マイページの食事機能は、別途の利用開始後に有効になります。</div>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-700">入会特典チケット</div>
          <div className="flex flex-wrap gap-2">
            {ENROLLMENT_BONUS_KOMA_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setBonusKoma(n)}
                className={[
                  "rounded-full border px-4 py-2 text-sm font-semibold",
                  bonusKoma === n
                    ? "border-slate-400 bg-slate-100 text-slate-900"
                    : "border-slate-200 bg-white text-slate-700",
                ].join(" ")}
              >
                {n === 0 ? "なし" : `${n}コマ`}
              </button>
            ))}
          </div>
          <div className="text-xs text-slate-500">
            4〜8コマの入会プレゼント用です。付与すると予約画面とマイページに残数が表示されます。
          </div>
        </div>
      </div>

      {err ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "登録中…" : "登録して次へ"}
        </button>
        <Link href="/admin/dashboard/members" className="rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 underline">
          キャンセル
        </Link>
      </div>
    </form>
  );
}
