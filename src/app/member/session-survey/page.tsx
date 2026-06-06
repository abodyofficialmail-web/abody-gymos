import { redirect } from "next/navigation";
import { sessionSurveyPagePath } from "@/lib/sessionSurveyPaths";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** 旧URL → /survey（LIFF エンドポイントは /survey に統一） */
export default async function LegacySessionSurveyRedirect({ searchParams }: Props) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v)) {
      for (const item of v) qs.append(k, item);
    }
  }
  const q = qs.toString();
  redirect(sessionSurveyPagePath(q || undefined));
}
