import express,{type Request,type Response,type NextFunction} from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { z } from 'zod';
import { openDatabase } from '../database/db.ts';
import { MediaProcessor,type Media } from '../media-processing/library.ts';
import { defaults,activeRule } from '../shared-types/core.ts';
import sharp from 'sharp';
import { ffmpeg,ffprobe } from '../media-processing/process.ts';
const hash=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
const token=()=>crypto.randomBytes(32).toString('hex');
const scrypt=promisify(crypto.scrypt);
const title=z.string().trim().min(1).max(120);
const display=z.object({rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]),fit:z.enum(['cover','contain','stretch']),background:z.string().regex(/^#[0-9a-fA-F]{6}$/),width:z.number().int().min(320).max(3840).multipleOf(2),height:z.number().int().min(240).max(2160).multipleOf(2),mirrorX:z.boolean(),mirrorY:z.boolean(),keepAwake:z.boolean().default(true)});
export type AssetStore={get(path:string):Buffer|undefined};
export type LicenseInfo={customer:string;machine:string;licenseId:string;issued:number;expires:number|null};
const MIME:Record<string,string>={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',ico:'image/x-icon',json:'application/json',mp4:'video/mp4',woff2:'font/woff2',txt:'text/plain; charset=utf-8'};
export function createApp(options:{dataDir?:string;root?:string;assets?:AssetStore;license?:LicenseInfo}={}){
 const root=options.root||process.cwd(),dir=path.resolve(options.dataDir||process.env.DATA_DIR||'data');
 for(const folder of ['originals','normalized','thumbs','variants','fixtures','tmp','snapshots'])fs.mkdirSync(path.join(dir,folder),{recursive:true});
 const db=openDatabase(dir),processor=new MediaProcessor(dir),app=express();
 const allowedHosts=new Set(['localhost','127.0.0.1','::1',os.hostname().toLowerCase(),...Object.values(os.networkInterfaces()).flat().filter(Boolean).map(x=>x!.address.toLowerCase())]);
 if(process.env.PUBLIC_URL)allowedHosts.add(new URL(process.env.PUBLIC_URL).hostname.toLowerCase());
 const events=new Map<number,Set<Response>>(),builds=new Map<number,Promise<any>>(),prepared=new Map<number,any>(),previous=new Map<number,{manifest:any;until:number}>(),errors=new Map<number,string>();
 const row=(sql:string,...args:any[]):any=>db.prepare(sql).get(...args);
 const all=(sql:string,...args:any[]):any[]=>db.prepare(sql).all(...args);
 const mutate=(sql:string,...args:any[])=>db.prepare(sql).run(...args);
 // Dashboard live updates: one debounced "state changed" event fans out to every signed-in dashboard.
 const adminClients=new Set<Response>();let adminTimer:NodeJS.Timeout|null=null;
 const notifyAdmins=()=>{if(adminTimer)return;adminTimer=setTimeout(()=>{adminTimer=null;for(const r of adminClients)r.write('data: state\n\n');},200);adminTimer.unref?.();};
 const notify=(id?:number)=>{for(const [screen,clients] of events)if(!id||id===screen)for(const res of clients)res.write('data: update\n\n');notifyAdmins();};
 // Audit/activity log. Levels: info | success | warning | error. Warnings and errors surface as dashboard alerts.
 const log=(level:'info'|'success'|'warning'|'error',kind:string,message:string,screenId:number|null=null)=>{mutate('INSERT INTO activity(time,level,kind,message,screen_id) VALUES(?,?,?,?,?)',Date.now(),level,kind,message.slice(0,300),screenId);notifyAdmins();};
 const screenName=(id:number)=>row('SELECT name FROM screens WHERE id=?',id)?.name||'Display '+id;
 const playlistName=(id:string|null)=>id?row('SELECT name FROM playlists WHERE id=?',id)?.name||'a playlist':'no playlist';
 const quote=(v:string)=>'“'+v+'”';
 const wasOnline=new Map<number,boolean>(),lastEffective=new Map<number,string|null>();
 function admin(req:Request){const cookie=req.headers.cookie?.match(/(?:^|;\s*)signage=([a-f0-9]{64})(?:;|$)/)?.[1];return !!cookie&&!!row('SELECT hash FROM sessions WHERE hash=? AND expires>?',hash(cookie),Date.now());}
 function requireAdmin(req:Request,res:Response,next:NextFunction){if(!admin(req)){res.status(401).json({error:'Sign in required'});return;}next();}
 function screenAuth(req:Request){const id=Number(req.params.id),value=req.header('X-Screen-Token')||String(req.query.token||'');const s=row('SELECT * FROM screens WHERE id=?',id);return s&&value&&s.token_hash===hash(value)?s:null;}
 function requireScreen(req:Request,res:Response,next:NextFunction){const s=screenAuth(req);if(!s){res.status(401).json({error:'Screen is not paired. Pair again from the dashboard.'});return;}(req as any).screen=s;next();}
 const attempts=new Map<string,{n:number;until:number}>();
 function limit(req:Request,res:Response,next:NextFunction){const key=req.ip+req.path,now=Date.now();let a=attempts.get(key);if(!a||a.until<now){a={n:0,until:now+60000};attempts.set(key,a);}if(++a.n>15){res.status(429).json({error:'Too many attempts; wait one minute'});return;}next();}
 app.disable('x-powered-by');
 app.use((req,res,next)=>{
  if(!allowedHosts.has(req.hostname.replace(/^\[|\]$/g,'').toLowerCase())){res.status(403).json({error:'Unrecognized host. Use the PC LAN IP or configured PUBLIC_URL.'});return;}
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
  if(req.path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
   const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.headers.host){res.status(403).json({error:'Cross-origin writes are forbidden'});return;}}catch{res.status(403).end();return;}}
   if(req.header('X-Signage-Request')!=='1'){res.status(403).json({error:'Required request header missing'});return;}
  }next();
 });
 app.use(express.json({limit:'1mb'}));
 app.get('/api/setup',(_req,res)=>res.json({needsSetup:!row('SELECT id FROM admin'),ffmpeg:fs.existsSync(ffmpeg),ffprobe:fs.existsSync(ffprobe)}));
 app.post('/api/setup',limit,async(req,res)=>{
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')){res.status(403).json({error:'Create the first administrator on the host PC at localhost'});return;}
  const password=z.string().min(12).max(200).parse(req.body.password),salt=token();const key=await scrypt(password,salt,64) as Buffer;
  if(row('SELECT id FROM admin')){res.status(409).json({error:'Setup already completed'});return;}
  mutate('INSERT INTO admin(id,password) VALUES(1,?)',salt+':'+key.toString('hex'));res.json({ok:true});
 });
 app.post('/api/login',limit,async(req,res)=>{
  const password=z.string().max(200).parse(req.body.password),a=row('SELECT password FROM admin');
  const [salt,saved]=(a?.password||token()+':'+('00'.repeat(64))).split(':');const check=await scrypt(password,salt,64) as Buffer;
  if(!a||!crypto.timingSafeEqual(check,Buffer.from(saved,'hex'))){if(a)log('warning','security','Failed sign-in attempt from '+(req.ip||'unknown address'));res.status(401).json({error:'Incorrect password'});return;}
  const sid=token();mutate('INSERT INTO sessions VALUES (?,?)',hash(sid),Date.now()+12*3600000);res.cookie('signage',sid,{httpOnly:true,sameSite:'strict',maxAge:12*3600000,path:'/'});log('info','security','Administrator signed in from '+(req.ip||'unknown address'));res.json({ok:true});
 });
 app.post('/api/logout',requireAdmin,(req,res)=>{const sid=req.headers.cookie?.match(/signage=([a-f0-9]{64})/)?.[1];if(sid)mutate('DELETE FROM sessions WHERE hash=?',hash(sid));res.clearCookie('signage');res.json({ok:true});});
 function getEntries(id:string){return all('SELECT media_id as mediaId,duration FROM entries WHERE playlist_id=? ORDER BY position',id);}
 function rulesFor(id:number){return all('SELECT id,playlist_id as playlistId,days,start,end,enabled FROM schedules WHERE screen_id=? ORDER BY position',id).map(r=>({...r,enabled:!!r.enabled}));}
 /** Playlist that should be on screen right now: an active schedule slot wins over the default assignment. */
 function effective(s:any){const rule=activeRule(rulesFor(s.id),new Date());return {playlistId:(rule?rule.playlistId:s.playlist_id) as string|null,rule};}
 function desired(s:any){const e=effective(s);const p=e.playlistId?row('SELECT * FROM playlists WHERE id=?',e.playlistId):null;return s.revision+':'+(e.playlistId||'-')+':'+(p?.revision||0);}
 function prepare(id:number):Promise<any>{
  if(builds.has(id))return builds.get(id)!;
  const s=row('SELECT * FROM screens WHERE id=?',id);if(!s)return Promise.resolve(null);
  const revision=desired(s);if(prepared.get(id)?.revision===revision)return Promise.resolve(prepared.get(id));
  const job=Promise.resolve().then(async()=>{try{
   const config=JSON.parse(s.config),eff=effective(s),entries=eff.playlistId?getEntries(eff.playlistId):[],items=[];
   for(const entry of entries){const m=row('SELECT * FROM media WHERE id=?',entry.mediaId) as Media;if(m?.status==='ready'){const file=await processor.variant(m,config);items.push({mediaId:m.id,title:m.title,kind:m.kind,duration:entry.duration,videoDuration:m.duration,file});}}
   const latest=row('SELECT * FROM screens WHERE id=?',id);if(!latest||desired(latest)!==revision)return null;
   const manifest={id,name:s.name,revision,immediate:!!s.immediate,config,items};if(prepared.has(id))previous.set(id,{manifest:prepared.get(id),until:Date.now()+24*3600000});prepared.set(id,manifest);errors.delete(id);notify(id);return manifest;
  }catch(e){errors.set(id,(e as Error).message);console.error('Screen preparation',id,(e as Error).message);return null;}finally{builds.delete(id);}});builds.set(id,job);return job;
 }
 function prepareAll(){for(const s of all('SELECT id FROM screens'))void prepare(s.id);}
 function screens(){return all('SELECT * FROM screens').map(s=>({id:s.id,name:s.name,playlistId:s.playlist_id,config:JSON.parse(s.config),paired:!!s.token_hash,lastSeen:s.last_seen,online:!!s.last_seen&&Date.now()-s.last_seen<45000,currentMedia:s.current_media,diagnostics:s.diagnostics?JSON.parse(s.diagnostics):null,preparing:builds.has(s.id),error:errors.get(s.id),groupId:s.group_id,snapshotAt:s.snapshot_at,schedules:rulesFor(s.id),...(e=>({activePlaylistId:e.playlistId,activeScheduleId:e.rule?.id||null}))(effective(s)),commands:all('SELECT id,action,status,result,created FROM commands WHERE screen_id=? ORDER BY id DESC LIMIT 6',s.id)}));}
 app.get('/api/admin/state',requireAdmin,(_req,res)=>{
  const port=process.env.PORT||'3000';const urls=Object.values(os.networkInterfaces()).flat().filter(x=>x?.family==='IPv4'&&!x.internal).map(x=>`http://${x!.address}:${port}`);
  res.json({screens:screens(),media:all('SELECT * FROM media ORDER BY created DESC').map(({file,...m})=>m),playlists:all('SELECT * FROM playlists').map(p=>({...p,entries:getEntries(p.id)})),groups:all('SELECT * FROM groups ORDER BY name'),urls:process.env.PUBLIC_URL?[process.env.PUBLIC_URL]:urls,license:options.license?{customer:options.license.customer,machine:options.license.machine,licenseId:options.license.licenseId,expires:options.license.expires}:null,dataDir:dir,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,uploadLimitMB:Number(process.env.MAX_UPLOAD_MB||1024)});
 });
 app.post('/api/admin/screens',requireAdmin,(req,res)=>{const name=title.parse(req.body.name);const r=mutate('INSERT INTO screens(name,config) VALUES(?,?)',name,JSON.stringify(defaults));log('info','display','Display '+quote(name)+' added',Number(r.lastInsertRowid));res.json({id:Number(r.lastInsertRowid)});});
 app.put('/api/admin/screens/:id',requireAdmin,(req,res)=>{
  const body=z.object({name:title,playlistId:z.string().nullable(),config:display,immediate:z.boolean().default(false),groupId:z.string().nullable().optional()}).parse(req.body),id=Number(req.params.id),before=row('SELECT * FROM screens WHERE id=?',id);
  if(body.groupId&&!row('SELECT id FROM groups WHERE id=?',body.groupId)){res.status(400).json({error:'Group does not exist'});return;}
  if(body.playlistId&&!row('SELECT id FROM playlists WHERE id=?',body.playlistId)){res.status(400).json({error:'Playlist does not exist'});return;}
  const r=mutate('UPDATE screens SET name=?,playlist_id=?,config=?,revision=revision+1,immediate=? WHERE id=?',body.name,body.playlistId,JSON.stringify(body.config),+body.immediate,id);if(!r.changes){res.status(404).json({error:'Screen not found'});return;}
  if(body.groupId!==undefined)mutate('UPDATE screens SET group_id=? WHERE id=?',body.groupId,id);
  if(before.playlist_id!==body.playlistId)log('info','playlist',body.name+' now uses '+(body.playlistId?quote(playlistName(body.playlistId)):'no playlist'),id);
  if(before.name!==body.name)log('info','display','Display '+quote(before.name)+' renamed to '+quote(body.name),id);
  if(before.config!==JSON.stringify(body.config))log('info','display','Display settings changed for '+body.name,id);
  void prepare(Number(req.params.id));notify(Number(req.params.id));res.json({ok:true,message:'Saved. Media variants are prepared before player update.'});
 });
 app.delete('/api/admin/screens/:id',requireAdmin,(req,res)=>{const id=Number(req.params.id),name=screenName(id);mutate('DELETE FROM screens WHERE id=?',id);void fsp.rm(path.join(dir,'snapshots',id+'.jpg'),{force:true});wasOnline.delete(id);log('warning','display','Display '+quote(name)+' removed');prepared.delete(id);notify(id);for(const client of events.get(id)||[])client.end();events.delete(id);res.json({ok:true});});
 app.post('/api/admin/screens/:id/pair',requireAdmin,(req,res)=>{const code=crypto.randomBytes(5).toString('hex').toUpperCase(),expires=Date.now()+10*60000;mutate('UPDATE screens SET pair_hash=?,pair_expires=? WHERE id=?',hash(code),expires,Number(req.params.id));log('info','security','Pairing code created for '+screenName(Number(req.params.id)),Number(req.params.id));res.json({code,expires});});
 app.post('/api/admin/screens/:id/revoke',requireAdmin,(req,res)=>{const id=Number(req.params.id);mutate('UPDATE screens SET token_hash=NULL,pair_hash=NULL,last_seen=NULL,snapshot_at=NULL WHERE id=?',id);void fsp.rm(path.join(dir,'snapshots',id+'.jpg'),{force:true});wasOnline.set(id,false);log('warning','security','Access revoked for '+screenName(id),id);notify(id);for(const client of events.get(id)||[])client.end();events.delete(id);res.json({ok:true});});
 app.post('/api/screens/:id/pair',limit,(req,res)=>{
  const code=z.string().max(20).parse(req.body.code).trim().toUpperCase(),id=Number(req.params.id);const s=row('SELECT * FROM screens WHERE id=? AND pair_hash=? AND pair_expires>?',id,hash(code),Date.now());
  if(!s){res.status(403).json({error:'Invalid or expired code'});return;}const value=token();mutate('UPDATE screens SET token_hash=?,pair_hash=NULL,pair_expires=NULL WHERE id=?',hash(value),id);log('success','security',s.name+' paired',id);for(const client of events.get(id)||[])client.end();events.delete(id);res.json({token:value});
 });
 app.post('/api/admin/playlists',requireAdmin,(req,res)=>{const id=crypto.randomUUID(),name=title.parse(req.body.name);mutate('INSERT INTO playlists(id,name) VALUES (?,?)',id,name);log('info','playlist','Playlist '+quote(name)+' created');res.json({id});});
 app.put('/api/admin/playlists/:id',requireAdmin,(req,res)=>{
  const p=z.object({name:title,entries:z.array(z.object({mediaId:z.string(),duration:z.number().min(1).max(86400)})).max(1000),immediate:z.boolean().default(false)}).parse(req.body),id=String(req.params.id);
  if(!row('SELECT id FROM playlists WHERE id=?',id)){res.status(404).json({error:'Playlist not found'});return;}
  if(p.entries.some(e=>!row("SELECT id FROM media WHERE id=? AND status='ready'",e.mediaId))){res.status(400).json({error:'Every item must finish processing before publishing'});return;}
  db.exec('BEGIN');try{mutate('UPDATE playlists SET name=?,revision=revision+1 WHERE id=?',p.name,id);mutate('DELETE FROM entries WHERE playlist_id=?',id);p.entries.forEach((e,i)=>mutate('INSERT INTO entries VALUES(?,?,?,?)',id,i,e.mediaId,e.duration));mutate('UPDATE screens SET immediate=? WHERE playlist_id=?',+p.immediate,id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  prepareAll();notify();log('success','playlist','Playlist '+quote(p.name)+' published ('+p.entries.length+' item'+(p.entries.length===1?'':'s')+')');res.json({ok:true});
 });
 app.delete('/api/admin/playlists/:id',requireAdmin,(req,res)=>{const id=String(req.params.id);if(row('SELECT id FROM screens WHERE playlist_id=?',id)){res.status(409).json({error:'Unassign this playlist from all screens first'});return;}if(row('SELECT id FROM schedules WHERE playlist_id=?',id)){res.status(409).json({error:'Remove this playlist from display schedules first'});return;}const name=playlistName(id);mutate('DELETE FROM playlists WHERE id=?',id);log('warning','playlist','Playlist '+quote(name)+' deleted');res.json({ok:true});});
 const upload=multer({dest:path.join(dir,'tmp'),limits:{fileSize:Number(process.env.MAX_UPLOAD_MB||1024)*1024*1024,files:20}});
 async function processMedia(id:string){const m=row('SELECT * FROM media WHERE id=?',id);try{await processor.normalize(m);mutate("UPDATE media SET status='ready',error=NULL WHERE id=?",id);log('success','content',quote(m.title)+' is ready');prepareAll();}catch(e){mutate("UPDATE media SET status='error',error=? WHERE id=?",'Conversion failed: '+(e as Error).message,id);log('error','content','Conversion failed for '+quote(m.title)+': '+(e as Error).message);}}
 app.post('/api/admin/media',requireAdmin,upload.array('files',20),async(req,res)=>{
  const results=[];for(const f of req.files as Express.Multer.File[]){const id=crypto.randomUUID(),file=id+'.bin';try{
   const info=await processor.inspect(f.path);await fsp.rename(f.path,path.join(dir,'originals',file));
   mutate('INSERT INTO media(id,title,original,kind,file,size,width,height,duration,animated,status,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,f.originalname.slice(0,120),f.originalname.slice(0,240),info.kind,file,f.size,info.width,info.height,info.duration,info.animated,'processing',Date.now());
   log('info','content',quote(f.originalname.slice(0,120))+' uploaded');void processor.queue(()=>processMedia(id));results.push({id,name:f.originalname,status:'processing'});
  }catch(e){await fsp.rm(f.path,{force:true});results.push({name:f.originalname,error:(e as Error).message});}}res.json({results});
 });
 app.post('/api/admin/media/:id/retry',requireAdmin,(req,res)=>{const id=String(req.params.id);const m=row('SELECT * FROM media WHERE id=?',id);if(!m||m.status!=='error'){res.status(409).json({error:'Only failed conversions can be retried'});return;}mutate("UPDATE media SET status='processing',error=NULL WHERE id=?",id);log('info','content','Retrying conversion of '+quote(m.title));void processor.queue(()=>processMedia(id));res.json({ok:true});});
 app.patch('/api/admin/media/:id',requireAdmin,(req,res)=>{mutate('UPDATE media SET title=? WHERE id=?',title.parse(req.body.title),String(req.params.id));notifyAdmins();res.json({ok:true});});
 app.delete('/api/admin/media/:id',requireAdmin,async(req,res)=>{const id=String(req.params.id),m=row('SELECT * FROM media WHERE id=?',id);if(!m){res.status(404).end();return;}if(m.status==='processing'||row('SELECT media_id FROM entries WHERE media_id=?',id)){res.status(409).json({error:'Remove this media from all playlists and wait for processing before deleting'});return;}mutate('DELETE FROM media WHERE id=?',id);log('warning','content',quote(m.title)+' deleted');await fsp.rm(path.join(dir,'originals',m.file),{force:true});for(const folder of ['normalized','thumbs','variants'])for(const file of await fsp.readdir(path.join(dir,folder)))if(file.startsWith(id))await fsp.rm(path.join(dir,folder,file),{force:true});res.json({ok:true});});
 app.get('/api/admin/media/:id/thumbnail',requireAdmin,(req,res)=>{const m=row('SELECT id FROM media WHERE id=?',String(req.params.id));if(!m){res.status(404).end();return;}res.sendFile(path.join(dir,'thumbs',m.id+'.jpg'));});
 app.get('/api/admin/media/:id/preview',requireAdmin,(req,res)=>{const m=row('SELECT * FROM media WHERE id=?',String(req.params.id));if(!m||m.status!=='ready'){res.status(404).end();return;}res.sendFile(path.join(dir,m.kind==='video'?'normalized':'originals',m.kind==='video'?m.id+'.mp4':m.file));});
 app.post('/api/admin/screens/:id/commands',requireAdmin,(req,res)=>{const action=z.enum(['play','pause','next','reload','mute','unmute']).parse(req.body.action);if(!row('SELECT id FROM screens WHERE id=?',Number(req.params.id))){res.status(404).end();return;}const r=mutate('INSERT INTO commands(screen_id,action,created) VALUES(?,?,?)',Number(req.params.id),action,Date.now());log('info','command',action[0].toUpperCase()+action.slice(1)+' sent to '+screenName(Number(req.params.id)),Number(req.params.id));notify(Number(req.params.id));res.json({id:Number(r.lastInsertRowid),status:'pending',message:'Queued; delivery is confirmed by the player acknowledgment.'});});
 app.get('/api/screens/:id/manifest',requireScreen,(req,res)=>{const id=Number(req.params.id);void prepare(id);const manifest=prepared.get(id);res.json(manifest||{id,revision:'pending',items:[],preparing:builds.has(id),error:errors.get(id),config:JSON.parse((req as any).screen.config)});});
 app.post('/api/screens/:id/heartbeat',requireScreen,(req,res)=>{
  const b=z.object({currentMedia:z.string().max(100).nullable().optional(),userAgent:z.string().max(1000).optional(),viewport:z.string().max(40).optional(),errors:z.array(z.string().max(500)).max(15).optional(),state:z.string().max(100).optional(),muted:z.boolean().optional(),awake:z.string().max(40).optional(),ack:z.array(z.object({id:z.number().int(),ok:z.boolean(),message:z.string().max(300)})).max(30).optional()}).parse(req.body),id=Number(req.params.id);
  const prev=(req as any).screen,prevDiag=prev.diagnostics?JSON.parse(prev.diagnostics):{};
  mutate('UPDATE screens SET last_seen=?,current_media=?,diagnostics=? WHERE id=?',Date.now(),b.currentMedia||null,JSON.stringify({...b,ack:undefined}),id);
  if(wasOnline.get(id)===false)log('success','display',prev.name+' is back online',id);wasOnline.set(id,true);
  if(prev.current_media!==(b.currentMedia||null)||prevDiag.state!==b.state||prevDiag.muted!==b.muted||(b.ack||[]).length)notifyAdmins();
  for(const ack of b.ack||[]){const r=mutate("UPDATE commands SET status=?,result=? WHERE id=? AND screen_id=? AND status='pending'",ack.ok?'success':'failed',ack.message,ack.id,id);if(r.changes&&!ack.ok)log('warning','command',prev.name+' could not run a command: '+ack.message,id);}
  mutate("UPDATE commands SET status='expired',result='No acknowledgment within 60 seconds' WHERE screen_id=? AND status='pending' AND created<?",id,Date.now()-60000);
  res.json({commands:all("SELECT id,action FROM commands WHERE screen_id=? AND status='pending' ORDER BY id",id)});
 });
 app.get('/api/screens/:id/events',requireScreen,(req,res)=>{const id=Number(req.params.id);res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-store');res.flushHeaders();res.write('data: connected\n\n');if(!events.has(id))events.set(id,new Set());events.get(id)!.add(res);const timer=setInterval(()=>res.write(': keepalive\n\n'),15000);req.on('close',()=>{clearInterval(timer);events.get(id)?.delete(res);});});
 // ---- Player snapshots: a small frame of what the browser player renders (not a capture of the physical panel).
 app.post('/api/screens/:id/snapshot',requireScreen,async(req,res)=>{
  const b=z.object({image:z.string().max(700000).regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/)}).parse(req.body),id=Number(req.params.id),s=(req as any).screen;
  if(s.snapshot_at&&Date.now()-s.snapshot_at<5000){res.status(429).json({error:'Snapshots are limited to one every 5 seconds'});return;}
  // Re-encode through sharp so only a clean, bounded JPEG is ever stored or served.
  try{await sharp(Buffer.from(b.image.slice(b.image.indexOf(',')+1),'base64'),{limitInputPixels:3840*2160}).resize(480,480,{fit:'inside',withoutEnlargement:true}).jpeg({quality:72}).toFile(path.join(dir,'snapshots',id+'.jpg'));}
  catch{res.status(400).json({error:'Invalid snapshot image'});return;}
  mutate('UPDATE screens SET snapshot_at=? WHERE id=?',Date.now(),id);notifyAdmins();res.json({ok:true});
 });
 app.get('/api/admin/screens/:id/snapshot',requireAdmin,(req,res)=>{const id=Number(req.params.id),s=row('SELECT snapshot_at FROM screens WHERE id=?',id),file=path.join(dir,'snapshots',id+'.jpg');if(!s?.snapshot_at||!fs.existsSync(file)){res.status(404).end();return;}res.setHeader('Cache-Control','private, no-cache');res.sendFile(file);});
 // ---- Display groups
 app.post('/api/admin/groups',requireAdmin,(req,res)=>{const id=crypto.randomUUID(),name=title.parse(req.body.name);mutate('INSERT INTO groups(id,name) VALUES(?,?)',id,name);log('info','display','Group '+quote(name)+' created');res.json({id});});
 app.patch('/api/admin/groups/:id',requireAdmin,(req,res)=>{const name=title.parse(req.body.name),r=mutate('UPDATE groups SET name=? WHERE id=?',name,String(req.params.id));if(!r.changes){res.status(404).json({error:'Group not found'});return;}notifyAdmins();res.json({ok:true});});
 app.delete('/api/admin/groups/:id',requireAdmin,(req,res)=>{const g=row('SELECT * FROM groups WHERE id=?',String(req.params.id));if(!g){res.status(404).json({error:'Group not found'});return;}mutate('UPDATE screens SET group_id=NULL WHERE group_id=?',g.id);mutate('DELETE FROM groups WHERE id=?',g.id);log('warning','display','Group '+quote(g.name)+' deleted; its displays are now ungrouped');res.json({ok:true});});
 app.post('/api/admin/groups/:id/assign',requireAdmin,(req,res)=>{
  const playlistId=z.object({playlistId:z.string().nullable()}).parse(req.body).playlistId,g=row('SELECT * FROM groups WHERE id=?',String(req.params.id));
  if(!g){res.status(404).json({error:'Group not found'});return;}if(playlistId&&!row('SELECT id FROM playlists WHERE id=?',playlistId)){res.status(400).json({error:'Playlist does not exist'});return;}
  const ids=all('SELECT id FROM screens WHERE group_id=?',g.id).map(s=>s.id as number);mutate('UPDATE screens SET playlist_id=?,revision=revision+1,immediate=0 WHERE group_id=?',playlistId,g.id);
  ids.forEach(id=>void prepare(id));notify();log('info','playlist','Group '+quote(g.name)+' ('+ids.length+' display'+(ids.length===1?'':'s')+') now uses '+(playlistId?quote(playlistName(playlistId)):'no playlist'));res.json({ok:true,count:ids.length});
 });
 // ---- Day-part schedules (ordered; first matching slot wins; otherwise the default playlist plays)
 const slot=z.object({playlistId:z.string(),days:z.number().int().min(1).max(127),start:z.number().int().min(0).max(1439),end:z.number().int().min(0).max(1439),enabled:z.boolean().default(true)});
 app.put('/api/admin/screens/:id/schedules',requireAdmin,(req,res)=>{
  const rules=z.object({rules:z.array(slot).max(50)}).parse(req.body).rules,id=Number(req.params.id);
  if(!row('SELECT id FROM screens WHERE id=?',id)){res.status(404).json({error:'Screen not found'});return;}
  if(rules.some(r=>!row('SELECT id FROM playlists WHERE id=?',r.playlistId))){res.status(400).json({error:'Every time slot needs an existing playlist'});return;}
  db.exec('BEGIN');try{mutate('DELETE FROM schedules WHERE screen_id=?',id);rules.forEach((r,i)=>mutate('INSERT INTO schedules(id,screen_id,position,playlist_id,days,start,end,enabled) VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),id,i,r.playlistId,r.days,r.start,r.end,+r.enabled));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  lastEffective.set(id,effective(row('SELECT * FROM screens WHERE id=?',id)).playlistId);void prepare(id);notify(id);log('info','schedule','Schedule updated for '+screenName(id)+' ('+rules.length+' time slot'+(rules.length===1?'':'s')+')',id);res.json({ok:true});
 });
 // ---- Activity log + live dashboard stream
 app.get('/api/admin/activity',requireAdmin,(req,res)=>{
  const q=z.object({before:z.coerce.number().int().positive().optional(),limit:z.coerce.number().int().min(1).max(200).default(50),level:z.enum(['all','alert']).default('all'),kind:z.enum(['display','content','playlist','schedule','command','security']).optional()}).parse(req.query);
  const where=['1=1'],args:any[]=[];if(q.before){where.push('id<?');args.push(q.before);}if(q.level==='alert')where.push("level IN ('warning','error')");if(q.kind){where.push('kind=?');args.push(q.kind);}
  res.json({items:all(`SELECT id,time,level,kind,message,screen_id as screenId FROM activity WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,...args,q.limit),latest:row('SELECT MAX(id) as id FROM activity')?.id||0});
 });
 app.get('/api/admin/events',requireAdmin,(req,res)=>{res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-store');res.flushHeaders();res.write('data: connected\n\n');adminClients.add(res);const timer=setInterval(()=>res.write(': keepalive\n\n'),15000);req.on('close',()=>{clearInterval(timer);adminClients.delete(res);});});
 function streamVariant(req:Request,res:Response,id:number,preview:boolean){const key=String(req.params.file);const manifest=prepared.get(id),old=previous.get(id);const allowed=manifest?.items.some((item:any)=>item.file===key)||(old&&old.until>Date.now()&&old.manifest.items.some((item:any)=>item.file===key));if(!/^[a-f0-9-]+\.(mp4|gif|jpg)$/.test(key)||!allowed){res.status(403).end();return;}res.setHeader('Cache-Control','private, max-age=3600');res.sendFile(path.join(dir,'variants',key));}
 app.get('/api/screens/:id/media/:file',requireScreen,(req,res)=>streamVariant(req,res,Number(req.params.id),false));
 app.get('/api/admin/screens/:id/manifest',requireAdmin,async(req,res)=>{const id=Number(req.params.id);void prepare(id);res.json(prepared.get(id)||{id,revision:'pending',items:[],config:defaults});});
 app.get('/api/admin/screens/:id/media/:file',requireAdmin,(req,res)=>streamVariant(req,res,Number(req.params.id),true));
 // Packaged installs serve dashboard/player files from decrypted memory (no readable copies on disk).
 const assets=options.assets;
 function sendAsset(req:Request,res:Response,next:NextFunction,rel:string){
  const body=assets!.get(rel);if(!body){next();return;}
  res.setHeader('Content-Type',MIME[rel.split('.').pop()!.toLowerCase()]||'application/octet-stream');res.setHeader('Accept-Ranges','bytes');
  res.setHeader('Cache-Control',rel.endsWith('.html')?'no-cache':rel.startsWith('dashboard/assets/')?'public, max-age=31536000, immutable':'private, max-age=3600');
  const m=/^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range||''));
  if(m&&(m[1]||m[2])){let start=m[1]?Number(m[1]):Math.max(0,body.length-Number(m[2])),end=m[1]&&m[2]?Math.min(Number(m[2]),body.length-1):body.length-1;if(!m[1])end=body.length-1;
   if(start>end||start>=body.length){res.status(416).setHeader('Content-Range','bytes */'+body.length);res.end();return;}
   res.status(206).setHeader('Content-Range',`bytes ${start}-${end}/${body.length}`);res.setHeader('Content-Length',String(end-start+1));res.end(req.method==='HEAD'?undefined:body.subarray(start,end+1));return;}
  res.setHeader('Content-Length',String(body.length));res.end(req.method==='HEAD'?undefined:body);
 }
 if(assets){
  app.get('/compat',(req,res,next)=>sendAsset(req,res,next,'tv-player/compat.html'));
  app.get('/player/:file',(req,res,next)=>sendAsset(req,res,next,'tv-player/'+req.params.file));
  app.get('/tv/:id',(req,res,next)=>sendAsset(req,res,next,'tv-player/index.html'));
  app.use('/admin',(req,res,next)=>{if(req.method!=='GET'&&req.method!=='HEAD'){next();return;}if(req.originalUrl==='/admin'){res.redirect('/admin/');return;}const p=req.path.endsWith('/')?req.path+'index.html':req.path;sendAsset(req,res,next,'dashboard'+p);});
 }
 app.get('/compat',(_req,res)=>res.sendFile(path.join(root,'tv-player','compat.html')));
 app.use('/fixtures',express.static(path.join(dir,'fixtures'),{index:false,dotfiles:'deny'}));
 app.use('/player',express.static(path.join(root,'tv-player'),{index:false}));
 app.get('/tv/:id',(_req,res)=>res.sendFile(path.join(root,'tv-player','index.html')));
 app.use('/admin',express.static(path.join(root,'dist','dashboard')));
 app.get('/',(_req,res)=>res.redirect('/admin/'));
 app.use((err:any,_req:Request,res:Response,_next:NextFunction)=>{console.error(new Date().toISOString(),err.message);res.status(err instanceof z.ZodError?400:err instanceof multer.MulterError?400:500).json({error:err instanceof z.ZodError?'Invalid input: '+err.issues.map((i:any)=>i.path.join('.')+' '+i.message).join('; '):err instanceof multer.MulterError?err.message:'Request failed. Check server log.'});});
 const cleanup=setInterval(()=>{mutate('DELETE FROM sessions WHERE expires<?',Date.now());mutate("UPDATE commands SET status='expired',result='Player did not acknowledge in 60 seconds' WHERE status='pending' AND created<?",Date.now()-60000);mutate('DELETE FROM commands WHERE created<?',Date.now()-7*86400000);for(const [key,value] of attempts)if(value.until<Date.now())attempts.delete(key);},30000);cleanup.unref();
 // Presence + schedule ticker: logs online/offline transitions and switches day-part playlists on time.
 for(const s of all('SELECT * FROM screens')){wasOnline.set(s.id,!!s.last_seen&&Date.now()-s.last_seen<45000);lastEffective.set(s.id,effective(s).playlistId);}
 const ticker=setInterval(()=>{for(const s of all('SELECT * FROM screens')){
  const online=!!s.last_seen&&Date.now()-s.last_seen<45000,was=wasOnline.get(s.id);
  if(was!==undefined&&was!==online){if(online)log('success','display',s.name+' is back online',s.id);else if(s.token_hash)log('warning','display',s.name+' went offline (no heartbeat for 45 seconds)',s.id);}
  wasOnline.set(s.id,online);
  const e=effective(s).playlistId;if(lastEffective.has(s.id)&&lastEffective.get(s.id)!==e)log('info','schedule','Schedule switched '+s.name+' to '+(e?quote(playlistName(e)):'no playlist'),s.id);lastEffective.set(s.id,e);
  if(prepared.get(s.id)?.revision!==desired(s)&&!builds.has(s.id))void prepare(s.id);
 }mutate('DELETE FROM activity WHERE time<?',Date.now()-90*86400000);},10000);ticker.unref();
 return {app,db,processor,prepare,close:()=>{clearInterval(cleanup);clearInterval(ticker);if(adminTimer)clearTimeout(adminTimer);for(const r of adminClients)r.end();for(const clients of events.values())for(const res of clients)res.end();db.close();}};
}
