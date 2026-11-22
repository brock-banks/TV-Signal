import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {MediaProcessor} from '../media-processing/library.ts';
import {ffmpeg,ffprobe,run} from '../media-processing/process.ts';
import {defaults} from '../shared-types/core.ts';
test('real image/video processing preserves clockwise corner mapping and creates playable landscape variants',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'signage-media-'));for(const d of ['originals','normalized','variants','thumbs'])await fs.mkdir(path.join(dir,d));const processor=new MediaProcessor(dir);
 try{
  const svg='<svg width="160" height="160" xmlns="http://www.w3.org/2000/svg"><path fill="red" d="M0 0H80V80H0Z"/><path fill="lime" d="M80 0H160V80H80Z"/><path fill="blue" d="M0 80H80V160H0Z"/><path fill="white" d="M80 80H160V160H80Z"/></svg>';
  const source=path.join(dir,'originals','corners.bin');await sharp(Buffer.from(svg)).png().toFile(source);
  const m={id:'aabbcc',file:'corners.bin',kind:'image',width:160,height:160,duration:0,status:'ready',animated:0};
  const expected=[[255,0,0],[0,0,255],[255,255,255],[0,255,0]];
  for(const [i,rotation] of ([0,90,180,270] as const).entries()){
   const key=await processor.variant(m,{...defaults,width:320,height:240,fit:'stretch',rotation});const file=path.join(dir,'variants',key);const meta=await sharp(file).metadata();assert.equal(meta.width,320);assert.equal(meta.height,240);
   const rgb=await sharp(file).extract({left:80,top:60,width:1,height:1}).raw().toBuffer();for(let c=0;c<3;c++)assert.ok(Math.abs(rgb[c]-expected[i][c])<15,`${rotation} corner channel ${c}: ${rgb[c]}`);
  }
  const video=path.join(dir,'originals','video.bin');await run(ffmpeg,['-y','-loop','1','-i',source,'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-r','25','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-f','mp4',video]);
  const info=await processor.inspect(video);assert.equal(info.kind,'video');assert.ok(info.duration>=1);const v={id:'ddeeff',file:'video.bin',...info,status:'ready'};await processor.normalize(v);
  for(const rotation of [0,90,180,270] as const){const key=await processor.variant(v,{...defaults,width:320,height:240,fit:'stretch',rotation});const result=JSON.parse(await run(ffprobe,['-v','error','-show_streams','-of','json',path.join(dir,'variants',key)]));const stream=result.streams.find((s:any)=>s.codec_type==='video');assert.equal(stream.codec_name,'h264');assert.equal(stream.width,320);assert.equal(stream.height,240);assert.equal(result.streams.find((s:any)=>s.codec_type==='audio').codec_name,'aac');}
  // Animated GIF must remain multi-frame after portrait rotation.
  const gif=path.join(dir,'originals','animated.bin');await run(ffmpeg,['-y','-f','lavfi','-i','testsrc2=size=64x96:rate=4','-t','1','-f','gif',gif]);const gi=await processor.inspect(gif);assert.equal(gi.animated,1);const key=await processor.variant({id:'112233',file:'animated.bin',...gi,status:'ready'},{...defaults,width:320,height:240,rotation:90});const gm=await sharp(path.join(dir,'variants',key),{animated:true}).metadata();assert.ok((gm.pages||0)>1);assert.equal(gm.width,320);assert.equal(gm.pageHeight,240);
 }finally{await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
