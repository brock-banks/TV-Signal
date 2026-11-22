import React,{useState,useEffect,useRef} from 'react';
import {Button} from './spectrum';
import {Icon,Modal,clock} from './src';

/* ==========================================================================
   Quick preview: play a local video or image straight from this computer
   (an object URL — nothing is uploaded) and simulate how it would look on a
   chosen display: logical orientation, fit mode, background and mirroring.
   ========================================================================== */
const fmtSize=(n:number)=>n>1e9?(n/1e9).toFixed(1)+' GB':n>1e6?(n/1e6).toFixed(1)+' MB':Math.max(1,Math.round(n/1e3))+' KB';
const FIT:Record<string,React.CSSProperties['objectFit']>={contain:'contain',cover:'cover',stretch:'fill'};
const NATIVE={id:'native',label:'Landscape 16:9 (no display settings)',config:{rotation:0,fit:'contain',background:'#000000',width:1920,height:1080,mirrorX:false,mirrorY:false}};

export function QuickPreview({close,screens,upload,initialFile}:{close:()=>void;screens:any[];upload:(f:File)=>void;initialFile?:File|null}){
 const [file,setFile]=useState<File|null>(initialFile||null),[url,setUrl]=useState(''),[target,setTarget]=useState('native');
 const [playing,setPlaying]=useState(false),[time,setTime]=useState(0),[length,setLength]=useState(0),[muted,setMuted]=useState(true),[loop,setLoop]=useState(true),[rate,setRate]=useState(1);
 const [meta,setMeta]=useState<{w:number;h:number}|null>(null),[error,setError]=useState(''),[over,setOver]=useState(false);
 const video=useRef<HTMLVideoElement>(null),stage=useRef<HTMLDivElement>(null),picker=useRef<HTMLInputElement>(null);
 const isVideo=!!file&&(file.type.startsWith('video/')||/\.(mp4|m4v|webm|mov|mkv|ogv)$/i.test(file.name));
 const options=[NATIVE,...screens.map((s:any)=>({id:String(s.id),label:`${s.name} · ${s.config.rotation}° · ${s.config.fit}`,config:s.config}))];
 const cfg=(options.find(o=>o.id===target)||NATIVE).config;
 const portrait=cfg.rotation===90||cfg.rotation===270;
 const [lw,lh]=portrait?[cfg.height,cfg.width]:[cfg.width,cfg.height];

 useEffect(()=>{if(!file){setUrl('');return;}const u=URL.createObjectURL(file);setUrl(u);setError('');setMeta(null);setTime(0);setLength(0);setPlaying(false);return()=>URL.revokeObjectURL(u);},[file]);
 useEffect(()=>{const v=video.current;if(!v)return;v.muted=muted;v.loop=loop;v.playbackRate=rate;},[muted,loop,rate,url]);

 const choose=(files:FileList|null)=>{const f=files?.[0];if(!f)return;if(!/^(video|image)\//.test(f.type)&&!/\.(mp4|m4v|webm|mov|mkv|ogv|jpe?g|png|gif|webp)$/i.test(f.name)){setError('Choose a video or image file.');return;}setFile(f);};
 const toggle=()=>{const v=video.current;if(!v)return;if(v.paused)void v.play().catch(()=>setError('The browser refused to start playback. Press play again.'));else v.pause();};
 const seek=(t:number)=>{const v=video.current;if(v&&Number.isFinite(t))v.currentTime=Math.max(0,Math.min(length||0,t));};
 const fullscreen=()=>{const el=stage.current as any;if(document.fullscreenElement)void document.exitFullscreen();else void (el?.requestFullscreen?.()||el?.webkitRequestFullscreen?.());};
 function onKey(e:React.KeyboardEvent){if(!isVideo||(e.target as HTMLElement).tagName==='SELECT')return;const k=e.key.toLowerCase();
  if(k===' '||k==='k'){e.preventDefault();toggle();}else if(k==='j'){seek(time-10);}else if(k==='l'){seek(time+10);}else if(k==='arrowleft'){e.preventDefault();seek(time-5);}else if(k==='arrowright'){e.preventDefault();seek(time+5);}else if(k==='m'){setMuted(m=>!m);}else if(k==='f'){fullscreen();}}

 const media:React.CSSProperties={width:'100%',height:'100%',objectFit:FIT[cfg.fit]||'contain',transform:`scale(${cfg.mirrorX?-1:1},${cfg.mirrorY?-1:1})`,display:'block'};
 return <Modal title="Quick preview" subtitle="Plays a file from this computer. Nothing is uploaded until you choose to." close={close} wide theater>
  <div className={'qp'+(over?' over':'')} onKeyDown={onKey} onDragOver={e=>{e.preventDefault();setOver(true);}} onDragLeave={()=>setOver(false)} onDrop={e=>{e.preventDefault();setOver(false);choose(e.dataTransfer.files);}}>
   <input ref={picker} type="file" accept="video/*,image/*" hidden onChange={e=>{choose(e.target.files);e.target.value='';}} aria-label="Choose a file to preview"/>
   {!file?<button type="button" className="qp-empty" onClick={()=>picker.current?.click()}><span className="qp-empty-icon"><Icon name="play" size={34}/></span><b>Choose or drop a video or image</b><small>Any format your browser can play. It stays on this computer; nothing is uploaded.</small></button>:<>
    <div className="qp-toolbar"><label className="select-inline compact qp-target"><Icon name="Overview" size={16}/><span className="sr-only">Simulate display</span><select aria-label="Simulate display" value={target} onChange={e=>setTarget(e.target.value)}>{options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
     <span className="qp-frame-label">{portrait?'Portrait':'Landscape'} {lw}×{lh} · {cfg.fit==='stretch'?'stretch':cfg.fit==='cover'?'cover / fill':'contain / fit'}</span></div>
    <div className="qp-stage-wrap"><div ref={stage} className={'qp-stage'+(playing?' is-playing':'')} style={{aspectRatio:`${lw} / ${lh}`,background:cfg.background,maxWidth:portrait?`min(100%, calc(62vh * ${lw/lh}))`:'100%'}} tabIndex={0} aria-label="Preview stage. Space or K plays and pauses, J and L skip 10 seconds, M mutes, F toggles full screen.">
     {isVideo?<video ref={video} src={url} style={media} playsInline muted={muted} loop={loop} onClick={toggle} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onLoadedMetadata={e=>{setLength(e.currentTarget.duration||0);setMeta({w:e.currentTarget.videoWidth,h:e.currentTarget.videoHeight});void e.currentTarget.play().catch(()=>{});}} onError={()=>setError('This browser cannot decode this video. If the TVs need it, upload it — the server converts it to H.264/AAC.')}/>
      :<img src={url} alt={file.name} style={media} onLoad={e=>setMeta({w:e.currentTarget.naturalWidth,h:e.currentTarget.naturalHeight})} onError={()=>setError('This image could not be decoded.')}/>}
     {isVideo&&!playing&&!error&&<button type="button" className="yt-big-play qp-big" aria-label="Play" onClick={toggle}><Icon name="play" size={34}/></button>}
     {isVideo&&<div className="yt-chrome qp-chrome">
      <input className="qp-seek" type="range" min={0} max={length||0} step={0.01} value={Math.min(time,length||0)} onChange={e=>seek(Number(e.target.value))} aria-label="Seek" style={{'--pct':(length?time/length*100:0)+'%'} as React.CSSProperties}/>
      <div className="yt-controls">
       <button type="button" className="yt-btn" aria-label={playing?'Pause':'Play'} title={playing?'Pause (k)':'Play (k)'} onClick={toggle}><Icon name={playing?'pause':'play'} size={24}/></button>
       <button type="button" className="yt-btn" aria-label="Back 10 seconds" title="Back 10 s (j)" onClick={()=>seek(time-10)}><Icon name="prev" size={20}/></button>
       <button type="button" className="yt-btn" aria-label="Forward 10 seconds" title="Forward 10 s (l)" onClick={()=>seek(time+10)}><Icon name="next" size={20}/></button>
       <button type="button" className="yt-btn" aria-label={muted?'Unmute':'Mute'} title={(muted?'Unmute':'Mute')+' (m)'} onClick={()=>setMuted(!muted)}><Icon name={muted?'mute':'unmute'} size={20}/></button>
       <span className="yt-time">{clock(time)} / {clock(length)}</span><span className="spacer"/>
       <button type="button" className="yt-btn qp-text" aria-pressed={loop} aria-label="Loop" title="Loop" onClick={()=>setLoop(!loop)}><Icon name="reload" size={18}/></button>
       <select className="qp-rate" aria-label="Playback speed" value={rate} onChange={e=>setRate(Number(e.target.value))}>{[0.5,1,1.5,2].map(r=><option key={r} value={r}>{r}×</option>)}</select>
       <button type="button" className="yt-btn" aria-label="Full screen" title="Full screen (f)" onClick={fullscreen}><Icon name="external" size={18}/></button>
      </div></div>}
    </div></div>
    {error&&<p className="error small qp-error" role="alert"><Icon name="alert" size={15}/>{error}</p>}
    <dl className="qp-info"><div><dt>File</dt><dd title={file.name}>{file.name}</dd></div><div><dt>Size</dt><dd>{fmtSize(file.size)}</dd></div><div><dt>Type</dt><dd>{file.type||'unknown'}</dd></div>{meta&&<div><dt>Resolution</dt><dd>{meta.w}×{meta.h}{meta.w&&meta.h&&Math.abs(meta.w/meta.h-lw/lh)>0.02?<span className="qp-warn"> · aspect differs from frame</span>:null}</dd></div>}{isVideo&&length>0&&<div><dt>Duration</dt><dd>{clock(length)}</dd></div>}</dl>
    <p className="muted small">Desktop simulation only: it shows the upright view for the chosen display using its fit, background and mirroring. On the TV the server prepares a pre-rotated, converted file, and the TV’s own decoder has the final say.</p>
   </>}
   <div className="modal-actions"><Button className="ghost" onClick={()=>picker.current?.click()}><Icon name="search" size={16}/>{file?'Choose another file':'Choose file'}</Button>{file&&<Button className="primary" onClick={()=>{upload(file);close();}}><Icon name="upload" size={16}/>Upload to library</Button>}</div>
  </div>
 </Modal>;
}
