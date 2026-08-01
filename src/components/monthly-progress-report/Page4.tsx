import type { MonthlyProgressReport } from "@/lib/monthlyProgressReport/types";
import { GoalCard, TrainerComment } from "./shared";
import { A4Page, ReportHeader, SectionCard, Stars } from "./ui";

export function Page4({ report }: { report: MonthlyProgressReport }) {
  const { member, meta, ai, trainer } = report;
  return (
    <A4Page>
      <ReportHeader
        title={`${meta.nextMonthLabel}の目標 & プラン`}
        subtitle="NEXT MONTH PLAN"
        memberName={member.name}
        tenureMonths={member.tenureMonths}
        yearMonthLabel={meta.yearMonthLabel}
      />
      <p className="-mt-2 mb-4 text-center text-xs text-abody-muted">
        さらにレベルアップするために、{meta.nextMonthLabel}の作戦をデータから組み立てました。
      </p>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <SectionCard title={`${meta.nextMonthLabel}の重点目標`}>
          <div className="space-y-2">
            {ai.goals.map((g) => (
              <GoalCard key={g.title} title={g.title} detail={g.detail} target={g.target} />
            ))}
          </div>
        </SectionCard>
        <SectionCard title="AIが提案する作戦プラン">
          <div className="space-y-3">
            {ai.strategies.map((s) => (
              <div key={s.title} className="rounded-xl border border-abody-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{s.title}</div>
                  <Stars value={s.priority} />
                </div>
                <p className="mt-1 text-xs text-abody-muted">{s.detail}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title={`${meta.nextMonthLabel}の習慣チェックリスト`} className="mb-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {ai.habits.map((h) => (
            <div key={h.key} className="rounded-xl border border-abody-line p-3 text-center">
              <div className="mx-auto mb-2 flex h-5 w-5 items-center justify-center rounded border border-abody-line" />
              <div className="text-sm font-semibold">{h.title}</div>
              <div className="mt-1 text-[11px] text-abody-muted">{h.detail}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="このペースで取り組んだ場合の期待できる変化" className="mb-4">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          {ai.timeline.map((t, i) => (
            <div
              key={t.label}
              className={
                i === ai.timeline.length - 1
                  ? "rounded-xl border border-abody-gold bg-abody-gold-soft p-3"
                  : "rounded-xl border border-abody-line p-3"
              }
            >
              <div className="text-xs font-semibold text-abody-gold">{t.label}</div>
              <Stars value={t.stars} />
              <p className="mt-2 text-xs leading-relaxed text-abody-ink">{t.detail}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {trainer && ai.closingTrainerComment ? (
        <TrainerComment name={trainer.displayName} comment={ai.closingTrainerComment} />
      ) : trainer && ai.trainerComment ? (
        <TrainerComment name={trainer.displayName} comment={ai.trainerComment} />
      ) : null}

      <div className="mt-auto pt-6 text-center text-[11px] text-abody-muted">
        あなたの努力は必ず結果につながります。{meta.nextMonthLabel}も一緒に積み上げましょう。
      </div>
    </A4Page>
  );
}
