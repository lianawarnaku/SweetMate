// Run with: node scripts/house-transition/test-ui.mjs /tmp/sweetmate-feedback-tests/node_modules
// Uses real React Native Web, SVG and Reanimated web; only theme, accessibility
// preferences, and the native splash API are adapted for the browser harness.
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const root =
  process.env.HOUSE_TEST_ROOT || resolve(import.meta.dirname, "../..");
const mobile = resolve(root, "artifacts/mobile");
const mobileRequire = createRequire(resolve(mobile, "package.json"));
const deps = createRequire(resolve(process.argv[2], "../package.json"));
const { build } = deps("esbuild");
const { chromium } = deps("playwright");
const babel = mobileRequire("@babel/core");
const workletsPlugin = mobileRequire.resolve("react-native-worklets/plugin");
const temp = await mkdtemp(resolve(tmpdir(), "house-transition-"));
const stubs = {
  "@/constants/colors": `export const useTheme=()=>({background:'#070708',primary:'#eeeeee'});`,
  "@/hooks/useAccessibilityPreferences": `export const useAccessibilityPreferences=()=>({reduceMotion:new URLSearchParams(location.search).has('reduceMotion')});`,
  "expo-splash-screen": `export const hideAsync=async()=>{window.splashHides=(window.splashHides||0)+1;};`,
};
await build({
  stdin: {
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {View,ScrollView,Text} from 'react-native';import {HouseTransition,TransitionHouse,useHouseTransitionRefresh} from '${mobile}/components/HouseTransition.tsx';
    function Destination({anchor}) { const refresh=useHouseTransitionRefresh(); return <ScrollView testID="destination-scroll" onScroll={refresh} scrollEventThrottle={16} onContentSizeChange={refresh} contentContainerStyle={{paddingTop:84,alignItems:'center'}}>{anchor&&<TransitionHouse size={86}/>}<Text>Destination ready</Text><View style={{height:1400}}/></ScrollView>; }
    function App(){const[loading,setLoading]=useState(!new URLSearchParams(location.search).has('immediate'));const[anchor,setAnchor]=useState(true);const[screen,setScreen]=useState('signin');const[updates,setUpdates]=useState(0);window.loading=setLoading;window.anchor=setAnchor;window.destination=setScreen;window.rerender=()=>setUpdates(x=>x+1);return <View style={{width:390,height:844}}><HouseTransition loading={loading} destination={screen} hasHouse={screen!=='app'}><Destination anchor={anchor}/></HouseTransition></View>;}createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: mobile,
    loader: "tsx",
  },
  outfile: resolve(temp, "bundle.js"),
  bundle: true,
  jsx: "automatic",
  format: "iife",
  mainFields: ["react-native", "browser", "module", "main"],
  resolveExtensions: [
    ".web.tsx",
    ".web.ts",
    ".web.jsx",
    ".web.js",
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    ".json",
  ],
  define: { "process.env.NODE_ENV": '"development"', __DEV__: "true" },
  plugins: [
    {
      name: "web-adapters",
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
          if (args.path.startsWith("@/")) {
            const name = resolve(mobile, args.path.slice(2));
            return { path: name + (existsSync(name + ".ts") ? ".ts" : ".tsx") };
          }
        });
        builder.onLoad(
          {
            filter:
              /(HouseTransition\.tsx$|react-native-(worklets|reanimated).*\.[jt]sx?$)/,
          },
          async (args) => ({
            contents: babel.transformSync(await readFile(args.path, "utf8"), {
              filename: args.path,
              configFile: false,
              babelrc: false,
              parserOpts: {
                plugins: args.path.endsWith(".tsx")
                  ? ["typescript", "jsx"]
                  : ["typescript"],
              },
              plugins: [workletsPlugin],
            }).code,
            loader: args.path.endsWith(".tsx") ? "tsx" : "ts",
            resolveDir: dirname(args.path),
          }),
        );
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
          contents: stubs[args.path],
          loader: "tsx",
          resolveDir: mobile,
        }));
      },
    },
  ],
});
const server = createServer(async (req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/bundle.js" ? "application/javascript" : "text/html",
  );
  res.end(
    req.url === "/bundle.js"
      ? await readFile(resolve(temp, "bundle.js"))
      : '<!doctype html><style>body{margin:0}</style><div id="root"></div><script>window.process={env:{NODE_ENV:"development"}};window.global=window;</script><script src="/bundle.js"></script>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("page console:", m.text());
});
const base = `http://127.0.0.1:${server.address().port}`;
async function sameHouse() {
  assert.equal(
    await page.evaluate(
      () => document.querySelector("svg") === window.originalHouse,
    ),
    true,
    "house must not remount",
  );
  assert.equal(await page.locator("svg").count(), 1);
}
async function box() {
  return page.locator("svg").boundingBox();
}
async function docked() {
  await page.waitForFunction(() => {
    const h = document.querySelector("svg")?.getBoundingClientRect();
    return h && Math.abs(h.width - 86) < 0.5 && Math.abs(h.top - 84) < 0.5;
  });
}
try {
  await page.goto(base);

  await page.waitForFunction(() => window.splashHides === 1, null, {
    timeout: 10000,
  });
  await page.evaluate(
    () => (window.originalHouse = document.querySelector("svg")),
  );
  const initial = await box();
  assert.equal(initial.width, 224);
  assert.equal(initial.y, 310);
  // A long restore leaves exactly the same, stationary mark on screen.
  await page.waitForTimeout(1400);
  await sameHouse();
  assert.deepEqual(await box(), initial);
  await page.evaluate(() => {
    window.anchor(false);
    window.loading(false);
  });
  await page.waitForTimeout(350);
  await sameHouse();
  assert.deepEqual(await box(), initial);
  await page.evaluate(() => {
    window.motionSamples = [];
    const start = performance.now();
    const sample = () => {
      const house = document.querySelector("svg");
      const bounds = house.getBoundingClientRect();
      window.motionSamples.push({
        width: bounds.width,
        y: bounds.top,
        opacity: Number(getComputedStyle(house.parentElement).opacity),
      });
      if (performance.now() - start < 450) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.anchor(true);
  });
  await docked();
  await sameHouse();
  const samples = await page.evaluate(() => window.motionSamples);
  assert(
    samples.some((sample) => sample.width > 90 && sample.width < 220),
    "house must animate through intermediate sizes",
  );
  assert(
    samples.every((sample) => sample.opacity > 0.99),
    "house must stay visible during motion",
  );
  assert(
    samples.every(
      (sample, index) => index === 0 || sample.y <= samples[index - 1].y + 0.5,
    ),
    "house must move smoothly toward the destination without jumping back",
  );
  await page.evaluate(() => window.rerender());
  await sameHouse();
  assert.equal(await page.evaluate(() => window.splashHides), 1);
  // The same house follows the actual scroll container after docking.
  await page
    .getByTestId("destination-scroll")
    .evaluate((node) => (node.scrollTop = 40));
  await page.waitForFunction(
    () =>
      Math.abs(document.querySelector("svg").getBoundingClientRect().top - 44) <
      1,
  );
  await sameHouse();
  await page.evaluate(() => {
    window.loading(true);
    window.destination("preferences");
  });
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector("svg").getBoundingClientRect().width - 224,
      ) < 0.5,
  );
  await page.evaluate(() => window.loading(false));
  await docked();
  await sameHouse();
  await page.evaluate(() => {
    window.anchor(false);
    window.destination("app");
  });
  await page.waitForFunction(() => {
    const svg = document.querySelector("svg");
    return getComputedStyle(svg.parentElement).opacity === "0";
  });
  await sameHouse();
  await page.goto(base + "?immediate");
  await docked();
  assert.equal(await page.evaluate(() => window.splashHides), 1);
  await page.goto(base + "?immediate&reduceMotion");
  await docked();
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: "/private/tmp/sweetmate-house-transition.png",
  });
  console.log(
    "PASS: delayed/immediate readiness, late destination layout, stationary waiting, one continuous SVG, no remount on rerender, scrolling, repeated loading, no-house destination, reduced motion, single splash handoff.",
  );
} catch (error) {
  console.error("Browser errors:", errors);
  await page.screenshot({
    path: "/private/tmp/sweetmate-house-transition-failure.png",
  });
  throw error;
} finally {
  await browser.close();
  server.close();
  await rm(temp, { recursive: true, force: true });
}
