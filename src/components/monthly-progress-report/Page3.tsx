import type { MonthlyProgressReport } from "@/lib/monthlyProgressReport/types";
import { PartPieChart, VolumeTrendCharts, WeightTable } from "./charts";
import { AIComment, TrainerComment } from "./shared";
import { A4Page, ReportHeader, SectionCard, Stars } from "./ui";

export function Page3({ report }: { report: MonthlyProgressReport }) {
  const { member, meta, ai, trainer, topExercises, weightRows } = report;
  const maxSets = Math.max(1, ...topExercises.map((t) => t.sets));
  return (
    <A4Page>
      <ReportHeader
        title="トレーニング分析レポート"
        subtitle="TRAINING ANALYSIS"
        memberName={member.name}
        tenureMonths={member.tenureMonths}
        yearMonthLabel={meta.yearMonthLabel}
      />

      <div className="mb-4">
        <WeightTable rows={weightRows} />
      </div>

      <SectionCard title="AI分析" className="mb-4">
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
          <Fact label="一番伸びた種目" value={ai.analysis.mostImproved} />
          <Fact label="伸び悩み種目" value={ai.analysis.plateau} />
          <Fact label="重点部位" value={ai.analysis.focusPart} />
          <Fact label="得意部位" value={ai.analysis.strongPart} />
          <Fact label="課題部位" value={ai.analysis.challengePart} />
        </div>
        <div className="mt-3">
          <AIComment title="AIからの総評">{ai.analysis.narrative}</AIComment>
        </div>
      </SectionCard>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <PartPieChart data={report.partRatios} />
        <SectionCard title="今月のTOP種目">
          <ul className="space-y-2">
            {topExercises.map((t, i) => (
              <li key={t.exercise}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>
                    {i + 1}. {t.exercise}
                  </span>
                  <span className="text-abody-gold">{t.sets} sets</span>
                </div>
                <div className="h-2 rounded-full bg-abody-gold-soft">
                  <div
                    className="h-2 rounded-full bg-abody-gold"
                    style={{ width: `${Math.round((t.sets / maxSets) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <div className="mb-4">
        <VolumeTrendCharts data={report.volumeTrend} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SectionCard title="今月のハイライト">
          <ul className="space-y-2 text-xs">
            {ai.achievements.slice(0, 4).map((a) => (
              <li key={a.title} className="flex gap-2">
                <span className="text-abody-gold">✓</span>
                <span>{a.title}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title="AIからの総評">
          <Stars value={5} />
          <p className="mt-2 text-xs leading-relaxed">{ai.overallComment}</p>
        </SectionCard>
        {trainer && ai.trainerComment ? (
          <TrainerComment name={trainer.displayName} comment={ai.trainerComment} />
        ) : (
          <SectionCard title="トレーナーコメント">
            <p className="text-xs text-abody-muted">担当トレーナー情報なし</p>
          </SectionCard>
        )}
      </div>
    </A4Page>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-abody-line p-2.5">
      <div className="text-[10px] text-abody-muted">{label}</div>
      <div className="mt-1 font-semibold text-abody-ink">{value}</div>
    </div>
  );
}
