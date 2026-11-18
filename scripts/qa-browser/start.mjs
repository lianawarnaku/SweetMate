import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, cp, access, rename, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const stateDir = resolve(root, '.sweetmate-qa');
const backend = resolve(stateDir, 'backend');
const web = resolve(stateDir, 'web');
const appRoot = process.env.SWEETMATE_QA_WEB_DIR ? root : resolve(stateDir, 'main-source');
let currentSha = 'fixture';
let syncMessage = 'Starting';
let installedLock = '';
const gitUrl = 'https://github.com/lianawarnaku/SweetMate.git';
const localUrl = 'http://127.0.0.1:54321';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env, SUPABASE_HOME: resolve(stateDir, 'cli'), SUPABASE_TELEMETRY_DISABLED: '1', npm_config_cache: resolve(stateDir, 'npm-cache') };
const cli = ['exec', '--yes', '--package=supabase@2.109.1', '--', 'supabase'];
const packageManager = ['exec', '--yes', '--package=pnpm@11.25.0', '--', 'pnpm'];
const exclude = 'logflare,vector,studio,imgproxy,edge-runtime,mailpit';
const fatal = message => { throw new Error(message); };
if (Number(process.versions.node.split('.')[0]) < 22) fatal('Install Node.js 22 or later, then run this again.');
await mkdir(stateDir, { recursive: true });
function run(command, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? done() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) fatal(result.error?.message || result.stderr || `${command} failed.`);
  return result.stdout;
}
const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
if (docker.error || docker.status !== 0) fatal('Start Docker Desktop, wait until its engine is running, then run this again.');
console.log('Preparing isolated SweetMate QA. Production credentials and records are not used.');
async function syncSource() {
  if (process.env.SWEETMATE_QA_WEB_DIR) return false;
  if (!existsSync(resolve(appRoot, '.git'))) {
    await run('git', ['clone', '--single-branch', '--branch', 'main', gitUrl, appRoot]);
  } else {
    await run('git', ['-C', appRoot, 'fetch', '--quiet', 'origin', 'main']);
    await run('git', ['-C', appRoot, 'merge', '--ff-only', 'FETCH_HEAD']);
  }
  const sha = capture('git', ['-C', appRoot, 'rev-parse', 'HEAD']).trim();
  return sha;
}
function prepareMigration(name, sql) {
  if (name === '202607220004_add_household_member_color.sql') {
    // An old deployed schema had avatar_color, but fresh main schemas do not.
    // Reading the optional field through the row's JSON supports both shapes.
    sql = sql.replace("coalesce(avatar_color, '#7B563B')", "coalesce(to_jsonb(household_members)->>'avatar_color', '#7B563B')");
  }
  // The local CLI can execute each SQL statement separately. A LOCK must be
  // inside an explicit transaction, including the backfill and trigger cutover.
  if (/^\s*lock\s+table\b/im.test(sql) && !/^\s*begin\s*;/im.test(sql)) {
    sql = `begin;\n${sql}\ncommit;\n`;
  }
  return sql;
}
async function copySchema() {
  await mkdir(resolve(backend, 'supabase'), { recursive: true });
  let config = await readFile(resolve(appRoot, 'supabase/config.toml'), 'utf8');
  config = config.replace('project_id = "Homie"', 'project_id = "sweetmate-qa"')
    .replace('site_url = "http://127.0.0.1:3000"', 'site_url = "http://127.0.0.1:4173"')
    .replace('additional_redirect_urls = ["https://127.0.0.1:3000"]', 'additional_redirect_urls = ["http://127.0.0.1:4173", "http://127.0.0.1:4174"]');
  if (!config.includes('project_id = "sweetmate-qa"')) fatal('The main-source Supabase config changed. Stop and review the QA config instead of using an unknown project.');
  await writeFile(resolve(backend, 'supabase/config.toml'), config);
  await cp(resolve(appRoot, 'supabase/migrations'), resolve(backend, 'supabase/migrations'), { recursive: true });
  const localMigrations = resolve(backend, 'supabase/migrations');
  for (const name of await readdir(localMigrations)) {
    if (!name.endsWith('.sql')) continue;
    const path = resolve(localMigrations, name);
    const sql = await readFile(path, 'utf8');
    const prepared = prepareMigration(name, sql);
    if (prepared !== sql) await writeFile(path, prepared);
  }

}
const initialSha = await syncSource();
await copySchema();
if (process.env.SWEETMATE_QA_REUSE_BACKEND !== '1') {
  console.log('Starting the local database, authentication and Realtime services. First run downloads Docker images.');
  await run(npm, [...cli, 'start', '--workdir', backend, '--exclude', exclude]);
}
const raw = capture(npm, [...cli, 'status', '--workdir', backend, '--output', 'json']);
const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
if (start < 0 || end < start) fatal('Could not read the local Supabase status.');
const status = JSON.parse(raw.slice(start, end + 1));
const anon = status.ANON_KEY || status.anon_key;
const service = status.SERVICE_ROLE_KEY || status.service_role_key;
const apiUrl = status.API_URL || status.api_url;
if (apiUrl !== localUrl || !anon || !service) fatal('Expected a local Supabase instance at 127.0.0.1:54321 with local API keys. Refusing any other backend.');
if (process.env.SWEETMATE_QA_REUSE_BACKEND !== '1') await run(npm, [...cli, 'migration', 'up', '--local', '--workdir', backend]);
async function request(path, { token = service, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(localUrl + path, {
    method, headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  if (!response.ok) fatal(`Local QA request ${path} failed (${response.status}): ${text.slice(0, 450)}`);
  return text ? JSON.parse(text) : null;
}
const fixtureFile = resolve(stateDir, 'fixtures.json');
let fixtures;
try { fixtures = JSON.parse(await readFile(fixtureFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!fixtures) {
  const password = 'QaOnly-' + randomBytes(18).toString('hex') + '!';
  const a = { email: 'avery@sweetmate.test', name: 'Avery', password, color: '#5793d6' };
  const b = { email: 'blake@sweetmate.test', name: 'Blake', password, color: '#b58ad0' };
  fixtures = { a, b, householdId: null, invite: randomBytes(4).toString('hex').toUpperCase(), ready: false };
  await writeFile(fixtureFile, JSON.stringify(fixtures), { mode: 0o600 });
}
if (!fixtures.ready) {
  const { a, b } = fixtures;
  const password = a.password;
  for (const persona of [a, b]) {
    if (persona.id) continue;
    const user = await request('/auth/v1/admin/users', { method: 'POST', body: { email: persona.email, password, email_confirm: true, user_metadata: { full_name: persona.name, name: persona.name } } });
    persona.id = user.id;
    await writeFile(fixtureFile, JSON.stringify(fixtures), { mode: 0o600 });
  }
  const login = persona => request('/auth/v1/token?grant_type=password', { token: anon, method: 'POST', body: { email: persona.email, password } });
  const aSession = await login(a), bSession = await login(b);
  const invite = fixtures.invite;
  const created = fixtures.householdId ? [{ household_id: fixtures.householdId }] : await request('/rest/v1/rpc/create_household', { token: aSession.access_token, method: 'POST', body: {
    household_name: 'QA Sweet 1', member_name: a.name, member_color: a.color, requested_invite_code: invite, household_timezone: 'America/New_York',
  } });
  const householdId = created?.[0]?.household_id;
  if (!householdId) fatal('Local household creation returned no ID.');
  fixtures.householdId = householdId;
  await writeFile(fixtureFile, JSON.stringify(fixtures), { mode: 0o600 });
  await request('/rest/v1/rpc/join_household', { token: bSession.access_token, method: 'POST', body: { code: invite, member_name: b.name, member_color: b.color } });
  await request('/rest/v1/household_preferences', { token: aSession.access_token, method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: {
    household_id: householdId, household_complete: true, points_enabled: false, plant_enabled: false, updated_by: a.id,
  } });
  fixtures = { a, b, householdId, invite, ready: true };
  await writeFile(fixtureFile, JSON.stringify(fixtures), { mode: 0o600 });
  console.log('Created Avery (owner), Blake (member), and QA Sweet 1 in the local database.');
}
async function buildBrowser(sha) {
  if (process.env.SWEETMATE_QA_WEB_DIR) {
    await cp(resolve(process.env.SWEETMATE_QA_WEB_DIR), web, { recursive: true });
    currentSha = 'fixture';return;
  }
  const lock = createHash('sha256').update(await readFile(resolve(appRoot, 'pnpm-lock.yaml'))).digest('hex');
  if (lock !== installedLock) {
    await run(npm, [...packageManager, 'install', '--frozen-lockfile', '--store-dir', resolve(stateDir, 'pnpm-store')], { cwd: appRoot });
    installedLock = lock;
  }
  const nextWeb = resolve(stateDir, 'web-next');
  await rm(nextWeb, { recursive: true, force: true });
  await run(npm, [...packageManager, '--filter', '@workspace/mobile', 'exec', 'expo', 'export', '--platform', 'web', '--output-dir', nextWeb], {
    cwd: appRoot,
    env: { ...env, EXPO_NO_TELEMETRY: '1', EXPO_PUBLIC_SUPABASE_URL: localUrl, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'SWEETMATE_QA_ANON_KEY_PLACEHOLDER',
      EXPO_PUBLIC_APP_ENV: 'development', EXPO_PUBLIC_DEMO_EMAIL: '', EXPO_PUBLIC_DEMO_PASSWORD: '', EXPO_PUBLIC_API_URL: '',
      EXPO_PUBLIC_POSTHOG_API_KEY: '', EXPO_PUBLIC_SENTRY_DSN: '', EXPO_NO_DOTENV: '1' },
  });
  await writeFile(resolve(nextWeb, 'qa-source.txt'), sha);
  const previous = resolve(stateDir, 'web-previous');
  await rm(previous, { recursive: true, force: true });
  if (existsSync(web)) await rename(web, previous);
  try { await rename(nextWeb, web); } catch(error) { if(existsSync(previous))await rename(previous,web);throw error; }
  currentSha = sha;
  await rm(previous, { recursive: true, force: true });
}
let builtSha = '';
try { builtSha = (await readFile(resolve(web, 'qa-source.txt'), 'utf8')).trim(); } catch {}
if (initialSha && builtSha === initialSha) currentSha = initialSha;
else await buildBrowser(initialSha);
syncMessage = 'Up to date';
function liveReloadScript() {
  return `<script>(()=>{let loaded=${JSON.stringify(currentSha)};setInterval(async()=>{try{const r=await fetch('/qa/version',{cache:'no-store'});if(!r.ok)return;const v=await r.json();const label=document.getElementById('qa-sync-status');if(label)label.textContent=v.message+' · '+v.sha.slice(0,7);if(v.sha!==loaded)location.reload();}catch{}},3000)})();</script>`;
}
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const wrap = (title, content) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px system-ui;background:#15171b;color:#f5f5f5;margin:0;padding:24px}a{color:#96c7ff}header{display:flex;gap:20px;flex-wrap:wrap;align-items:center}h1{font-size:24px}p{max-width:80ch;line-height:1.5}.panes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}iframe{width:100%;height:780px;border:1px solid #555;border-radius:16px;background:#101010}button{padding:12px;font:inherit;cursor:pointer}small{color:#c2c6ce}@media(max-width:800px){.panes{grid-template-columns:1fr}}</style>${content}</html>`;
const launcher = wrap('SweetMate QA — two personas', `<header><h1>SweetMate QA</h1><span>QA Sweet 1 · local database</span><span id="qa-sync-status">Checking main…</span></header><p>Two actual app sessions with separate browser storage. Avery is the owner; Blake is a member. Add “QA — wash dishes” in one session and watch the other. Production records are not connected. Main is checked every 30 seconds; both sessions refresh after a successful build.</p><p><a href="http://127.0.0.1:4173/qa-login" target="_blank" rel="noopener">Open Avery separately</a> · <a href="http://127.0.0.1:4174/qa-login" target="_blank" rel="noopener">Open Blake separately</a> · <a href="/walkthrough" target="_blank" rel="noopener">Testing checklist</a></p><div class="panes"><section><h2>Avery · owner</h2><iframe title="Avery’s SweetMate session" src="http://127.0.0.1:4173/qa-login"></iframe></section><section><h2>Blake · member</h2><iframe title="Blake’s SweetMate session" src="http://127.0.0.1:4174/qa-login"></iframe></section></div><p><small>Local preview: Google/Apple OAuth, email delivery, push notifications and account-deletion Edge Functions are not configured. Those require a connected test project and native-device testing. Sign out to test signup/onboarding separately. Stop this terminal with Ctrl+C; local database data remains for the next run.</small></p>`);
const loginPage = wrap('Open QA persona', '<p id="status">Signing into the local QA account…</p><script>(async()=>{try{const r=await fetch("/qa/session",{cache:"no-store"});if(!r.ok)throw Error(await r.text());const data=await r.json();const s=data.session;localStorage.setItem("sb-127-auth-token",JSON.stringify(s));localStorage.setItem(`sweetmate:user-preferences:v1:${s.user.id}`,JSON.stringify({onboardingPending:false,householdSetupStep:null,householdSetupVersion:3}));localStorage.setItem(`sweetmate:user:${s.user.id}:active-sweet`,data.householdId);location.replace("/");}catch(e){document.getElementById("status").textContent=e.message;}})();</script>');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.ttf':'font/ttf', '.woff':'font/woff', '.woff2':'font/woff2', '.ico':'image/x-icon' };
const servers = [];
for (const [port, persona] of [[4172, null], [4173, fixtures.a], [4174, fixtures.b]]) {
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const path = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname);
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405);res.end();return; }
      if (path === '/qa/version') { res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sha:currentSha,message:syncMessage}));return; }
      if (!persona && path === '/') { res.setHeader('Content-Type','text/html; charset=utf-8');res.end(launcher.replace('</html>',liveReloadScript()+'</html>'));return; }
      if (!persona && path === '/walkthrough') {
        res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile(resolve(root,'scripts/qa-browser/checklist.html')));return;
      }
      if (persona && path === '/qa-login') { res.setHeader('Content-Type','text/html; charset=utf-8');res.end(loginPage);return; }
      if (persona && path === '/qa/session') {
        const origin=req.headers.origin;
        if(origin && origin!==`http://127.0.0.1:${port}`){res.writeHead(403);res.end();return;}
        const session=await request('/auth/v1/token?grant_type=password',{token:anon,method:'POST',body:{email:persona.email,password:persona.password}});
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({session,householdId:fixtures.householdId}));return;
      }
      let file = resolve(web, '.' + path);
      if (!file.startsWith(web + sep) && file !== web) { res.writeHead(403);res.end();return; }
      try { await access(file); if (!extname(file)) file=resolve(web,'index.html'); }
      catch { if(extname(path)){res.writeHead(404);res.end('Not found');return;}file=resolve(web,'index.html'); }
      let bytes=await readFile(file);
      if(extname(file)==='.js')bytes=Buffer.from(bytes.toString().replaceAll('SWEETMATE_QA_ANON_KEY_PLACEHOLDER',anon));
      if(extname(file)==='.html')bytes=Buffer.from(bytes.toString().replace('</body>',liveReloadScript()+'</body>'));
      res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(req.method==='HEAD'?undefined:bytes);
    } catch(error) { res.writeHead(500,{'Content-Type':'text/plain'});res.end('Local QA request failed. See the launcher terminal.');console.error(error.message); }
  });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
  servers.push(server);
}
let updating = false;
const updater = !process.env.SWEETMATE_QA_WEB_DIR && setInterval(async () => {
  if (updating) return;
  updating = true;
  try {
    const sha = await syncSource();
    if (sha === currentSha) { syncMessage = 'Up to date'; return; }
    syncMessage = 'Updating from main';
    console.log(`Main changed to ${sha.slice(0,7)}. Applying local migrations and rebuilding…`);
    await copySchema();
    await run(npm, [...cli, 'migration', 'up', '--local', '--workdir', backend]);
    await buildBrowser(sha);
    syncMessage = 'Up to date';
    console.log(`Updated both browser profiles to ${sha.slice(0,7)}. QA records and sessions retained.`);
  } catch(error) {
    syncMessage = 'Update failed — see terminal; showing previous build';
    console.error('QA auto-update failed:', error.message);
  } finally { updating = false; }
}, 30000);
console.log('\nReady: http://127.0.0.1:4172\nAvery: http://127.0.0.1:4173/qa-login\nBlake: http://127.0.0.1:4174/qa-login\n');
if(process.env.SWEETMATE_QA_NO_OPEN!=='1'){
 const command=process.platform==='darwin'?'open':process.platform==='win32'?'explorer.exe':'xdg-open';
 const opener=spawn(command,['http://127.0.0.1:4172'],{stdio:'ignore'});opener.on('error',()=>{});opener.unref();
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(updater)clearInterval(updater);for(const server of servers)server.close();process.exit(0);});
