export function BookingStopGlanceMark({ label, prominent = false }: { label: string; prominent?: boolean }) {
  if (prominent) {
    return (
      <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-950">{label}</div>
    );
  }
  return (
    <span className="inline-flex rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-950">{label}</span>
  );
}
