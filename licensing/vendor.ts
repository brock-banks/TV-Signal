// Vendor licensing tool — stays with you, never shipped.
//   npm run license -- init                                  create signing keys + master key (once; back them up offline)
//   npm run license -- issue --machine ABCDE-... --customer "Acme Ltd" [--expires 2027-12-31 | --days 365] [--note "Lobby PC"]
//   npm run license -- list                                  show issued codes
//   npm run license -- machine-id                            Machine ID of this PC
//   npm run license -- verify --code SGNL1... --machine ABCDE-...
// Vault location: ./license-vault (or SIGNAL_VAULT). It holds secrets: never commit, email or ship it.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const core=createRequire(import.meta.url)('./core.cjs');

export const vaultDir=path.resolve(process.env.SIGNAL_VAULT||'license-vault');
const file=(n:string)=>path.join(vaultDir,n);
export function loadVault(){
 if(!fs.existsSync(file('master.key')))throw new Error(`No license vault at ${vaultDir}. Run: npm run license -- init`);
 return {privateKeyPem:fs.readFileSync(file('signing-private.pem'),'utf8'),publicKeyPem:fs.readFileSync(file('signing-public.pem'),'utf8'),masterKey:Buffer.from(fs.readFileSync(file('master.key'),'utf8').trim(),'base64')};
}
/** Value after --name. A flag given without a value (or followed by another flag) is an error, never silently ignored. */
function arg(name:string){const i=process.argv.indexOf('--'+name);if(i<0)return undefined;const v=process.argv[i+1];if(v===undefined||v.startsWith('--')){console.error(`--${name} needs a value.`);process.exit(1);}return v;}
const csvCell=(v:string)=>'"'+String(v).replace(/"/g,'""')+'"';

function main(){
 const cmd=process.argv[2];
 if(cmd==='init'){
  if(fs.existsSync(file('master.key'))&&!process.argv.includes('--force')){console.error(`A vault already exists at ${vaultDir}.\nRe-initialising would invalidate every release and activation code you have issued. Use --force only if you really mean it.`);process.exit(1);}
  const v=core.createVault();fs.mkdirSync(vaultDir,{recursive:true});
  fs.writeFileSync(file('signing-private.pem'),v.privateKeyPem,{mode:0o600});fs.writeFileSync(file('signing-public.pem'),v.publicKeyPem);
  fs.writeFileSync(file('master.key'),v.masterKey.toString('base64')+'\n',{mode:0o600});
  if(!fs.existsSync(file('issued.csv')))fs.writeFileSync(file('issued.csv'),'issued,license_id,customer,machine_id,expires,note\n');
  fs.writeFileSync(file('README.txt'),'Signal license vault.\n\nsigning-private.pem and master.key are SECRET. Anyone holding them can create activation codes and decrypt releases.\nBack up this folder to offline storage (e.g. an encrypted USB drive). If it is lost you cannot issue codes for existing builds.\nNever commit, email or ship it.\n');
  console.log(`Created license vault at ${vaultDir}\nBack it up offline now. Keep it out of source control and out of any release.`);return;
 }
 if(cmd==='machine-id'){console.log(core.machineId());return;}
 if(cmd==='issue'){
  const machine=arg('machine'),customer=arg('customer'),note=arg('note')||'';
  if(!machine||!customer){console.error('Usage: npm run license -- issue --machine ABCDE-FGHJK-LMNPQ-RSTUV --customer "Acme Ltd" [--expires 2027-12-31 | --days 365] [--note "Lobby PC"]');process.exit(1);}
  let expires:number|null=null;
  if(arg('expires')){expires=Date.parse(arg('expires')+'T23:59:59');if(!Number.isFinite(expires)){console.error('Use --expires YYYY-MM-DD');process.exit(1);}}
  else if(arg('days')){const days=Number(arg('days'));if(!Number.isInteger(days)||days<1||days>36500){console.error('--days must be a whole number of days, e.g. --days 365');process.exit(1);}expires=Date.now()+days*86400000;}
  if(arg('expires')&&arg('days')){console.error('Use either --expires or --days, not both.');process.exit(1);}
  const v=loadVault();const r=core.issueCode({...v,machine,customer,expires,note});
  fs.appendFileSync(file('issued.csv'),[new Date().toISOString(),r.licenseId,customer,r.machine,expires?new Date(expires).toISOString().slice(0,10):'never',note].map(csvCell).join(',')+'\n');
  fs.mkdirSync(file('codes'),{recursive:true});const out=file(path.join('codes',`${customer.replace(/[^\w.-]+/g,'_')}-${r.machine}.key`));fs.writeFileSync(out,r.code+'\n');
  console.log(`Activation code for ${customer} (Machine ID ${r.machine}, ${expires?'expires '+new Date(expires).toISOString().slice(0,10):'no expiry'}):\n\n${r.code}\n\nAlso saved to ${out}\nThe customer pastes it on the activation page (http://localhost:3000 on their PC), runs activate.bat <code>, or saves it as license.key in the install folder.`);return;
 }
 if(cmd==='list'){console.log(fs.existsSync(file('issued.csv'))?fs.readFileSync(file('issued.csv'),'utf8'):'No codes issued yet.');return;}
 if(cmd==='verify'){const v=loadVault();try{const i=core.verifyCode(arg('code')||'',{publicKeyPem:v.publicKeyPem,machine:arg('machine')||core.machineId()});console.log(`Valid: ${i.customer}, machine ${i.machine}, ${i.expires?'expires '+new Date(i.expires).toISOString().slice(0,10):'no expiry'}, license ${i.licenseId}`);}catch(e){console.error('Invalid: '+(e as Error).message);process.exit(1);}return;}
 console.log('Commands: init | issue | list | machine-id | verify   (see the header of licensing/vendor.ts)');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
