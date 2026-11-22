'use strict';
/*
 * Signal packaged loader (becomes signal.cjs in a release).
 *   node signal.cjs                 start (activation page if not activated)
 *   node signal.cjs --machine-id    print this PC's Machine ID
 *   node signal.cjs --activate CODE activate from the command line
 *   node signal.cjs --status        show license status
 * The application code and web assets live only inside the encrypted app.dat and are decrypted in memory.
 */
const path=require('node:path');
const fs=require('node:fs');
const http=require('node:http');
const crypto=require('node:crypto');
const Module=require('node:module');
const core=require('./core.cjs');

/* global __SIGNAL_PUBLIC_KEY__, __SIGNAL_VERSION__ */
const PUBLIC_KEY=__SIGNAL_PUBLIC_KEY__;
const VERSION=__SIGNAL_VERSION__;
const BASE=__dirname;
const LICENSE_FILE=path.join(BASE,'license.key');
const PORT=Number(process.env.PORT||3000),HOST=process.env.HOST||'0.0.0.0';
process.chdir(BASE);

function readLicense(){
  let code='';try{code=fs.readFileSync(LICENSE_FILE,'utf8');}catch{return {ok:false,reason:'missing'};}
  try{return {ok:true,info:core.verifyCode(code,{publicKeyPem:PUBLIC_KEY,machine:core.machineId()})};}
  catch(e){return {ok:false,reason:e.code||'invalid',message:e.message};}
}
function activate(code){const info=core.verifyCode(code,{publicKeyPem:PUBLIC_KEY,machine:core.machineId()});core.decryptPackage(info.masterKey,fs.readFileSync(path.join(BASE,'app.dat')));fs.writeFileSync(LICENSE_FILE,String(code).replace(/\s+/g,'')+'\n',{mode:0o600});return info;}
const describe=i=>`Licensed to ${i.customer} · ${i.expires?'expires '+new Date(i.expires).toISOString().slice(0,10):'no expiry'} · Machine ID ${i.machine}`;

/* ------------------------------------------------------------------ CLI */
const args=process.argv.slice(2);
if(args[0]==='--machine-id'){console.log(core.machineId());process.exit(0);}
if(args[0]==='--status'){const l=readLicense();console.log(`Signal ${VERSION}\nMachine ID: ${core.machineId()}\n`+(l.ok?describe(l.info):'Not activated'+(l.message?': '+l.message:'')));process.exit(l.ok?0:2);}
if(args[0]==='--activate'){
  const code=args.slice(1).join('')||'';
  if(!code){console.log('Usage: activate.bat <activation code>\nMachine ID for this PC: '+core.machineId());process.exit(1);}
  try{const i=activate(code);console.log('Activated. '+describe(i)+'\nRun start.bat to start Signal.');process.exit(0);}
  catch(e){console.error('Activation failed: '+e.message);process.exit(1);}
}

/* ------------------------------------------------------------------ App */
let current=null;
function startApp(info){
  const pkg=JSON.parse(core.decryptPackage(info.masterKey,fs.readFileSync(path.join(BASE,'app.dat'))).toString('utf8'));
  info.masterKey.fill(0);
  const assets=new Map(Object.entries(pkg.assets).map(([k,v])=>[k,Buffer.from(v,'base64')]));
  const m=new Module(path.join(BASE,'app.bundle.cjs'),module);m.filename=m.id;m.paths=Module._nodeModulePaths(BASE);
  m._compile(pkg.server,m.filename);pkg.server='';
  const {createApp,generateFixtures}=m.exports;
  const license={customer:info.customer,machine:info.machine,licenseId:info.licenseId,issued:info.issued,expires:info.expires};
  const service=createApp({root:BASE,assets:{get:k=>assets.get(k)},license});
  const server=service.app.listen(PORT,HOST,()=>console.log(`Signal ${pkg.version} running on ${HOST}:${PORT}. Admin: http://localhost:${PORT}/admin/ | ${describe(info)}`));
  server.on('error',e=>{console.error('Could not start the server: '+e.message);process.exit(1);});
  const fixtures=path.resolve(process.env.DATA_DIR||'data','fixtures');
  if(!fs.existsSync(path.join(fixtures,'270.mp4')))generateFixtures().then(()=>console.log('Calibration files created for /compat')).catch(e=>console.error('Calibration files could not be created: '+e.message));
  let expiryTimer=null;
  if(info.expires){const check=()=>{if(Date.now()>=info.expires){console.error('The activation code has expired. Switching to the activation page.');clearInterval(expiryTimer);stop(()=>startActivation({reason:'expired',message:'This PC’s activation code expired on '+new Date(info.expires).toISOString().slice(0,10)+'.'}));}};expiryTimer=setInterval(check,60000);}
  function stop(done){server.close(()=>{service.close();done&&done();});server.closeAllConnections?.();}
  current={stop:(done)=>{clearInterval(expiryTimer);stop(done);}};
}

/* ------------------------------------------------------------------ Activation page (loopback only) */
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function page({id,message,error,success,nonce}){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activate Signal</title>${success?'<meta http-equiv="refresh" content="4;url=/admin/">':''}
<style>:root{color-scheme:light dark;--bg:#f9f9f9;--card:#fff;--text:#0f0f0f;--muted:#606060;--line:#e0e0e0;--chip:#f2f2f2}@media(prefers-color-scheme:dark){:root{--bg:#0f0f0f;--card:#181818;--text:#f1f1f1;--muted:#aaa;--line:#303030;--chip:#272727}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(1000px 420px at 50% -10%,rgba(229,9,20,.12),transparent 70%),var(--bg);color:var(--text);font:15px/1.55 Roboto,"Segoe UI",system-ui,sans-serif}
main{width:100%;max-width:560px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:36px;box-shadow:0 10px 40px rgba(0,0,0,.08)}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:1.2px;font-size:18px;margin-bottom:24px}.mark{width:30px;height:30px;border-radius:9px;background:linear-gradient(145deg,#ff2a4f,#d4000f)}
h1{font-size:26px;margin:0 0 6px}p{color:var(--muted);margin:0 0 18px}.id{display:flex;align-items:center;gap:8px;padding:14px 16px;border-radius:12px;background:var(--chip);font:700 20px/1 Consolas,ui-monospace,monospace;letter-spacing:1px;margin-bottom:22px}
.id span{flex:1}button{font:inherit;cursor:pointer;border-radius:999px;border:0;transition:background-color .12s,transform .12s}button:active{transform:scale(.97)}button:focus-visible,textarea:focus-visible{outline:2px solid #3ea6ff;outline-offset:2px}
.copy{padding:8px 14px;background:transparent;color:var(--text);border:1px solid var(--line)}.copy:hover{background:var(--card)}
ol{padding-left:20px;color:var(--muted);margin:0 0 18px}li{margin:4px 0}label{font-weight:600;font-size:13px;display:block;margin-bottom:6px}
textarea{width:100%;min-height:110px;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--text);font:13px/1.45 Consolas,ui-monospace,monospace;resize:vertical;word-break:break-all}
.primary{width:100%;margin-top:14px;padding:13px;background:#e50914;color:#fff;font-weight:600}.primary:hover{background:#c80712}
.msg{padding:12px 14px;border-radius:10px;margin-bottom:18px;font-size:14px}.err{background:rgba(229,9,20,.1);color:#c4040f}.ok{background:rgba(11,128,67,.12);color:#0b8043}.info{background:var(--chip);color:var(--muted)}
small{color:var(--muted);display:block;margin-top:16px}</style></head><body><main>
<div class="brand"><span class="mark"></span>SIGNAL</div>
${success?`<h1>Activated</h1><div class="msg ok">${esc(success)}</div><p>Starting Signal… you will be taken to the dashboard in a few seconds.</p>`:`<h1>Activate this PC</h1>
${message?`<div class="msg info">${esc(message)}</div>`:''}${error?`<div class="msg err" role="alert">${esc(error)}</div>`:''}
<ol><li>Send this Machine ID to your Signal provider.</li><li>Paste the activation code you receive below.</li></ol>
<label>Machine ID</label><div class="id"><span id="mid">${esc(id)}</span><button type="button" class="copy" id="copy">Copy</button></div>
<form method="post" action="/activate"><label for="code">Activation code</label><textarea id="code" name="code" required spellcheck="false" autocomplete="off" placeholder="SGNL1.…"></textarea><button class="primary" type="submit">Activate</button></form>
<small>You can also run <b>activate.bat &lt;code&gt;</b> in the install folder. The code only works on this PC.</small>`}
</main><script nonce="${nonce}">var b=document.getElementById('copy');if(b)b.onclick=function(){var t=document.getElementById('mid').textContent;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1500)},function(){var r=document.createRange();r.selectNodeContents(document.getElementById('mid'));getSelection().removeAllRanges();getSelection().addRange(r);});};</script></body></html>`;
}
function startActivation({reason,message}){
  const id=core.machineId();let attempts=0,window0=Date.now();
  const intro=message||(reason==='missing'?'Signal is installed but not activated on this PC yet.':reason==='machine'?'This installation was activated for a different PC. A new activation code is needed for this one.':'');
  const server=http.createServer((req,res)=>{
    const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'');
    const nonce=crypto.randomBytes(16).toString('base64');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
    if(!local){
      if((req.url||'').startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'This signage server is waiting for activation on the host PC.'}));return;}
      res.writeHead(503,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><title>Signal</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#000;color:#eee;font:24px Arial">This signage server is waiting for activation on the host PC.</body>');return;
    }
    const send=(html,status=200)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(html);};
    if(req.method==='POST'&&req.url==='/activate'){
      if(Date.now()-window0>60000){window0=Date.now();attempts=0;}
      if(++attempts>10){send(page({id,message:intro,error:'Too many attempts. Wait one minute and try again.',nonce}),429);return;}
      let body='';req.setEncoding('utf8');
      req.on('data',d=>{body+=d;if(body.length>8192)req.destroy();});
      req.on('end',()=>{
        const code=new URLSearchParams(body).get('code')||'';
        try{const info=activate(code);console.log('Activated. '+describe(info));
          send(page({id,success:describe(info),nonce}));
          setTimeout(()=>{server.close(()=>startApp(info));server.closeAllConnections?.();},400);
        }catch(e){send(page({id,message:intro,error:e.message,nonce}),400);}
      });return;
    }
    send(page({id,message:intro,nonce}));
  });
  server.on('error',e=>{console.error('Could not start the activation page: '+e.message);process.exit(1);});
  server.listen(PORT,HOST,()=>console.log(`Signal ${VERSION} is not activated${intro?' ('+intro+')':''}.\nOpen http://localhost:${PORT}/ on this PC to activate. Machine ID: ${id}`));
  current={stop:(done)=>{server.close(()=>done&&done());server.closeAllConnections?.();}};
}

function shutdown(){if(current)current.stop(()=>process.exit(0));setTimeout(()=>process.exit(0),10000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);

const lic=readLicense();
if(lic.ok){try{startApp(lic.info);}catch(e){console.error(e.message);startActivation({reason:'package',message:e.message});}}
else startActivation({reason:lic.reason,message:lic.reason==='expired'||lic.reason==='signature'||lic.reason==='format'?lic.message:''});
