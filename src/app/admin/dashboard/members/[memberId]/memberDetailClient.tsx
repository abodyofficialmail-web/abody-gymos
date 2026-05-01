"use client";

import { DateTime } from "luxon";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const TZ = "Asia/Tokyo";

type ReservationRow = {
  id: string;
  store_id: string;
  store_name?: string;
  trainer_id: string | null;
  trainer_name?: string;
  member_id: string;
  member_code?: string;
  start_at: string;
  end_at: string;
  status: string;
  created_at: string;
};

type ClientNoteRow = {
  id: string;
  member_id: string;
  store_id: string;
  store_name?: string;
  trainer_id: string;
  trainer_name?: string;
  date: string; // YYYY-MM-DD
  content: string;
  created_at: string;
};

type StoreRow = { id: string; name: string };
type TrainerRow = { id: string; display_name: string };

type MenuSet = { reps: string; weight: string };
type MenuItem = { id: string; exercise: string; sets: MenuSet[] };

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "取得に失敗しました");
  return json as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "保存に失敗しました");
  return json as T;
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "更新に失敗しました");
  return json as T;
}

export function MemberDetailClient({
  memberId,
  member,
}: {
  memberId: string;
  member: {
    id: string;
    member_code: string;
    name: string;
    email: string | null;
    is_active: boolean;
    line_user_id: string | null;
  };
}) {
  const month = useMemo(() => DateTime.now().setZone(TZ).toFormat("yyyy-MM"), []);
  const [rows, setRows] = useState<ReservationRow[] | null>(null);
  const [notes, setNotes] = useState<ClientNoteRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState(member.email ?? "");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);

  // 本日のカルテ入力
  const todayYmd = useMemo(() => DateTime.now().setZone(TZ).toISODate()!, []);
  const [stores, setStores] = useState<StoreRow[] | null>(null);
  const [trainers, setTrainers] = useState<TrainerRow[] | null>(null);
  /** 確認画面: 当日シフトに入っているトレーナー（優先表示） */
  const [shiftTrainerOptions, setShiftTrainerOptions] = useState<TrainerRow[]>([]);
  const [shiftFetchDone, setShiftFetchDone] = useState(false);
  /** 確認画面: シフト・店舗APIとも空のときだけ /api/trainers から同店舗を補完（undefined=未試行） */
  const [allTrainersFallback, setAllTrainersFallback] = useState<TrainerRow[] | undefined>(undefined);
  const [storeId, setStoreId] = useState<string>("");
  const [trainerId, setTrainerId] = useState<string>("");
  const [noteDate, setNoteDate] = useState<string>(todayYmd);

  const [bodyWeightKg, setBodyWeightKg] = useState("");
  const [bodyFatPct, setBodyFatPct] = useState("");
  const [condition, setCondition] = useState<string>("");

  const [trainingParts, setTrainingParts] = useState<string[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [stretch, setStretch] = useState<string>("あり");
  const [stretchDetail, setStretchDetail] = useState("");
  const [trainingConcept, setTrainingConcept] = useState("");

  const [goodPoint, setGoodPoint] = useState("");
  const [improvePoint, setImprovePoint] = useState("");
  const [painLevel, setPainLevel] = useState<string>("なし");
  const [communication, setCommunication] = useState("");

  const [noteSaving, setNoteSaving] = useState(false);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);

  // ステップ式（店舗/担当確認→入力）
  const [karteStep, setKarteStep] = useState<"idle" | "confirm" | "edit">("idle");
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [suggestedReservationId, setSuggestedReservationId] = useState<string | null>(null);

  useEffect(() => {
    // SSR/キャッシュ差分で email が空になることがあるので、画面表示時に必ず最新を取り直す
    apiGet<{ member: { email: string | null } }>(`/api/admin/members/${encodeURIComponent(memberId)}/get`)
      .then((d) => {
        const next = d.member?.email ?? "";
        setEmail((cur) => {
          // ユーザーが既に入力し始めている場合は上書きしない
          if (cur.trim().length > 0) return cur;
          return next;
        });
      })
      .catch(() => {
        // 取得失敗は致命ではない（手入力で救える）
      });
  }, [memberId]);

  useEffect(() => {
    apiGet<{ stores: StoreRow[] }>("/api/booking-v2/stores")
      .then((d) => setStores(d.stores ?? []))
      .catch(() => setStores([]));
  }, []);

  useEffect(() => {
    if (!stores || stores.length === 0) return;
    if (!storeId) setStoreId(stores[0].id);
  }, [stores, storeId]);

  useEffect(() => {
    if (!storeId) return;
    apiGet<{ trainers: TrainerRow[] }>(`/api/booking-v2/trainers?store_id=${encodeURIComponent(storeId)}`)
      .then((d) => setTrainers(d.trainers ?? []))
      .catch(() => setTrainers([]));
  }, [storeId]);

  useEffect(() => {
    if (karteStep !== "confirm") {
      setShiftTrainerOptions([]);
      setShiftFetchDone(false);
      setAllTrainersFallback(undefined);
    }
  }, [karteStep]);

  useEffect(() => {
    if (karteStep !== "confirm" || !storeId || !noteDate) return;
    setShiftFetchDone(false);
    setAllTrainersFallback(undefined);
    let cancelled = false;
    apiGet<{ shifts: { trainer_id: string; trainer_name: string }[] }>(
      `/api/admin/shifts/by-store-date?store_id=${encodeURIComponent(storeId)}&date=${encodeURIComponent(noteDate)}`
    )
      .then((d) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const list: TrainerRow[] = [];
        for (const s of d.shifts ?? []) {
          const id = String(s.trainer_id ?? "").trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          list.push({
            id,
            display_name: String(s.trainer_name ?? "").trim() || "（名前なし）",
          });
        }
        list.sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"));
        setShiftTrainerOptions(list);
      })
      .catch(() => {
        if (!cancelled) setShiftTrainerOptions([]);
      })
      .finally(() => {
        if (!cancelled) setShiftFetchDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [karteStep, storeId, noteDate]);

  useEffect(() => {
    if (karteStep !== "confirm" || !storeId) return;
    if (!shiftFetchDone) return;
    if (trainers === null) return;
    if (shiftTrainerOptions.length > 0 || trainers.length > 0) {
      if (allTrainersFallback !== undefined) setAllTrainersFallback(undefined);
      return;
    }
    if (allTrainersFallback !== undefined) return;
    let cancelled = false;
    fetch("/api/trainers", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { trainers?: { id: string; name: string; store_id: string }[] }) => {
        if (cancelled) return;
        const list = (data.trainers ?? [])
          .filter((t) => String(t.store_id) === storeId)
          .map((t) => ({ id: t.id, display_name: t.name }))
          .sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"));
        setAllTrainersFallback(list);
      })
      .catch(() => {
        if (!cancelled) setAllTrainersFallback([]);
      });
    return () => {
      cancelled = true;
    };
  }, [karteStep, storeId, shiftFetchDone, trainers, shiftTrainerOptions, allTrainersFallback]);

  const confirmTrainerOptions = useMemo(() => {
    if (shiftTrainerOptions.length > 0) return shiftTrainerOptions;
    if (trainers && trainers.length > 0) return trainers;
    return allTrainersFallback ?? [];
  }, [shiftTrainerOptions, trainers, allTrainersFallback]);

  useEffect(() => {
    if (karteStep !== "confirm") return;
    const opts = confirmTrainerOptions;
    if (opts.length === 0) return;
    if (!trainerId || !opts.some((t) => t.id === trainerId)) {
      setTrainerId(opts[0].id);
    }
  }, [karteStep, confirmTrainerOptions, trainerId]);

  useEffect(() => {
    if (karteStep === "confirm") return;
    if (!trainers || trainers.length === 0) return;
    if (!trainerId) setTrainerId(trainers[0].id);
  }, [trainers, trainerId, karteStep]);

  useEffect(() => {
    setErr(null);
    apiGet<{ reservations: ReservationRow[] }>(
      `/api/booking-v2/reservations?member_id=${encodeURIComponent(memberId)}&month=${encodeURIComponent(month)}`
    )
      .then((d) => setRows(d.reservations ?? []))
      .catch((e: any) => {
        setErr(String(e?.message ?? "取得に失敗しました"));
        setRows([]);
      });
  }, [memberId, month]);

  const refreshNotes = async () => {
    const d = await apiGet<{ notes: ClientNoteRow[] }>(`/api/client-notes?member_id=${encodeURIComponent(memberId)}`);
    setNotes(d.notes ?? []);
  };

  useEffect(() => {
    refreshNotes().catch(() => setNotes([]));
  }, [memberId]);

  const parts = useMemo(
    () => [
      { id: "脚", label: "脚" },
      { id: "背中", label: "背中" },
      { id: "胸", label: "胸" },
      { id: "肩", label: "肩" },
      { id: "腕", label: "腕" },
      { id: "腹筋", label: "腹筋" },
      { id: "有酸素", label: "有酸素" },
    ],
    []
  );

  const exerciseCatalog = useMemo(() => {
    // 画像のUIに寄せた“部位→種目”の簡易カタログ（必要なら後でDB化できます）
    return {
      胸: ["ベンチプレス", "インクラインベンチプレス", "ダンベルベンチプレス", "ダンベルフライ", "ケーブルフライ", "チェストプレス", "その他"],
      肩: ["ショルダープレス", "ダンベルショルダープレス", "アーノルドプレス", "サイドレイズ", "フロントレイズ", "リアレイズ", "ケーブルサイドレイズ", "アップライトロウ", "シュラッグ", "フェイスプル", "その他"],
      背中: ["ラットプルダウン", "シーテッドロー", "ワンハンドロー", "ベントオーバーロウ", "懸垂", "デッドリフト", "その他"],
      腕: ["アームカール", "ハンマーカール", "ケーブルカール", "トライセプスプレスダウン", "フレンチプレス", "その他"],
      脚: ["スクワット", "フロントスクワット", "ブルガリアンスクワット", "ワイドスクワット", "ゴブレットスクワット", "レッグプレス", "レッグエクステンション", "レッグカール", "ルーマニアンデッドリフト", "レッグアダクション", "レッグアブダクション", "カーフレイズ", "その他"],
      腹筋: ["クランチ", "レッグレイズ", "プランク", "ケーブルクランチ", "その他"],
      有酸素: ["バイク", "ラン", "ウォーク", "ローイング", "その他"],
    } as Record<string, string[]>;
  }, []);

  const togglePart = (id: string) => {
    setTrainingParts((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const monthSessionCount = useMemo(() => {
    const list = (rows ?? []).filter((r) => String(r.status ?? "") !== "cancelled");
    return list.length;
  }, [rows]);

  const reservationsForToday = useMemo(() => {
    const ymd = noteDate || todayYmd;
    const list = (rows ?? []).filter((r) => DateTime.fromISO(r.start_at).setZone(TZ).toISODate() === ymd);
    return list.sort((a, b) => DateTime.fromISO(a.start_at).toMillis() - DateTime.fromISO(b.start_at).toMillis());
  }, [rows, noteDate, todayYmd]);

  const startKarteFlow = () => {
    setConfirmErr(null);
    // 1) 同日の予約があればそれを提案
    const first = reservationsForToday[0];
    if (first) {
      setSuggestedReservationId(first.id);
      setStoreId(first.store_id);
      // trainer_id が null の予約もあるので、シフト/一覧から選び直させる
      if (first.trainer_id) setTrainerId(first.trainer_id);
      else setTrainerId("");
    } else {
      setSuggestedReservationId(null);
    }
    setKarteStep("confirm");
  };

  const goToEdit = () => {
    if (!storeId) return setConfirmErr("店舗を選択してください");
    if (!trainerId) return setConfirmErr("担当トレーナーを選択してください");
    setConfirmErr(null);
    setKarteStep("edit");
  };

  const addMenuItem = (exercise: string) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setMenuItems((cur) => [...cur, { id, exercise, sets: [{ reps: "", weight: "" }] }]);
  };

  const repOptions = useMemo(() => Array.from({ length: 30 }, (_, i) => String(i + 1)), []);
  const weightOptions = useMemo(() => {
    // 0〜200kg (0.5刻み) を選択式で提供（必要なら後で上限/刻み変更）
    const out: string[] = [];
    for (let w = 0; w <= 200; w += 0.5) out.push(w % 1 === 0 ? String(w) : w.toFixed(1));
    return out;
  }, []);

  const appendSet = (itemId: string) => {
    setMenuItems((cur) =>
      cur.map((x) => (x.id !== itemId ? x : { ...x, sets: [...x.sets, { reps: "", weight: "" }] }))
    );
  };

  const copyLastSet = (itemId: string) => {
    setMenuItems((cur) =>
      cur.map((x) => {
        if (x.id !== itemId) return x;
        const last = x.sets[x.sets.length - 1] ?? { reps: "", weight: "" };
        return { ...x, sets: [...x.sets, { reps: last.reps, weight: last.weight }] };
      })
    );
  };

  const removeSetAt = (itemId: string, idx: number) => {
    setMenuItems((cur) =>
      cur.map((x) => {
        if (x.id !== itemId) return x;
        if (x.sets.length <= 1) return x;
        const next = x.sets.filter((_, i) => i !== idx);
        return { ...x, sets: next.length ? next : x.sets };
      })
    );
  };

  const allExerciseOptions = useMemo(() => {
    const selected = trainingParts.length ? trainingParts : Object.keys(exerciseCatalog);
    const out: string[] = [];
    for (const p of selected) {
      for (const ex of exerciseCatalog[p] ?? []) out.push(ex);
    }
    return Array.from(new Set(out));
  }, [exerciseCatalog, trainingParts]);

  // 種目選択モーダル
  const [exercisePickerOpen, setExercisePickerOpen] = useState(false);
  const [exercisePickerQuery, setExercisePickerQuery] = useState("");
  const filteredExerciseOptions = useMemo(() => {
    const q = exercisePickerQuery.trim().toLowerCase();
    if (!q) return allExerciseOptions;
    return allExerciseOptions.filter((x) => x.toLowerCase().includes(q));
  }, [allExerciseOptions, exercisePickerQuery]);

  const buildContent = () => {
    const lines: string[] = [];
    lines.push("【基本情報】");
    lines.push(`会員ID: ${member.member_code || member.id}`);
    if (member.name) lines.push(`会員名: ${member.name}`);
    if (bodyWeightKg.trim() || bodyFatPct.trim()) {
      lines.push("");
      lines.push("【体組成】");
      if (bodyWeightKg.trim()) lines.push(`体重(kg): ${bodyWeightKg.trim()}`);
      if (bodyFatPct.trim()) lines.push(`体脂肪率(%): ${bodyFatPct.trim()}`);
    }
    if (condition.trim()) {
      lines.push("");
      lines.push("【今日の体調】");
      lines.push(condition.trim());
    }
    lines.push("");
    lines.push("【本日のトレーニング内容】");
    lines.push(`部位: ${trainingParts.length ? trainingParts.join(" / ") : "-"}`);
    lines.push("");
    lines.push("【本日のメニュー】");
    if (menuItems.length === 0) {
      lines.push("-");
    } else {
      for (const item of menuItems) {
        lines.push(`■ ${item.exercise}`);
        const sets = item.sets.filter((s) => s.reps.trim() || s.weight.trim());
        if (sets.length === 0) {
          lines.push("  -");
        } else {
          for (const s of sets) {
            const reps = s.reps.trim() ? `${s.reps.trim()}回` : "";
            const w = s.weight.trim() ? `${s.weight.trim()}kg` : "";
            lines.push(`  ${[w, reps].filter(Boolean).join("×") || "-"}`);
          }
        }
      }
    }
    lines.push("");
    lines.push("【ストレッチ】");
    lines.push(stretch);
    if (stretchDetail.trim()) lines.push(`ストレッチ内容: ${stretchDetail.trim()}`);
    if (trainingConcept.trim()) {
      lines.push("");
      lines.push("【トレーニングコンセプト】");
      lines.push(trainingConcept.trim());
    }
    lines.push("");
    lines.push("【トレーナーからのフィードバック】");
    if (goodPoint.trim()) lines.push(goodPoint.trim());
    if (improvePoint.trim()) lines.push(improvePoint.trim());
    lines.push("");
    lines.push("【痛みや違和感】");
    lines.push(painLevel);
    if (communication.trim()) {
      lines.push("");
      lines.push("【会員とのコミュニケーション内容】");
      lines.push(communication.trim());
    }
    return lines.join("\n");
  };

  const buildLineMessage = () => {
    const storeName = (stores ?? []).find((s) => s.id === storeId)?.name ?? "";
    const trainerName = (trainers ?? []).find((t) => t.id === trainerId)?.display_name ?? "";
    const dateLabel = DateTime.fromISO(noteDate, { zone: TZ }).setLocale("ja").toFormat("yyyy年M月d日");

    const lines: string[] = [];
    const honor = member.name ? `${member.name}様` : `${member.member_code || member.id}様`;
    lines.push(honor);
    lines.push("");
    lines.push("本日もトレーニングお疲れさまでした！");
    lines.push("");
    if (trainerName) lines.push(`担当：${trainerName}`);
    lines.push(`実施日：${dateLabel}`);
    if (storeName) lines.push(`店舗：${storeName}店`);
    lines.push(`今月のセッション回数：${monthSessionCount}回`);
    lines.push("");
    lines.push("【本日のトレーニング内容】");
    lines.push(`部位：${trainingParts.length ? trainingParts.join(" / ") : "-"}`);
    lines.push("");
    lines.push("【本日のメニュー】");
    if (menuItems.length === 0) {
      lines.push("・-");
    } else {
      for (const item of menuItems) {
        lines.push(`■ ${item.exercise}`);
        const sets = item.sets.filter((s) => s.reps.trim() || s.weight.trim());
        if (sets.length === 0) {
          lines.push("  -");
        } else {
          for (const s of sets) {
            const reps = s.reps.trim() ? `${s.reps.trim()}回` : "";
            const w = s.weight.trim() ? `${s.weight.trim()}kg` : "";
            lines.push(`  ${[w, reps].filter(Boolean).join("×") || "-"}`);
          }
        }
      }
    }
    lines.push("");
    lines.push("【ストレッチ】");
    lines.push(stretch);
    lines.push("");
    lines.push("【トレーナーからのフィードバック】");
    if (goodPoint.trim()) lines.push(goodPoint.trim());
    if (improvePoint.trim()) lines.push(improvePoint.trim());
    lines.push("");
    lines.push("※ご不明点や「この種目が難しかった」などあれば、いつでも気軽にLINEでご連絡ください！");
    if (storeName) lines.push(`\nAbody ${storeName}店`);
    return lines.join("\n");
  };

  const saveTodayNote = async () => {
    setNoteMsg(null);
    if (!storeId) return setNoteMsg("店舗を選択してください");
    if (!trainerId) return setNoteMsg("担当トレーナーを選択してください");
    if (!noteDate) return setNoteMsg("日付を選択してください");
    const content = buildContent();
    if (!content.trim()) return setNoteMsg("内容を入力してください");

    setNoteSaving(true);
    try {
      await apiPost("/api/client-notes", {
        member_id: memberId,
        store_id: storeId,
        trainer_id: trainerId,
        date: noteDate,
        content,
        line_message: buildLineMessage(),
      });
      await refreshNotes();
      setNoteMsg("保存しました（LINE連携済みの会員には送信されます）");
    } catch (e: any) {
      setNoteMsg(String(e?.message ?? "保存に失敗しました"));
    } finally {
      setNoteSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Link href="/admin/dashboard/members" className="text-sm text-slate-600 underline">
        ← 一覧へ
      </Link>

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

      {/* 会員基本情報 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-bold text-slate-900">{member.member_code || member.id}</div>
            <div className="pt-1 text-sm text-slate-700">{member.name || ""}</div>
            <div className="pt-1 text-xs text-slate-500">{member.is_active ? "有効" : "無効"}</div>
            <div className="pt-1 text-[11px] text-slate-400 break-all">ID: {member.id}</div>
            {email.trim() ? (
              <div className="pt-1 text-[11px] text-slate-500 break-all">Email: {email.trim()}</div>
            ) : (
              <div className="pt-1 text-[11px] text-slate-400">Email: 未登録</div>
            )}
          </div>
          <div
            className={[
              "rounded-full px-3 py-1 text-xs font-semibold border",
              member.line_user_id ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600",
            ].join(" ")}
          >
            {member.line_user_id ? "LINE連携済み" : "LINE未連携"}
          </div>
        </div>

        <div className="pt-2 space-y-1">
          <div className="text-xs font-semibold text-slate-700">メールアドレス</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailMsg(null);
              }}
              inputMode="email"
              placeholder="未登録（入力して保存）"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={emailSaving}
              onClick={async () => {
                setEmailSaving(true);
                setEmailMsg(null);
                try {
                  await apiPatch(`/api/admin/members/${encodeURIComponent(memberId)}`, { email });
                  setEmailMsg("保存しました");
                } catch (e: any) {
                  setEmailMsg(String(e?.message ?? "保存に失敗しました"));
                } finally {
                  setEmailSaving(false);
                }
              }}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {emailSaving ? "保存中…" : "保存"}
            </button>
          </div>
          {emailMsg ? <div className="text-xs text-slate-600">{emailMsg}</div> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <div className="text-sm font-bold text-slate-900">本日のカルテ入力</div>

        {karteStep === "idle" ? (
          <div className="pt-2">
            <button
              type="button"
              onClick={startKarteFlow}
              className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
            >
              本日のカルテを入力する
            </button>
            <div className="pt-2 text-xs text-slate-600">
              予約一覧から店舗/担当を自動提案します（違う場合は選び直せます）。
            </div>
          </div>
        ) : null}

        {karteStep === "confirm" ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
            <div className="text-xs font-semibold text-slate-700">確認</div>
            {suggestedReservationId ? (
              <div className="text-xs text-slate-600">
                本日の予約から提案しました。違う場合は下で変更してください。
              </div>
            ) : (
              <div className="text-xs text-slate-600">本日の予約が見つからないため、店舗/担当を選択してください。</div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-xs font-semibold text-slate-700">日付</div>
                <input
                  type="date"
                  value={noteDate}
                  onChange={(e) => {
                    setNoteDate(e.target.value);
                    setConfirmErr(null);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-700">店舗</div>
                <select
                  value={storeId}
                  onChange={(e) => {
                    setStoreId(e.target.value);
                    setTrainerId("");
                    setConfirmErr(null);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                >
                  {(stores ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-700">担当トレーナー</div>
                <select
                  value={trainerId}
                  onChange={(e) => {
                    setTrainerId(e.target.value);
                    setConfirmErr(null);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                >
                  <option value="">選択してください</option>
                  {confirmTrainerOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.display_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {confirmErr ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{confirmErr}</div> : null}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setKarteStep("idle")}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800"
              >
                戻る
              </button>
              <button
                type="button"
                onClick={goToEdit}
                className="flex-1 rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white"
              >
                OK（入力へ）
              </button>
            </div>
          </div>
        ) : null}

        {karteStep === "edit" ? (
          <div className="pb-20">
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold text-slate-700">体組成データ（任意）</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-slate-600">体重（kg）</div>
                  <input
                    value={bodyWeightKg}
                    onChange={(e) => setBodyWeightKg(e.target.value)}
                    inputMode="decimal"
                    placeholder="例: 70.5"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                  />
                </div>
                <div>
                  <div className="text-xs text-slate-600">体脂肪率（%）</div>
                  <input
                    value={bodyFatPct}
                    onChange={(e) => setBodyFatPct(e.target.value)}
                    inputMode="decimal"
                    placeholder="例: 15.5"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                  />
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold text-slate-700">今日の体調</div>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
              >
                <option value="">選択してください</option>
                <option value="良い">良い</option>
                <option value="普通">普通</option>
                <option value="やや不調">やや不調</option>
                <option value="不調">不調</option>
              </select>
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
              <div className="text-sm font-bold text-slate-900">トレーニング内容</div>

              <div>
                <div className="text-xs font-semibold text-slate-700">トレーニング部位（複数選択可）</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {parts.map((p) => {
                    const active = trainingParts.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => togglePart(p.id)}
                        className={[
                          "rounded-xl border px-3 py-2 text-sm font-semibold",
                          active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 先に固定で出したい項目（メニューより上） */}
              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-700">ストレッチ</div>
                    <select
                      value={stretch}
                      onChange={(e) => setStretch(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                    >
                      <option value="あり">あり</option>
                      <option value="なし">なし</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-700">痛みや違和感</div>
                    <select
                      value={painLevel}
                      onChange={(e) => setPainLevel(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                    >
                      <option value="なし">なし</option>
                      <option value="軽い">軽い</option>
                      <option value="中">中</option>
                      <option value="強い">強い</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-700">ストレッチ内容</div>
                  <input
                    value={stretchDetail}
                    onChange={(e) => setStretchDetail(e.target.value)}
                    placeholder="例: 肩周り/股関節中心に実施"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                  />
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-700">トレーニングコンセプト</div>
                  <textarea
                    value={trainingConcept}
                    onChange={(e) => setTrainingConcept(e.target.value)}
                    placeholder="例: 大胸筋の上部を意識、フォーム改良に集中"
                    className="mt-2 min-h-[80px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                  />
                </div>
              </div>

              {/* コンセプトの下にメニュー */}
              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                <div className="text-xs font-semibold text-slate-700">本日のメニュー</div>

                <div className="space-y-3">
                  {menuItems.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">{item.exercise}</div>
                        <button
                          type="button"
                          onClick={() => setMenuItems((cur) => cur.filter((x) => x.id !== item.id))}
                          className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700"
                        >
                          メニュー削除
                        </button>
                      </div>

                      <div className="space-y-2">
                        {item.sets.map((s, idx) => (
                          <div key={idx} className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-semibold text-slate-700">セット{idx + 1}</div>
                              <button
                                type="button"
                                onClick={() => removeSetAt(item.id, idx)}
                                disabled={item.sets.length <= 1}
                                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-700 disabled:opacity-50"
                              >
                                セット削除
                              </button>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <div className="text-xs text-slate-600">重量（kg）</div>
                                <select
                                  value={s.weight}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setMenuItems((cur) =>
                                      cur.map((x) =>
                                        x.id !== item.id
                                          ? x
                                          : { ...x, sets: x.sets.map((ss, i) => (i === idx ? { ...ss, weight: v } : ss)) }
                                      )
                                    );
                                  }}
                                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                                >
                                  <option value="">選択</option>
                                  {weightOptions.map((w) => (
                                    <option key={w} value={w}>
                                      {w}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <div className="text-xs text-slate-600">回数</div>
                                <select
                                  value={s.reps}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setMenuItems((cur) =>
                                      cur.map((x) =>
                                        x.id !== item.id
                                          ? x
                                          : { ...x, sets: x.sets.map((ss, i) => (i === idx ? { ...ss, reps: v } : ss)) }
                                      )
                                    );
                                  }}
                                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                                >
                                  <option value="">選択</option>
                                  {repOptions.map((r) => (
                                    <option key={r} value={r}>
                                      {r}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => appendSet(item.id)}
                          className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800"
                        >
                          ＋セット追加
                        </button>
                        <button
                          type="button"
                          onClick={() => copyLastSet(item.id)}
                          className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 disabled:opacity-50"
                        >
                          コピー
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
          <div className="text-sm font-bold text-slate-900">セッション記録</div>

          <div>
            <div className="text-xs font-semibold text-slate-700">良かった点</div>
            <textarea
              value={goodPoint}
              onChange={(e) => setGoodPoint(e.target.value)}
              placeholder="例: 肩の動きが良くなった"
              className="mt-2 min-h-[70px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
            />
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-700">改善点や気付き</div>
            <textarea
              value={improvePoint}
              onChange={(e) => setImprovePoint(e.target.value)}
              placeholder="例: 背中使い、肩甲骨の寄せ"
              className="mt-2 min-h-[70px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
            />
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-700">会員とのコミュニケーション内容</div>
            <textarea
              value={communication}
              onChange={(e) => setCommunication(e.target.value)}
              placeholder="例: 今日感じた身体の不調、気づいた点などを記載してください。"
              className="mt-2 min-h-[90px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
            />
          </div>

          <button
            type="button"
            onClick={saveTodayNote}
            disabled={noteSaving}
            className="w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {noteSaving ? "保存中…" : "記録を保存する"}
          </button>
          {noteMsg ? <div className="text-xs text-slate-600">{noteMsg}</div> : null}
        </div>
          </div>
        ) : null}
      </section>

      {/* 画面下固定: メニュー追加（スクロール不要） */}
      {karteStep === "edit" ? (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 backdrop-blur"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto max-w-3xl">
            <button
              type="button"
              onClick={() => {
                setExercisePickerQuery("");
                setExercisePickerOpen(true);
              }}
              className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
            >
              ＋メニュー追加
            </button>
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <div className="text-sm font-bold text-slate-900">予約履歴（当月）</div>
        {rows === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
        {rows !== null && rows.length === 0 ? <div className="text-sm text-slate-600">予約がありません。</div> : null}
        <div className="grid gap-2">
          {(rows ?? []).map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <div className="font-semibold">
                {DateTime.fromISO(r.start_at).setZone(TZ).toFormat("M/d HH:mm")}〜
                {DateTime.fromISO(r.end_at).setZone(TZ).toFormat("HH:mm")}
              </div>
              <div className="text-xs text-slate-500">
                トレーナー: {r.trainer_name || (r.trainer_id ?? "-")} / 店舗: {r.store_name || r.store_id}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <div className="text-sm font-bold text-slate-900">カルテ（全店舗）</div>
        {notes === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
        {notes !== null && notes.length === 0 ? <div className="text-sm text-slate-600">履歴がありません。</div> : null}
        <div className="grid gap-2">
          {(notes ?? []).map((n) => (
            <div key={n.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm space-y-1">
              <div className="font-semibold">
                {n.date} {n.store_name || n.store_id}（{n.trainer_name || n.trainer_id}）
              </div>
              <div className="whitespace-pre-wrap text-slate-800">{n.content}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 種目選択モーダル */}
      {exercisePickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-bold text-slate-900">種目を選択</div>
              <button
                type="button"
                onClick={() => setExercisePickerOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                閉じる
              </button>
            </div>

            <input
              value={exercisePickerQuery}
              onChange={(e) => setExercisePickerQuery(e.target.value)}
              placeholder="検索（例: スクワット / プレス）"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
            />

            <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
              {filteredExerciseOptions.length === 0 ? (
                <div className="px-2 py-6 text-sm text-slate-600">該当する種目がありません。</div>
              ) : (
                <div className="space-y-1">
                  {filteredExerciseOptions.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => {
                        addMenuItem(ex);
                        setExercisePickerOpen(false);
                      }}
                      className="w-full rounded-xl border border-transparent bg-white px-3 py-3 text-left text-sm font-semibold text-slate-900 hover:border-slate-200"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

