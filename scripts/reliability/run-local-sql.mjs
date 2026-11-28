// Run transactionally rolled-back suites against the named LOCAL QA container.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const output=process.argv[2]||'/tmp/sweetmate-reliability-audit';
await mkdir(output,{recursive:true});
const tests=(await readdir(join(root,'supabase/tests'))).filter(name=>name.endsWith('.sql')).sort();
const failed=[];
for(const name of tests) {
 const sql=await readFile(join(root,'supabase/tests',name),'utf8');
 const leading=sql.replace(/^(\s*--[^\n]*\n)*/,'').trimStart();
 if(!/^begin\s*;/i.test(leading)||!/^rollback\s*;/im.test(sql))throw Error('Refusing nontransactional test '+name);
 const result=spawnSync('docker',['exec','-i','supabase_db_sweetmate-qa','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-Atq'],{input:sql,encoding:'utf8',timeout:60000});
 await writeFile(join(output,'sql-'+name+'.log'),(result.stdout||'')+(result.stderr||''));
 console.log((result.status===0?'PASS ':'FAIL ')+name);
 if(result.status!==0||result.error)failed.push(name);
}
console.log(JSON.stringify({total:tests.length,failed}));
if(failed.length)process.exitCode=1;
