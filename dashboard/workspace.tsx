import React,{useState,useEffect,useRef} from 'react';
import {Button} from './spectrum';
import {Icon,Modal,Menu,clock,relative,CardFx} from './src';
import {confirmAction,toTime} from './features';

function ago(time:number){if(!time)return 'Never connected';const minutes=Math.floor(Math.max(0,Date.now()-time)/60000);return minutes<1?'Last connected less than a minute ago':minutes<60?`Last connected ${minutes} minute${minutes===1?'':'s'} ago`:minutes<1440?`Last connected ${Math.floor(minutes/60)} hours ago`:`Last connected ${Math.floor(minutes/1440)} days ago`;}
const commandNames:Record<string,string>={play:'Play',pause:'Pause',next:'Next item',mute:'Mute',unmute:'Unmute',reload:'Reload player'};

/* ---------- Display card (YouTube-style video card) ---------- */
export function DisplayCard({screen:s,data,api,refresh,preview,settings,pair}:any){
 const [working,setWorking]=useState(false),[feedback,setFeedback]=useState(''),[help,setHelp]=useState(false),[localCommand,setLocalCommand]=useState<any>(null);
 const current=data.media.find((m:any)=>m.id===s.currentMedia),playlist=data.playlists.find((p:any)=>p.id===(s.activePlaylistId??s.playlistId)),assigned=data.media.find((m:any)=>m.id===playlist?.entries[0]?.mediaId);
 const paused=s.diagnostics?.state!=='playing',muted=s.diagnostics?.muted;
 const latest=s.commands?.[0];const command=localCommand&&(!latest||localCommand.id>latest.id)?localCommand:latest;
 const pending=command?.status==='pending'&&Date.now()-command.created<60000;
 const reported=s.online&&current;
 const st=s.diagnostics?.state;
 const stateLabel=!s.online?'Offline':st==='paused'?'Paused':st==='playing'&&current?'Playing':st==='empty'?'No content':st==='blocked'?'TV interaction needed':st==='error'?'Playback error':'Waiting for playback';
 const tone=!s.online?'muted':st==='error'||st==='blocked'?'bad':st==='playing'&&current?'live':st==='paused'?'paused':'muted';
 async function send(action:string){if(!s.online||working||pending)return;setWorking(true);setFeedback('');try{const result=await api('/admin/screens/'+s.id+'/commands','POST',{action});setLocalCommand({...result,action,created:Date.now()});await refresh();}catch(e){setFeedback((e as Error).message);}finally{setWorking(false);}}
 async function assign(id:string){setWorking(true);setFeedback('');try{await api('/admin/screens/'+s.id,'PUT',{name:s.name,playlistId:id||null,config:s.config,immediate:false});setFeedback(s.online?'Playlist saved. Playback updates after the current item and preparation.':'Playlist saved. It will update when the display reconnects.');await refresh();}catch(e){setFeedback((e as Error).message);}finally{setWorking(false);}}
 useEffect(()=>{if(!feedback)return;const t=setTimeout(()=>setFeedback(''),8000);return()=>clearTimeout(t);},[feedback]);
 const blocked=!s.online||working||pending;
 const thumb=current||assigned;
 // Player snapshot: fresh frames replace the media thumbnail. The native frame is pre-rotated, so undo rotation/mirroring for an upright view.
 const snapFresh=!!(s.online&&s.snapshotAt&&Date.now()-s.snapshotAt<180000);
 const rot=Number(s.config?.rotation)||0,k=rot%180?(s.config.height/s.config.width):1;
 const snapStyle={transform:`scale(${k*(s.config?.mirrorX?-1:1)},${k*(s.config?.mirrorY?-1:1)}) rotate(${-rot}deg)`};
 const activeRule=(s.schedules||[]).find((r:any)=>r.id===s.activeScheduleId),activePlaylist=data.playlists.find((p:any)=>p.id===s.activePlaylistId);
 const failed=command&&(command.status==='failed'||command.status==='expired'||(!pending&&command.status==='pending'));
 const showCommand=command&&(pending||Date.now()-command.created<120000);
 const offlineTitle='Reconnect this display to control playback';

 return <section className={'screen card fx-card flat'+(s.online?' is-online':' is-offline')}><CardFx/>
  <button type="button" className="screen-preview" onClick={preview} aria-label={'Preview '+s.name} title={reported?'Thumbnail of media reported by the player — not a live feed':current?'Last reported media':'Assigned content'}>
   {snapFresh?<img className="snapshot" style={snapStyle} src={'/api/admin/screens/'+s.id+'/snapshot?t='+s.snapshotAt} alt=""/>:thumb?<img src={'/api/admin/media/'+thumb.id+'/thumbnail'} alt=""/>:<span className="preview-empty"><Icon name="Overview" size={34}/><span>No content assigned</span></span>}
   <span className={'thumb-status '+(s.online?'online':'offline')}><Icon name={s.online?'online':'offline'} size={14}/>{s.online?'Online':'Offline'}</span>
   {snapFresh&&<span className="thumb-snap" title="Frame reported by the browser player"><Icon name="eye" size={13}/>Snapshot</span>}{(thumb||snapFresh)&&s.online&&<span className={'thumb-badge state-'+tone}>{tone!=='muted'&&<Icon name={tone==='live'?'play':tone==='paused'?'pause':'alert'} size={tone==='bad'?13:11}/>}{stateLabel}</span>}
   <span className="preview-play" aria-hidden="true"><Icon name="play" size={26}/></span>
   {s.preparing&&<span className="thumb-progress" aria-hidden="true"/>}
  </button>

  <div className="screen-meta">
   <div className="title-row"><h2>{s.name}</h2>
    <Menu label={'More actions for '+s.name} items={[
     {label:'Preview',icon:'eye',onSelect:preview},
     {label:'Display settings',icon:'settings',onSelect:settings},
     {label:s.paired?'Pair again':'Pair display',icon:'key',onSelect:pair},
     {label:'Reload player',icon:'reload',disabled:blocked,onSelect:()=>void send('reload')},
     {label:'Mute audio',icon:'mute',hidden:muted!==undefined,disabled:blocked,onSelect:()=>void send('mute')},
    ]}/></div>
   <p className="now-title" title={current?.title||assigned?.title}>{current?.title||assigned?.title||'Ready for your content'}</p>
   <p className="meta"><span className={'playback-state '+tone+(reported?' reported':'')}>{stateLabel}</span><span aria-hidden="true"> · </span>{!s.online?ago(s.lastSeen).replace('Last connected ','Seen '):snapFresh?'Snapshot '+relative(s.snapshotAt):reported?'Reported by player':thumb?'Not yet reported':'Pick a playlist'}</p>
  </div>

  <div className="screen-assignment"><label className="select-inline"><Icon name="Playlists" size={18}/><span className="sr-only">Playlist</span><select aria-label={'Playlist for '+s.name} value={s.playlistId||''} disabled={working} onChange={e=>void assign(e.target.value)}><option value="">No playlist</option>{data.playlists.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   {!data.playlists.length&&<small className="hint">Create a playlist in the Playlists tab to get started.</small>}
   {activeRule?<small className="hint schedule-hint active"><Icon name="calendar" size={14}/>Scheduled now: “{activePlaylist?.name||'playlist'}” {activeRule.start===activeRule.end?'all day':'until '+toTime(activeRule.end)}</small>:(s.schedules||[]).length>0&&<small className="hint schedule-hint"><Icon name="calendar" size={14}/>{s.schedules.length} time slot{s.schedules.length===1?'':'s'} · default playing now</small>}
   {s.online&&s.diagnostics?.awake==='video-blocked'&&<small className="hint warning"><Icon name="alert" size={14}/> Keep-awake is blocked — press OK on the TV remote once.</small>}{s.preparing&&<small className="hint warning">Preparing content for this display…</small>}{s.error&&<small className="hint error">{s.error}</small>}</div>

  <div className="player-controls" role="group" aria-label={s.name+' playback controls'}>
   {[paused?'play':'pause','next',muted===false?'mute':'unmute'].map((a,i)=><Button type="button" key={a} className={'player-control'+(i===0?' main':'')} disabled={blocked} aria-label={commandNames[a]} title={!s.online?offlineTitle:muted===undefined&&a==='unmute'?'Unmute (audio state not yet reported)':commandNames[a]} onClick={()=>void send(a)}>{pending&&command?.action===a?<span className="spinner"/>:<Icon name={a} size={i===0?20:19}/>}</Button>)}
   <span className="spacer"/>
   {!s.online&&<Button className="tonal sm" onClick={()=>setHelp(true)}>Troubleshoot</Button>}
   <Button type="button" className="icon-btn" aria-label="Display settings" title="Display settings" onClick={settings}><Icon name="settings"/></Button>
  </div>

  {showCommand&&<div role="status" className={'command-feedback '+(failed?'failed':pending?'pending':'ok')}>{pending?<span className="spinner"/>:<Icon name={failed?'alert':'check'} size={16}/>}<span className="command-text"><b>{commandNames[command.action]||command.action} · {command.status==='success'?'Confirmed':command.status==='failed'?'Failed':command.status==='expired'||!pending&&command.status==='pending'?'Not confirmed':'Pending'}</b><small>{command.status==='success'?'Acknowledged by the player':pending?'Waiting for the player to acknowledge…':command.result||'No acknowledgment received. Check the display connection.'}</small></span></div>}
  {feedback&&<p role="status" className="inline-feedback"><Icon name="info" size={15}/>{feedback}</p>}

  {help&&<Modal title={'Reconnect '+s.name} close={()=>setHelp(false)} subtitle={ago(s.lastSeen)+'. Playback controls become available after the player reconnects.'}><ol className="steps compact troubleshooting"><li>Turn on the TV and open its browser.</li><li>Connect the TV and this PC to the same local network.</li><li>Keep the signage server running on this PC.</li><li>Open <a className="link" href={(data.urls[0]||location.origin)+'/tv/'+s.id} target="_blank" rel="noreferrer">{(data.urls[0]||location.origin)+'/tv/'+s.id}</a> on the TV.</li><li>If the TV asks for a pairing code, choose Pair display below.</li></ol><div className="modal-actions"><Button className="ghost" onClick={()=>setHelp(false)}>Close</Button><Button className="primary" onClick={()=>{setHelp(false);pair();}}><Icon name="key" size={17}/>Pair display</Button></div></Modal>}
 </section>;
}

export function seconds(entry:any,media:any[]){const m=media.find(x=>x.id===entry.mediaId);return m?.kind==='video'?Number(m.duration)||0:Number(entry.duration)||10;}
export function duration(n:number){return `${Math.floor(n/60)}m ${Math.round(n)%60}s`;}

/* ---------- Playlist editor (YouTube watch-page layout: player + queue) ---------- */
export function PlaylistEditor({value,setValue,media,screens=[],busy,close,save}:any){
 const video=useRef<HTMLVideoElement>(null);const [cycle,setCycle]=useState(0);
 const drag=useRef(-1),[dragOver,setDragOver]=useState(-1),[selected,setSelected]=useState(0),[playing,setPlaying]=useState(false),[review,setReview]=useState(false),[previewError,setPreviewError]=useState(''),[elapsed,setElapsed]=useState(0),[videoLength,setVideoLength]=useState(0);
 const entry=value.entries[selected],item=media.find((m:any)=>m.id===entry?.mediaId),total=value.entries.reduce((n:number,e:any)=>n+seconds(e,media),0);
 const invalid=value.entries.some((e:any)=>{const m=media.find((m:any)=>m.id===e.mediaId);return !m||m.status!=='ready'||(m.kind==='image'&&(!Number.isFinite(e.duration)||e.duration<1||e.duration>86400));});
 const itemSeconds=entry?seconds(entry,media):0;
 const length=item?.kind==='video'?(videoLength||itemSeconds):itemSeconds;
 const assignedTo=screens.filter((s:any)=>s.playlistId===value.id);
 const initial=useRef(JSON.stringify({name:value.name,entries:value.entries}));
 const dirty=JSON.stringify({name:value.name,entries:value.entries})!==initial.current;
 async function guardedClose(){if(!dirty||await confirmAction({title:'Discard unpublished changes?',danger:true,confirmLabel:'Discard changes',body:<p>Your edits to “{value.name||'this playlist'}” haven’t been published. Displays keep playing the last published version.</p>}))close();}
 function advance(){setCycle(c=>c+1);setSelected(i=>(i+1)%Math.max(1,value.entries.length));}
 function back(){setCycle(c=>c+1);setSelected(i=>(i-1+value.entries.length)%Math.max(1,value.entries.length));}
 useEffect(()=>{setPreviewError('');setElapsed(0);setVideoLength(0);},[selected,item?.id,cycle]);
 useEffect(()=>{if(!playing||!item||item.kind==='video')return;const t=setTimeout(advance,itemSeconds*1000);return()=>clearTimeout(t);},[playing,selected,itemSeconds,item?.id,item?.kind,cycle]);
 useEffect(()=>{if(!playing||!item||item.kind==='video')return;const start=Date.now();setElapsed(0);const t=setInterval(()=>setElapsed((Date.now()-start)/1000),200);return()=>clearInterval(t);},[playing,selected,item?.id,item?.kind,cycle]);
 useEffect(()=>{if(!video.current)return;if(playing)void video.current.play().catch(()=>{setPlaying(false);setPreviewError('Press play to start the preview.');});else video.current.pause();},[playing,item?.id,selected,cycle]);
 useEffect(()=>{if(selected>=value.entries.length){setSelected(Math.max(0,value.entries.length-1));setPlaying(false);}},[value.entries.length,selected]);
 function update(next:any){setValue(next);setReview(false);setPlaying(false);}
 function move(from:number,to:number){if(from<0||to<0||to>=value.entries.length||from===to)return;const entries=[...value.entries],part=entries.splice(from,1)[0];entries.splice(to,0,part);setSelected(to);update({...value,entries});}
 function onStageKey(e:React.KeyboardEvent){if(e.key===' '||e.key==='k'){e.preventDefault();if(entry&&!invalid)setPlaying(!playing);}else if(e.key==='ArrowRight'||e.key==='n'){if(entry){e.preventDefault();advance();}}else if(e.key==='ArrowLeft'||e.key==='p'){if(entry){e.preventDefault();back();}}}
 const pct=length?Math.min(100,elapsed/length*100):0;

 return <Modal title="Edit playlist" close={()=>void guardedClose()} wide subtitle={assignedTo.length?'Used on '+assignedTo.map((s:any)=>s.name).join(', '):'Not assigned to any display yet'}>
  <label className="field">Playlist name<input value={value.name} maxLength={120} onChange={e=>update({...value,name:e.target.value})}/></label>
  <div className="watch-layout">
   <section className="watch-main" aria-label="Draft preview">
    <div className={'yt-player'+(playing?' is-playing':'')} tabIndex={0} onKeyDown={onStageKey} aria-label="Draft preview player. Space to play or pause, arrow keys to change item.">
     <div className="yt-stage" onClick={()=>{if(entry&&!invalid)setPlaying(!playing);}}>
      {item?(item.kind==='video'?<video ref={video} key={item.id+'-'+selected+'-'+cycle} src={'/api/admin/media/'+item.id+'/preview'} autoPlay={playing} muted playsInline onLoadedMetadata={e=>setVideoLength(e.currentTarget.duration||0)} onTimeUpdate={e=>setElapsed(e.currentTarget.currentTime)} onPlay={()=>setPlaying(true)} onPause={()=>{if(video.current&&!video.current.ended)setPlaying(false);}} onEnded={()=>{if(playing)advance();}} onError={()=>{setPlaying(false);setPreviewError('Preview unavailable. Check the media in your library.');}}/>:<img src={'/api/admin/media/'+item.id+'/preview'} alt={item.title} onError={()=>{setPlaying(false);setPreviewError('Preview unavailable. Check the media in your library.');}}/>):<span className="yt-empty"><Icon name="Playlists" size={36}/>Add an item to preview</span>}
      {entry&&!playing&&<span className="yt-big-play" aria-hidden="true"><Icon name="play" size={34}/></span>}
     </div>
     <div className="yt-chrome">
      <div className="yt-progress" aria-hidden="true"><span style={{width:pct+'%'}}/></div>
      <div className="yt-controls">
       <Button type="button" className="yt-btn" aria-label="Previous item" disabled={!entry||value.entries.length<2} onClick={back}><Icon name="prev" size={20}/></Button>
       <Button type="button" className="yt-btn" aria-label={playing?'Pause preview':'Play sequence'} title={playing?'Pause (k)':'Play (k)'} disabled={!entry||invalid} onClick={()=>setPlaying(!playing)}><Icon name={playing?'pause':'play'} size={24}/></Button>
       <Button type="button" className="yt-btn" aria-label="Next item" disabled={!entry} onClick={advance}><Icon name="next" size={20}/></Button>
       <span className="yt-time">{clock(elapsed)} / {clock(length)}</span>
       <span className="spacer"/>
       <span className="yt-chip">{item?.kind==='video'?'Video · muted':item?'Image':''}</span>
      </div>
     </div>
    </div>
    <div className="watch-meta"><h3>{item?.title||'No media selected'}</h3>{entry&&<small>Item {selected+1} of {value.entries.length} · {duration(seconds(entry,media))}</small>}
     {previewError&&<p role="alert" className="error small">{previewError}</p>}
     <p className="muted small">Preview uses original orientation. Display rotation and fit apply on the TV. Videos are muted here.</p></div>
   </section>

   <aside className="queue" aria-label="Playlist items">
    <div className="queue-head"><div><b className="queue-title">{value.name||'Untitled playlist'}</b><div className="playlist-summary"><span>{value.entries.length} items</span><span aria-hidden="true">·</span><span>{duration(total)} per loop</span></div></div><span className={'badge draft'+(dirty?'':' clean')}>{dirty?'Unsaved draft':'Published'}</span></div>
    <div className="entry-list">{!value.entries.length&&<div className="empty compact">Add media below to build your sequence.</div>}
     {value.entries.map((e:any,i:number)=>{const m=media.find((m:any)=>m.id===e.mediaId);return <div className={'entry'+(selected===i?' selected-entry':'')+(dragOver===i?' drag-over':'')} draggable key={i} onDragStart={ev=>{drag.current=i;ev.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{drag.current=-1;setDragOver(-1);}} onDragOver={ev=>{ev.preventDefault();if(dragOver!==i)setDragOver(i);}} onDragLeave={()=>setDragOver(d=>d===i?-1:d)} onDrop={()=>{setDragOver(-1);move(drag.current,i);}}>
      <span className="entry-index" aria-hidden="true">{selected===i&&playing?<Icon name="play" size={12}/>:i+1}</span>
      <span className="entry-handle" aria-hidden="true" title="Drag to reorder"><Icon name="drag" size={16}/></span>
      <button type="button" className="entry-thumbnail" aria-label={'Preview item '+(i+1)} onClick={()=>{setSelected(i);setPlaying(false);}}><img alt="" src={'/api/admin/media/'+e.mediaId+'/thumbnail'}/><span>{m?.kind==='video'?clock(seconds(e,media)):clock(Number(e.duration)||0)}</span></button>
      <div className="entry-info"><b title={m?.title}>{m?.title||'Missing media'}</b><small>{!m?<span className="error">Removed from library</span>:m.kind==='video'?'Video · plays in full':'Image'}</small>
       {m?.kind==='image'&&<label className="duration-field"><input aria-label={'Duration for '+m.title} type="number" min={1} max={86400} value={e.duration} onChange={event=>{const entries=[...value.entries];entries[i]={...e,duration:Number(event.target.value)};update({...value,entries});}}/><span>sec</span></label>}</div>
      <div className="entry-actions"><Button type="button" className="icon-btn sm" aria-label={'Move item '+(i+1)+' up'} title="Move up" disabled={i===0} onClick={()=>move(i,i-1)}><Icon name="up" size={16}/></Button><Button type="button" className="icon-btn sm" aria-label={'Move item '+(i+1)+' down'} title="Move down" disabled={i===value.entries.length-1} onClick={()=>move(i,i+1)}><Icon name="down" size={16}/></Button><Button type="button" className="icon-btn sm" aria-label={'Duplicate item '+(i+1)} title="Duplicate" onClick={()=>{const entries=[...value.entries];entries.splice(i+1,0,{...e});update({...value,entries});}}><Icon name="copy" size={16}/></Button><Button type="button" className="icon-btn sm danger" aria-label={'Remove item '+(i+1)} title="Remove" onClick={()=>update({...value,entries:value.entries.filter((_:any,j:number)=>j!==i)})}><Icon name="x" size={16}/></Button></div>
     </div>;})}</div>
    <label className="field add-media">Add media<select value="" onChange={e=>{if(e.target.value)update({...value,entries:[...value.entries,{mediaId:e.target.value,duration:10}]});}}><option value="">Choose a ready media item…</option>{media.filter((m:any)=>m.status==='ready').map((m:any)=><option key={m.id} value={m.id}>{m.title} ({m.kind})</option>)}</select></label>
    <p className="muted small">Drag items or use the arrow buttons to change the order.</p>
   </aside>
  </div>

  <div className="editor-footer">
   <label className="check"><input type="checkbox" checked={value.immediate} onChange={e=>update({...value,immediate:e.target.checked})}/>Interrupt current playback when the updated content is ready</label>
   {invalid&&<p className="error small" role="alert"><Icon name="alert" size={15}/>Use ready media and image durations from 1 to 86400 seconds.</p>}
   {review?<div className="publish-review"><div><h3>Ready to publish?</h3><p>{value.entries.length?`${value.entries.length} items · ${duration(total)} per loop.`:'This empty playlist will show the fallback screen.'} Assigned displays will update {value.immediate?'as soon as preparation finishes.':'after preparation and their current item finishes.'}</p></div><div className="modal-actions"><Button className="ghost" onClick={()=>setReview(false)}>Back to editing</Button><Button className="primary" loading={busy} disabled={invalid} onClick={save}>{busy?'Publishing…':'Publish playlist'}</Button></div></div>
    :<div className="modal-actions"><Button className="ghost" onClick={()=>void guardedClose()}>{dirty?'Discard':'Close'}</Button><Button className="primary" disabled={busy||!value.name.trim()||invalid} onClick={()=>{setPlaying(false);setReview(true);}}>Review & publish</Button></div>}
  </div>
 </Modal>;
}
