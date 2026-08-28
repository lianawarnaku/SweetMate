import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const sourceRoots = [join(root, "app"), join(root, "components"), join(root, "context"), join(root, "hooks"), join(root, "lib")];
const extensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const prohibited = [
  ["React Native alert", "Alert" + ".alert("],
  ["React Native prompt", "Alert" + ".prompt("],
  ["native action sheet", "ActionSheet" + "IOS."],
  ["browser alert", "window" + ".alert("],
  ["browser confirm", "window" + ".confirm("],
  ["browser prompt", "window" + ".prompt("],
  ["Android native toast", "Toast" + "Android."],
] as const;

function filesIn(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesIn(path) : extensions.has(extname(path)) ? [path] : [];
  });
}

const violations = sourceRoots.flatMap(filesIn).flatMap((file) => {
  const source = readFileSync(file, "utf8");
  return prohibited
    .filter(([, token]) => source.includes(token))
    .map(([label]) => `${relative(root, file)}: ${label}`);
});

const glassPopupComponents = [
  "AppPopupProvider.tsx",
  "ActionMenuModal.tsx",
  "QuickGuideModal.tsx",
  "AnalyticsConsentManager.tsx",
];
for (const name of glassPopupComponents) {
  const source = readFileSync(join(root, "components", name), "utf8");
  if (!source.includes("GlassModalSurface")) {
    violations.push(`components/${name}: custom popup must use the shared glass surface`);
  }
}

const glassSurface = readFileSync(join(root, "components", "GlassModalSurface.tsx"), "utf8");
if (!glassSurface.includes("<BlurView")) {
  violations.push("components/GlassModalSurface.tsx: shared popup surface must retain native blur");
}

if (violations.length) throw new Error(`Prohibited app-controlled native popups:\n${violations.join("\n")}`);
console.log("native popup audit passed");
