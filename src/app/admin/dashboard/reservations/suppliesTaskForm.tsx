"use client";

import { useState } from "react";
import { OPEN_SLOT_SUPPLY_ITEMS, validateOpenSlotSupplies, type OpenSlotSupplyKey } from "@/lib/openSlotSupplies";

type TrainerOption = { id: string; display_name: string };

export type SuppliesSubmit = {
  items: { key: OpenSlotSupplyKey; quantity: number; note?: string }[];
  receipts: { data_base64: string }[];
  trainerId: string;
  password?: string;
};

const MAX_RECEIPTS = 3;

function compressToJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const maxEdge = 1280;
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("写真を処理できません"));
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const base64 = canvas.toDataURL("image/jpeg", 0.72).split(",")[1] ?? "";
      if (!base64) reject(new Error("写真を処理できません"));
      else resolve(base64);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("写真を読み取れません"));
    };
    image.src = url;
  });
}

export function SuppliesTaskForm(props: {
  trainers: TrainerOption[];
  defaultTrainerId: string;
  busy: boolean;
  onSubmit: (input: SuppliesSubmit) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Partial<Record<OpenSlotSupplyKey, boolean>>>({});
  const [quantities, setQuantities] = useState<Partial<Record<OpenSlotSupplyKey, string>>>({});
  const [otherName, setOtherName] = useState("");
  const [receipts, setReceipts] = useState<string[]>([]);
  const [trainerId, setTrainerId] = useState(props.defaultTrainerId);
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (key: OpenSlotSupplyKey) => {
    setPicked((current) => ({ ...current, [key]: !current[key] }));
    setQuantities((current) => ({ ...current, [key]: current[key] || "1" }));
    setErr(null);
  };

  const addReceipt = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    try {
      const base64 = await compressToJpeg(file);
      setReceipts((current) => (current.length >= MAX_RECEIPTS ? current : [...current, base64]));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "写真を読み取れません");
    }
  };

  const submit = async () => {
    if (!trainerId) {
      setErr("担当トレーナーを選んでください");
      return;
    }
    const items = OPEN_SLOT_SUPPLY_ITEMS.filter((item) => picked[item.key]).map((item) => ({
      key: item.key,
      quantity: Number(quantities[item.key]),
      note: item.key === "other" ? otherName.trim() : undefined,
    }));
    const ready = validateOpenSlotSupplies({ items, receiptCount: receipts.length });
    if (!ready.ok) {
      setErr(ready.error);
      return;
    }
    setErr(null);
    try {
      await props.onSubmit({
        items,
        receipts: receipts.map((data_base64) => ({ data_base64 })),
        trainerId,
        password: needPassword ? password : undefined,
      });
    } catch (e) {
      const error = e as Error & { code?: string };
      if (String(error.message).includes("password_required") || error.code === "password_required") {
        setNeedPassword(true);
        setErr("このトレーナーはパスワードが必要です");
      } else {
        setErr(error.message || "実行に失敗しました");
      }
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold text-slate-700">買ったもの・整理したもの</div>
        <div className="mt-2 space-y-2">
          {OPEN_SLOT_SUPPLY_ITEMS.map((item) => {
            const on = Boolean(picked[item.key]);
            return (
              <div key={item.key} className="rounded-xl border border-slate-200 px-3 py-2">
                <label className="flex items-center gap-2 text-sm text-slate-900">
                  <input type="checkbox" checked={on} onChange={() => toggle(item.key)} className="h-5 w-5" />
                  <span className="font-semibold">{item.key === "other" ? "その他（筆記）" : item.label}</span>
                </label>
                {on ? (
                  <div className="mt-2 grid gap-2 pl-7">
                    {item.key === "other" ? (
                      <input
                        value={otherName}
                        onChange={(e) => setOtherName(e.target.value)}
                        maxLength={80}
                        placeholder="品名を書く"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                    ) : null}
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      個数
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={999}
                        value={quantities[item.key] ?? "1"}
                        onChange={(e) => setQuantities((current) => ({ ...current, [item.key]: e.target.value }))}
                        className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-700">領収書</div>
        <p className="mt-1 text-xs text-slate-500">写真は必須です。3枚まで付けられます。</p>
        <div className="mt-2 space-y-2">
          {receipts.map((receipt, index) => (
            <div key={`${index}-${receipt.slice(0, 12)}`} className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
              <span className="text-sm text-emerald-950">領収書 {index + 1} 添付済み</span>
              <button
                type="button"
                onClick={() => setReceipts((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                className="text-xs font-semibold text-slate-600"
              >
                外す
              </button>
            </div>
          ))}
          {receipts.length < MAX_RECEIPTS ? (
            <div>
              <button
                type="button"
                onClick={(e) => {
                  const input = e.currentTarget.nextElementSibling;
                  if (input instanceof HTMLInputElement) input.click();
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
              >
                {receipts.length === 0 ? "領収書を付ける" : "領収書をもう1枚付ける"}
              </button>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  void addReceipt(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <label className="block text-xs font-semibold text-slate-700">
        担当トレーナー
        <select
          value={trainerId}
          onChange={(e) => {
            setTrainerId(e.target.value);
            setNeedPassword(false);
            setPassword("");
          }}
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal"
        >
          <option value="">選択してください</option>
          {props.trainers.map((trainer) => (
            <option key={trainer.id} value={trainer.id}>
              {trainer.display_name}
            </option>
          ))}
        </select>
      </label>
      {needPassword ? (
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
        />
      ) : null}
      {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div> : null}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={props.busy || !trainerId || (needPassword && !password)}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {props.busy ? "送信中…" : "実行して報告"}
      </button>
    </div>
  );
}
