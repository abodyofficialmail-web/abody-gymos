"use client";

import {
  BODY_PHOTO_ANGLE_LABELS,
  BODY_PHOTO_ANGLES,
  type BodyPhotoAngle,
  type MemberBodyPhotoSetView,
} from "@/lib/memberBodyPhotos";
import { compressImageFile } from "@/lib/compressImageFile";
import { DateTime } from "luxon";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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

function angleUrl(set: MemberBodyPhotoSetView, angle: BodyPhotoAngle): string | null {
  if (angle === "front") return set.front_url;
  if (angle === "back") return set.back_url;
  if (angle === "side_left") return set.side_left_url;
  return set.side_right_url;
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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const preview = pending?.previewUrl ?? existingUrl;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onPick(angle, file);
    e.target.value = "";
  };

  return (
    <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2">
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
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={disabled}
        onChange={handleFileChange}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled}
        onChange={handleFileChange}
      />
      <div className="flex gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => cameraInputRef.current?.click()}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-800 disabled:opacity-60"
        >
          撮影
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-800 disabled:opacity-60"
        >
          ファイル
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

function PhotoBoard({ set }: { set: MemberBodyPhotoSetView }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {BODY_PHOTO_ANGLES.map((angle) => {
        const label = BODY_PHOTO_ANGLE_LABELS[angle];
        const url = angleUrl(set, angle);
        return (
          <div key={angle} className="relative aspect-[3/4] overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={label} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">未登録</div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-6 text-center text-xs font-semibold text-white">
              {label}
            </div>
          </div>
        );
      })}
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
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<Partial<Record<BodyPhotoAngle, PendingFile>>>({});
  const [note, setNote] = useState("");
  const [page, setPage] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const jumpedFor = useRef("");

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
      for (const p of Object.values(pendingRef.current)) {
        if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
    };
  }, []);

  const chronological = useMemo(() => {
    const withPhotos = (sets ?? []).filter((s) => s.front_url || s.back_url || s.side_left_url || s.side_right_url);
    return [...withPhotos].reverse();
  }, [sets]);

  const newestId = chronological[chronological.length - 1]?.id ?? "";

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !newestId || jumpedFor.current === newestId) return;
    const last = chronological.length - 1;
    const jump = () => {
      if (el.clientWidth <= 0) return false;
      el.scrollLeft = last * el.clientWidth;
      setPage(last);
      return true;
    };
    if (jump()) {
      jumpedFor.current = newestId;
      return;
    }
    const id = requestAnimationFrame(() => {
      if (jump()) jumpedFor.current = newestId;
    });
    return () => cancelAnimationFrame(id);
  }, [newestId, chronological.length]);

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

  const clearPending = () => {
    setPending((cur) => {
      for (const p of Object.values(cur)) {
        if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
      return {};
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
        let uploadFile: File;
        try {
          uploadFile = await compressImageFile(file);
        } catch (compressErr: unknown) {
          const message = compressErr instanceof Error ? compressErr.message : "画像の処理に失敗しました";
          throw new Error(`${BODY_PHOTO_ANGLE_LABELS[angle]}: ${message}`);
        }

        const form = new FormData();
        form.set("photo_date", photoDate);
        form.set("angle", angle);
        form.set("file", uploadFile);
        if (note.trim()) form.set("note", note.trim());
        const res = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/body-photos`, {
          method: "POST",
          body: form,
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        if (!res.ok) {
          if (res.status === 413) {
            throw new Error(`${BODY_PHOTO_ANGLE_LABELS[angle]}: 画像が大きすぎます`);
          }
          const detail = json.detail ? `（${json.detail}）` : "";
          throw new Error(`${BODY_PHOTO_ANGLE_LABELS[angle]}: ${json.error ?? "保存に失敗しました"}${detail}`);
        }
      }
      clearPending();
      setNote("");
      setRecording(false);
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

  function goTo(i: number) {
    const el = scrollerRef.current;
    const next = Math.max(0, Math.min(chronological.length - 1, i));
    setPage(next);
    if (el) el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  }

  const visible = chronological[page] ?? chronological[chronological.length - 1] ?? null;

  return (
    <section className="min-w-0 space-y-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-900">体型写真</div>
        {chronological.length > 1 && visible ? (
          <div className="text-[11px] font-semibold text-slate-400">右にスライドで過去</div>
        ) : null}
      </div>

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div> : null}
      {msg ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div> : null}

      {sets === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
      {sets !== null && chronological.length === 0 && !recording ? (
        <div className="text-sm text-slate-600">まだ登録がありません。</div>
      ) : null}

      {chronological.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="過去の体型写真"
              disabled={page <= 0}
              onClick={() => goTo(page - 1)}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            >
              ‹
            </button>
            <div className="min-w-0 text-center">
              <div className="text-sm font-semibold text-slate-900">
                {visible ? formatDateLabel(visible.photo_date) : ""}
              </div>
              {visible?.note ? <div className="truncate text-xs text-slate-500">{visible.note}</div> : null}
            </div>
            <button
              type="button"
              aria-label="新しい体型写真"
              disabled={page >= chronological.length - 1}
              onClick={() => goTo(page + 1)}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            >
              ›
            </button>
          </div>
          <div
            ref={scrollerRef}
            onScroll={() => {
              const el = scrollerRef.current;
              if (!el || el.clientWidth <= 0) return;
              setPage(Math.max(0, Math.min(chronological.length - 1, Math.round(el.scrollLeft / el.clientWidth))));
            }}
            className="flex w-full min-w-0 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {chronological.map((s) => (
              <div key={s.id} className="min-w-0 shrink-0 snap-start overflow-hidden" style={{ flex: "0 0 100%" }}>
                <PhotoBoard set={s} />
              </div>
            ))}
          </div>
          {chronological.length > 1 ? (
            <div className="flex justify-center gap-1.5">
              {chronological.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={formatDateLabel(s.photo_date)}
                  onClick={() => goTo(i)}
                  className={`h-1.5 rounded-full ${i === page ? "w-4 bg-slate-800" : "w-1.5 bg-slate-300"}`}
                />
              ))}
            </div>
          ) : null}
          {visible ? (
            <div className="text-right">
              <button
                type="button"
                disabled={busy}
                onClick={() => onDeleteSet(visible.id, formatDateLabel(visible.photo_date))}
                className="text-[11px] font-semibold text-slate-400 hover:text-red-600 disabled:opacity-60"
              >
                この日を削除
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setRecording((open) => !open);
          setMsg(null);
          if (!recording) {
            setPhotoDate(todayYmd);
          }
        }}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900"
      >
        {recording ? "記録を閉じる" : "最新を記録する"}
      </button>

      {recording ? (
        <div className="space-y-3">
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
          <div className="grid grid-cols-2 gap-2">
            {BODY_PHOTO_ANGLES.map((angle) => (
              <PhotoSlot
                key={angle}
                angle={angle}
                label={BODY_PHOTO_ANGLE_LABELS[angle]}
                existingUrl={currentSet ? angleUrl(currentSet, angle) : null}
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
        </div>
      ) : null}
    </section>
  );
}
