import { spawn } from 'node:child_process';
import ffmpegBinary from 'ffmpeg-static';
import ffprobeBinary from 'ffprobe-static';
export const ffmpeg=process.env.FFMPEG_PATH||ffmpegBinary!;
export const ffprobe=process.env.FFPROBE_PATH||ffprobeBinary.path;
export function run(binary:string,args:string[]):Promise<string>{return new Promise((resolve,reject)=>{
 const child=spawn(binary,args,{windowsHide:true}); let out='',err='';
 const timer=setTimeout(()=>{child.kill();reject(new Error('Media processing exceeded 30 minutes'));},1800000);
 child.stdout.on('data',d=>{out+=d.toString();if(out.length>4000000)child.kill();});
 child.stderr.on('data',d=>{err=(err+d.toString()).slice(-6000);});
 child.on('error',e=>{clearTimeout(timer);reject(e);});
 child.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(new Error(err||'Media processor failed'));});
});}
