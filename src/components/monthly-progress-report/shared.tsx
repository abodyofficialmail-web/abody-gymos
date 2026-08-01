import type { MonthlyProgressReport } from "@/lib/monthlyProgressReport/types";
import { SectionCard, Stars } from "./ui";

export function PhotoComparison({
  oldest,
  previous,
  current,
  before,
  after,
}: {
  oldest?: MonthlyProgressReport["photos"]["oldest"];
  previous?: MonthlyProgressReport["photos"]["previous"];
  current?: MonthlyProgressReport["photos"]["current"];
  before?: MonthlyProgressReport["photos"]["before"];
  after?: MonthlyProgressReport["photos"]["after"];
}) {
  const cols = [
    { set: oldest || before || null, role: "最古" },
    { set: previous || null, role: "先月" },
    { set: current || after || null, role: "今月" },
  ];
  const angles = [
    { key: "front" as const, label: "正面", pick: (s: NonNullable<(typeof cols)[0]["set"]>) => s.angles.frontUrl },
    { key: "side" as const, label: "側面", pick: (s: NonNullable<(typeof cols)[0]["set"]>) => s.angles.sideUrl },
    { key: "back" as const, label: "背面", pick: (s: NonNullable<(typeof cols)[0]["set"]>) => s.angles.backUrl },
  ];

  return (
    <SectionCard title="体型比較">
      <p className="mb-3 text-center text-xs text-abody-muted">
        {cols.map((c) => (c.set ? `${c.role}（${c.set.label}）` : `${c.role}：—`)).join(" ／ ")}
      </p>
      <div className="space-y-3">
        {angles.map((angle) => (
          <div key={angle.key} className="rounded-xl bg-[#2f3338] p-3 text-white">
            <div className="mb-2 text-center text-xs font-semibold tracking-wide text-abody-gold">{angle.label}</div>
            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5">
              {cols.map((c, idx) => (
                <div key={c.role} className="contents">
                  <div className="overflow-hidden rounded-lg bg-black/30">
                    {c.set && angle.pick(c.set) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={angle.pick(c.set)!} alt={`${angle.label} ${c.role}`} className="aspect-[3/4] w-full object-contain object-top" />
                    ) : (
                      <div className="flex aspect-[3/4] items-center justify-center text-[10px] text-white/40">未登録</div>
                    )}
                    <div className="py-1 text-center text-[10px] text-white/80">
                      {c.role}
                      {c.set ? <div className="text-[9px] text-white/50">{c.set.label}</div> : null}
                    </div>
                  </div>
                  {idx < cols.length - 1 ? <div className="text-center text-lg text-abody-gold">›</div> : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function AIComment({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-abody-line bg-[#FAFAF8] p-4">
      {title ? <div className="mb-2 text-xs font-semibold tracking-wide text-abody-gold">{title}</div> : null}
      <div className="text-sm leading-relaxed text-abody-ink">{children}</div>
    </div>
  );
}

export function TrainerComment({
  name,
  comment,
}: {
  name: string;
  comment: string;
}) {
  return (
    <SectionCard title="トレーナーからのコメント">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-abody-gold-soft text-sm font-semibold text-abody-gold">
          {name.slice(0, 1)}
        </div>
        <div className="flex-1">
          <p className="text-sm leading-relaxed text-abody-ink">{comment}</p>
          <div className="mt-3 text-right text-xs text-abody-muted">担当トレーナー {name}</div>
        </div>
      </div>
    </SectionCard>
  );
}

export function GoalCard({
  title,
  detail,
  target,
}: {
  title: string;
  detail: string;
  target: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-abody-line px-4 py-3">
      <div>
        <div className="text-sm font-semibold text-abody-ink">{title}</div>
        <div className="mt-0.5 text-xs text-abody-muted">{detail}</div>
      </div>
      <div className="shrink-0 text-sm font-semibold text-abody-gold">{target}</div>
    </div>
  );
}

export function PostureGrid({
  items,
}: {
  items: MonthlyProgressReport["ai"]["postureItems"];
}) {
  return (
    <SectionCard title="AI姿勢分析">
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {items.map((item) => (
          <div key={item.key} className="rounded-xl border border-abody-line p-3">
            <div className="text-[11px] font-medium text-abody-muted">{item.label}</div>
            <div className="mt-1">
              <Stars value={item.stars} />
            </div>
            <div className="mt-2 text-xs font-semibold text-abody-gold">{item.summary}</div>
            <p className="mt-1 text-[11px] leading-snug text-abody-muted">{item.detail}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
