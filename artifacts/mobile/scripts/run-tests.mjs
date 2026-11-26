import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => entry.isDirectory()
    ? discover(resolve(directory, entry.name))
    : entry.name.endsWith(".test.ts") ? [resolve(directory, entry.name)] : []));
  return files.flat().sort();
}
const files = await discover(resolve(root, "lib"));
if (!files.length) throw new Error("No mobile test programs found.");
const failures = [];
for (const file of files) {
  const name = relative(root, file);
  process.stdout.write(`\nRUN ${name}\n`);
  const result = spawnSync(process.execPath, ["--experimental-strip-types", file], {
    cwd: root, stdio: "inherit", timeout: 120_000,
  });
  if (result.status !== 0 || result.error) {
    failures.push(name);
    if (result.error) process.stderr.write(`${result.error.message}\n`);
    process.stderr.write(`FAIL ${name}\n`);
  } else process.stdout.write(`PASS ${name}\n`);
}
process.stdout.write(`\nMobile tests: ${files.length - failures.length}/${files.length} passed.\n`);
if (failures.length) {
  process.stderr.write(`Failed programs: ${failures.join(", ")}\n`);
  process.exitCode = 1;
}
