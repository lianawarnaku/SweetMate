// Render the existing vector house, preserving transparent pixels around it.
// Usage: node scripts/house-transition/render-splash.mjs /tmp/sweetmate-feedback-tests/node_modules
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root =
  process.env.HOUSE_TEST_ROOT || resolve(import.meta.dirname, "../..");
const deps = createRequire(resolve(process.argv[2], "../package.json"));
const project = createRequire(resolve(root, "package.json"));
const { BRAND_MARK_ON_DARK } = project("./artifacts/mobile/constants/brand.js");
const folder = resolve(root, "artifacts/mobile/assets/images");
const source = (
  await readFile(resolve(folder, "sweetmate-splash-on-dark-source.svg"), "utf8")
).replaceAll("#FFFFFF", BRAND_MARK_ON_DARK);
const browser = await deps("playwright").chromium.launch({
  headless: true,
  channel: "chrome",
});
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    "<style>html,body{margin:0;background:transparent}svg{display:block}</style>" +
      source,
  );
  await page.screenshot({
    path: resolve(folder, "sweetmate-splash-on-dark.png"),
    omitBackground: true,
  });
} finally {
  await browser.close();
}
console.log("Rendered the existing house SVG on a transparent background.");
