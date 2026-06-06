/** LIFF 起動時の URL / liff.state からアンケート用クエリを復元 */

export type SurveyUrlParams = {
  token?: string;
  s?: string;
  sig?: string;
};

const STORAGE_KEY = "session_survey_params_v1";

function parseSearch(search: string): SurveyUrlParams | null {
  const q = search.startsWith("?") ? search.slice(1) : search;
  if (!q) return null;
  const p = new URLSearchParams(q);
  const token = p.get("token")?.trim();
  const s = p.get("s")?.trim();
  const sig = p.get("sig")?.trim();
  if (token) return { token };
  if (s && sig) return { s, sig };
  return null;
}

/** LIFF が …/survey + s=… を …/surveys=… と連結したときの復元 */
function paramsFromBrokenSurveyPath(): SurveyUrlParams | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname || "";
  if (!path.startsWith("/surveys=")) return null;
  const tail = path.slice("/surveys=".length);
  const amp = tail.indexOf("&sig=");
  if (amp >= 0) {
    return { s: tail.slice(0, amp), sig: tail.slice(amp + "&sig=".length) };
  }
  const sig = new URLSearchParams(window.location.search).get("sig")?.trim();
  if (sig) return { s: tail, sig };
  return null;
}

function parseLiffState(raw: string): SurveyUrlParams | null {
  try {
    const decoded = decodeURIComponent(raw);
    const asSearch = decoded.includes("=") ? (decoded.startsWith("?") ? decoded : `?${decoded}`) : "";
    if (asSearch) {
      const fromState = parseSearch(asSearch);
      if (fromState) return fromState;
    }
    if (decoded.length >= 36 && !decoded.includes("&")) {
      return { token: decoded };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 現在の location から token / s+sig を取得（liff.state も見る） */
export function captureSurveyParamsFromLocation(): SurveyUrlParams | null {
  if (typeof window === "undefined") return null;

  const broken = paramsFromBrokenSurveyPath();
  if (broken) return broken;

  const direct = parseSearch(window.location.search);
  if (direct) return direct;

  const fromSearchState = new URLSearchParams(window.location.search).get("liff.state");
  if (fromSearchState) {
    const p = parseLiffState(fromSearchState);
    if (p) return p;
  }

  const hash = window.location.hash?.replace(/^#/, "").trim();
  if (hash) {
    const fromHash = parseSearch(hash.startsWith("?") ? hash : `?${hash}`);
    if (fromHash) return fromHash;
    const fromHashState = new URLSearchParams(hash).get("liff.state");
    if (fromHashState) {
      const p = parseLiffState(fromHashState);
      if (p) return p;
    }
  }

  return null;
}

export function persistSurveyParams(params: SurveyUrlParams): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(params));
}

export function restoreSurveyParams(): SurveyUrlParams | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SurveyUrlParams;
    if (p?.token || (p?.s && p?.sig)) return p;
  } catch {
    /* ignore */
  }
  return null;
}

export function toSurveyApiQuery(params: SurveyUrlParams): string {
  if (params.token) return `token=${encodeURIComponent(params.token)}`;
  if (params.s && params.sig) {
    return `s=${encodeURIComponent(params.s)}&sig=${encodeURIComponent(params.sig)}`;
  }
  return "";
}
