import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function SectionCard({
  title,
  icon,
  children,
  className,
}: {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-abody-line bg-white p-5", className)}>
      {title ? (
        <div className="mb-4 flex items-center gap-2">
          {icon}
          <h3 className="text-[15px] font-semibold tracking-wide text-abody-ink">{title}</h3>
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  hint,
  achieved,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  achieved?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-abody-line bg-white p-4">
      <div className="text-[11px] font-medium tracking-wider text-abody-muted">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-abody-ink">{value}</span>
        {unit ? <span className="text-xs text-abody-muted">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1 text-[11px] text-abody-muted">{hint}</div> : null}
      {achieved ? (
        <div className="mt-2 inline-flex rounded-full bg-abody-gold-soft px-2 py-0.5 text-[10px] font-semibold text-abody-gold">
          達成
        </div>
      ) : null}
    </div>
  );
}

export function Stars({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="flex gap-0.5 text-abody-gold" aria-label={`${value}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? "opacity-100" : "opacity-25"}>
          ★
        </span>
      ))}
    </div>
  );
}

export function ReportHeader({
  title,
  subtitle,
  memberName,
  tenureMonths,
  yearMonthLabel,
}: {
  title: string;
  subtitle?: string;
  memberName: string;
  tenureMonths: number;
  yearMonthLabel: string;
}) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="text-[11px] font-semibold tracking-[0.22em] text-abody-gold">ABODY PERSONAL GYM</div>
      <div className="flex-1 text-center">
        <div className="text-sm font-medium text-abody-gold">{yearMonthLabel}</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-abody-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-xs tracking-widest text-abody-gold">{subtitle}</p> : null}
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold text-abody-ink">{memberName} 様</div>
        <div className="mt-1 inline-flex rounded-full border border-abody-gold/40 bg-abody-gold-soft px-2.5 py-0.5 text-[10px] text-abody-gold">
          Abody歴 {tenureMonths}ヶ月
        </div>
      </div>
    </header>
  );
}

export function A4Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "monthly-report-page mx-auto flex min-h-[297mm] w-[210mm] flex-col bg-white p-[12mm] text-abody-ink shadow-sm print:shadow-none",
        className
      )}
    >
      {children}
    </div>
  );
}
