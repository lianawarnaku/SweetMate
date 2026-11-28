import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  fetchAllRows,
  fetchAllRowsByIds,
  type PageQuery,
} from "./pagination.ts";

function fixture(
  total: number,
  cap: number,
  options: {
    failAt?: number;
    repeat?: boolean;
    afterPage?: (page: number) => void;
  } = {},
) {
  let source = Array.from({ length: total }, (_, i) => ({
    id: String(i).padStart(6, "0"),
  }));
  let calls = 0;
  const orders: string[] = [];
  const query = () => {
    let after: string | undefined,
      before: string | undefined,
      count = 250;
    const builder: PageQuery<{ id: string }> = {
      order: (column, { ascending }) => {
        orders.push(`${column}:${ascending}`);
        return builder;
      },
      gt: (_column, value) => {
        after = String(value);
        return builder;
      },
      lt: (_column, value) => {
        before = String(value);
        return builder;
      },
      or: () => {
        throw Error("Unexpected composite filter");
      },
      limit: (value) => {
        count = value;
        return builder;
      },
      abortSignal: () => builder,
      then: (yes, no) => {
        calls++;
        if (options.failAt === calls)
          return Promise.resolve({
            data: null,
            error: {
              code: "offline",
              message: "offline",
              details: "",
              hint: "",
            },
          }).then(yes, no);
        const data = source
          .filter(
            (row) =>
              options.repeat ||
              ((!after || row.id > after) && (!before || row.id < before)),
          )
          .slice(0, Math.min(cap, count));
        options.afterPage?.(calls);
        return Promise.resolve({ data, error: null }).then(yes, no);
      },
    };
    return builder;
  };
  return {
    query,
    orders,
    get calls() {
      return calls;
    },
    removeFirst: () => {
      source.shift();
    },
  };
}
for (const [count, cap] of [
  [0, 1000],
  [1, 1000],
  [250, 1000],
  [1000, 1000],
  [1001, 1000],
  [2573, 1000],
  [1207, 71],
  [12, 1],
]) {
  const f = fixture(count, cap),
    result = await fetchAllRows(f.query);
  assert.equal(result.error, null);
  assert.equal(result.data?.length, count);
  assert.equal(new Set(result.data?.map((row) => row.id)).size, count);
  assert(f.orders.every((order) => order === "id:true"));
}
{
  const f = fixture(1207, 71, { failAt: 4 }),
    result = await fetchAllRows(f.query);
  assert.equal(
    result.data,
    null,
    "a later-page failure must not publish a partial collection",
  );
  assert.equal(result.error?.code, "offline");
}
{
  let current = true;
  const f = fixture(1207, 71, {
    afterPage: () => {
      current = false;
    },
  });
  const result = await fetchAllRows(f.query, undefined, {
    isCurrent: () => current,
  });
  assert.equal(result.data, null);
  assert.equal(result.error?.code, "PAGINATION_CANCELLED");
  assert.equal(f.calls, 1);
}
{
  const abort = new AbortController(),
    f = fixture(1207, 71, { afterPage: () => abort.abort() });
  const result = await fetchAllRows(f.query, undefined, {
    signal: abort.signal,
  });
  assert.equal(result.data, null);
  assert.equal(result.error?.code, "PAGINATION_CANCELLED");
}
{
  const f = fixture(12, 3, { repeat: true }),
    result = await fetchAllRows(f.query);
  assert.equal(result.data, null);
  assert.equal(result.error?.code, "PAGINATION_CURSOR");
  assert.equal(f.calls, 2, "a broken server cursor must not loop forever");
}
{
  const f = fixture(12, 3, {
    afterPage: (page) => {
      if (page === 1) f.removeFirst();
    },
  });
  const result = await fetchAllRows(f.query);
  assert.equal(
    result.data?.length,
    12,
    "deleting a row before the cursor cannot shift an unread row out of the next page",
  );
}
{
  const requested: string[][] = [];
  const ids = Array.from({ length: 1207 }, (_, i) =>
    String(i).padStart(6, "0"),
  ).reverse();
  const result = await fetchAllRowsByIds<{ id: string }>(
    [...ids, ids[0]],
    (batch) => {
      requested.push(batch);
      let after = "";
      const q: any = {
        order: () => q,
        gt: (_: string, value: string) => {
          after = value;
          return q;
        },
        limit: () => q,
        then: (yes: any, no: any) =>
          Promise.resolve({
            data: batch
              .filter((id) => id > after)
              .slice(0, 3)
              .map((id) => ({ id })),
            error: null,
          }).then(yes, no),
      };
      return q;
    },
  );
  assert.equal(result.error, null);
  assert.equal(result.data?.length, 1207);
  assert(requested.every((batch) => batch.length <= 100));
  assert.deepEqual(
    result.data?.map((row) => row.id),
    [...new Set(ids)].sort(),
  );
}
// Full collections must be paged; unique reads and single-row mutation
// representations are separate contracts. Inspect the actual client callsites.
const violations: string[] = [];
for (const directory of ["context", "hooks", "components", "app", "lib"]) {
  const scan = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        scan(path);
        continue;
      }
      if (!/\.tsx?$/.test(path) || path.endsWith(".test.ts")) continue;
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "select" &&
          node.expression.expression.getText(source).includes("supabase")
        ) {
          let ancestor: ts.Node | undefined = node,
            paged = false,
            unique = false;
          while (ancestor && !ts.isSourceFile(ancestor)) {
            if (ts.isCallExpression(ancestor)) {
              if (
                ["fetchAllRows", "fetchAllRowsByIds"].includes(
                  ancestor.expression.getText(source),
                )
              )
                paged = true;
              if (
                ts.isPropertyAccessExpression(ancestor.expression) &&
                ["single", "maybeSingle"].includes(
                  ancestor.expression.name.text,
                )
              )
                unique = true;
            }
            ancestor = ancestor.parent;
          }
          if (!paged && !unique)
            violations.push(
              `${path}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`,
            );
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  scan(directory);
}
assert.deepEqual(
  violations,
  [],
  "a collection SELECT must not silently fall back to a single capped response",
);
console.log(
  "Pagination passes >1,000 rows, short server pages, exact page boundaries, atomic failure/cancellation, deletion before the cursor, bounded IN filters and client-read coverage.",
);
