/** LINE / LIFF 起動時の URL から目標ヒアリング用 s+sig を復元（外部I/Oなし） */

export type GoalHearingUrlParams = { s: string; sig: string };

function parseSearch(search: string): GoalHearingUrlParams | null {
  const q = search.startsWith("?") ? search.slice(1) : search;
  if (!q) return null;
  const p = new URLSearchParams(q);
  const s = p.get("s")?.trim() ?? "";
  const sig = p.get("sig")?.trim() ?? "";
  if (!s || !sig) return null;
  return { s, sig };
}

/** LIFF が …/goal-hearing + s=… を …/goal-hearings=… と連結したときの復元 */
function paramsFromBrokenPath(): GoalHearingUrlParams | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname || "";
  if (!path.startsWith("/goal-hearings=")) return null;
  const tail = path.slice("/goal-hearings=".length);
  const amp = tail.indexOf("&sig=");
  if (amp >= 0) {
    return {
      s: decodeURIComponent(tail.slice(0, amp)),
      sig: decodeURIComponent(tail.slice(amp + "&sig=".length)),
    };
  }
  const sig = new URLSearchParams(window.location.search).get("sig")?.trim();
  if (sig) return { s: decodeURIComponent(tail), sig };
  return null;
}

function parseLiffState(raw: string): GoalHearingUrlParams | null {
  try {
    const decoded = decodeURIComponent(raw);
    const asSearch = decoded.includes("=") ? (decoded.startsWith("?") ? decoded : `?${decoded}`) : "";
    return asSearch ? parseSearch(asSearch) : null;
  } catch {
    return null;
  }
}

export function captureGoalHearingParamsFromLocation(): GoalHearingUrlParams | null {
  if (typeof window === "undefined") return null;

  const broken = paramsFromBrokenPath();
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

/** 署名ペイロードを検証せず、どの画面へ送るべきかだけ見る */
export function signedPayloadDestination(s: string): "/goal-hearing" | "/pre-session-survey" | "/survey" | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as Record<string, unknown>;
    if (typeof json.reservation_id === "string") return "/pre-session-survey";
    if (typeof json.session_date === "string" && typeof json.trainer_id === "string") return "/survey";
    if (typeof json.member_id === "string" && "invite_id" in json) return "/goal-hearing";
  } catch {
    /* ignore */
  }
  return null;
}
