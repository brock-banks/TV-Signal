import React,{useState,useEffect,useRef,useMemo,useCallback} from 'react';
import {Button} from './spectrum';
import {Icon,Modal,relative} from './src';

/* ==========================================================================
   Confirmation dialogs (replace window.confirm with explained, styled dialogs)
   ========================================================================== */
export type ConfirmOptions={title:string;body?:React.ReactNode;confirmLabel?:string;danger?:boolean;blockedReason?:React.ReactNode};
let openConfirm:((o:ConfirmOptions,resolve:(v:boolean)=>void)=>void)|null=null;
/** Promise-based confirmation. Resolves false when dismissed or when `blockedReason` prevents the action. */
export function confirmAction(o:ConfirmOptions){return new Promise<boolean>(resolve=>{if(openConfirm)openConfirm(o,resolve);else resolve(window.confirm(o.title));});}
export function ConfirmHost(){
 const [state,setState]=useState<{o:ConfirmOptions;resolve:(v:boolean)=>void}|null>(null);
 useEffect(()=>{openConfirm=(o,resolve)=>setState({o,resolve});return()=>{openConfirm=null;};},[]);
 if(!state)return null;
 const done=(v:boolean)=>{state.resolve(v);setState(null);};
 const {o}=state;
 return <Modal title={o.title} close={()=>done(false)}>
  {o.body&&<div className="confirm-body">{o.body}</div>}
  {o.blockedReason&&<div className="callout warn"><Icon name="alert" size={16}/><div>{o.blockedReason}</div></div>}
  <div className="modal-actions"><Button className="ghost" onClick={()=>done(false)}>{o.blockedReason?'Close':'Cancel'}</Button>{!o.blockedReason&&<Button className={o.danger?'danger-solid':'primary'} autoFocus onClick={()=>done(true)}>{o.confirmLabel||'Confirm'}</Button>}</div>
 </Modal>;
}

/* ==========================================================================
   Command palette (Ctrl/⌘ + K)
   ========================================================================== */
export type Command={id:string;label:string;group:string;icon?:string;hint?:string;keywords?:string;run:()=>void};
function score(c:Command,q:string){
 if(!q)return 1;const hay=(c.label+' '+(c.keywords||'')+' '+c.group).toLowerCase(),label=c.label.toLowerCase();
 const words=q.toLowerCase().split(/\s+/).filter(Boolean);if(!words.every(w=>hay.includes(w)))return 0;
 return (label.startsWith(words[0])?4:0)+(label.includes(q.toLowerCase())?2:0)+1;
}
export function CommandPalette({open,close,commands}:{open:boolean;close:()=>void;commands:Command[]}){
 const [q,setQ]=useState(''),[active,setActive]=useState(0);const list=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null);
 const results=useMemo(()=>commands.map(c=>({c,s:score(c,q.trim())})).filter(r=>r.s>0).sort((a,b)=>b.s-a.s).slice(0,60).map(r=>r.c),[commands,q]);
 const grouped=useMemo(()=>{if(q.trim())return [['Results',results] as const];const m=new Map<string,Command[]>();results.forEach(c=>{if(!m.has(c.group))m.set(c.group,[]);m.get(c.group)!.push(c);});return [...m.entries()];},[results,q]);
 const flat=useMemo(()=>grouped.flatMap(([,cs])=>cs),[grouped]);
 useEffect(()=>{if(open){setQ('');setActive(0);const prev=document.activeElement as HTMLElement;setTimeout(()=>input.current?.focus(),0);return()=>prev?.focus?.();}},[open]);
 useEffect(()=>{setActive(0);},[q]);
 useEffect(()=>{list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[active]);
 if(!open)return null;
 const run=(c?:Command)=>{if(!c)return;close();setTimeout(c.run,0);};
 return <div className="palette-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
  <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
   <div className="palette-input"><Icon name="search" size={20}/><input ref={input} value={q} onChange={e=>setQ(e.target.value)} placeholder="Search displays, playlists, media or type a command…" aria-label="Search commands" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={flat[active]?'cmd-'+flat[active].id:undefined}
    onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(a=>Math.min(flat.length-1,a+1));}else if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(0,a-1));}else if(e.key==='Enter'){e.preventDefault();run(flat[active]);}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}}}/><kbd>Esc</kbd></div>
   <div className="palette-list" id="palette-list" role="listbox" ref={list}>
    {!flat.length&&<p className="palette-empty">No matches for “{q}”.</p>}
    {grouped.map(([group,cs])=><div key={group} role="group" aria-label={group}><div className="palette-group">{group}</div>{cs.map(c=>{const i=flat.indexOf(c);return <div key={c.id} id={'cmd-'+c.id} role="option" aria-selected={i===active} className="palette-item" onMouseMove={()=>setActive(i)} onClick={()=>run(c)}><span className="palette-icon"><Icon name={c.icon||'external'} size={18}/></span><span className="palette-label">{c.label}</span>{c.hint&&<span className="palette-hint">{c.hint}</span>}</div>;})}</div>)}
   </div>
   <div className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> run</span><span><kbd>Ctrl</kbd><kbd>K</kbd> toggle</span></div>
  </div>
 </div>;
}

/* ==========================================================================
   Upload queue (per-file progress, cancel, processing status)
   ========================================================================== */
export type UploadItem={key:number;name:string;size:number;progress:number;status:'queued'|'uploading'|'processing'|'ready'|'error'|'cancelled';error?:string;mediaId?:string;xhr?:XMLHttpRequest};
let uploadKey=0;
export function useUploads(onUploaded:()=>void){
 const [items,setItems]=useState<UploadItem[]>([]);const itemsRef=useRef(items);itemsRef.current=items;
 const patch=(key:number,p:Partial<UploadItem>)=>setItems(list=>list.map(i=>i.key===key?{...i,...p}:i));
 const pump=useCallback(()=>{
  const list=itemsRef.current;if(list.filter(i=>i.status==='uploading').length>=2)return;
  const next=list.find(i=>i.status==='queued'&&(i as any).file);if(!next)return;
  const file:File=(next as any).file,form=new FormData();form.append('files',file);
  const x=new XMLHttpRequest();x.open('POST','/api/admin/media');x.setRequestHeader('X-Signage-Request','1');
  itemsRef.current=list.map(i=>i.key===next.key?{...i,status:'uploading',xhr:x}:i);setItems(itemsRef.current);
  x.upload.onprogress=e=>{if(e.lengthComputable)patch(next.key,{progress:Math.round(e.loaded/e.total*100)});};
  x.onload=()=>{try{const r=JSON.parse(x.responseText),res=r.results?.[0];if(x.status>=400||r.error||res?.error)patch(next.key,{status:'error',error:r.error||res?.error||'Upload failed'});else patch(next.key,{status:'processing',progress:100,mediaId:res.id});}catch{patch(next.key,{status:'error',error:'Upload failed'});}onUploaded();setTimeout(pump,0);};
  x.onerror=()=>{patch(next.key,{status:'error',error:'Connection lost while uploading. Retry the upload.'});setTimeout(pump,0);};
  x.onabort=()=>{patch(next.key,{status:'cancelled'});setTimeout(pump,0);};
  x.send(form);setTimeout(pump,0);
 },[onUploaded]);
 const add=(files:FileList|File[]|null)=>{if(!files?.length)return;const added=Array.from(files).map(f=>({key:++uploadKey,name:f.name,size:f.size,progress:0,status:'queued' as const,file:f}));itemsRef.current=[...itemsRef.current,...added];setItems(itemsRef.current);setTimeout(pump,0);};
 const cancel=(key:number)=>{const i=itemsRef.current.find(i=>i.key===key);if(i?.status==='uploading')i.xhr?.abort();else if(i?.status==='queued')patch(key,{status:'cancelled'});};
 const retry=(key:number)=>{patch(key,{status:'queued',progress:0,error:undefined});setTimeout(pump,0);};
 const clear=()=>setItems(list=>list.filter(i=>i.status==='queued'||i.status==='uploading'||i.status==='processing'));
 const sync=(media:any[])=>setItems(list=>{let changed=false;const next=list.map(i=>{if(i.status!=='processing'||!i.mediaId)return i;const m=media.find(m=>m.id===i.mediaId);if(!m)return i;if(m.status==='ready'){changed=true;return {...i,status:'ready' as const};}if(m.status==='error'){changed=true;return {...i,status:'error' as const,error:m.error||'Conversion failed'};}return i;});return changed?next:list;});
 const uploading=items.some(i=>i.status==='uploading'||i.status==='queued');
 useEffect(()=>{if(!uploading)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[uploading]);
 return {items,add,cancel,retry,clear,sync,uploading};
}
const fmtSize=(n:number)=>n>1e9?(n/1e9).toFixed(1)+' GB':n>1e6?(n/1e6).toFixed(1)+' MB':Math.max(1,Math.round(n/1e3))+' KB';
export function UploadPanel({q}:{q:ReturnType<typeof useUploads>}){
 const [collapsed,setCollapsed]=useState(false);
 if(!q.items.length)return null;
 const active=q.items.filter(i=>i.status==='uploading'||i.status==='queued').length,processing=q.items.filter(i=>i.status==='processing').length,failed=q.items.filter(i=>i.status==='error').length;
 const title=active?`Uploading ${active} file${active===1?'':'s'}`:processing?`Converting ${processing} file${processing===1?'':'s'}`:failed?`${failed} upload${failed===1?'':'s'} need attention`:'Uploads complete';
 return <section className={'upload-panel'+(collapsed?' collapsed':'')} aria-label="Upload queue">
  <header><b role="status">{title}</b><span className="spacer"/><Button className="icon-btn sm" aria-label={collapsed?'Expand upload queue':'Collapse upload queue'} onClick={()=>setCollapsed(!collapsed)}><Icon name={collapsed?'up':'down'} size={18}/></Button>{!active&&!processing&&<Button className="icon-btn sm" aria-label="Close upload queue" onClick={q.clear}><Icon name="x" size={18}/></Button>}</header>
  {!collapsed&&<ul>{q.items.map(i=><li key={i.key} className={'upload-item '+i.status}>
   <span className="upload-status-icon">{i.status==='ready'?<Icon name="check" size={18}/>:i.status==='error'?<Icon name="alert" size={18}/>:i.status==='cancelled'?<Icon name="x" size={18}/>:<span className="spinner"/>}</span>
   <span className="upload-meta"><b title={i.name}>{i.name}</b><small>{i.status==='uploading'?`${i.progress}% of ${fmtSize(i.size)}`:i.status==='queued'?'Waiting…':i.status==='processing'?'Converting on this PC…':i.status==='ready'?'Ready':i.status==='cancelled'?'Cancelled':i.error}</small>{(i.status==='uploading'||i.status==='queued')&&<progress max={100} value={i.progress} aria-label={'Upload progress for '+i.name}/>}</span>
   {(i.status==='uploading'||i.status==='queued')&&<Button className="icon-btn sm" aria-label={'Cancel '+i.name} onClick={()=>q.cancel(i.key)}><Icon name="x" size={16}/></Button>}
   {(i.status==='error'||i.status==='cancelled')&&(i as any).file&&!i.mediaId&&<Button className="icon-btn sm" aria-label={'Retry '+i.name} onClick={()=>q.retry(i.key)}><Icon name="reload" size={16}/></Button>}
  </li>)}</ul>}
 </section>;
}

/* ==========================================================================
   Activity log + alerts
   ========================================================================== */
export type Activity={id:number;time:number;level:'info'|'success'|'warning'|'error';kind:string;message:string;screenId:number|null};
const KIND_ICON:Record<string,string>={display:'Overview',content:'Media library',playlist:'Playlists',schedule:'calendar',command:'play',security:'shield'};
const levelIcon=(a:Activity)=>a.level==='error'||a.level==='warning'?'alert':a.level==='success'?'check':KIND_ICON[a.kind]||'info';
async function getJSON(url:string){const r=await fetch('/api'+url,{headers:{'X-Signage-Request':'1'}});const ct=r.headers.get('content-type')||'';if(!r.ok||!ct.includes('json'))throw new Error('Request failed');return r.json();}
function dayLabel(t:number){const d=new Date(t),today=new Date();const y=new Date();y.setDate(today.getDate()-1);if(d.toDateString()===today.toDateString())return 'Today';if(d.toDateString()===y.toDateString())return 'Yesterday';return d.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});}
const FILTERS:[string,string][]=[['all','All'],['alert','Alerts'],['display','Displays'],['content','Media'],['playlist','Playlists'],['schedule','Schedules'],['command','Commands'],['security','Security']];
export function ActivityPage({version,screens}:{version:number;screens:any[]}){
 const [filter,setFilter]=useState('all'),[items,setItems]=useState<Activity[]>([]),[loading,setLoading]=useState(true),[more,setMore]=useState(true),[failed,setFailed]=useState(false);
 const query=(before?:number)=>'/admin/activity?limit=50'+(filter==='alert'?'&level=alert':filter!=='all'?'&kind='+filter:'')+(before?'&before='+before:'');
 useEffect(()=>{let live=true;setFailed(false);getJSON(query()).then(r=>{if(!live)return;const list=Array.isArray(r?.items)?r.items:[];setItems(list);setMore(list.length===50);}).catch(()=>live&&setFailed(true)).finally(()=>live&&setLoading(false));return()=>{live=false;};},[filter,version]);
 const loadMore=()=>{const last=items[items.length-1];if(!last)return;setLoading(true);getJSON(query(last.id)).then(r=>{const list=Array.isArray(r?.items)?r.items:[];setItems(i=>[...i,...list]);setMore(list.length===50);}).catch(()=>setFailed(true)).finally(()=>setLoading(false));};
 const exportCsv=()=>{const rows=[['Time','Level','Category','Display','Message'],...items.map(a=>[new Date(a.time).toISOString(),a.level,a.kind,screens.find(s=>s.id===a.screenId)?.name||'',a.message])];const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='signal-activity-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const days:[string,Activity[]][]=[];items.forEach(a=>{const d=dayLabel(a.time);const last=days[days.length-1];if(last&&last[0]===d)last[1].push(a);else days.push([d,[a]]);});
 return <div className="activity">
  <div className="section-title"><div className="chips" role="group" aria-label="Filter activity">{FILTERS.map(([k,l])=><Button key={k} className="chip" aria-pressed={filter===k} onClick={()=>{setFilter(k);setLoading(true);}}>{l}</Button>)}</div><Button className="tonal sm" onClick={exportCsv} disabled={!items.length}><Icon name="download" size={16}/>Export CSV</Button></div>
  {failed&&<div className="empty compact"><h3>Activity is unavailable</h3><p>Check the connection to the signage server.</p></div>}
  {!failed&&!loading&&!items.length&&<div className="empty"><span className="empty-icon"><Icon name="activity" size={28}/></span><h3>Nothing here yet</h3><p>Sign-ins, publishing, uploads, commands and display connection changes will appear here.</p></div>}
  {days.map(([day,list])=><section key={day} className="activity-day"><h3>{day}</h3><ol className="activity-list">{list.map(a=><li key={a.id} className={'activity-item '+a.level}><span className="activity-icon"><Icon name={levelIcon(a)} size={17}/></span><span className="activity-msg">{a.message}{a.screenId!=null&&screens.find(s=>s.id===a.screenId)&&<span className="activity-chip">{screens.find(s=>s.id===a.screenId).name}</span>}</span><time dateTime={new Date(a.time).toISOString()} title={new Date(a.time).toLocaleString()}>{new Date(a.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></li>)}</ol></section>)}
  {loading&&<div className="activity-loading"><span className="spinner"/>Loading…</div>}
  {!loading&&more&&items.length>0&&<div className="center"><Button className="tonal" onClick={loadMore}>Load older activity</Button></div>}
 </div>;
}

const SEEN_KEY='signal-alerts-seen',DESKTOP_KEY='signal-alerts-desktop';
const store={get:(k:string)=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k:string,v:string)=>{try{localStorage.setItem(k,v);}catch{}}};
/** Masthead bell: unread warnings/errors, optional desktop notifications, in-app toast for new alerts. */
export function AlertsBell({version,onAlert,openActivity}:{version:number;onAlert:(a:Activity)=>void;openActivity:()=>void}){
 const [alerts,setAlerts]=useState<Activity[]>([]),[seen,setSeen]=useState(()=>Number(store.get(SEEN_KEY))||0),[desktop,setDesktop]=useState(()=>store.get(DESKTOP_KEY)==='1');
 const newest=useRef<number|null>(null);
 const canNotify=typeof Notification!=='undefined'&&window.isSecureContext;
 useEffect(()=>{let live=true;getJSON('/admin/activity?level=alert&limit=15').then(r=>{if(!live)return;const list:Activity[]=Array.isArray(r?.items)?r.items:[];setAlerts(list);
  if(newest.current!==null){list.filter(a=>a.id>newest.current!).reverse().forEach(a=>{onAlert(a);if(desktop&&canNotify&&Notification.permission==='granted'){try{new Notification('Signal · '+(a.level==='error'?'Error':'Warning'),{body:a.message,tag:'signal-'+a.id});}catch{}}});}
  newest.current=list[0]?.id??0;}).catch(()=>{});return()=>{live=false;};},[version]);
 const unread=alerts.filter(a=>a.id>seen).length;
 const markRead=()=>{const top=alerts[0]?.id||seen;setSeen(top);store.set(SEEN_KEY,String(top));};
 const toggleDesktop=async()=>{if(!canNotify)return;if(!desktop&&Notification.permission!=='granted'){const p=await Notification.requestPermission();if(p!=='granted')return;}setDesktop(!desktop);store.set(DESKTOP_KEY,!desktop?'1':'0');};
 return <details className="menu alerts" onToggle={e=>{if(!(e.currentTarget as HTMLDetailsElement).open&&unread)markRead();}}>
  <Button as="summary" className="icon-btn" aria-label={unread?`Alerts, ${unread} unread`:'Alerts'} title="Alerts"><Icon name="bell"/>{unread>0&&<span className="bell-badge" aria-hidden="true">{unread>9?'9+':unread}</span>}</Button>
  <div className="menu-popover right alerts-popover" role="dialog" aria-label="Alerts">
   <div className="alerts-head"><b>Alerts</b>{unread>0&&<button type="button" className="link-btn" onClick={markRead}>Mark all read</button>}</div>
   {!alerts.length?<p className="alerts-empty"><Icon name="check" size={18}/>No warnings or errors.</p>:<ol className="alerts-list">{alerts.slice(0,8).map(a=><li key={a.id} className={'alert-row '+a.level+(a.id>seen?' unread':'')}><Icon name="alert" size={16}/><span><span className="alert-msg">{a.message}</span><small>{relative(a.time)}</small></span></li>)}</ol>}
   <div className="alerts-foot">
    {canNotify?<label className="check small"><input type="checkbox" checked={desktop} onChange={()=>void toggleDesktop()}/>Desktop notifications</label>:<small className="muted" title="Browsers allow desktop notifications only on localhost or HTTPS">Desktop notifications need localhost or HTTPS</small>}
    <button type="button" className="link-btn" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');openActivity();}}>View all activity</button>
   </div>
  </div>
 </details>;
}

/* ==========================================================================
   Day-part schedule editor
   ========================================================================== */
const DAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],DAY_SHORT=['S','M','T','W','T','F','S'];
export const toTime=(m:number)=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const fromTime=(v:string)=>{const [h,m]=v.split(':').map(Number);return (h||0)*60+(m||0);};
export function daysLabel(mask:number){if(mask===127)return 'Every day';if(mask===62)return 'Weekdays';if(mask===65)return 'Weekends';return DAY_NAMES.filter((_,i)=>mask&(1<<i)).join(', ');}
type Rule={playlistId:string;days:number;start:number;end:number;enabled:boolean};
export function ScheduleEditor({screen,playlists,api,saved,timezone}:{screen:any;playlists:any[];api:(u:string,m?:string,d?:any)=>Promise<any>;saved:(msg:string,ok:boolean)=>void;timezone?:string}){
 const initial:Rule[]=(screen.schedules||[]).map((r:any)=>({playlistId:r.playlistId,days:r.days,start:r.start,end:r.end,enabled:!!r.enabled}));
 const [rules,setRules]=useState<Rule[]>(initial),[busy,setBusy]=useState(false);
 const dirty=JSON.stringify(rules)!==JSON.stringify(initial);
 const invalid=rules.some(r=>!r.playlistId||!r.days);
 const set=(i:number,p:Partial<Rule>)=>setRules(rs=>rs.map((r,j)=>j===i?{...r,...p}:r));
 const add=(preset?:Partial<Rule>)=>setRules(rs=>[...rs,{playlistId:playlists[0]?.id||'',days:62,start:540,end:1020,enabled:true,...preset}]);
 async function save(){setBusy(true);try{await api('/admin/screens/'+screen.id+'/schedules','PUT',{rules});saved('Schedule saved for '+screen.name,true);}catch(e){saved((e as Error).message,false);}finally{setBusy(false);}}
 return <div className="schedule-editor">
  <p className="muted small">Time slots override the default playlist. The first matching slot wins; outside every slot the default plays. Times use this PC’s clock{timezone?` (${timezone})`:''}. End before start runs overnight; equal times mean all day.</p>
  {!playlists.length&&<p className="callout"><Icon name="info" size={16}/>Create a playlist first.</p>}
  <ol className="slots">{rules.map((r,i)=><li key={i} className={'slot'+(r.enabled?'':' disabled')}>
   <div className="slot-row"><span className="slot-index">{i+1}</span>
    <div className="day-toggle" role="group" aria-label={'Days for time slot '+(i+1)}>{DAY_SHORT.map((d,di)=><button type="button" key={di} className="day" aria-pressed={!!(r.days&(1<<di))} aria-label={DAY_NAMES[di]} title={DAY_NAMES[di]} onClick={()=>set(i,{days:r.days^(1<<di)})}>{d}</button>)}</div>
    <label className="time-field"><span className="sr-only">Start time for slot {i+1}</span><input type="time" value={toTime(r.start)} onChange={e=>set(i,{start:fromTime(e.target.value)})}/></label><span className="to">to</span>
    <label className="time-field"><span className="sr-only">End time for slot {i+1}</span><input type="time" value={toTime(r.end)} onChange={e=>set(i,{end:fromTime(e.target.value)})}/></label>
   </div>
   <div className="slot-row"><label className="slot-playlist"><span className="sr-only">Playlist for slot {i+1}</span><select value={r.playlistId} onChange={e=>set(i,{playlistId:e.target.value})}><option value="">Choose playlist…</option>{playlists.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="check small slot-on"><input type="checkbox" checked={r.enabled} onChange={e=>set(i,{enabled:e.target.checked})}/>On</label>
    <Button className="icon-btn sm" aria-label={'Move slot '+(i+1)+' up'} disabled={i===0} onClick={()=>setRules(rs=>{const n=[...rs];[n[i-1],n[i]]=[n[i],n[i-1]];return n;})}><Icon name="up" size={16}/></Button>
    <Button className="icon-btn sm danger" aria-label={'Remove slot '+(i+1)} onClick={()=>setRules(rs=>rs.filter((_,j)=>j!==i))}><Icon name="trash" size={16}/></Button></div>
   <small className="slot-summary">{daysLabel(r.days)||'No days selected'} · {r.start===r.end?'all day':toTime(r.start)+'–'+toTime(r.end)+(r.end<r.start?' (overnight)':'')}</small>
  </li>)}</ol>
  <div className="slot-actions"><Button className="tonal sm" disabled={!playlists.length||rules.length>=50} onClick={()=>add()}><Icon name="plus" size={16}/>Add time slot</Button>
   <Button className="text sm" disabled={!playlists.length} onClick={()=>add({days:62,start:540,end:1020})}>+ Weekdays 9–17</Button><Button className="text sm" disabled={!playlists.length} onClick={()=>add({days:65,start:0,end:0})}>+ Weekends all day</Button>
   <span className="spacer"/><Button className="primary sm" loading={busy} disabled={!dirty||invalid} onClick={save}>Save schedule</Button></div>
  {invalid&&<p className="error small"><Icon name="alert" size={15}/>Each slot needs at least one day and a playlist.</p>}
 </div>;
}
