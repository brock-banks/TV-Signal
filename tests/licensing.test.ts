import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const core=createRequire(import.meta.url)('../licensing/core.cjs');

const A=core.machineId('11111111-2222-3333-4444-555555555555'),B=core.machineId('99999999-8888-7777-6666-555555555555');

test('machine IDs are stable, well-formed and distinct',()=>{
 assert.match(A,/^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);
 assert.equal(core.machineId('11111111-2222-3333-4444-555555555555'),A);
 assert.equal(core.machineId('11111111-2222-3333-4444-555555555555'.toUpperCase()),A,'case-insensitive source');
 assert.notEqual(A,B);
 assert.equal(core.normalizeMachineId(A.toLowerCase().replace(/-/g,'')),A,'typing without dashes or in lowercase is accepted');
 assert.throws(()=>core.normalizeMachineId('ABC'),/Invalid Machine ID/);
 assert.match(core.machineId(),/^[A-Z2-9-]{23}$/,'this PC has a readable machine identifier');
});

test('activation codes: bound to one PC, signed, tamper-proof, expiring',()=>{
 const v=core.createVault(),other=core.createVault();
 const {code}=core.issueCode({...v,machine:A,customer:'Acme Ltd',note:'Lobby PC'});
 const ok=core.verifyCode(code,{publicKeyPem:v.publicKeyPem,machine:A});
 assert.equal(ok.customer,'Acme Ltd');assert.equal(ok.expires,null);assert.ok(ok.masterKey.equals(v.masterKey));
 assert.ok(core.verifyCode(code.slice(0,50)+'\n  '+code.slice(50),{publicKeyPem:v.publicKeyPem,machine:A}),'whitespace from email wrapping is ignored');
 assert.throws(()=>core.verifyCode(code,{publicKeyPem:v.publicKeyPem,machine:B}),(e:any)=>e.code==='machine');
 assert.throws(()=>core.verifyCode(code,{publicKeyPem:other.publicKeyPem,machine:A}),(e:any)=>e.code==='signature','codes from another vendor key are rejected');
 const forged=core.issueCode({...other,machine:A,customer:'Pirate'}).code;
 assert.throws(()=>core.verifyCode(forged,{publicKeyPem:v.publicKeyPem,machine:A}),(e:any)=>e.code==='signature');
 const [p,body,sig]=code.split('.');const json=JSON.parse(Buffer.from(body,'base64url').toString());
 const edited=[p,Buffer.from(JSON.stringify({...json,e:null,c:'Someone else'})).toString('base64url'),sig].join('.');
 assert.throws(()=>core.verifyCode(edited,{publicKeyPem:v.publicKeyPem,machine:A}),(e:any)=>e.code==='signature','editing the code breaks the signature');
 assert.ok(!Buffer.from(body,'base64url').toString().includes(A)&&!Buffer.from(body,'base64url').toString().includes(A.replace(/-/g,'')),'the Machine ID is not stored in the code');
 assert.throws(()=>core.verifyCode('hello',{publicKeyPem:v.publicKeyPem,machine:A}),(e:any)=>e.code==='format');
 const exp=Date.now()+60000;const timed=core.issueCode({...v,machine:A,customer:'Trial',expires:exp}).code;
 assert.equal(core.verifyCode(timed,{publicKeyPem:v.publicKeyPem,machine:A}).expires,exp);
 assert.throws(()=>core.verifyCode(timed,{publicKeyPem:v.publicKeyPem,machine:A,now:exp+1}),(e:any)=>e.code==='expired');
 assert.throws(()=>core.issueCode({...v,machine:A,customer:'Past',expires:Date.now()-1}),/future/);
 assert.throws(()=>core.issueCode({...v,machine:A,customer:''}),/Customer/);
});

test('application packages are encrypted, authenticated and need the master key',()=>{
 const v=core.createVault(),wrong=core.createVault();
 const secret=Buffer.from('function createApp(){ /* proprietary dashboard source */ }'.repeat(50));
 const pkg=core.encryptPackage(v.masterKey,secret);
 assert.ok(!pkg.includes(Buffer.from('createApp'))&&!pkg.includes(Buffer.from('proprietary')),'no readable code in the package');
 assert.ok(core.decryptPackage(v.masterKey,pkg).equals(secret));
 assert.throws(()=>core.decryptPackage(wrong.masterKey,pkg),(e:any)=>e.code==='package');
 const tampered=Buffer.from(pkg);tampered[tampered.length-5]^=1;
 assert.throws(()=>core.decryptPackage(v.masterKey,tampered),(e:any)=>e.code==='package');
});

test('vendor tool: init once, issue codes, keep a register',()=>{
 const vault=fs.mkdtempSync(path.join(os.tmpdir(),'signal-vault-'));
 const run=(...args:string[])=>execFileSync(process.execPath,['--import','tsx','licensing/vendor.ts',...args],{env:{...process.env,SIGNAL_VAULT:vault},encoding:'utf8'});
 try{
  run('init');for(const f of ['signing-private.pem','signing-public.pem','master.key','issued.csv'])assert.ok(fs.existsSync(path.join(vault,f)),f);
  assert.throws(()=>run('init'),'refuses to overwrite an existing vault');
  const out=run('issue','--machine',A,'--customer','Acme Ltd','--days','30','--note','Front desk');
  const code=/SGNL1\.[\w-]+\.[\w-]+/.exec(out)![0];
  assert.match(run('verify','--code',code,'--machine',A),/Valid: Acme Ltd/);
  assert.match(fs.readFileSync(path.join(vault,'issued.csv'),'utf8'),/Acme Ltd.*Front desk/);
  assert.equal(fs.readdirSync(path.join(vault,'codes')).length,1);
 }finally{fs.rmSync(vault,{recursive:true,force:true});}
});
