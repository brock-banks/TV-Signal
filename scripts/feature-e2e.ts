// End-to-end check of the operator features against a real server, real TV player page and real browser.
// Run: npm run test:features   (set PLAYWRIGHT_CHANNEL=chrome to use an installed Chrome instead of Playwright's Chromium)
import {chromium} from '@playwright/test';
import {createApp} from '../server/app.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'signage-features-'));
const service=createApp({dataDir:dir});const server=service.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url='http://127.0.0.1:'+(server.address() as any).port;
const H={'X-Signage-Request':'1'};let browser;
await fs.mkdir('test-results',{recursive:true});const shot=(p:any,name:string)=>p.screenshot({path:'test-results/features-'+name+'.png'});
const step=(s:string)=>console.log('·',s);
try{
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/admin/');await page.getByLabel('Administrator password').fill('feature-password-123');await page.getByRole('button',{name:'Create account & continue'}).click();await page.getByRole('heading',{name:'Displays',exact:true}).waitFor();
 await page.getByText('Live updates connected').waitFor({timeout:10000});step('live update stream connected');

 const png=await sharp({create:{width:320,height:180,channels:3,background:'#d01020'}}).png().toBuffer();
 const media=(await (await page.request.post(url+'/api/admin/media',{headers:H,multipart:{files:{name:'red.png',mimeType:'image/png',buffer:png}}})).json()).results[0];
 for(let i=0;i<100;i++){const s=await (await page.request.get(url+'/api/admin/state')).json();if(s.media[0]?.status==='ready')break;await page.waitForTimeout(100);}
 const day=(await (await page.request.post(url+'/api/admin/playlists',{headers:H,data:{name:'Daytime'}})).json()).id;
 const eve=(await (await page.request.post(url+'/api/admin/playlists',{headers:H,data:{name:'Evening promo'}})).json()).id;
 for(const [id,name] of [[day,'Daytime'],[eve,'Evening promo']])await page.request.put(url+'/api/admin/playlists/'+id,{headers:H,data:{name,entries:[{mediaId:media.id,duration:20}],immediate:true}});
 const st=await (await page.request.get(url+'/api/admin/state')).json();
 await page.request.put(url+'/api/admin/screens/1',{headers:H,data:{name:'TV 1',playlistId:day,config:{...st.screens[0].config,width:640,height:360},immediate:true}});

 // Real player: pair, play, and report a snapshot that the dashboard shows without a reload (live push).
 const pairing=await (await page.request.post(url+'/api/admin/screens/1/pair',{headers:H})).json();
 const tv=await browser.newPage({viewport:{width:640,height:360}});tv.on('pageerror',e=>errors.push(e.message));
 await tv.goto(url+'/tv/1');await tv.getByLabel('Pairing code').fill(pairing.code);await tv.getByRole('button',{name:'Pair screen'}).click();await tv.locator('#stage img').waitFor({timeout:30000});
 const card=page.locator('.screen.card').first();
 await card.locator('img.snapshot').waitFor({timeout:15000});step('player snapshot reached the dashboard card');await shot(page,'snapshot-card');
 const snap=await page.request.get(url+'/api/admin/screens/1/snapshot');const px=await sharp(Buffer.from(await snap.body())).resize(1,1).raw().toBuffer();
 assert.ok(px[0]>150&&px[1]<80&&px[2]<80,'snapshot shows the red test image, got '+[...px]);step('snapshot pixels match what the player renders');

 // Command palette → display settings; schedule an all-day slot for today.
 await page.keyboard.press('Control+K');await page.getByLabel('Search commands').fill('tv 1');await shot(page,'palette');await page.getByLabel('Search commands').fill('tv 1 settings');await page.keyboard.press('Enter');
 await page.getByRole('dialog',{name:'Settings · TV 1'}).waitFor();step('command palette opened display settings');
 const dlg=page.getByRole('dialog',{name:'Settings · TV 1'});
 await dlg.locator('summary',{hasText:/^Schedule/}).click();await dlg.getByRole('button',{name:'Add time slot'}).click();
 await dlg.getByRole('button',{name:'Sun'}).click();await dlg.getByRole('button',{name:'Sat'}).click();
 await dlg.getByLabel('Start time for slot 1').fill('00:00');await dlg.getByLabel('End time for slot 1').fill('00:00');
 await dlg.getByLabel('Playlist for slot 1').selectOption(eve);await dlg.getByText('Every day · all day').waitFor();
 await shot(page,'schedule');await dlg.getByRole('button',{name:'Save schedule'}).click();await page.getByText('Schedule saved for TV 1').waitFor();
 await page.keyboard.press('Escape');await card.getByText('Scheduled now: “Evening promo” all day').waitFor({timeout:10000});step('schedule slot overrides the default playlist');

 // Groups: create from the display actions menu, assign TV 1, see the grouped section.
 await page.getByLabel('Display actions').click();await page.getByRole('menuitem',{name:'New display group'}).click();
 await page.getByLabel('Group name').fill('Lobby');await page.getByRole('button',{name:'Create group'}).click();await page.getByRole('heading',{name:'Ungrouped'}).waitFor();
 await card.getByRole('button',{name:'Display settings',exact:true}).click();await page.getByRole('dialog',{name:'Settings · TV 1'}).getByLabel('Group').selectOption({label:'Lobby'});await page.getByRole('button',{name:'Save display'}).click();
 await page.locator('#main section[aria-label="Lobby"] .screen.card').first().waitFor();step('display grouped under Lobby');await page.waitForTimeout(400);await shot(page,'groups');

 // Bulk selection + explained, blocked delete (media is used by playlists).
 await page.getByRole('button',{name:'Media library',exact:true}).click();await page.getByLabel('Select red.png').check({force:true});
 await page.getByText('1 selected').waitFor();await shot(page,'bulk');await page.getByRole('toolbar',{name:'Bulk media actions'}).getByRole('button',{name:'Delete'}).click();
 const confirm=page.getByRole('dialog',{name:'Delete “red.png”?'});await confirm.getByText('Remove the item from those playlists').waitFor();await shot(page,'confirm');await confirm.getByRole('button',{name:'Close',exact:true}).click();step('bulk delete explains why it is blocked');

 // Upload queue with per-file status.
 const blue=await sharp({create:{width:160,height:90,channels:3,background:'#1030d0'}}).png().toBuffer();
 await page.locator('input[type=file]').setInputFiles({name:'blue.png',mimeType:'image/png',buffer:blue});
 const panel=page.getByRole('region',{name:'Upload queue'});await panel.getByText('Ready').waitFor({timeout:20000});step('upload queue tracked upload → conversion → ready');await shot(page,'uploads');

 // Quick preview: play a local file without uploading it, simulate a portrait display, then upload it.
 const webm=path.join(dir,'local.webm');execFileSync(ffmpeg as unknown as string,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc=s=320x180:r=15','-t','4','-c:v','libvpx-vp9','-b:v','200k',webm]);
 const st3=await (await page.request.get(url+'/api/admin/state')).json();
 await page.request.put(url+'/api/admin/screens/2',{headers:H,data:{name:'TV 2',playlistId:null,config:{...st3.screens[1].config,rotation:90,fit:'cover'}}});
 const mediaBefore=st3.media.length;
 await page.getByRole('button',{name:'Quick preview'}).click();const qp=page.getByRole('dialog',{name:'Quick preview'});
 await qp.locator('input[type=file]').setInputFiles({name:'local.webm',mimeType:'video/webm',buffer:await fs.readFile(webm)});
 await page.waitForFunction(()=>{const v=document.querySelector('.qp-stage video') as HTMLVideoElement|null;return !!v&&v.currentTime>0.5&&!v.paused;},null,{timeout:10000});
 assert.match(await qp.locator('video').getAttribute('src')||'',/^blob:/,'played from a local object URL');
 assert.equal((await (await page.request.get(url+'/api/admin/state')).json()).media.length,mediaBefore,'nothing uploaded by previewing');step('quick preview plays a local file without uploading');
 await qp.getByLabel('Simulate display').selectOption({label:'TV 2 · 90° · cover'});await qp.getByText('Portrait 1080×1920').waitFor();
 assert.match(await qp.locator('.qp-stage').getAttribute('style')||'',/aspect-ratio: 1080 \/ 1920/);await page.waitForTimeout(300);await shot(page,'quick-preview');step('quick preview simulates a portrait display');
 await qp.getByRole('button',{name:'Upload to library'}).click();
 await page.getByRole('region',{name:'Upload queue'}).getByText('local.webm').waitFor();step('quick preview hands the file to the upload queue');

 // Alerts: a failed sign-in elsewhere raises a live alert badge.
 await fetch(url+'/api/login',{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({password:'not-the-password'})});
 await page.locator('summary[aria-label^="Alerts, "]').waitFor({timeout:10000});step('failed sign-in raised a live alert');await page.locator('summary[aria-label^="Alerts, "]').click();await page.waitForTimeout(250);await shot(page,'alerts');await page.keyboard.press('Escape');

 // Activity log lists what happened.
 await page.getByRole('button',{name:'Activity',exact:true}).click();
 for(const t of [/TV 1 paired/,/Schedule updated for TV 1/,/Group “Lobby” created/,/Failed sign-in attempt/])await page.locator('.activity-msg',{hasText:t}).first().waitFor();step('activity log shows pairing, schedule, group and security events');
 await shot(page,'activity');

 assert.deepEqual(errors,[]);console.log('PASS: live push, player snapshots, quick preview, command palette, schedules, groups, bulk actions, explained confirmations, upload queue, alerts, activity log; no browser JS errors.');
}finally{await browser?.close();server.close();service.close();await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
