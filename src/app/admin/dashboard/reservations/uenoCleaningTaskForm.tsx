"use client";

import { useMemo, useState } from "react";
import {
  UENO_CLEANING_AREAS,
  uenoCleaningAreaByKey,
  uenoCleaningPhotoSlots,
  uenoCleaningPhotoStepLabels,
  validateUenoCleaningSubmission,
  type UenoCleaningArea,
} from "@/lib/uenoOpenSlotCleaning";

type TrainerOption = { id: string; display_name: string };

export type UenoCleaningSubmit = {
  areaKey: UenoCleaningArea["key"];
  checks: { place_key: string; step_key: string; done: boolean }[];
  photos: { place_key: string; step_key: string; data_base64: string }[];
  note?: string;
  trainerId: string;
  password?: string;
};

function photoKey(placeKey: string, stepKey: string) {
  return `${placeKey}:${stepKey}`;
}

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

export function UenoCleaningTaskForm(props: {
  slotStart: string;
  trainers: TrainerOption[];
  defaultTrainerId: string;
  busy: boolean;
  onSubmit: (input: UenoCleaningSubmit) => Promise<void>;
}) {
  const [areaKey, setAreaKey] = useState<UenoCleaningArea["key"] | "">("");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [trainerId, setTrainerId] = useState(props.defaultTrainerId);
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const area = areaKey ? uenoCleaningAreaByKey(areaKey) : null;
  const photoSlots = useMemo(() => (area ? uenoCleaningPhotoSlots(area.key, props.slotStart) : []), [area, props.slotStart]);
  const photoLabels = area ? uenoCleaningPhotoStepLabels(area.key, props.slotStart) : [];
  const photoSlotKeys = new Set(photoSlots.map((slot) => photoKey(slot.placeKey, slot.stepKey)));

  const choosePhoto = async (placeKey: string, stepKey: string, file: File | undefined) => {
    if (!file) return;
    setErr(null);
    try {
      const base64 = await compressToJpeg(file);
      setPhotos((current) => ({ ...current, [photoKey(placeKey, stepKey)]: base64 }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "写真を読み取れません");
    }
  };

  const submit = async () => {
    if (!area) {
      setErr("掃除の場所を選んでください");
      return;
    }
    if (!trainerId) {
      setErr("担当トレーナーを選んでください");
      return;
    }
    const checkRows = area.places.flatMap((place) =>
      place.steps.map((step) => ({
        place_key: place.key,
        step_key: step.key,
        done: Boolean(checks[photoKey(place.key, step.key)]),
      }))
    );
    const photoRows = photoSlots
      .map((slot) => {
        const data = photos[photoKey(slot.placeKey, slot.stepKey)];
        return data ? { place_key: slot.placeKey, step_key: slot.stepKey, data_base64: data } : null;
      })
      .filter((row): row is { place_key: string; step_key: string; data_base64: string } => Boolean(row));
    const ready = validateUenoCleaningSubmission({
      areaKey: area.key,
      slotStart: props.slotStart,
      checks: checkRows.map((row) => ({ placeKey: row.place_key, stepKey: row.step_key, done: row.done })),
      photos: photoRows.map((row) => ({ placeKey: row.place_key, stepKey: row.step_key })),
      note,
    });
    if (!ready.ok) {
      setErr(ready.error);
      return;
    }
    setErr(null);
    try {
      await props.onSubmit({
        areaKey: area.key,
        checks: checkRows,
        photos: photoRows,
        note: note.trim() || undefined,
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

  if (!area) {
    return (
      <div>
        <div className="text-xs font-semibold text-slate-700">どこを掃除しますか</div>
        <div className="mt-2 grid gap-2">
          {UENO_CLEANING_AREAS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setAreaKey(item.key);
                setErr(null);
              }}
              className="flex min-h-[52px] items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
            >
              <span className="text-sm font-semibold text-slate-900">{item.label}</span>
              <span className="text-xs text-slate-500">手順とチェックへ</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => {
          setAreaKey("");
          setErr(null);
        }}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
      >
        場所を選び直す
      </button>
      <div>
        <div className="text-sm font-semibold text-slate-900">{area.label}</div>
        <div className="mt-2 rounded-xl bg-slate-50 px-3 py-3">
          <div className="text-xs font-semibold text-slate-700">マニュアル</div>
          {area.videoUrl ? (
            <a
              href={area.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block text-sm font-semibold text-sky-800 underline"
            >
              マニュアル動画
            </a>
          ) : null}
          <p className="mt-1 text-xs text-slate-500">上から順に掃除します。写真が付いている項目は必須です。</p>
          {area.places.some((place) => place.manual.length > 0) ? (
            area.places.map((place) => (
              <div key={place.key} className="mt-2">
                <div className="text-xs font-semibold text-slate-800">{place.label}</div>
                <ol className="mt-1 list-decimal pl-5 text-sm text-slate-800">
                  {place.manual.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              </div>
            ))
          ) : (
            <ol className="mt-2 list-decimal pl-5 text-sm text-slate-800">
              {area.places[0]?.steps.map((step) => (
                <li key={step.key}>
                  <span className="font-semibold">{step.label}</span> {step.detail}
                </li>
              ))}
            </ol>
          )}
          {photoLabels.length > 0 ? <p className="mt-2 text-sm font-semibold text-slate-900">今回の写真: {photoLabels.join("、")}</p> : null}
        </div>
      </div>

      {area.places.map((place) => (
        <section key={place.key} className="border-t border-slate-200 pt-3">
          <div className="text-xs font-semibold text-slate-700">{place.label}のチェック</div>
          <div className="mt-2 space-y-3">
            {place.steps.map((step) => {
              const key = photoKey(place.key, step.key);
              const needsPhoto = photoSlotKeys.has(key);
              return (
                <div key={step.key}>
                  <label className="flex items-start gap-2 text-sm text-slate-900">
                    <input
                      type="checkbox"
                      checked={Boolean(checks[key])}
                      onChange={(e) => setChecks((current) => ({ ...current, [key]: e.target.checked }))}
                      className="mt-1 h-5 w-5"
                    />
                    <span>
                      <span className="font-semibold">{step.label}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{step.detail}</span>
                    </span>
                  </label>
                  {needsPhoto ? (
                    <PhotoButton attached={Boolean(photos[key])} onPick={(file) => void choosePhoto(place.key, step.key, file)} />
                  ) : null}
                </div>
              );
            })}
            {photoSlots
              .filter((slot) => slot.placeKey === place.key && slot.stepKey === "place")
              .map((slot) => {
                const key = photoKey(slot.placeKey, slot.stepKey);
                return (
                  <PhotoButton key={key} attached={Boolean(photos[key])} onPick={(file) => void choosePhoto(slot.placeKey, slot.stepKey, file)} />
                );
              })}
          </div>
        </section>
      ))}

      <label className="block text-xs font-semibold text-slate-700">
        報告メモ
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={400}
          placeholder="あれば補足"
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal"
        />
      </label>
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

function PhotoButton(props: { attached: boolean; onPick: (file: File | undefined) => void }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 pl-7">
      <span className="text-sm text-slate-800">
        写真 <strong>{props.attached ? "添付済み" : "必須"}</strong>
      </span>
      <button
        type="button"
        onClick={(e) => {
          const input = e.currentTarget.nextElementSibling;
          if (input instanceof HTMLInputElement) input.click();
        }}
        className={[
          "rounded-lg border px-3 py-1.5 text-sm",
          props.attached ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white",
        ].join(" ")}
      >
        {props.attached ? "写真を付け直す" : "写真を付ける"}
      </button>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          props.onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
