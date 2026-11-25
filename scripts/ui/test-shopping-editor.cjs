// Actual shopping sheet interaction regression. Pass an installed esbuild module path.
// CHROMIUM_PATH can override the local Chrome/Chromium executable. No app/backend data is used.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = process.env.SWEETMATE_REPO || path.resolve(__dirname, '../..');
const mobile = path.join(root, 'artifacts/mobile');
const esbuild = require(process.argv[2] || 'esbuild');
const resolve = name => require.resolve(name, { paths: [mobile] });
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(fn, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await sleep(80); }
  throw Error('Shopping editor check timed out');
}
async function connect(url) {
  const ws = new WebSocket(url); await new Promise((yes, no) => { ws.onopen = yes; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = event => { const reply = JSON.parse(event.data); if (!reply.id) return; const p = pending.get(reply.id); if (!p) return; pending.delete(reply.id); reply.error ? p.reject(Error(reply.error.message)) : p.resolve(reply.result); };
  return { close: () => ws.close(), call: (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); }) };
}
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sweetmate-shopping-editor-'));
  let server, chrome, page;
  try {
    await esbuild.build({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ShoppingEditorSheet}from'@/components/ShoppingEditorSheet';
      function App(){const[visible,setVisible]=useState(true),[item,setItem]=useState(false),[name,setName]=useState(''),[quantity,setQuantity]=useState('1'),[schedule,setSchedule]=useState(),[saved,setSaved]=useState([]);
      return <><button id="new-item" onClick={()=>{setName('');setQuantity('1');setSchedule(undefined);setItem(true);setVisible(true)}}>Open item editor</button><pre id="result">{JSON.stringify(saved)}</pre>
      <ShoppingEditorSheet visible={visible} name={name} onNameChange={setName} quantity={quantity} onQuantityChange={item?setQuantity:undefined} schedule={schedule} onScheduleChange={setSchedule} timezone="America/New_York" onClose={()=>setVisible(false)} onSave={()=>{setSaved(s=>[...s,{name,quantity,schedule}]);setVisible(false)}}/></>}
      createRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: mobile }, bundle: true, jsx: 'automatic', platform: 'browser', outfile: path.join(temp, 'bundle.js'), define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'platform-fixtures', setup(build) {
      build.onResolve({ filter: /^(react|react\/jsx-runtime|react-dom\/client|react-native)$/ }, args => ({ path: resolve(args.path === 'react-native' ? 'react-native-web' : args.path) }));
      build.onResolve({ filter: /^(expo-blur|expo-glass-effect|@expo\/vector-icons|react-native-safe-area-context|@\/constants\/colors|@\/hooks\/useAccessibilityPreferences|@\/lib\/ripple)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
        args.path === '@/constants/colors' ? `import{resolveThemeTokens}from'${mobile}/constants/themeTokens.ts';export const useTheme=()=>resolveThemeTokens('dark','mono');`
        : args.path === '@/hooks/useAccessibilityPreferences' ? 'export const useAccessibilityPreferences=()=>({reduceMotion:true,reduceTransparency:false});'
        : args.path === '@/lib/ripple' ? 'export const androidRipple=()=>undefined;'
        : args.path === 'react-native-safe-area-context' ? 'export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});'
        : args.path === '@expo/vector-icons' ? 'export const Feather=()=>null;'
        : 'export const BlurView=()=>null;export const GlassView=()=>null;export const isGlassEffectAPIAvailable=()=>false;export const isLiquidGlassAvailable=()=>false;', loader: 'js', resolveDir: mobile }));
      build.onResolve({ filter: /^@\// }, args => { const base = path.join(mobile, args.path.slice(2)); return { path: syncFs.existsSync(base + '.tsx') ? base + '.tsx' : base + '.ts' }; });
    } }] });
    const bundle = await fs.readFile(path.join(temp, 'bundle.js'));
    server = http.createServer((req, res) => { if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); } else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;width:100%;margin:0;background:#101014;overflow-x:hidden}#result{display:none}</style><div id="root"></div><script src="/bundle.js"></script>'); } });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const executable = process.env.CHROMIUM_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
    chrome = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + path.join(temp, 'chrome'), '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
    const info = await until(async () => { try { return (await fs.readFile(path.join(temp, 'chrome/DevToolsActivePort'), 'utf8')).split('\n'); } catch { return null; } });
    const tabs = await (await fetch('http://127.0.0.1:' + info[0] + '/json')).json();
    page = await connect(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await page.call('Page.enable'); await page.call('Runtime.enable');
    await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const evaluate = async expression => { const r = await page.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
    await page.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
    const click = async selector => {
      const point = await until(() => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return r.width&&r.height&&e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`));
      await sleep(160); // Let ScrollView finish scrolling before a real tap.
      await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    const label = text => '[aria-label=' + JSON.stringify(text) + ']';
    const button = async text => {
      await until(() => evaluate(`(()=>{for(const e of document.querySelectorAll('[role="button"]'))if(e.textContent.trim()===${JSON.stringify(text)}){e.setAttribute('data-test-button',${JSON.stringify(text)});return true;}return false})()`));
      await click('[data-test-button=' + JSON.stringify(text) + ']');
    };
    const fill = async (name, text) => { await click(label(name)); await evaluate(`document.querySelector(${JSON.stringify(label(name))}).select()`); await page.call('Input.insertText', { text }); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(label(name))}).value`), text); };
    await until(() => evaluate(`document.activeElement?.getAttribute('aria-label')==='Shopping list name'`));
    await fill('Shopping list name', 'Weekend groceries');
    await click(label('Add shopping to calendar'));
    const chosen = await evaluate(`(()=>{const e=[...document.querySelectorAll('[aria-label^="Schedule shopping on "]')][20];e.setAttribute('data-test-date','chosen');const d=new Date(e.getAttribute('aria-label').replace('Schedule shopping on ',''));return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')})()`);
    await click('[data-test-date="chosen"]');
    await fill('Shopping hour', '25'); await button('Done');
    assert(await evaluate(`document.body.innerText.includes('Enter an hour from 1–12')`));
    await fill('Shopping hour', '3'); await fill('Shopping minutes', '45'); await click(label('PM'));
    await page.call('Emulation.setDeviceMetricsOverride', {width:320,height:568,deviceScaleFactor:1,mobile:true}); await sleep(250);
    assert(await evaluate(`['Shopping hour','Shopping minutes','AM','PM'].every(label=>{const e=document.querySelector('[aria-label="'+label+'"]');const r=e.getBoundingClientRect();return r.left>=0&&r.right<=320})`), 'Calendar time controls must fit a compact phone');
    await page.call('Page.captureScreenshot', {format:'png'}).then(async r=>fs.writeFile('/tmp/sweetmate-shopping-calendar-compact.png',Buffer.from(r.data,'base64')));
    await page.call('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true}); await sleep(250);
    await button('Done');
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(label('Shopping list name'))}).value`), 'Weekend groceries');
    await page.call('Page.captureScreenshot', { format: 'png' }).then(async r => fs.writeFile('/tmp/sweetmate-shopping-editor.png', Buffer.from(r.data, 'base64')));
    await button('Create list');
    await until(() => evaluate(`JSON.parse(document.querySelector('#result').textContent).length===1`));
    let saved = await evaluate(`JSON.parse(document.querySelector('#result').textContent)`);
    assert.equal(saved[0].name, 'Weekend groceries'); assert.equal(saved[0].schedule.date, chosen); assert.equal(saved[0].schedule.time, '15:45');
    await click('#new-item'); await until(() => evaluate(`document.activeElement?.getAttribute('aria-label')==='Item or ingredient name'`));
    await fill('Item or ingredient name', 'Dish soap'); await fill('Item quantity', '2');
    await click(label('Add shopping to calendar')); await button('Done');
    await click(label('Remove shopping calendar date and time')); await button('Add to list');
    await until(() => evaluate(`JSON.parse(document.querySelector('#result').textContent).length===2`));
    saved = await evaluate(`JSON.parse(document.querySelector('#result').textContent)`);
    assert.equal(saved[1].name, 'Dish soap'); assert.equal(saved[1].quantity, '2'); assert.equal(saved[1].schedule, undefined);
    console.log('PASS: actual shopping editor focuses and accepts typing, retains names through calendar/time selection, validates times, saves the chosen schedule, and supports removing optional scheduling.');
  } catch (error) {
    if (page) {
      const r = await page.call('Page.captureScreenshot', {format:'png'}); await fs.writeFile('/tmp/sweetmate-shopping-editor-error.png',Buffer.from(r.data,'base64'));
      const body = await page.call('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true}); console.error('Visible editor:',body.result.value);
    }
    throw error;
  } finally {
    if (page) page.close(); if (chrome) { chrome.kill('SIGTERM'); await sleep(400); }
    if (server) await new Promise(done => server.close(done));
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
