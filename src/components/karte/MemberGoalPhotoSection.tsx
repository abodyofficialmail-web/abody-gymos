"use client";

import { DateTime } from "luxon";
import { useCallback, useEffect, useState } from "react";

const TZ = "Asia/Tokyo";

type GoalPhoto = { index: number; path: string; url: string };
type GoalHearingMeta = {
  id: string;
  created_at: string;
  photo_count: number;
  primary_goal?: string | null;
  secondary_goal?: string | null;
  tertiary_goal?: string | null;
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string })?.error ?? "取得に失敗しました");
  return json as T;
}

function formatRespondedAt(iso: string) {
  const dt = DateTime.fromISO(iso, { zone: TZ });
  if (!dt.isValid) return iso;
  return dt.toFormat("yyyy/M/d HH:mm");
}

/** 会員カルテ：目標ヒアリングで提出されたなりたい体型写真 */
export function MemberGoalPhotoSection({ memberId }: { memberId: string }) {
  const [photos, setPhotos] = useState<GoalPhoto[] | null>(null);
  const [meta, setMeta] = useState<GoalHearingMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await apiGet<{ photos: GoalPhoto[]; response: GoalHearingMeta | null }>(
        `/api/admin/members/${encodeURIComponent(memberId)}/goal-photos`
      );
      setPhotos(data.photos ?? []);
      setMeta(data.response);
    } catch (e) {
      setPhotos([]);
      setMeta(null);
      setErr(String((e as Error)?.message ?? "取得に失敗しました"));
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-bold text-slate-900">目標写真（なりたい体型）</div>
        {meta?.created_at ? (
          <div className="text-xs text-slate-500">回答日 {formatRespondedAt(meta.created_at)}</div>
        ) : null}
      </div>
      <div className="text-xs text-slate-600">会員が目標ヒアリングで提出した参考写真です。現在の体型写真と見比べてください。</div>

      {photos === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
      {err ? <div className="text-sm text-red-700">{err}</div> : null}

      {photos !== null && photos.length === 0 && !err ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
          まだ目標写真の提出がありません。
        </div>
      ) : null}

      {photos && photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((p) => (
            <button
              key={p.path}
              type="button"
              onClick={() => setLightbox(p.url)}
              className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`目標写真 ${p.index + 1}`} className="aspect-[3/4] w-full object-cover" />
              <div className="px-2 py-1 text-[11px] font-semibold text-slate-600">写真 {p.index + 1}</div>
            </button>
          ))}
        </div>
      ) : null}

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="目標写真拡大"
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </section>
  );
}
