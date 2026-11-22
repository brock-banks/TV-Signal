import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { ffmpeg,ffprobe,run } from './process.ts';
import { logicalSize,videoFilters,type Display } from '../shared-types/core.ts';
// Windows must release original-file handles so delete/retry and backups work.
sharp.cache({files:0});
export interface Media {id:string;kind:string;file:string;width:number;height:number;duration:number;status:string;[key:string]:any}
export class MediaProcessor {
 private tail:Promise<unknown>=Promise.resolve(); private tasks=new Map<string,Promise<string>>();
 constructor(public dir:string){}
 queue<T>(task:()=>Promise<T>):Promise<T>{const p=this.tail.then(task,task);this.tail=p.catch(()=>{});return p;}
 async inspect(file:string):Promise<{kind:string;width:number;height:number;duration:number;animated:number}>{
  try {const m=await sharp(file,{animated:true,limitInputPixels:100000000}).metadata();if(!['jpeg','png','webp','gif'].includes(m.format||''))throw new Error('Unsupported image');await sharp(file).resize(1,1).toBuffer();return {kind:'image',width:m.width!,height:m.pageHeight||m.height!,duration:0,animated:Number((m.pages||1)>1)};}catch{}
  const p=JSON.parse(await run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',file]));
  const v=p.streams?.find((s:any)=>s.codec_type==='video'&&!s.disposition?.attached_pic);
  if(!v||!p.format?.format_name?.split(',').includes('mp4')||!v.width||!v.height)throw new Error('Use JPG, PNG, WebP, GIF or an MP4 video. Other containers must be converted to MP4 first.');
  const duration=Number(p.format.duration);if(!Number.isFinite(duration)||duration<=0||v.width*v.height>34000000)throw new Error('Invalid duration or excessive video dimensions');
  return {kind:'video',width:v.width,height:v.height,duration,animated:0};
 }
 async normalize(m:Media){
  const input=path.join(this.dir,'originals',m.file);
  if(m.kind==='video'){
   await run(ffmpeg,['-y','-i',input,'-map','0:v:0','-map','0:a:0?','-vf',"scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",'-c:v','libx264','-preset','fast','-crf','21','-maxrate',process.env.VIDEO_BITRATE||'5000k','-bufsize','10000k','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',path.join(this.dir,'normalized',m.id+'.mp4')]);
   await run(ffmpeg,['-y','-i',path.join(this.dir,'normalized',m.id+'.mp4'),'-frames:v','1','-vf','scale=480:-2',path.join(this.dir,'thumbs',m.id+'.jpg')]);
  } else await sharp(input).rotate().resize(480,300,{fit:'inside'}).jpeg().toFile(path.join(this.dir,'thumbs',m.id+'.jpg'));
 }
 // Only visual settings shape a variant; behavioural flags (keepAwake) must not invalidate the cache.
 key(m:Media,d:Display){const {keepAwake:_ignored,...visual}=d;return m.id+'-'+crypto.createHash('sha256').update(JSON.stringify(visual)).digest('hex').slice(0,20)+(m.kind==='video'?'.mp4':m.animated?'.gif':'.jpg');}
 async variant(m:Media,d:Display):Promise<string>{
  const key=this.key(m,d),dest=path.join(this.dir,'variants',key);
  try{await fs.access(dest);return key;}catch{}
  if(this.tasks.has(key))return this.tasks.get(key)!;
  const task=this.queue(async()=>{const temp=dest+'.tmp'+path.extname(dest);try{
   if(m.kind==='video') await run(ffmpeg,['-y','-i',path.join(this.dir,'normalized',m.id+'.mp4'),'-vf',videoFilters(d),'-c:v','libx264','-preset','fast','-crf','21','-maxrate',process.env.VIDEO_BITRATE||'5000k','-bufsize','10000k','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',temp]);
   else if(m.animated){await run(ffmpeg,['-y','-i',path.join(this.dir,'originals',m.file),'-vf',videoFilters(d),'-loop','0',temp]);}
   else {const [w,h]=logicalSize(d);const input=path.join(this.dir,'originals',m.file);
    // Two passes ensure fit occurs in logical upright space BEFORE pixel rotation.
    const fitted=await sharp(input,{animated:true,limitInputPixels:100000000}).autoOrient().resize(w,h,{fit:d.fit==='stretch'?'fill':d.fit,background:d.background}).toBuffer();
    let img=sharp(fitted,{animated:true});if(d.mirrorX)img=img.flop();if(d.mirrorY)img=img.flip();
    await img.rotate(d.rotation,{background:d.background}).flatten({background:d.background}).jpeg({quality:92}).toFile(temp);
   }
   await fs.rename(temp,dest);return key;
  }catch(e){await fs.rm(temp,{force:true});throw e;}finally{this.tasks.delete(key);}});
  this.tasks.set(key,task);return task;
 }
}
