/**
 * Supabase/PostgREST ページング取得（1000件上限対策）
 *
 * 単発 .select() は禁止。必ず fetchAllChecked を使い、count と fetched の一致を検証する。
 */

const PAGE_SIZE = 1000;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} table
 * @param {string} select
 * @param {(q: import('@supabase/supabase-js').PostgrestFilterBuilder<any, any, any>) => import('@supabase/supabase-js').PostgrestFilterBuilder<any, any, any>} [apply]
 */
export async function fetchAll(supabase, table, select, apply) {
  let from = 0;
  const out = [];
  for (;;) {
    let q = supabase.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

/**
 * count（同一フィルタ）と fetched 件数が一致しない場合は throw。
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} table
 * @param {string} select
 * @param {(q: import('@supabase/supabase-js').PostgrestFilterBuilder<any, any, any>) => import('@supabase/supabase-js').PostgrestFilterBuilder<any, any, any>} [apply]
 * @param {string} [label]
 * @returns {Promise<{ rows: any[], count: number, fetched: number }>}
 */
export async function fetchAllChecked(supabase, table, select, apply, label = table) {
  let countQ = supabase.from(table).select("*", { count: "exact", head: true });
  if (apply) countQ = apply(countQ);
  const { count, error: countError } = await countQ;
  if (countError) throw countError;
  if (count == null) {
    throw new Error(`fetchAllChecked(${label}): count が null（取得失敗）`);
  }

  const rows = await fetchAll(supabase, table, select, apply);
  const fetched = rows.length;

  if (count !== fetched) {
    throw new Error(`fetchAllChecked(${label}): count=${count} fetched=${fetched}`);
  }

  return { rows, count, fetched };
}
