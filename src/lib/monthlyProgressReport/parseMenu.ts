/** カルテ content からメニュー種目・重量を抽出 */
export function parseMenu(content: string): { name: string; sets: number[] }[] {
  const exercises: { name: string; sets: number[] }[] = [];
  let cur: { name: string; sets: number[] } | null = null;
  for (const line of String(content || "").split("\n")) {
    const em = line.match(/^■\s*(.+)$/);
    if (em) {
      cur = { name: em[1]!.trim(), sets: [] };
      exercises.push(cur);
      continue;
    }
    if (!cur) continue;
    const sm = line.match(/(\d+(?:\.\d+)?)\s*kg/);
    if (sm) cur.sets.push(Number(sm[1]));
  }
  return exercises.filter((e) => e.name && e.name !== "その他");
}
