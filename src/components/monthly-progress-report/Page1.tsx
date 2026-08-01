import type { MonthlyProgressReport } from "@/lib/monthlyProgressReport/types";
import { A4Page, MetricCard, ReportHeader, SectionCard, Stars } from "./ui";
import { AIComment, PhotoComparison, PostureGrid, TrainerComment } from "./shared";

export function Page1({ report }: { report: MonthlyProgressReport }) {
  const { member, photos, ai, metrics, trainer, meta } = report;
  return (
    <A4Page>
      <ReportHeader
        title="あなたの成長レポート"
        subtitle="MONTHLY PROGRESS REPORT"
        memberName={member.name}
        tenureMonths={member.tenureMonths}
        yearMonthLabel={meta.yearMonthLabel}
      />

      {photos.hasComparison || photos.hasTimeline || photos.oldest || photos.before ? (
        <div className="mb-4">
          <PhotoComparison
            oldest={photos.oldest}
            previous={photos.previous}
            current={photos.current}
            before={photos.before}
            after={photos.after}
          />
        </div>
      ) : (
        <div className="mb-4">
          <SectionCard title="AI総合分析">
            <AIComment>{ai.overallAnalysisFallback}</AIComment>
          </SectionCard>
        </div>
      )}

      {(photos.hasComparison || photos.hasTimeline) && ai.postureItems.length > 0 ? (
        <div className="mb-4">
          <PostureGrid items={ai.postureItems} />
        </div>
      ) : null}

      <SectionCard title="総合評価" className="mb-4">
        <div className="flex items-center gap-5">
          <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full border-2 border-abody-gold bg-abody-gold-soft">
            <div className="text-2xl font-bold text-abody-gold">{metrics.overallGrade}</div>
            <div className="text-[10px] text-abody-gold">Excellent</div>
          </div>
          <div className="flex-1">
            <Stars value={Math.min(5, Math.round(metrics.abodyScore / 20))} />
            <p className="mt-2 text-sm font-semibold text-abody-ink">{ai.overallComment}</p>
          </div>
          <div className="hidden text-right sm:block">
            <div className="text-[10px] text-abody-muted">ABODY SCORE</div>
            <div className="text-3xl font-bold text-abody-gold">{metrics.abodyScore}</div>
          </div>
        </div>
      </SectionCard>

      {trainer && ai.trainerComment ? (
        <TrainerComment name={trainer.displayName} comment={ai.trainerComment} />
      ) : null}

      <div className="mt-auto pt-6 text-center text-[10px] text-abody-muted">
        小さな積み重ねが、大きな変化につながります。
      </div>
    </A4Page>
  );
}
