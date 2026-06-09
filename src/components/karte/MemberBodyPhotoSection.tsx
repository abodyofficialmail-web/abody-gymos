"use client";

import {
  BODY_PHOTO_ANGLE_LABELS,
  BODY_PHOTO_ANGLES,
  type BodyPhotoAngle,
  type MemberBodyPhotoSetView,
} from "@/lib/memberBodyPhotos";
import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TZ = "Asia/Tokyo";

type PendingFile = { file: File; previewUrl: string };

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string })?.error ?? "取得に失敗しました");
  return json as T;
}

function formatDateLabel(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: TZ });
  if (!dt.isValid) return ymd;
  const dow = ["日", "月", "火", "水", "木", "金", "土"][dt.weekday % 7];
  return `${dt.toFormat("yyyy/M/d")}（${dow}）`;
}

function PhotoSlot({
  angle,
  label,
  existingUrl,
  pending,
  onPick,
  onClearPending,
  disabled,
}: {
  angle: BodyPhotoAngle;
  label: string;
  existingUrl: string | null;
  pending: PendingFile | null;
  onPick: (angle: BodyPhotoAngle, file: File) => void;
  onClearPending: (angle: BodyPhotoAngle) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = pending?.previewUrl ?? existingUrl;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 space-y-2">
      <div className="text-xs font-semibold text-slate-700">{label}</div>
      <div className="aspect-[3/4] overflow-hidden rounded-lg border border-slate-200 bg-white">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">未登録</div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(angle, file);
          e.target.value = "";
        }}
      />
      <div className="flex gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-800 disabled:opacity-60"
        >
          {preview ? "差し替え" : "撮影"}
        </button>
        {pending ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onClearPending(angle)}
            className="rounded-lg border border-red-200 bg-white px-2 py-2 text-xs font-semibold text-red-700 disabled:opacity-60"
          >
            取消
          </button>
        ) : null}
      </div>
    </div>
  );
}

function HistoryThumbs({ set }: { set: MemberBodyPhotoSetView }) {
  const urls = [
    { label: BODY_PHOTO_ANGLE_LABELS.front, url: set.front_url },
    { label: BODY_PHOTO_ANGLE_LABELS.back, url: set.back_url },
    { label: BODY_PHOTO_ANGLE_LABELS.side_left, url: set.side_left_url },
    { label: BODY_PHOTO_ANGLE_LABELS.side_right, url: set.side_right_url },
  ].filter((x) => x.url);

  if (urls.length === 0) return <div className="text-xs text-slate-500">写真なし</div>;

  return (
    <div className="grid grid-cols-4 gap-1">
      {urls.map((x) => (
        <div key={x.label} className="space-y-0.5">
          <div className="aspect-[3/4] overflow-hidden rounded border border-slate-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={x.url!} alt={x.label} className="h-full w-full object-cover" />
          </div>
          <div className="text-[10px] text-center text-slate-500">{x.label}</div>
        </div>
      ))}
    </div>
  );
}

export function MemberBodyPhotoSection({ memberId }: { memberId: string }) {
  const todayYmd = useMemo(() => DateTime.now().setZone(TZ).toISODate()!, []);
  const [photoDate, setPhotoDate] = useState(todayYmd);
  const [sets, setSets] = useState<MemberBodyPhotoSetView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Partial<Record<BodyPhotoAngle, PendingFile>>>({});
  const [note, setNote] = useState("");

  const loadSets = useCallback(async () => {
    setErr(null);
    try {
      const data = await apiGet<{ sets: MemberBodyPhotoSetView[] }>(
        `/api/admin/members/${encodeURIComponent(memberId)}/body-photos`
      );
      setSets(data.sets ?? []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "取得に失敗しました");
      setSets([]);
    }
  }, [memberId]);

  useEffect(() => {
    loadSets();
  }, [loadSets]);

  useEffect(() => {
    return () => {
      for (const p of Object.values(pending)) {
        if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
    };
  }, [pending]);

  const currentSet = useMemo(
    () => (sets ?? []).find((s) => s.photo_date === photoDate) ?? null,
    [sets, photoDate]
  );

  const pendingCount = Object.keys(pending).length;

  const onPick = (angle: BodyPhotoAngle, file: File) => {
    setMsg(null);
    setPending((cur) => {
      const prev = cur[angle];
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return { ...cur, [angle]: { file, previewUrl: URL.createObjectURL(file) } };
    });
  };

  const onClearPending = (angle: BodyPhotoAngle) => {
    setPending((cur) => {
      const prev = cur[angle];
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      const next = { ...cur };
      delete next[angle];
      return next;
    });
  };

  const onSave = async () => {
    const entries = Object.entries(pending) as [BodyPhotoAngle, PendingFile][];
    if (entries.length === 0) {
      setMsg("保存する写真を選択してください");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      for (const [angle, { file }] of entries) {
        const form = new FormData();
        form.set("photo_date", photoDate);
        form.set("angle", angle);
        form.set("file", file);
        if (note.trim()) form.set("note", note.trim());
        const res = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/body-photos`, {
          method: "POST",
          body: form,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as { error?: string })?.error ?? "保存に失敗しました");
      }
      setPending((cur) => {
        for (const p of Object.values(cur)) {
          if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
        }
        return {};
      });
      setMsg(`${entries.length}枚を保存しました`);
      await loadSets();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const onDeleteSet = async (setId: string, photoDateLabel: string) => {
    if (!window.confirm(`${photoDateLabel} の体型写真を削除しますか？`)) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/admin/members/${encodeURIComponent(memberId)}/body-photos/${encodeURIComponent(setId)}`,
        { method: "DELETE" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string })?.error ?? "削除に失敗しました");
      setMsg("削除しました");
      await loadSets();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      <div>
        <div className="text-sm font-bold text-slate-900">体型写真</div>
        <div className="pt-1 text-xs text-slate-500">正面・背面・左横・右横の4枚を日付ごとに保存します</div>
      </div>

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div> : null}
      {msg ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold text-slate-700">撮影日</div>
          <input
            type="date"
            value={photoDate}
            onChange={(e) => {
              setPhotoDate(e.target.value);
              setMsg(null);
            }}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
          />
          <div className="mt-1 text-xs text-slate-500">{formatDateLabel(photoDate)}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-700">メモ（任意）</div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例: 初回体験時"
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {BODY_PHOTO_ANGLES.map((angle) => (
          <PhotoSlot
            key={angle}
            angle={angle}
            label={BODY_PHOTO_ANGLE_LABELS[angle]}
            existingUrl={
              angle === "front"
                ? currentSet?.front_url ?? null
                : angle === "back"
                  ? currentSet?.back_url ?? null
                  : angle === "side_left"
                    ? currentSet?.side_left_url ?? null
                    : currentSet?.side_right_url ?? null
            }
            pending={pending[angle] ?? null}
            onPick={onPick}
            onClearPending={onClearPending}
            disabled={busy}
          />
        ))}
      </div>

      <button
        type="button"
        disabled={busy || pendingCount === 0}
        onClick={onSave}
        className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? "保存中…" : pendingCount > 0 ? `${pendingCount}枚を保存` : "保存"}
      </button>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-700">履歴</div>
        {sets === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
        {sets !== null && sets.length === 0 ? <div className="text-sm text-slate-600">まだ登録がありません。</div> : null}
        <div className="grid gap-2">
          {(sets ?? []).map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-200 px-3 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{formatDateLabel(s.photo_date)}</div>
                  {s.note ? <div className="text-xs text-slate-500">{s.note}</div> : null}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDeleteSet(s.id, formatDateLabel(s.photo_date))}
                  className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-60"
                >
                  削除
                </button>
              </div>
              <HistoryThumbs set={s} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
