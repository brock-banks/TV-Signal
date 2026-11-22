import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';
import {createApp} from '../server/app.ts';
import {openDatabase,SCHEMA_VERSION} from '../database/db.ts';
import {activeRule} from '../shared-types/core.ts';

const WEEKDAYS=62,ALL=127;
const at=(day:number,h:number,m=0)=>{const d=new Date(2026,10,15+((day-0+7)%7));/* 2026-11-15 is a Sunday */d.setHours(h,m,0,0);return d;};

test('schedule rules: day mask, ranges, overnight, all-day, priority, disabled',()=>{
 assert.equal(at(0,12).getDay(),0);
 const morning={id:'a',playlistId:'am',days:WEEKDAYS,start:6*60,end:11*60,enabled:true};
 const night={id:'b',playlistId:'night',days:1<<5,start:22*60,end:2*60,enabled:true};// Friday 22:00 → Saturday 02:00
 const weekend={id:'c',playlistId:'wk',days:(1<<0)|(1<<6),start:0,end:0,enabled:true};
 const off={id:'d',playlistId:'off',days:ALL,start:0,end:0,enabled:false};
 const rules=[off,morning,night,weekend];
 assert.equal(activeRule(rules,at(1,6))?.playlistId,'am');
 assert.equal(activeRule(rules,at(1,10,59))?.playlistId,'am');
 assert.equal(activeRule(rules,at(1,11)),null,'end is exclusive');
 assert.equal(activeRule(rules,at(5,23))?.playlistId,'night');
 assert.equal(activeRule(rules,at(6,1,30))?.playlistId,'night','overnight continues into next day before weekend rule');
 assert.equal(activeRule(rules,at(6,2))?.playlistId,'wk');
 assert.equal(activeRule(rules,at(4,1)),null,'overnight only follows the selected start day');
 assert.equal(activeRule([],at(1,9)),null);
});

test('schema v1 databases upgrade to v2 transactionally without losing data',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'signage-mig-'));
 const v1=new DatabaseSync(path.join(dir,'signage.sqlite'));
 v1.exec(`CREATE TABLE admin (id INTEGER PRIMARY KEY CHECK(id=1), password TEXT NOT NULL);
 CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
 CREATE TABLE media (id TEXT PRIMARY KEY, title TEXT NOT NULL, original TEXT NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0, duration REAL DEFAULT 0, animated INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT, created INTEGER NOT NULL);
 CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE entries (playlist_id TEXT REFERENCES playlists(id) ON DELETE CASCADE, position INTEGER, media_id TEXT REFERENCES media(id), duration REAL NOT NULL DEFAULT 10, PRIMARY KEY(playlist_id,position));
 CREATE TABLE screens (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL, config TEXT NOT NULL, token_hash TEXT, pair_hash TEXT, pair_expires INTEGER, last_seen INTEGER, current_media TEXT, diagnostics TEXT, revision INTEGER NOT NULL DEFAULT 1, immediate INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE commands (id INTEGER PRIMARY KEY AUTOINCREMENT, screen_id INTEGER REFERENCES screens(id) ON DELETE CASCADE, action TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result TEXT);
 INSERT INTO playlists(id,name) VALUES('p1','Legacy');INSERT INTO screens(name,config,playlist_id,token_hash) VALUES('Old TV','{}','p1','abc');PRAGMA user_version=1;`);
 v1.close();
 const db=openDatabase(dir);
 assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version,SCHEMA_VERSION);
 const s=db.prepare('SELECT * FROM screens').get() as any;
 assert.equal(s.name,'Old TV');assert.equal(s.playlist_id,'p1');assert.equal(s.token_hash,'abc');assert.equal(s.group_id,null);assert.equal(s.snapshot_at,null);
 for(const t of ['activity','groups','schedules'])assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t),t+' table exists');
 db.close();
 const again=openDatabase(dir);assert.equal((again.prepare('PRAGMA user_version').get() as any).user_version,SCHEMA_VERSION);again.close();
 const newer=new DatabaseSync(path.join(dir,'signage.sqlite'));newer.exec('PRAGMA user_version=99');newer.close();
 assert.throws(()=>openDatabase(dir),/newer/);
 await fs.rm(dir,{recursive:true,force:true});
});

test('activity log, alerts, groups, schedules, snapshots and live dashboard stream',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'signage-feat-'));const service=createApp({dataDir:dir});const server=service.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+(server.address() as any).port;let cookie='';
 const req=(url:string,method='GET',body?:any,headers:Record<string,string>={})=>fetch(base+url,{method,headers:{'X-Signage-Request':'1','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
 try{
  assert.equal((await req('/api/admin/events')).status,401,'live stream requires sign-in');
  assert.equal((await req('/api/admin/activity')).status,401);
  await req('/api/setup','POST',{password:'a-long-password-123'});
  assert.equal((await req('/api/login','POST',{password:'wrong-password'})).status,401);
  const login=await req('/api/login','POST',{password:'a-long-password-123'});cookie=login.headers.get('set-cookie')!.split(';')[0];

  // Activity: sign-in and failed sign-in are recorded; alert filter only returns warnings/errors.
  let act=await (await req('/api/admin/activity')).json();
  assert.ok(act.items.some((a:any)=>/signed in/.test(a.message)));
  const alerts=await (await req('/api/admin/activity?level=alert')).json();
  assert.ok(alerts.items.length>=1&&alerts.items.every((a:any)=>a.level==='warning'||a.level==='error'));
  assert.ok(alerts.items.some((a:any)=>/Failed sign-in/.test(a.message)));
  assert.equal((await req('/api/admin/activity?limit=9999')).status,400);

  // Live stream delivers an initial event to a signed-in dashboard.
  const ctrl=new AbortController();const stream=await fetch(base+'/api/admin/events',{headers:{Cookie:cookie},signal:ctrl.signal});
  assert.equal(stream.status,200);assert.match(stream.headers.get('content-type')||'',/text\/event-stream/);
  const reader=stream.body!.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/data: connected/);
  const pl=await (await req('/api/admin/playlists','POST',{name:'Evening'})).json();
  const pushed=new TextDecoder().decode((await reader.read()).value);assert.match(pushed,/data: state/,'mutations push a state event');
  ctrl.abort();

  // Groups
  const g=await (await req('/api/admin/groups','POST',{name:'Lobby'})).json();
  let state=await (await req('/api/admin/state')).json();const config=state.screens[0].config;
  assert.equal(state.groups[0].name,'Lobby');
  assert.equal((await req('/api/admin/screens/1','PUT',{name:'TV 1',playlistId:null,config,groupId:'missing'})).status,400);
  assert.equal((await req('/api/admin/screens/1','PUT',{name:'TV 1',playlistId:null,config,groupId:g.id})).status,200);
  assert.equal((await req('/api/admin/screens/2','PUT',{name:'TV 2',playlistId:null,config,groupId:g.id})).status,200);
  assert.equal((await req('/api/admin/screens/3','PUT',{name:'TV 3',playlistId:null,config})).status,200,'groupId is optional and preserved');
  const assigned=await (await req('/api/admin/groups/'+g.id+'/assign','POST',{playlistId:pl.id})).json();assert.equal(assigned.count,2);
  state=await (await req('/api/admin/state')).json();
  assert.deepEqual(state.screens.map((s:any)=>s.playlistId),[pl.id,pl.id,null]);
  assert.equal(state.screens[0].groupId,g.id);
  assert.equal((await req('/api/admin/groups/'+g.id,'PATCH',{name:'Lobby west'})).status,200);
  assert.equal((await req('/api/admin/groups/'+g.id+'/assign','POST',{playlistId:'missing'})).status,400);

  // Schedules: all-day slot today overrides the default; validation; playlist deletion is blocked while scheduled.
  const am=await (await req('/api/admin/playlists','POST',{name:'Morning'})).json();
  assert.equal((await req('/api/admin/screens/3/schedules','PUT',{rules:[{playlistId:'missing',days:127,start:0,end:0}]})).status,400);
  assert.equal((await req('/api/admin/screens/3/schedules','PUT',{rules:[{playlistId:am.id,days:0,start:0,end:0}]})).status,400,'at least one day');
  assert.equal((await req('/api/admin/screens/3/schedules','PUT',{rules:[{playlistId:am.id,days:127,start:0,end:1440}]})).status,400,'minutes stay within a day');
  assert.equal((await req('/api/admin/screens/3/schedules','PUT',{rules:[{playlistId:am.id,days:127,start:0,end:0,enabled:true}]})).status,200);
  state=await (await req('/api/admin/state')).json();const tv3=state.screens.find((s:any)=>s.id===3);
  assert.equal(tv3.playlistId,null,'default assignment is unchanged');assert.equal(tv3.activePlaylistId,am.id);assert.ok(tv3.activeScheduleId);assert.equal(tv3.schedules.length,1);
  assert.equal((await req('/api/admin/playlists/'+am.id,'DELETE')).status,409);
  await req('/api/admin/screens/3/schedules','PUT',{rules:[{playlistId:am.id,days:127,start:0,end:0,enabled:false}]});
  state=await (await req('/api/admin/state')).json();assert.equal(state.screens.find((s:any)=>s.id===3).activePlaylistId,null,'disabled slots are ignored');
  await req('/api/admin/screens/3/schedules','PUT',{rules:[]});
  assert.equal((await req('/api/admin/playlists/'+am.id,'DELETE')).status,200);

  // Snapshots: only a paired screen may post; images are re-encoded; rate-limited; admin-only download.
  const pair=await (await req('/api/admin/screens/1/pair','POST')).json();
  const tok=(await (await req('/api/screens/1/pair','POST',{code:pair.code})).json()).token;
  const jpeg='data:image/jpeg;base64,'+(await sharp({create:{width:64,height:36,channels:3,background:'#c00'}}).jpeg().toBuffer()).toString('base64');
  assert.equal((await req('/api/screens/1/snapshot','POST',{image:jpeg})).status,401,'needs screen token');
  assert.equal((await req('/api/screens/1/snapshot','POST',{image:'data:image/jpeg;base64,bm90IGFuIGltYWdl'},{'X-Screen-Token':tok})).status,400,'non-image rejected');
  assert.equal((await req('/api/screens/1/snapshot','POST',{image:'data:text/html;base64,PGgxPg=='},{'X-Screen-Token':tok})).status,400);
  assert.equal((await req('/api/screens/1/snapshot','POST',{image:jpeg},{'X-Screen-Token':tok})).status,200);
  assert.equal((await req('/api/screens/1/snapshot','POST',{image:jpeg},{'X-Screen-Token':tok})).status,429);
  const shot=await req('/api/admin/screens/1/snapshot');assert.equal(shot.status,200);assert.match(shot.headers.get('content-type')||'',/image\/jpeg/);
  const meta=await sharp(Buffer.from(await shot.arrayBuffer())).metadata();assert.equal(meta.format,'jpeg');
  assert.equal((await fetch(base+'/api/admin/screens/1/snapshot')).status,401);
  state=await (await req('/api/admin/state')).json();assert.ok(state.screens[0].snapshotAt>0);
  assert.equal((await req('/api/admin/screens/1/revoke','POST')).status,200);
  assert.equal((await req('/api/admin/screens/1/snapshot')).status,404,'revoking clears the snapshot');

  // Group deletion ungroups displays; activity kinds filter.
  assert.equal((await req('/api/admin/groups/'+g.id,'DELETE')).status,200);
  state=await (await req('/api/admin/state')).json();assert.ok(state.screens.every((s:any)=>s.groupId===null));
  act=await (await req('/api/admin/activity?kind=schedule')).json();assert.ok(act.items.length>=1&&act.items.every((a:any)=>a.kind==='schedule'));
  act=await (await req('/api/admin/activity?kind=security')).json();assert.ok(act.items.some((a:any)=>/paired/.test(a.message))&&act.items.some((a:any)=>/revoked/.test(a.message)));
 }finally{server.close();service.close();await fs.rm(dir,{recursive:true,force:true});}
});
