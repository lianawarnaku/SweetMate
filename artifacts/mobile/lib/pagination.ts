import type { PostgrestError } from "@supabase/supabase-js";

export const COLLECTION_PAGE_SIZE = 250;
export type CursorOrder = { column: string; ascending?: boolean };
export type CollectionLoadError = Pick<
  PostgrestError,
  "code" | "message" | "details" | "hint"
>;
type PageResult<Row> = {
  data: Row[] | null;
  error: CollectionLoadError | null;
};
export type PageQuery<Row> = PromiseLike<PageResult<Row>> & {
  order(column: string, options: { ascending: boolean }): PageQuery<Row>;
  limit(count: number): PageQuery<Row>;
  gt(column: string, value: unknown): PageQuery<Row>;
  lt(column: string, value: unknown): PageQuery<Row>;
  or(filter: string): PageQuery<Row>;
  abortSignal(signal: AbortSignal): PageQuery<Row>;
};
const failure = (code: string, message: string): CollectionLoadError => ({
  code,
  message,
  details: "",
  hint: "",
});
function literal(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number")
    throw failure(
      "PAGINATION_CURSOR",
      "A collection cursor is missing. Please refresh and try again.",
    );
  return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
/**
 * Read a complete collection with a fresh, identically scoped query per page.
 * The non-null, immutable order columns MUST end in a unique key (including
 * composite keys). Keyset paging avoids offset skips when earlier rows disappear.
 * Stop only on an empty page: a server cap can be lower than our requested size.
 * Never expose a partial snapshot on error, cancellation or a repeated cursor.
 */
export async function fetchAllRows<Row>(
  query: () => PageQuery<Row>,
  order: readonly CursorOrder[] = [{ column: "id" }],
  options: {
    signal?: AbortSignal;
    isCurrent?: () => boolean;
    pageSize?: number;
  } = {},
): Promise<PageResult<Row>> {
  const rows: Row[] = [],
    seen = new Set<string>();
  let cursor: unknown[] | null = null;
  const pageSize = options.pageSize ?? COLLECTION_PAGE_SIZE;
  try {
    if (
      !order.length ||
      order.some((key) => !/^[a-z_][a-z0-9_]*$/.test(key.column)) ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1
    )
      throw failure(
        "PAGINATION_CONFIG",
        "This collection could not be loaded.",
      );
    while (true) {
      if (options.signal?.aborted || options.isCurrent?.() === false)
        throw failure(
          "PAGINATION_CANCELLED",
          "This collection load was cancelled.",
        );
      let page = query();
      for (const key of order)
        page = page.order(key.column, { ascending: key.ascending !== false });
      if (cursor) {
        if (order.length === 1)
          page =
            order[0].ascending === false
              ? page.lt(order[0].column, cursor[0])
              : page.gt(order[0].column, cursor[0]);
        else
          page = page.or(
            order
              .map((key, index) => {
                const comparison = `${key.column}.${key.ascending === false ? "lt" : "gt"}.${literal(cursor![index])}`;
                return index
                  ? `and(${order
                      .slice(0, index)
                      .map(
                        (prior, i) =>
                          `${prior.column}.eq.${literal(cursor![i])}`,
                      )
                      .join(",")},${comparison})`
                  : comparison;
              })
              .join(","),
          );
      }
      page = page.limit(pageSize);
      if (options.signal) page = page.abortSignal(options.signal);
      const result = await page;
      if (options.signal?.aborted || options.isCurrent?.() === false)
        throw failure(
          "PAGINATION_CANCELLED",
          "This collection load was cancelled.",
        );
      if (result.error) return { data: null, error: result.error };
      if (!Array.isArray(result.data))
        throw failure(
          "PAGINATION_RESPONSE",
          "This collection did not return a complete response. Please try again.",
        );
      if (!result.data.length) return { data: rows, error: null };
      for (const row of result.data) {
        const values = order.map(
          (key) => (row as Record<string, unknown>)[key.column],
        );
        values.forEach(literal);
        const identity = JSON.stringify(values);
        if (seen.has(identity))
          throw failure(
            "PAGINATION_CURSOR",
            "This collection changed while loading. Please refresh and try again.",
          );
        seen.add(identity);
        rows.push(row);
        cursor = values;
      }
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error
    )
      return { data: null, error: error as CollectionLoadError };
    return {
      data: null,
      error: failure(
        "PAGINATION_UNAVAILABLE",
        "This collection could not finish loading. Check your connection and try again.",
      ),
    };
  }
}

/**
 * Bound IN filters as well as responses, so many households/IDs cannot overflow
 * a URL. Order must start with the filtered ID column; sorting the partitions
 * then preserves that same global order when their complete pages are joined.
 */
export async function fetchAllRowsByIds<Row>(
  ids: readonly string[],
  query: (ids: string[]) => PageQuery<Row>,
  order: readonly CursorOrder[] = [{ column: "id" }],
  options: Parameters<typeof fetchAllRows<Row>>[2] = {},
): Promise<PageResult<Row>> {
  const rows: Row[] = [];
  const unique = [...new Set(ids)].sort();
  if (order[0]?.ascending === false) unique.reverse();
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    const result = await fetchAllRows(() => query(batch), order, options);
    if (result.error) return { data: null, error: result.error };
    rows.push(...result.data!);
  }
  return { data: rows, error: null };
}
