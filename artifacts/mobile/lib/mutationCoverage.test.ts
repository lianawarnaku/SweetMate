import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
const transport = readFileSync("lib/durableMutationFetch.ts", "utf8"),
  migration = readFileSync(
    "../../supabase/migrations/202611270001_durable_app_operations.sql",
    "utf8",
  );
const rpcNames = new Set<string>(),
  tables = new Set<string>();
function walk(path: string) {
  for (const file of readdirSync(path, { withFileTypes: true })) {
    if (file.name === "node_modules" || file.name.startsWith(".")) continue;
    const full = join(path, file.name);
    if (file.isDirectory()) {
      walk(full);
      continue;
    }
    if (
      !/\.tsx?$/.test(file.name) ||
      file.name.endsWith(".test.ts") ||
      file.name === "durableMutationFetch.ts"
    )
      continue;
    const source = ts.createSourceFile(
      full,
      readFileSync(full, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        if (node.expression.name.text === "rpc")
          rpcNames.add(node.arguments[0].text);
        if (node.expression.name.text === "from") {
          let parent: ts.Node = node;
          while (
            parent.parent &&
            (ts.isPropertyAccessExpression(parent.parent) ||
              ts.isCallExpression(parent.parent))
          )
            parent = parent.parent;
          if (/\.(upsert|insert|update|delete)\(/.test(parent.getText(source)))
            tables.add(node.arguments[0].text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
for (const dir of ["app", "components", "context", "hooks", "lib"]) walk(dir);
for (const name of rpcNames)
  assert(
    transport.includes('"' + name + '"'),
    `Mutation/read RPC ${name} needs an explicit durable or specialized policy`,
  );
for (const name of tables) {
  assert(
    transport.includes('"' + name + '"'),
    `Table mutation ${name} bypasses the journal`,
  );
  assert(migration.includes("'" + name + "'"), name);
}
for (const name of [
  "finish_household_setup",
  "restart_chore_chart_review",
  "update_personal_schedule_task",
  "create_household_random_task",
])
  assert(migration.includes("'" + name + "'"));
assert(migration.includes("security invoker"));
assert(migration.includes("pg_advisory_xact_lock"));
assert(migration.includes("request_hash"));
assert(migration.includes("on delete cascade"));
console.log(
  `Mutation boundary coverage passed: ${rpcNames.size} RPC names and ${tables.size} concrete table-write targets have explicit policies`,
);
