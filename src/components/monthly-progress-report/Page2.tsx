import type { MonthlyProgressReport } from "@/lib/monthlyProgressReport/types";
import { PartPieChart, VisitCalendar } from "./charts";
import { TrainerComment } from "./shared";
import { A4Page, MetricCard, ReportHeader, SectionCard } from "./ui";

export function Page2({ report }: { report: MonthlyProgressReport }) {
  const { member, metrics, meta, visitDates, ai, trainer } = report;
  return (
    <A4Page>
      <ReportHeader
        title={`${meta.yearMonthLabel}の成果サマリー`}
        subtitle="RESULTS SUMMARY"
        memberName={member.name}
        tenureMonths={member.tenureMonths}
        yearMonthLabel={meta.yearMonthLabel}
      />
      <p className="-mt-2 mb-4 text-center text-xs text-abody-muted">
        {member.name}さん、今月もお疲れさまでした。数字で振り返ると成長がよくわかります。
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2 rounded-2xl bg-[#1f2421] p-5 text-white md:row-span-2">
          <div className="text-[11px] tracking-[0.2em] text-abody-gold">ABODY SCORE</div>
          <div className="mt-2 text-5xl font-bold text-abody-gold">{metrics.abodyScore}</div>
          <div className="mt-1 text-xs text-white/60">/ 100 · Grade {metrics.overallGrade}</div>
        </div>
        <MetricCard label="来店回数" value={metrics.visitCount} unit="回" achieved={metrics.visitCount >= 8} />
        <MetricCard label="総運動時間" value={metrics.totalMinutes} unit="分" hint="セッション合計" />
        <MetricCard label="消費カロリー(目安)" value={metrics.estimatedKcal.toLocaleString()} unit="kcal" />
        <MetricCard
          label="累計来店"
          value={metrics.cumulativeVisits}
          unit="回"
          hint={`今月 +${metrics.visitCount}`}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="平均満足度"
          value={metrics.avgSatisfaction ?? "—"}
          unit={metrics.avgSatisfaction != null ? "/5" : undefined}
        />
        <MetricCard
          label="アンケート回答率"
          value={metrics.surveyResponseRate ?? "—"}
          unit={metrics.surveyResponseRate != null ? "%" : undefined}
          achieved={(metrics.surveyResponseRate ?? 0) >= 80}
        />
        <MetricCard label="予約達成率" value={metrics.bookingAchievementRate ?? "—"} unit="%" />
        <MetricCard label="総合評価" value={metrics.overallGrade} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <VisitCalendar yearMonth={meta.yearMonth} visitDates={visitDates} />
        <PartPieChart data={report.partRatios} />
      </div>

      <SectionCard title="今月できたこと" className="mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {ai.achievements.map((a) => (
            <div key={a.title} className="rounded-xl border border-abody-line p-3">
              <div className="text-sm font-semibold text-abody-ink">{a.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-abody-muted">{a.detail}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {trainer && ai.trainerComment ? (
        <TrainerComment name={trainer.displayName} comment={ai.trainerComment} />
      ) : null}
    </A4Page>
  );
}
