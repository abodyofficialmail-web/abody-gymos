import type { SupabaseClient } from "@supabase/supabase-js";

export const MEMBER_REPORTS_BUCKET = "member-reports";
const SIGNED_TTL_SEC = 60 * 60 * 24; // 24h for mypage

export type MonthlyProgressReportMeta = {
  memberId: string;
  memberCode: string;
  name: string;
  yearMonth: string;
  yearMonthLabel: string;
  visitCount: number;
  abodyScore: number;
  overallGrade: string;
  storeName?: string | null;
  generatedAt: string;
  lineSentAt?: string | null;
  pdfPath: string;
  pagePaths: string[];
  storagePrefix: string;
};

export type MonthlyProgressReportListItem = {
  yearMonth: string;
  yearMonthLabel: string;
  visitCount: number;
  abodyScore: number;
  overallGrade: string;
  generatedAt: string;
  lineSentAt: string | null;
  pdfUrl: string | null;
  pageUrls: string[];
};

function prefixFor(memberId: string, yearMonth: string) {
  return `${memberId}/${yearMonth}`;
}

export async function saveMonthlyProgressReportAssets(
  supabase: SupabaseClient,
  params: {
    memberId: string;
    memberCode: string;
    name: string;
    yearMonth: string;
    yearMonthLabel: string;
    visitCount: number;
    abodyScore: number;
    overallGrade: string;
    storeName?: string | null;
    pageJpgs: Array<Uint8Array | Buffer>;
    pdfBytes: Uint8Array | Buffer;
    lineSentAt?: string | null;
  }
): Promise<MonthlyProgressReportMeta> {
  const storagePrefix = prefixFor(params.memberId, params.yearMonth);
  const pagePaths: string[] = [];

  for (let i = 0; i < params.pageJpgs.length; i++) {
    const storagePath = `${storagePrefix}/page-${i + 1}.jpg`;
    const { error } = await supabase.storage.from(MEMBER_REPORTS_BUCKET).upload(storagePath, params.pageJpgs[i], {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) throw error;
    pagePaths.push(storagePath);
  }

  const pdfStoragePath = `${storagePrefix}/report.pdf`;
  {
    const { error } = await supabase.storage.from(MEMBER_REPORTS_BUCKET).upload(pdfStoragePath, params.pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (error) throw error;
  }

  const meta: MonthlyProgressReportMeta = {
    memberId: params.memberId,
    memberCode: params.memberCode,
    name: params.name,
    yearMonth: params.yearMonth,
    yearMonthLabel: params.yearMonthLabel,
    visitCount: params.visitCount,
    abodyScore: params.abodyScore,
    overallGrade: params.overallGrade,
    storeName: params.storeName ?? null,
    generatedAt: new Date().toISOString(),
    lineSentAt: params.lineSentAt ?? null,
    pdfPath: pdfStoragePath,
    pagePaths,
    storagePrefix,
  };

  const metaPath = `${storagePrefix}/meta.json`;
  {
    const { error } = await supabase.storage
      .from(MEMBER_REPORTS_BUCKET)
      .upload(metaPath, Buffer.from(JSON.stringify(meta, null, 2), "utf8"), {
        contentType: "application/json",
        upsert: true,
      });
    if (error) throw error;
  }

  try {
    const { error } = await (supabase as any).from("member_monthly_progress_reports").upsert(
      {
        member_id: params.memberId,
        year_month: params.yearMonth,
        member_code: params.memberCode,
        visit_count: params.visitCount,
        abody_score: params.abodyScore,
        overall_grade: params.overallGrade,
        pdf_path: pdfStoragePath,
        page1_path: pagePaths[0] ?? null,
        page2_path: pagePaths[1] ?? null,
        page3_path: pagePaths[2] ?? null,
        page4_path: pagePaths[3] ?? null,
        storage_prefix: storagePrefix,
        line_sent_at: params.lineSentAt ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "member_id,year_month" }
    );
    if (error) {
      console.warn("member_monthly_progress_reports upsert skipped:", error.message);
    }
  } catch (e) {
    console.warn("member_monthly_progress_reports upsert skipped:", e);
  }

  return meta;
}

export async function markMonthlyProgressLineSent(
  supabase: SupabaseClient,
  memberId: string,
  yearMonth: string,
  sentAt = new Date().toISOString()
) {
  const storagePrefix = prefixFor(memberId, yearMonth);
  const metaPath = `${storagePrefix}/meta.json`;
  const { data: blob, error: dlErr } = await supabase.storage.from(MEMBER_REPORTS_BUCKET).download(metaPath);
  if (dlErr || !blob) return;
  const meta = JSON.parse(await blob.text()) as MonthlyProgressReportMeta;
  meta.lineSentAt = sentAt;
  await supabase.storage
    .from(MEMBER_REPORTS_BUCKET)
    .upload(metaPath, Buffer.from(JSON.stringify(meta, null, 2), "utf8"), {
      contentType: "application/json",
      upsert: true,
    });
  try {
    await (supabase as any)
      .from("member_monthly_progress_reports")
      .update({ line_sent_at: sentAt, updated_at: sentAt })
      .eq("member_id", memberId)
      .eq("year_month", yearMonth);
  } catch {
    // optional
  }
}

async function signedUrl(supabase: SupabaseClient, path: string | null | undefined) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(MEMBER_REPORTS_BUCKET).createSignedUrl(path, SIGNED_TTL_SEC);
  if (error) return null;
  return data.signedUrl;
}

export async function listMonthlyProgressReportsForMember(
  supabase: SupabaseClient,
  memberId: string
): Promise<MonthlyProgressReportListItem[]> {
  try {
    const { data, error } = await (supabase as any)
      .from("member_monthly_progress_reports")
      .select(
        "year_month, visit_count, abody_score, overall_grade, pdf_path, page1_path, page2_path, page3_path, page4_path, line_sent_at, created_at, updated_at"
      )
      .eq("member_id", memberId)
      .order("year_month", { ascending: false });
    if (!error && Array.isArray(data) && data.length) {
      const items: MonthlyProgressReportListItem[] = [];
      for (const row of data) {
        const [y, m] = String(row.year_month).split("-");
        const pagePaths = [row.page1_path, row.page2_path, row.page3_path, row.page4_path].filter(Boolean);
        items.push({
          yearMonth: row.year_month,
          yearMonthLabel: `${y}年${Number(m)}月`,
          visitCount: row.visit_count ?? 0,
          abodyScore: row.abody_score ?? 0,
          overallGrade: row.overall_grade ?? "",
          generatedAt: row.updated_at || row.created_at,
          lineSentAt: row.line_sent_at ?? null,
          pdfUrl: await signedUrl(supabase, row.pdf_path),
          pageUrls: (await Promise.all(pagePaths.map((p: string) => signedUrl(supabase, p)))).filter(Boolean) as string[],
        });
      }
      return items;
    }
  } catch {
    // fall through to storage listing
  }

  const { data: folders, error: listErr } = await supabase.storage.from(MEMBER_REPORTS_BUCKET).list(memberId, {
    limit: 48,
  });
  if (listErr || !folders?.length) return [];

  const yearMonths = folders
    .map((f) => f.name)
    .filter((name) => /^\d{4}-\d{2}$/.test(name))
    .sort((a, b) => b.localeCompare(a));

  const items: MonthlyProgressReportListItem[] = [];
  for (const yearMonth of yearMonths) {
    const metaPath = `${memberId}/${yearMonth}/meta.json`;
    const { data: blob } = await supabase.storage.from(MEMBER_REPORTS_BUCKET).download(metaPath);
    if (!blob) continue;
    try {
      const meta = JSON.parse(await blob.text()) as MonthlyProgressReportMeta;
      items.push({
        yearMonth: meta.yearMonth,
        yearMonthLabel: meta.yearMonthLabel,
        visitCount: meta.visitCount,
        abodyScore: meta.abodyScore,
        overallGrade: meta.overallGrade,
        generatedAt: meta.generatedAt,
        lineSentAt: meta.lineSentAt ?? null,
        pdfUrl: await signedUrl(supabase, meta.pdfPath),
        pageUrls: (await Promise.all((meta.pagePaths || []).map((p) => signedUrl(supabase, p)))).filter(
          Boolean
        ) as string[],
      });
    } catch {
      // skip broken meta
    }
  }
  return items;
}
