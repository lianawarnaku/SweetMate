import sys,subprocess,json,concurrent.futures,re
from pathlib import Path
base=sys.argv[1].rstrip('/')
label=sys.argv[2] if len(sys.argv)>2 else 'verification'
if not re.fullmatch(r'[a-z0-9-]+',label): raise SystemExit('Use a simple verification label')
if not re.fullmatch(r'https://(?:sweetmate\.info|(?:[a-z0-9-]+\.)?sweetmate-website\.pages\.dev)',base): raise SystemExit('Use the SweetMate public or Pages preview URL')
root=Path(__file__).resolve().parents[1]/'out'
out=Path('/tmp')/('sweetmate-website-'+label+'-http');out.mkdir(exist_ok=True)
paths={'/':'index.html','/privacy':'privacy.html','/support':'support.html','/delete-account':'delete-account.html','/auth/confirm':'auth/confirm.html','/auth-confirm.js':'auth-confirm.js','/qa-nonexistent-page':'404.html'}
def decoded_email(value):
 data=bytes.fromhex(value);return bytes(v^data[0] for v in data[1:]).decode('utf-8')
def normalize_email_protection(body):
 text=body.decode('utf-8')
 text=re.sub(r'href="/cdn-cgi/l/email-protection#([a-fA-F0-9]+)"',lambda m:'href="mailto:'+decoded_email(m.group(1))+'"',text)
 text=re.sub(r'<span class="__cf_email__" data-cfemail="([a-fA-F0-9]+)">.*?</span>',lambda m:decoded_email(m.group(1)),text)
 text=re.sub(r'<script data-cfasync="false" src="/cdn-cgi/scripts/[a-fA-F0-9]+/cloudflare-static/email-decode.min.js"></script>','',text)
 return text.encode('utf-8')
def check(entry):
 path,file=entry;name=path.strip('/').replace('/','-') or 'home';body=out/(name+'.body');headers=out/(name+'.headers')
 r=subprocess.run(['curl','--location','--silent','--show-error','--max-time','20','--dump-header',str(headers),'--output',str(body),'--write-out','%{http_code}',base+path],capture_output=True,text=True)
 if r.returncode: raise RuntimeError(path+': '+r.stderr.strip())
 status=int(r.stdout);expected=404 if path=='/qa-nonexistent-page' else 200
 if status!=expected: raise RuntimeError(path+': HTTP '+str(status))
 h={}
 for line in headers.read_text().splitlines():
  if ':' in line:
   k,v=line.split(':',1);h[k.lower()]=v.strip()
 exact=body.read_bytes()==(root/file).read_bytes()
 equivalent=exact or (file.endswith('.html') and normalize_email_protection(body.read_bytes())==(root/file).read_bytes())
 if expected==200 and not equivalent: raise RuntimeError('Unexpected content mismatch at '+path)
 if expected==200 and (h.get('referrer-policy')!='no-referrer' or not h.get('content-security-policy')): raise RuntimeError('Missing security headers at '+path)
 if path=='/auth/confirm' and 'no-store' not in h.get('cache-control',''): raise RuntimeError('Auth cache policy mismatch')
 return {'path':path,'status':status,'matchesUploadedAsset':exact,'matchesAfterEmailProtection':equivalent,'csp':h.get('content-security-policy'),'cacheControl':h.get('cache-control'),'referrerPolicy':h.get('referrer-policy')}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(check,paths.items()))
(out/'checks.json').write_text(json.dumps(results,indent=2)+'\n')
for r in results: print(r['path'],r['status'],'exact uploaded content' if r['matchesUploadedAsset'] else 'matches after Cloudflare email protection')
print('Published page contents and security headers verified with normal TLS validation.')
