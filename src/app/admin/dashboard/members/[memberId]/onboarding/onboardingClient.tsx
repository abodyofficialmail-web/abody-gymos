"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { KarteSessionForm } from "@/components/karte/KarteSessionForm";
import { CounselingForm } from "@/components/member/CounselingForm";
import { createEmptyCounselingFormState, type CounselingFormState } from "@/lib/memberCounseling";
import { createEmptyKarteSessionState, type KarteSessionState } from "@/lib/karteSession";

const TZ = "Asia/Tokyo";

type StoreRow = { id: string; name: string };
type TrainerRow = { id: string; display_name: string };

type MemberInfo = {
  id: string;
  member_code: string;
  name: string | null;
  email: string | null;
  store_id: string | null;
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((json as any)?.error ?? "取得に失敗しました"));
  return json as T;
}

async function loadAllTrainers(): Promise<TrainerRow[]> {
  const allData = await apiGet<{ trainers: { id: string; display_name: string }[] }>(
    "/api/booking-v2/trainers?all=1"
  );
  return (allData.trainers ?? [])
    .map((t) => ({
      id: t.id,
      display_name: String(t.display_name ?? "").trim() || "（名前なし）",
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"));
}

export function MemberOnboardingClient({
  memberId,
  member,
}: {
  memberId: string;
  member: MemberInfo;
}) {
  const router = useRouter();
  const todayYmd = useMemo(() => DateTime.now().setZone(TZ).toISODate()!, []);

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [trainers, setTrainers] = useState<TrainerRow[]>([]);
  const [trainersLoading, setTrainersLoading] = useState(false);
  const [storeId, setStoreId] = useState(member.store_id ?? "");
  const [trainerId, setTrainerId] = useState("");
  const [noteDate, setNoteDate] = useState(todayYmd);
  const [counseling, setCounseling] = useState<CounselingFormState>(() => {
    const base = createEmptyCounselingFormState();
    return base;
  });
  const [trialSession, setTrialSession] = useState<KarteSessionState>(() => createEmptyKarteSessionState());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ stores: StoreRow[] }>("/api/booking-v2/stores")
      .then((d) => setStores(d.stores ?? []))
      .catch(() => setStores([]));
  }, []);

  useEffect(() => {
    if (!member.store_id && stores.length > 0 && !storeId) {
      setStoreId(stores[0].id);
    }
  }, [member.store_id, stores, storeId]);

  useEffect(() => {
    let cancelled = false;
    setTrainersLoading(true);
    loadAllTrainers()
      .then((list) => {
        if (cancelled) return;
        setTrainers(list);
        setTrainerId((cur) => (cur && list.some((t) => t.id === cur) ? cur : list[0]?.id ?? ""));
      })
      .catch(() => {
        if (!cancelled) setTrainers([]);
      })
      .finally(() => {
        if (!cancelled) setTrainersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setTrialSession((prev) => ({
      ...prev,
      bodyWeightKg: counseling.weightKg.trim() || prev.bodyWeightKg,
      bodyFatPct: counseling.bodyFatPct.trim() || prev.bodyFatPct,
    }));
  }, [counseling.weightKg, counseling.bodyFatPct]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!storeId) {
      setErr("店舗を選択してください");
      return;
    }
    if (!trainerId) {
      setErr("担当トレーナーを選択してください");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/gym/admin/members/${encodeURIComponent(memberId)}/onboarding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: storeId,
          trainer_id: trainerId,
          date: noteDate,
          counseling,
          trial_session: trialSession,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json.error ?? "保存に失敗しました"));
      setSaved(true);
    } catch (e) {
      setErr(String((e as Error)?.message ?? "保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <div className="text-base font-bold">入会カルテを保存しました</div>
          <div className="mt-2 text-sm">
            {member.member_code} {member.name ?? ""} さんのカウンセリング内容と体験セッション内容を記録しました。トレーナーは会員カルテから確認できます。
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <div className="font-semibold text-slate-900">LINE連携の案内</div>
          <p className="mt-2">
            {stores.find((s) => s.id === storeId)?.name ?? "店舗"}店のLINE公式で「{member.member_code}」を送信 → 案内に従い「はい」で連携完了
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/dashboard/members/${memberId}`}
            className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
          >
            会員カルテを見る
          </Link>
          <Link href="/admin/dashboard/members/new" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
            続けて新規登録
          </Link>
          <Link href="/admin/dashboard/members" className="rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 underline">
            会員一覧へ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-base font-bold text-slate-900">
          {member.member_code} {member.name ?? ""}
        </div>
        <div className="pt-1 text-sm text-slate-600">{member.email ?? ""}</div>
        <div className="pt-2 text-sm text-slate-600">カウンセリング内容と体験セッション内容を入力して、入会カルテとして保存します。</div>
      </div>

      <CounselingForm value={counseling} onChange={setCounseling} />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="text-sm font-bold text-slate-900">担当・実施日</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">日付</span>
            <input
              type="date"
              value={noteDate}
              onChange={(e) => setNoteDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
              required
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">店舗</span>
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
              required
            >
              {(stores.length ? stores : member.store_id ? [{ id: member.store_id, name: "所属店舗" }] : []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">担当トレーナー</span>
            <select
              value={trainerId}
              onChange={(e) => setTrainerId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
              required
              disabled={trainersLoading}
            >
              <option value="">{trainersLoading ? "読み込み中…" : "選択してください"}</option>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name}
                </option>
              ))}
            </select>
            {!trainersLoading && trainers.length === 0 ? (
              <div className="text-xs text-amber-700">トレーナーが見つかりません。</div>
            ) : null}
          </label>
        </div>
      </section>

      <KarteSessionForm value={trialSession} onChange={setTrialSession} />

      {err ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-2xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "保存中…" : "入会カルテを保存する"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/admin/dashboard/members/${memberId}`)}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
        >
          あとで入力
        </button>
      </div>
    </form>
  );
}
