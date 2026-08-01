/** member-reports バケットへ月次レポートを保存（マイページ用） */

export const MEMBER_REPORTS_BUCKET = "member-reports";

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {{
 *   memberId: string,
 *   memberCode: string,
 *   name: string,
 *   yearMonth: string,
 *   yearMonthLabel: string,
 *   visitCount: number,
 *   abodyScore: number,
 *   overallGrade: string,
 *   storeName?: string|null,
 *   pageJpgBuffers: Buffer[],
 *   pdfBuffer: Buffer,
 *   lineSentAt?: string|null,
 *   quality?: { scale?: number, jpeg?: number },
 * }} params
 */
export async function persistMonthlyProgressReport(sb, params) {
  const storagePrefix = `${params.memberId}/${params.yearMonth}`;
  const pagePaths = [];

  for (let i = 0; i < params.pageJpgBuffers.length; i++) {
    const storagePath = `${storagePrefix}/page-${i + 1}.jpg`;
    const { error } = await sb.storage.from(MEMBER_REPORTS_BUCKET).upload(storagePath, params.pageJpgBuffers[i], {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) throw error;
    pagePaths.push(storagePath);
  }

  const pdfPath = `${storagePrefix}/report.pdf`;
  {
    const { error } = await sb.storage.from(MEMBER_REPORTS_BUCKET).upload(pdfPath, params.pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (error) throw error;
  }

  const meta = {
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
    pdfPath,
    pagePaths,
    storagePrefix,
    quality: params.quality ?? { scale: 2, jpeg: 90 },
  };

  {
    const { error } = await sb.storage
      .from(MEMBER_REPORTS_BUCKET)
      .upload(`${storagePrefix}/meta.json`, Buffer.from(JSON.stringify(meta, null, 2), "utf8"), {
        contentType: "application/json",
        upsert: true,
      });
    if (error) throw error;
  }

  try {
    const { error } = await sb.from("member_monthly_progress_reports").upsert(
      {
        member_id: params.memberId,
        year_month: params.yearMonth,
        member_code: params.memberCode,
        visit_count: params.visitCount,
        abody_score: params.abodyScore,
        overall_grade: params.overallGrade,
        pdf_path: pdfPath,
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
    if (error) console.warn("DB upsert skipped:", error.message);
  } catch (e) {
    console.warn("DB upsert skipped:", e?.message || e);
  }

  return meta;
}

export async function markLineSent(sb, memberId, yearMonth, sentAt = new Date().toISOString()) {
  const metaPath = `${memberId}/${yearMonth}/meta.json`;
  const { data: blob, error } = await sb.storage.from(MEMBER_REPORTS_BUCKET).download(metaPath);
  if (error || !blob) return;
  const meta = JSON.parse(await blob.text());
  meta.lineSentAt = sentAt;
  await sb.storage
    .from(MEMBER_REPORTS_BUCKET)
    .upload(metaPath, Buffer.from(JSON.stringify(meta, null, 2), "utf8"), {
      contentType: "application/json",
      upsert: true,
    });
  try {
    await sb
      .from("member_monthly_progress_reports")
      .update({ line_sent_at: sentAt, updated_at: sentAt })
      .eq("member_id", memberId)
      .eq("year_month", yearMonth);
  } catch {
    // optional
  }
}

/** LINE配信用に signed URL を発行（7日） */
export async function createDeliveryUrls(sb, meta, ttlSec = 60 * 60 * 24 * 7) {
  const imageUrls = [];
  for (const p of meta.pagePaths || []) {
    const { data, error } = await sb.storage.from(MEMBER_REPORTS_BUCKET).createSignedUrl(p, ttlSec);
    if (error) throw error;
    imageUrls.push(data.signedUrl);
  }
  let pdfUrl = null;
  if (meta.pdfPath) {
    const { data, error } = await sb.storage.from(MEMBER_REPORTS_BUCKET).createSignedUrl(meta.pdfPath, ttlSec);
    if (error) throw error;
    pdfUrl = data.signedUrl;
  }
  return { imageUrls, pdfUrl };
}
