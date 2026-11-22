import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { run, ffmpeg } from '../media-processing/process.ts';
import { pathToFileURL } from 'node:url';
/** Generates the four calibration PNG + H.264/AAC MP4 pairs used by /compat. Exported so packaged installs can create them on first start. */
export async function generateFixtures(dataDir=process.env.DATA_DIR||'data'){
const dir=path.resolve(dataDir,'fixtures'); await fs.mkdir(dir,{recursive:true});
for(const angle of [0,90,180,270]){
 const portrait=angle===90||angle===270; const w=portrait?1080:1920,h=portrait?1920:1080;
 const svg=`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#162437"/><rect x="15" y="15" width="${w-30}" height="${h-30}" fill="none" stroke="#fff" stroke-width="20"/><path d="M ${w/2} 90 l -80 120 h 55 v 130 h 50 V 210 h 55 Z" fill="#64efb1"/><g font-family="Arial" text-anchor="middle" fill="white"><text x="${w/2}" y="${h/2}" font-size="85">TOP / UP</text><text x="${w/2}" y="${h/2+110}" font-size="65">${angle}° CLOCKWISE</text><text x="${w/2}" y="${h-80}" font-size="45">BOTTOM • ALL FOUR EDGES VISIBLE</text></g><rect x="35" y="35" width="90" height="90" fill="red"/><rect x="${w-125}" y="35" width="90" height="90" fill="#00aaff"/></svg>`;
 await sharp(Buffer.from(svg)).rotate(angle).png().toFile(path.join(dir,`${angle}.png`));
 await run(ffmpeg,['-y','-loop','1','-i',path.join(dir,`${angle}.png`),'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-f','lavfi','-i','testsrc2=size=320x90:rate=25','-t','8','-filter_complex','[0:v][2:v]overlay=40:900:shortest=1[v]','-map','[v]','-map','1:a','-c:v','libx264','-profile:v','main','-level','4.1','-pix_fmt','yuv420p','-r','25','-c:a','aac','-b:a','128k','-movflags','+faststart',path.join(dir,`${angle}.mp4`)]);
}
return dir;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)generateFixtures().then(dir=>console.log('Created calibration PNG and H.264/AAC MP4 files in '+dir));
