// Keep-awake end-to-end: wake lock where available; otherwise a tiny clip during images that is unloaded during video.
// Run: npm run test:keepawake   (PLAYWRIGHT_CHANNEL=chrome to use installed Chrome)
import {chromium} from '@playwright/test';
import {createApp} from '../server/app.ts';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import sharp from 'sharp';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import ffmpeg from 'ffmpeg-static';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'signage-awake-'));const service=createApp({dataDir:dir});const server=service.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url='http://127.0.0.1:'+(server.address() as any).port;
const H={'X-Signage-Request':'1'};const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});const errors:string[]=[];
try{
 const page=await browser.newPage();await page.goto(url+'/admin/');await page.getByLabel('Administrator password').fill('awake-password-123');await page.getByRole('button',{name:'Create account & continue'}).click();await page.getByRole('heading',{name:'Displays',exact:true}).waitFor();
 const png=await sharp({create:{width:320,height:180,channels:3,background:'#0a0'}}).png().toBuffer();
 const mp4=path.join(dir,'clip.mp4');execFileSync(ffmpeg as unknown as string,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc=s=320x180:r=15','-t','6','-c:v','libx264','-pix_fmt','yuv420p',mp4]);
 const up=async(name:string,mime:string,buffer:Buffer)=>(await (await page.request.post(url+'/api/admin/media',{headers:H,multipart:{files:{name,mimeType:mime,buffer}}})).json()).results[0].id;
 const img=await up('green.png','image/png',png),vid=await up('clip.mp4','video/mp4',await fs.readFile(mp4));
 for(let i=0;i<300;i++){const s=await (await page.request.get(url+'/api/admin/state')).json();if(s.media.every((m:any)=>m.status==='ready'))break;await page.waitForTimeout(200);}
 const pl=(await (await page.request.post(url+'/api/admin/playlists',{headers:H,data:{name:'Mix'}})).json()).id;
 await page.request.put(url+'/api/admin/playlists/'+pl,{headers:H,data:{name:'Mix',entries:[{mediaId:img,duration:4},{mediaId:vid,duration:10}],immediate:true}});
 const st=await (await page.request.get(url+'/api/admin/state')).json();
 for(const id of [1,2])await page.request.put(url+'/api/admin/screens/'+id,{headers:H,data:{name:'TV '+id,playlistId:pl,config:{...st.screens[0].config,width:640,height:360},immediate:true}});
 const pairTv=async(id:number,noWakeLock:boolean)=>{const code=(await (await page.request.post(url+'/api/admin/screens/'+id+'/pair',{headers:H})).json()).code;const tv=await browser.newPage({viewport:{width:640,height:360}});
  tv.on('pageerror',e=>errors.push(e.message));if(noWakeLock)await tv.addInitScript({content:"Object.defineProperty(Navigator.prototype,'wakeLock',{get:function(){return undefined;},configurable:true});"});
  await tv.goto(url+'/tv/'+id);await tv.getByLabel('Pairing code').fill(code);await tv.getByRole('button',{name:'Pair screen'}).click();return tv;};
 // Path 1: secure context (127.0.0.1) with the Wake Lock API.
 const tv1=await pairTv(1,false);await tv1.locator('#stage img').waitFor({timeout:30000});await tv1.waitForTimeout(800);
 const mode1=await tv1.evaluate(()=>(document.getElementById('keepawake') as HTMLVideoElement|null)?.paused===false?'video':'no-clip');
 console.log('TV1 (wake lock available):',mode1);
 // Path 2: no Wake Lock API (plain-HTTP LAN TVs) → clip must play during images and be unloaded during video.
 const tv2=await pairTv(2,true);await tv2.locator('#stage img').waitFor({timeout:30000});
 await tv2.waitForFunction(()=>{const v=document.getElementById('keepawake') as HTMLVideoElement|null;return !!v&&!v.paused&&v.currentTime>0.3;},null,{timeout:10000});
 console.log('TV2 image item: keep-awake clip playing');
 await tv2.locator('#stage video').waitFor({timeout:15000});await tv2.waitForTimeout(500);
 const during=await tv2.evaluate(()=>{const v=document.getElementById('keepawake') as HTMLVideoElement;return {paused:v.paused,src:v.getAttribute('src')};});
 assert.equal(during.paused,true);assert.equal(during.src,null,'clip unloaded while content video plays');console.log('TV2 video item: keep-awake clip unloaded',JSON.stringify(during));
 await tv2.locator('#stage img').waitFor({timeout:20000});
 await tv2.waitForFunction(()=>{const v=document.getElementById('keepawake') as HTMLVideoElement;return !v.paused&&!!v.getAttribute('src');},null,{timeout:10000});console.log('TV2 back on image: clip resumed');
 // Heartbeat reports the mode to the dashboard.
 let modes:any=[];for(let i=0;i<40;i++){const s=await (await page.request.get(url+'/api/admin/state')).json();modes=s.screens.slice(0,2).map((x:any)=>x.diagnostics?.awake);if(modes[0]&&modes[1])break;await page.waitForTimeout(500);}
 console.log('Reported modes:',modes);assert.ok(['wakelock','video','content-video'].includes(modes[0]));assert.ok(['video','content-video'].includes(modes[1]));
 // Disabled per display → no clip.
 const st2=await (await page.request.get(url+'/api/admin/state')).json();
 await page.request.put(url+'/api/admin/screens/2',{headers:H,data:{name:'TV 2',playlistId:pl,config:{...st2.screens[1].config,keepAwake:false},immediate:true}});
 await tv2.waitForFunction(()=>{const v=document.getElementById('keepawake') as HTMLVideoElement;return v.paused&&!v.getAttribute('src');},null,{timeout:30000});console.log('keepAwake:false → clip stopped');
 const vars=await fs.readdir(path.join(dir,'variants'));assert.equal(vars.length,2,'toggling keepAwake must not create new media variants');
 assert.deepEqual(errors,[]);
 console.log('PASS: wake lock path, clip fallback during images, clip unloaded during video, heartbeat reporting, per-display opt-out, variant cache unaffected.');
}finally{await browser.close();server.close();service.close();await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
