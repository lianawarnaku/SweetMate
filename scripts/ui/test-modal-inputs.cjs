// Real Chromium regression: an input can have a correct DOM value/color but
// still be hidden by a glass tint painted above an unpositioned web input.
// Pass installed esbuild and playwright module paths; Chromium must be installed.
// node scripts/ui/test-modal-inputs.cjs /path/to/esbuild /path/to/playwright
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
const http=require('node:http');
const root=path.resolve(__dirname,'../..');
const mobile=path.join(root,'artifacts/mobile');
const esbuild=require(process.argv[2]||'esbuild');
const{chromium}=require(process.argv[3]||'playwright');
const resolve=name=>require.resolve(name,{paths:[mobile]});
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'sweetmate-input-test-'));
 let server,browser;
 try{
  await esbuild.build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{TextInput,Text}from'react-native';import{Surface}from'@/components/Surface';
  function App(){const[list,setList]=useState('');const[item,setItem]=useState('');return <Surface level="modal" style={{padding:24,width:440,borderRadius:20}}><Text style={{color:'#f5f5f7'}}>List name</Text><TextInput accessibilityLabel="Shopping list name" value={list} onChangeText={setList} style={{color:'#f5f5f7',backgroundColor:'rgba(255,255,255,.07)',padding:14,fontSize:17}}/><Text style={{color:'#f5f5f7'}}>Item or ingredient name</Text><TextInput accessibilityLabel="Item or ingredient name" value={item} onChangeText={setItem} style={{color:'#f5f5f7',backgroundColor:'rgba(255,255,255,.07)',padding:14,fontSize:17}}/></Surface>}createRoot(document.getElementById('root')).render(<App/>);`,loader:'jsx',resolveDir:mobile},bundle:true,jsx:'automatic',outfile:path.join(temp,'bundle.js'),platform:'browser',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'platform-stubs',setup(build){
   build.onResolve({filter:/^(react|react\/jsx-runtime|react-dom\/client|react-native)$/},a=>({path:resolve(a.path==='react-native'?'react-native-web':a.path)}));
   build.onResolve({filter:/^(expo-blur|expo-glass-effect|@\/constants\/colors|@\/hooks\/useAccessibilityPreferences|@\/lib\/ripple)$/},a=>({path:a.path,namespace:'fixture'}));
   build.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='@/constants/colors'?`import{resolveThemeTokens}from'${mobile}/constants/themeTokens.ts';export const useTheme=()=>resolveThemeTokens('dark','mono');`:a.path==='@/hooks/useAccessibilityPreferences'?'export const useAccessibilityPreferences=()=>({reduceMotion:false,reduceTransparency:false});':a.path==='@/lib/ripple'?'export const androidRipple=()=>undefined;':'export const BlurView=()=>null;export const GlassView=()=>null;export const isGlassEffectAPIAvailable=()=>false;export const isLiquidGlassAvailable=()=>false;',loader:'js',resolveDir:mobile}));
   build.onResolve({filter:/^@\//},a=>{const base=path.resolve(mobile,a.path.slice(2));return{path:require('node:fs').existsSync(base+'.tsx')?base+'.tsx':base+'.ts'}});
  }}]});
  const bundle=await fs.readFile(path.join(temp,'bundle.js'));
  server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle)}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><style>body{padding:24px;background:#101014}</style><div id="root"></div><script src="/bundle.js"></script>')}});
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)});
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:520,height:420}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  async function textPixels(field){
   const shot=await field.screenshot();
   return page.evaluate(async base64=>{const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const{data,width,height}=ctx.getImageData(0,0,canvas.width,canvas.height);let count=0;for(let y=5;y<height-5;y++)for(let x=5;x<width-5;x++){const i=(y*width+x)*4;if(Math.min(data[i],data[i+1],data[i+2])>180)count++}return count},shot.toString('base64'));
  }
  for(const[name,value]of[['Shopping list name','Weekly groceries'],['Item or ingredient name','Tomatoes and olive oil']]){
   const field=page.getByRole('textbox',{name,exact:true});await field.fill('');await field.blur();const empty=await textPixels(field);
   await field.fill(value);await field.blur();assert.equal(await field.inputValue(),value);
   const typed=await textPixels(field);assert(typed>empty+40,`${name}: text value exists but visible glyphs were not painted above the modal tint (${typed-empty} bright pixels)`);
  }
  assert.deepEqual(errors,[]);console.log('PASS: list/item controlled text values remain visibly painted above actual web modal glass after typing and blur.');
 }finally{if(browser)await browser.close();if(server)await new Promise(done=>server.close(done));await fs.rm(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
