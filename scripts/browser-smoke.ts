import {chromium} from '@playwright/test';
import {createApp} from '../server/app.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'signage-browser-'));
const service=createApp({dataDir:dir});const server=service.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url='http://127.0.0.1:'+(server.address() as any).port;
let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/admin/');await page.getByLabel('Administrator password').fill('smoke-password-123');await page.getByRole('button',{name:'Create account & continue'}).click();await page.getByRole('heading',{name:'Displays',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Display settings'}).count(),3);
 const png=await sharp({create:{width:200,height:300,channels:3,background:'#31cfa1'}}).png().toBuffer();
 const create=await page.request.post(url+'/api/admin/playlists',{headers:{'X-Signage-Request':'1'},data:{name:'Smoke playlist'}});const playlist=await create.json();
 const upload=await page.request.post(url+'/api/admin/media',{headers:{'X-Signage-Request':'1'},multipart:{files:{name:'smoke.png',mimeType:'image/png',buffer:png}}});const media=(await upload.json()).results[0];
 for(let i=0;i<100;i++){const state=await (await page.request.get(url+'/api/admin/state')).json();if(state.media[0]?.status==='ready')break;await page.waitForTimeout(100);}
 await page.request.put(url+'/api/admin/playlists/'+playlist.id,{headers:{'X-Signage-Request':'1'},data:{name:'Smoke playlist',entries:[{mediaId:media.id,duration:1}],immediate:true}});
 const state=await (await page.request.get(url+'/api/admin/state')).json();await page.request.put(url+'/api/admin/screens/1',{headers:{'X-Signage-Request':'1'},data:{name:'TV 1',playlistId:playlist.id,config:{...state.screens[0].config,width:640,height:360},immediate:true}});
 const pairing=await (await page.request.post(url+'/api/admin/screens/1/pair',{headers:{'X-Signage-Request':'1'}})).json();
 const tv=await browser.newPage();tv.on('pageerror',e=>errors.push(e.message));await tv.goto(url+'/tv/1');await tv.getByLabel('Pairing code').fill(pairing.code);await tv.getByRole('button',{name:'Pair screen'}).click();await tv.locator('#stage img').waitFor({timeout:30000});await tv.waitForFunction(()=>{const img=document.querySelector('#stage img') as HTMLImageElement;return img?.complete&&img.naturalWidth>0;});
 await tv.reload();await tv.locator('#stage img').waitFor({timeout:30000});
 const pause=await (await page.request.post(url+'/api/admin/screens/1/commands',{headers:{'X-Signage-Request':'1'},data:{action:'pause'}})).json();
 let acked=false;for(let i=0;i<150;i++){const s=await (await page.request.get(url+'/api/admin/state')).json();if(s.screens[0].commands.find((c:any)=>c.id===pause.id)?.status==='success'){acked=true;break;}await page.waitForTimeout(100);}assert.ok(acked,'Player must acknowledge pause');
 await page.reload();await page.getByRole('heading',{name:'Displays',exact:true}).waitFor();await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/dashboard.png',fullPage:true});assert.deepEqual(errors,[]);console.log('PASS: setup, dashboard, upload, publish, screen enrollment, decoded image playback, persistent pairing, command acknowledgment, no browser JS errors.');
}finally{await browser?.close();await new Promise<void>(r=>server.close(()=>r()));service.close();await fs.rm(dir,{recursive:true,force:true});}

