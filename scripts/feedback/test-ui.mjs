// Component browser checks with native platform adapters and a controlled transport.
// Install playwright + esbuild in a temporary folder; pass its node_modules path.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const deps = createRequire(resolve(process.argv[2], "../package.json"));
const { build } = deps("esbuild");
const { chromium } = deps("playwright");
const root = resolve(import.meta.dirname, "../..");
const mobile = resolve(root, "artifacts/mobile");
const mobileRequire = createRequire(resolve(mobile, "package.json"));
const temp = await mkdtemp(resolve(tmpdir(), "feedback-ui-"));
const stubs = {
  "@/components/LiquidGlass": `import React from 'react'; import {View,Pressable} from 'react-native'; import {useTheme} from '@/constants/colors'; export const GlassSheet=({children,style})=><View style={[{backgroundColor:useTheme().surfaceModal},style]}>{children}</View>; export const AccentButton=({children,style,...props})=><Pressable {...props} style={[{backgroundColor:useTheme().action},style]}>{children}</Pressable>;`,
  "@/constants/colors": `export { useTheme } from 'theme-stub';`,
  "theme-stub": `import { resolveThemeTokens } from '${mobile}/constants/themeTokens.ts'; export const useTheme=()=>resolveThemeTokens(new URLSearchParams(location.search).get('appearance') === 'light' ? 'light' : 'dark', 'mono');`,
  "expo-crypto": `export const randomUUID=()=>crypto.randomUUID();`,
  "@expo/vector-icons": `export const Feather=()=>null;`,
  "react-native-safe-area-context": `export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`,
  "./SmoothPressable": `import React from 'react'; import { Pressable } from 'react-native'; export const SmoothPressable=({containerStyle,haptic,...props})=><Pressable {...props}/>;`,
  "@/lib/feedback": `export {feedbackSchema,FEEDBACK_LIMIT,FEEDBACK_SUCCESS} from '${root}/supabase/functions/_shared/feedback-schema.ts'; export const feedbackMetadata=()=>({app_version:'test',platform:'web'}); export async function sendFeedback(input) { window.submissions.push(input); await new Promise(resolve=>window.finishFeedback=resolve); if(window.failFeedback) throw Error('We could not save your feedback. Please try again.'); }`,
};
await build({
  stdin: {
    contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import {FeedbackSection} from '${mobile}/components/FeedbackSection.tsx'; document.body.style.background=new URLSearchParams(location.search).get('appearance')==='light'?'#F4F4F7':'#070708';window.submissions=[];createRoot(document.getElementById('root')).render(<FeedbackSection userId="test-user" email="tester@example.com"/>);`,
    resolveDir: mobile,
    loader: "tsx",
  },
  outfile: resolve(temp, "bundle.js"),
  bundle: true,
  jsx: "automatic",
  format: "iife",
  define: { "process.env.NODE_ENV": '"development"', __DEV__: "true" },
  plugins: [
    {
      name: "native-adapters",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in stubs) return { path: args.path, namespace: "stub" };
          if (args.path === "react-native")
            return { path: mobileRequire.resolve("react-native-web") };
          if (
            args.path === "react" ||
            args.path.startsWith("react-dom") ||
            args.path === "react/jsx-runtime"
          )
            return { path: mobileRequire.resolve(args.path) };
          if (args.path.startsWith("@/"))
            return {
              path: resolve(
                mobile,
                args.path.slice(2) +
                  (existsSync(resolve(mobile, args.path.slice(2) + ".ts"))
                    ? ".ts"
                    : ".tsx"),
              ),
            };
        });
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
          contents: stubs[args.path],
          loader: "tsx",
          resolveDir: mobile,
        }));
      },
    },
  ],
});
const html =
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>';
const server = createServer(async (req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/bundle.js" ? "application/javascript" : "text/html",
  );
  res.end(
    req.url === "/bundle.js"
      ? await readFile(resolve(temp, "bundle.js"))
      : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    `http://127.0.0.1:${server.address().port}?appearance=${process.argv[3] || "dark"}`,
  );
  await page
    .getByRole("button", { name: "Send Feedback", exact: true })
    .click();
  const message = page.getByRole("textbox", {
    name: "Feedback message, required",
  });
  const email = page.getByRole("textbox", { name: "Contact email, optional" });
  await message.waitFor();
  assert.equal(await email.inputValue(), "tester@example.com");
  await page
    .getByRole("button", { name: "Send Feedback", exact: true })
    .last()
    .click();
  await page
    .getByText("Please enter your feedback.", { exact: true })
    .waitFor();
  await message.fill("A useful suggestion");
  await email.fill("bad@");
  await page
    .getByRole("button", { name: "Send Feedback", exact: true })
    .last()
    .click();
  await page
    .getByText("Enter a valid email address or leave it blank.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.evaluate(() => window.submissions.length), 0);
  assert.equal(await message.getAttribute("maxlength"), "1500");
  await email.fill("");
  await page.getByRole("button", { name: "Bug", exact: true }).click();
  await page.screenshot({
    path: "/tmp/homie-feedback-form.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Send Feedback", exact: true })
    .last()
    .dblclick({ delay: 10 });
  assert.equal(await page.evaluate(() => window.submissions.length), 1);
  assert.equal(
    await page
      .getByRole("button", { name: "Sending feedback" })
      .getAttribute("aria-disabled"),
    "true",
  );
  await page.evaluate(() => {
    window.failFeedback = true;
    window.finishFeedback();
  });
  await page
    .getByText("We could not save your feedback. Please try again.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await message.inputValue(), "A useful suggestion");
  await page
    .getByRole("button", { name: "Send Feedback", exact: true })
    .last()
    .click();
  const submitted = await page.evaluate(() => window.submissions);
  assert.equal(
    submitted[0].request_id,
    submitted[1].request_id,
    "retry must reuse request ID",
  );
  assert.equal(submitted[0].contact_email, "");
  assert.equal(submitted[0].category, "bug");
  await page.evaluate(() => {
    window.failFeedback = false;
    window.finishFeedback();
  });
  await page
    .getByText("Your suggestion has been sent to the team.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Send Feedback", exact: true })
    .click();
  assert.equal(await message.inputValue(), "");
  await page.setViewportSize({ width: 320, height: 568 });
  await message.waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "no narrow-screen horizontal overflow",
  );
  await page.getByRole("button", { name: "Close feedback form" }).click();
  await message.waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.activeElement?.textContent === "Send Feedback",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: form opening, email prefill/removal, validation, character cap, category, loading, duplicate prevention, failed retry ID, success/reset, narrow viewport, focus restoration.",
  );
} catch (error) {
  console.error("Browser errors:", errors);
  console.error((await page.locator("body").innerText()).slice(0, 1800));
  await page.screenshot({ path: "/tmp/v2-feedback-test-failure.png" });
  throw error;
} finally {
  await browser.close();
  server.close();
  await rm(temp, { recursive: true, force: true });
}
