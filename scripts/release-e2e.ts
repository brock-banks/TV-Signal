// End-to-end check of a built release, exactly as a customer would run it.
// Usage: SIGNAL_VAULT=<vault used for the build> npm run test:release [-- release/Signal-x.y.z-date]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import {loadVault} from '../licensing/vendor.ts';
const core=createRequire(import.meta.url)('../licensing/core.cjs');

const releases=path.resolve('release');
const src=process.argv[2]?path.resolve(process.argv[2]):path.join(releases,fs.readdirSync(releases).filter(f=>fs.statSync(path.join(releases,f)).isDirectory()).sort().pop()!);
const vault=loadVault();
const install=fs.mkdtempSync(path.join(os.tmpdir(),'signal-install-'));
const step=(s:string)=>console.log('· '+s);
const port=await new Promise<number>(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=(s.address() as any).port;s.close(()=>r(p));});});
const url='http://127.0.0.1:'+port;
let proc:ChildProcess|null=null,log='';
function start(){log='';proc=spawn(path.join(install,process.platform==='win32'?'node.exe':'node'),['signal.cjs'],{cwd:install,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:path.join(install,'data')},windowsHide:true});proc.stdout!.on('data',d=>log+=d);proc.stderr!.on('data',d=>log+=d);}
async function stop(){if(!proc)return;const p=proc;proc=null;p.kill();await new Promise(r=>p.once('exit',r));}
async function waitFor(fn:()=>Promise<boolean>,ms=20000){const t=Date.now();while(Date.now()-t<ms){try{if(await fn())return;}catch{}await new Promise(r=>setTimeout(r,200));}throw new Error('Timed out. Log:\n'+log);}
const H={'X-Signage-Request':'1','Content-Type':'application/json'};

try{
 step('installing '+path.basename(src)+' into a fresh folder');fs.cpSync(src,install,{recursive:true});

 // Nothing readable: no app code, dashboard text or vendor secrets anywhere outside third-party node_modules/runtime.
 const scan=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);if(e.isDirectory())return e.name==='node_modules'?[]:scan(p);return /^node(\.exe)?$/.test(e.name)?[]:[p];});
 for(const f of scan(install)){const b=fs.readFileSync(f);for(const needle of ['Command palette','Media library','api/admin/state','heartbeat','schedules','PRIVATE KEY','master.key'])assert.ok(!b.includes(Buffer.from(needle)),`${path.relative(install,f)} must not contain "${needle}"`);}
 assert.ok(!fs.existsSync(path.join(install,'dist'))&&!fs.existsSync(path.join(install,'server'))&&!fs.existsSync(path.join(install,'dashboard')),'no source folders');
 step('no readable application code, web assets or vendor secrets in the install');

 start();await waitFor(async()=>(await fetch(url+'/')).ok);
 const pageHtml=await (await fetch(url+'/')).text();const machine=core.machineId();
 assert.match(pageHtml,/Activate this PC/);assert.ok(pageHtml.includes(machine),'activation page shows the Machine ID');
 assert.equal((await fetch(url+'/admin/')).status,200);assert.match(await (await fetch(url+'/admin/')).text(),/Activate this PC/,'dashboard is not available before activation');
 step('unactivated install only shows the activation page (Machine ID '+machine+')');

 const bad=await fetch(url+'/activate',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'code=SGNL1.abc.def'});
 assert.equal(bad.status,400);assert.match(await bad.text(),/not genuine|damaged/);
 const otherPc=core.issueCode({...vault,machine:core.machineId('another-pc'),customer:'Other PC'}).code;
 const wrongPc=await fetch(url+'/activate',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'code='+encodeURIComponent(otherPc)});
 assert.equal(wrongPc.status,400);assert.match(await wrongPc.text(),/different PC/);
 step('forged and other-PC codes are refused');

 const {code}=core.issueCode({...vault,machine,customer:'Release Test Ltd',expires:Date.now()+30*86400000});
 const ok=await fetch(url+'/activate',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'code='+encodeURIComponent(code)});
 assert.equal(ok.status,200);assert.match(await ok.text(),/Activated/);
 await waitFor(async()=>(await fetch(url+'/api/setup')).headers.get('content-type')?.includes('json')??false);
 step('activation via the web page started the application');

 const admin=await (await fetch(url+'/admin/')).text();assert.match(admin,/<div id="root">/);
 const js=/src="(\/admin\/assets\/[^"]+\.js)"/.exec(admin)![1];const jsRes=await fetch(url+js);assert.equal(jsRes.status,200);assert.match(jsRes.headers.get('content-type')||'',/javascript/);
 assert.match(await (await fetch(url+'/tv/1')).text(),/player\.js/);
 const clip=await fetch(url+'/player/keepawake.mp4',{headers:{Range:'bytes=0-99'}});assert.equal(clip.status,206);assert.equal((await clip.arrayBuffer()).byteLength,100);
 assert.equal((await fetch(url+'/admin')).url.endsWith('/admin/'),true);
 step('dashboard, TV player, ranged media and redirects served from the encrypted package');

 await fetch(url+'/api/setup',{method:'POST',headers:H,body:JSON.stringify({password:'release-test-123'})});
 const login=await fetch(url+'/api/login',{method:'POST',headers:H,body:JSON.stringify({password:'release-test-123'})});const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const state=await (await fetch(url+'/api/admin/state',{headers:{Cookie:cookie}})).json();
 assert.equal(state.license.customer,'Release Test Ltd');assert.equal(state.license.machine,machine);assert.equal(state.screens.length,3);
 step('dashboard API works and reports the license');
 await waitFor(async()=>fs.existsSync(path.join(install,'data','fixtures','270.mp4')),60000);step('calibration files generated on first start');

 await stop();start();await waitFor(async()=>(await fetch(url+'/api/setup')).headers.get('content-type')?.includes('json')??false);
 step('restart: activation persists (license.key)');

 await stop();fs.writeFileSync(path.join(install,'license.key'),otherPc);start();
 await waitFor(async()=>/different PC/.test(await (await fetch(url+'/')).text()));
 step('a license copied from another PC is refused at startup');

 await stop();console.log('PASS: protected release installs, refuses forged/other-PC codes, activates, serves everything from the encrypted package, persists and generates calibration files.');
}finally{await stop();fs.rmSync(install,{recursive:true,force:true});}
