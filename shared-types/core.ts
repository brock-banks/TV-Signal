export type Rotation = 0|90|180|270;
export type Fit = 'cover'|'contain'|'stretch';
export interface Entry { mediaId:string; duration:number }
export interface Display { rotation:Rotation; fit:Fit; background:string; width:number; height:number; mirrorX:boolean; mirrorY:boolean; keepAwake?:boolean }
export const defaults:Display={rotation:0,fit:'contain',background:'#000000',width:1920,height:1080,mirrorX:false,mirrorY:false,keepAwake:true};
export function nextIndex(index:number,length:number){return length ? (index+1)%length : -1;}
export function imageDuration(seconds:number){return Math.min(86400,Math.max(1,Number(seconds)||10));}
export function logicalSize(d:Display){return d.rotation===90||d.rotation===270 ? [d.height,d.width] : [d.width,d.height];}
// Content rotation clockwise relative to the TV's native landscape coordinates.
export function rotationFilters(rotation:Rotation){return rotation===90?['transpose=clock']:rotation===270?['transpose=cclock']:rotation===180?['hflip','vflip']:[];}
export function videoFilters(d:Display){
  const [w,h]=logicalSize(d); const bg=d.background.replace('#','0x');
  const size=d.fit==='stretch'?[`scale=${w}:${h}`]:d.fit==='cover'?[`scale=${w}:${h}:force_original_aspect_ratio=increase`,`crop=${w}:${h}`]:[`scale=${w}:${h}:force_original_aspect_ratio=decrease`,`pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${bg}`];
  return [...size,...(d.mirrorX?['hflip']:[]),...(d.mirrorY?['vflip']:[]),...rotationFilters(d.rotation),'setsar=1','format=yuv420p'].join(',');
}

/** Day-part rule: `days` is a bitmask (bit 0 = Sunday … bit 6 = Saturday); start/end are minutes after local midnight.
 *  start===end means the whole day. end<start runs overnight into the next day. Earlier rules win. */
export interface ScheduleRule { id?:string; playlistId:string; days:number; start:number; end:number; enabled:boolean }
export function activeRule<T extends ScheduleRule>(rules:T[],date:Date):T|null{
  const day=date.getDay(),minute=date.getHours()*60+date.getMinutes(),on=(r:ScheduleRule,d:number)=>(r.days&(1<<d))!==0;
  for(const r of rules){
    if(!r.enabled)continue;
    if(r.start===r.end){if(on(r,day))return r;continue;}
    if(r.start<r.end){if(on(r,day)&&minute>=r.start&&minute<r.end)return r;continue;}
    if(on(r,day)&&minute>=r.start)return r;
    if(on(r,(day+6)%7)&&minute<r.end)return r;
  }
  return null;
}
