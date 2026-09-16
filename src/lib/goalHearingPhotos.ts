import type { SupabaseClient } from "@supabase/supabase-js";
import { BODY_PHOTO_SIGNED_URL_TTL_SEC, MEMBER_BODY_PHOTO_BUCKET } from "@/lib/memberBodyPhotos";

export type GoalPhotoItem = {
  index: number;
  path: string;
  url: string | null;
};

/** カルテ本文が目標ヒアリング回答か（セッション記録と区別する） */
export function isGoalHearingKarteContent(content: string | null | undefined): boolean {
  return /【目標ヒアリング\s+\d{4}-\d{2}-\d{2}】/.test(String(content ?? ""));
}

export function parseGoalPhotoPaths(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x ?? "").trim()).filter(Boolean);
      }
    } catch {
      // 単一パスとして扱う
    }
    return [t];
  }
  return [];
}

/** Storage オブジェクトキーへ正規化。公開URLならそのまま返す */
export function normalizeGoalPhotoRef(raw: string): { path?: string; url?: string } {
  const t = raw.trim();
  if (!t) return {};
  if (/^https?:\/\//i.test(t)) return { url: t };

  let path = t.replace(/^\/+/, "");
  const bucketPrefix = `${MEMBER_BODY_PHOTO_BUCKET}/`;
  if (path.startsWith(bucketPrefix)) path = path.slice(bucketPrefix.length);
  try {
    path = decodeURIComponent(path);
  } catch {
    // そのままで署名を試す
  }
  return { path };
}

export async function signGoalPhotoUrls(
  supabase: SupabaseClient,
  rawPaths: unknown,
  ttlSec: number = BODY_PHOTO_SIGNED_URL_TTL_SEC
): Promise<GoalPhotoItem[]> {
  const parsed = parseGoalPhotoPaths(rawPaths);
  return Promise.all(
    parsed.map(async (raw, index) => {
      const ref = normalizeGoalPhotoRef(raw);
      if (ref.url) {
        return { index, path: raw, url: ref.url };
      }
      const path = ref.path;
      if (!path) return { index, path: raw, url: null };

      const { data, error } = await supabase.storage.from(MEMBER_BODY_PHOTO_BUCKET).createSignedUrl(path, ttlSec);
      if (!error && data?.signedUrl) {
        return { index, path, url: data.signedUrl };
      }

      console.warn("goal photo signed url failed", { path, message: error?.message });
      return { index, path, url: null };
    })
  );
}
