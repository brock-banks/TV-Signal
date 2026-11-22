'use strict';
/*
 * Signal licensing core (shared by the vendor tools and the packaged loader).
 *
 * Model
 * - The vendor (you) holds an Ed25519 signing key pair and a 256-bit master content key in a private vault.
 * - Release packages contain the application code and assets encrypted with a key derived from the master key.
 *   The package therefore cannot be read or run without the master key.
 * - An activation code is issued for one Machine ID. It is signed with the vendor's private key and carries the
 *   master key wrapped (AES-256-GCM) under a key derived from that Machine ID. The Machine ID itself is NOT in
 *   the code (only a salted hash), so a leaked code cannot be unwrapped on another PC.
 * - The Machine ID is derived from the operating-system installation ID (Windows MachineGuid). Reinstalling
 *   Windows or moving to another PC requires a new code.
 *
 * Limits (stated plainly): software that must decrypt itself to run can always be extracted by a determined
 * person with administrator access to an activated PC. This scheme stops copying to other PCs, unauthorised
 * installs and casual inspection of the files; it is not DRM against reverse engineering.
 */
const crypto=require('node:crypto');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');

const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PREFIX='SGNL1';
const PACKAGE_MAGIC=Buffer.from('SGNLPKG1');

const b64u=b=>Buffer.from(b).toString('base64url');
const unb64u=s=>Buffer.from(String(s),'base64url');
const sha256=data=>crypto.createHash('sha256').update(data).digest();

function base32(buf,length){let bits=0,value=0,out='';for(const byte of buf){value=(value<<8)|byte;bits+=8;while(bits>=5&&out.length<length){out+=ALPHABET[(value>>>(bits-5))&31];bits-=5;}value&=(1<<bits)-1;if(out.length>=length)break;}return out;}

/** OS installation identifier. Windows: MachineGuid (stable until Windows is reinstalled). */
function machineSecret(){
  if(process.platform==='win32'){
    const out=execFileSync('reg',['query','HKLM\\SOFTWARE\\Microsoft\\Cryptography','/v','MachineGuid'],{encoding:'utf8',windowsHide:true});
    const m=/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/.exec(out);if(m)return m[1].toLowerCase();
    throw new Error('Could not read the Windows MachineGuid');
  }
  for(const f of ['/etc/machine-id','/var/lib/dbus/machine-id']){try{const v=fs.readFileSync(f,'utf8').trim();if(v)return v.toLowerCase();}catch{}}
  if(process.platform==='darwin'){const out=execFileSync('ioreg',['-rd1','-c','IOPlatformExpertDevice'],{encoding:'utf8'});const m=/"IOPlatformUUID" = "([^"]+)"/.exec(out);if(m)return m[1].toLowerCase();}
  throw new Error('Could not determine a machine identifier on this platform');
}

/** Human-friendly Machine ID: 20 base32 characters (100 bits) in groups of five, e.g. K7Q2M-9XD4R-… */
function machineId(secret=machineSecret()){return base32(sha256('signal-machine-v1|'+String(secret).trim().toLowerCase()),20).match(/.{5}/g).join('-');}
function normalizeMachineId(id){const s=String(id||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(s.length!==20||[...s].some(c=>!ALPHABET.includes(c)))throw new Error('Invalid Machine ID. It has 20 characters in four groups, e.g. ABCDE-FGHJK-LMNPQ-RSTUV');return s.match(/.{5}/g).join('-');}
const bindHash=id=>b64u(sha256('signal-bind-v1|'+normalizeMachineId(id)));
const wrapKey=id=>Buffer.from(crypto.hkdfSync('sha256',Buffer.from(normalizeMachineId(id)),Buffer.from('signal-license-v1'),Buffer.from('master-key-wrap'),32));
const packageKey=master=>Buffer.from(crypto.hkdfSync('sha256',master,Buffer.from('signal-package-v1'),Buffer.from('package'),32));

function seal(key,plain,aad){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);if(aad)c.setAAD(aad);const ct=Buffer.concat([c.update(plain),c.final()]);return Buffer.concat([iv,c.getAuthTag(),ct]);}
function open(key,box,aad){const b=Buffer.from(box);if(b.length<29)throw new Error('Corrupt data');const d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));if(aad)d.setAAD(aad);d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]);}

/** Vendor: create keys. Keep the result offline and backed up; losing it means no new codes for existing builds. */
function createVault(){const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');return {publicKeyPem:publicKey.export({type:'spki',format:'pem'}).toString(),privateKeyPem:privateKey.export({type:'pkcs8',format:'pem'}).toString(),masterKey:crypto.randomBytes(32)};}

/** Vendor: issue an activation code for one Machine ID. `expires` is a ms timestamp or null for perpetual. */
function issueCode({privateKeyPem,masterKey,machine,customer,expires=null,note=''}){
  const id=normalizeMachineId(machine);
  if(!customer||String(customer).trim().length<2)throw new Error('Customer name is required');
  if(expires!==null&&!(Number.isFinite(expires)&&expires>Date.now()))throw new Error('Expiry must be in the future');
  const payload={v:1,lid:b64u(crypto.randomBytes(9)),c:String(customer).trim().slice(0,120),n:String(note||'').slice(0,200),i:Date.now(),e:expires,b:bindHash(id)};
  payload.k=b64u(seal(wrapKey(id),Buffer.from(masterKey),Buffer.from(payload.lid)));
  const body=b64u(JSON.stringify(payload));
  const sig=b64u(crypto.sign(null,Buffer.from(CODE_PREFIX+'.'+body),crypto.createPrivateKey(privateKeyPem)));
  return {code:CODE_PREFIX+'.'+body+'.'+sig,licenseId:payload.lid,machine:id};
}

class LicenseError extends Error{constructor(code,message){super(message);this.code=code;}}
/** Loader: verify a code for this PC. Returns license details and the unwrapped master key. */
function verifyCode(code,{publicKeyPem,machine,now=Date.now()}){
  const clean=String(code||'').replace(/\s+/g,'');
  const parts=clean.split('.');
  if(parts.length!==3||parts[0]!==CODE_PREFIX)throw new LicenseError('format','This is not a Signal activation code.');
  let ok=false;try{ok=crypto.verify(null,Buffer.from(parts[0]+'.'+parts[1]),crypto.createPublicKey(publicKeyPem),unb64u(parts[2]));}catch{ok=false;}
  if(!ok)throw new LicenseError('signature','The activation code is not genuine or was altered.');
  let p;try{p=JSON.parse(unb64u(parts[1]).toString('utf8'));}catch{throw new LicenseError('format','The activation code is damaged.');}
  if(p.v!==1)throw new LicenseError('version','This activation code is for a different version of Signal.');
  const id=normalizeMachineId(machine);
  if(p.b!==bindHash(id))throw new LicenseError('machine','This activation code was issued for a different PC. Send this PC’s Machine ID to get a code for it.');
  if(p.e!==null&&now>=p.e)throw new LicenseError('expired','This activation code expired on '+new Date(p.e).toISOString().slice(0,10)+'.');
  let masterKey;try{masterKey=open(wrapKey(id),unb64u(p.k),Buffer.from(p.lid));}catch{throw new LicenseError('machine','This activation code cannot be used on this PC.');}
  return {licenseId:p.lid,customer:p.c,note:p.n,issued:p.i,expires:p.e,machine:id,masterKey};
}

/** Encrypt / decrypt an application package (gzip + AES-256-GCM, authenticated). */
function encryptPackage(masterKey,plain){return Buffer.concat([PACKAGE_MAGIC,seal(packageKey(masterKey),require('node:zlib').gzipSync(plain,{level:9}),PACKAGE_MAGIC)]);}
function decryptPackage(masterKey,file){const b=Buffer.from(file);if(!b.subarray(0,8).equals(PACKAGE_MAGIC))throw new Error('Not a Signal package');try{return require('node:zlib').gunzipSync(open(packageKey(masterKey),b.subarray(8),PACKAGE_MAGIC));}catch{throw new LicenseError('package','The application package could not be decrypted with this activation code (wrong build or damaged files).');}}

module.exports={machineSecret,machineId,normalizeMachineId,createVault,issueCode,verifyCode,encryptPackage,decryptPackage,LicenseError,CODE_PREFIX};
