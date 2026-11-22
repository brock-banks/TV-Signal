import React,{useState,useEffect,useRef,useCallback} from 'react';
import {createRoot} from 'react-dom/client';

import './spectrum.css';
import './features.css';
import {DisplayCard,PlaylistEditor,seconds,duration} from './workspace';
import {Button,SpectrumTheme} from './spectrum';
import {QuickPreview} from './quick-preview';
import {ConfirmHost,confirmAction,CommandPalette,type Command,useUploads,UploadPanel,ActivityPage,AlertsBell,ScheduleEditor} from './features';

async function api(url:string,method='GET',data?:any){const r=await fetch('/api'+url,{method,headers:{'Content-Type':'application/json','X-Signage-Request':'1'},body:data?JSON.stringify(data):undefined});const body=await r.json();if(!r.ok)throw new Error(body.error||'Request failed');return body;}

/* ---------- Icons ---------- */
const F={fill:'currentColor',stroke:'none'} as const;
const ICONS:Record<string,React.ReactNode>={
 play:<path {...F} d="M8 5.6v12.8c0 .8.9 1.3 1.6.8l10-6.4c.6-.4.6-1.2 0-1.6l-10-6.4C8.9 4.3 8 4.8 8 5.6Z"/>,
 pause:<path {...F} d="M6.5 5h3.5v14H6.5zM14 5h3.5v14H14z"/>,
 next:<><path {...F} d="M5 6.1v11.8c0 .8.9 1.2 1.5.8l8.3-5.9c.5-.4.5-1.2 0-1.6L6.5 5.3C5.9 4.9 5 5.3 5 6.1Z"/><path d="M18.5 5.5v13"/></>,
 prev:<><path {...F} d="M19 6.1v11.8c0 .8-.9 1.2-1.5.8l-8.3-5.9c-.5-.4-.5-1.2 0-1.6l8.3-5.9c.6-.4 1.5 0 1.5.8Z"/><path d="M5.5 5.5v13"/></>,
 reload:<path d="M20 5v5h-5M20 12a8 8 0 1 1-2.3-5.7L20 10"/>,
 mute:<path d="M11 5 6 9H3v6h3l5 4ZM16 9.5l5 5m0-5-5 5"/>,
 unmute:<path d="M11 5 6 9H3v6h3l5 4ZM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>,
 Overview:<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>,
 'Media library':<><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 17 5.5-5.5 4 4 3-3L21 18"/></>,
 Playlists:<><path d="M3 6h14M3 11h14M3 16h7"/><path {...F} d="M14 14.2v6.6c0 .5.5.8.9.5l5.3-3.3c.4-.3.4-.8 0-1l-5.3-3.3c-.4-.3-.9 0-.9.5Z"/></>,
 'Setup & help':<><circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.8M12 17v.1"/></>,
 search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
 upload:<path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>,
 menu:<path d="M3 6h18M3 12h18M3 18h18"/>,
 more:<><circle {...F} cx="12" cy="5" r="1.6"/><circle {...F} cx="12" cy="12" r="1.6"/><circle {...F} cx="12" cy="19" r="1.6"/></>,
 settings:<><path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></>,
 plus:<path d="M12 5v14M5 12h14"/>,
 trash:<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>,
 edit:<path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4"/>,
 copy:<><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/></>,
 check:<path d="m5 12.5 4.5 4.5L19 7.5"/>,
 alert:<><path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4M12 17v.1"/></>,
 info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/></>,
 x:<path d="M6 6l12 12M18 6 6 18"/>,
 up:<path d="m6 15 6-6 6 6"/>,
 down:<path d="m6 9 6 6 6-6"/>,
 drag:<><circle {...F} cx="9" cy="6" r="1.3"/><circle {...F} cx="15" cy="6" r="1.3"/><circle {...F} cx="9" cy="12" r="1.3"/><circle {...F} cx="15" cy="12" r="1.3"/><circle {...F} cx="9" cy="18" r="1.3"/><circle {...F} cx="15" cy="18" r="1.3"/></>,
 logout:<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h11"/>,
 external:<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>,
 sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></>,
 moon:<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>,
 system:<><circle cx="12" cy="12" r="9"/><path {...F} d="M12 3a9 9 0 0 1 0 18Z"/></>,
 offline:<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.5-2.6M19 13a10 10 0 0 0-2.2-1.6M2 8.8a15 15 0 0 1 3.8-2.4M22 8.8a15 15 0 0 0-11-3.7M12 20h.01"/>,
 clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
 video:<><rect x="3" y="5" width="18" height="14" rx="2"/><path {...F} d="M10 9.2v5.6c0 .4.4.6.7.4l4.4-2.8c.3-.2.3-.6 0-.8l-4.4-2.8c-.3-.2-.7 0-.7.4Z"/></>,
 image:<><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/></>,
 key:<><circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16.5 6.5l3 3M14 9l2 2"/></>,
 eye:<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
 'eye-off':<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6C3.6 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>,
 shield:<><path d="M12 3 4.5 6v6c0 4.6 3.2 7.8 7.5 9 4.3-1.2 7.5-4.4 7.5-9V6Z"/><path d="m9 12 2 2 4-4"/></>,
 link:<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>,
 folder:<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>,
 signal:<><circle {...F} cx="12" cy="12" r="2.2"/><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8"/></>,
 online:<><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.7 15.9a4.8 4.8 0 0 1 6.6 0"/><circle {...F} cx="12" cy="19.3" r="1.4"/></>,
 bell:<path d="M6 8.5a6 6 0 1 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5ZM10.2 20.5a2 2 0 0 0 3.6 0"/>,
 Activity:<path d="M3 12h4l3-8 4 16 3-8h4"/>,
 activity:<path d="M3 12h4l3-8 4 16 3-8h4"/>,
 calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
 layers:<><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/></>,
 download:<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M4 19.5h16"/>,
 globe:<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z"/></>,
};
/** Hover-card layer: a brand fill rises from the bottom and an oversized icon rotates in the corner (see .fx-card). */
export function CardFx({icon}:{icon?:string}){return <span className="fx-bg" aria-hidden="true"><span className="fx-fill"/>{icon&&<span className="fx-icon"><Icon name={icon} size={120}/></span>}</span>;}
/** Connection state as an icon (replaces bare colour dots, which rely on colour alone). */
export function StatusIcon({online,size=16}:{online:boolean;size?:number}){return <span className={'status-icon '+(online?'ok':'off')} title={online?'Online':'Offline'}><Icon name={online?'online':'offline'} size={size}/></span>;}
export function Icon({name,size=20}:{name:string;size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICONS[name]||ICONS.Overview}</svg>;}

/* ---------- Helpers ---------- */
const fmt=(n:number)=>n>1e9?(n/1e9).toFixed(1)+' GB':(n/1e6).toFixed(1)+' MB';
export function clock(n:number){n=Math.max(0,Math.round(n||0));const h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(s).padStart(2,'0');}
export function relative(time:number){if(!time)return 'never';const s=(Date.now()-time)/1000;let r:Intl.RelativeTimeFormat;try{r=new Intl.RelativeTimeFormat(undefined,{numeric:'auto'});}catch{return new Date(time).toLocaleString();}if(s<60)return 'just now';if(s<3600)return r.format(-Math.round(s/60),'minute');if(s<86400)return r.format(-Math.round(s/3600),'hour');if(s<2592000)return r.format(-Math.round(s/86400),'day');return new Date(time).toLocaleDateString();}
export async function copyText(text:string){try{await navigator.clipboard.writeText(text);return true;}catch{const t=document.createElement('textarea');t.value=text;t.setAttribute('readonly','');t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();let ok=false;try{ok=document.execCommand('copy');}catch{}t.remove();return ok;}}

/** Overflow ("kebab") menu built on <details> so it works without JS focus management; closes on outside click / Escape (see App). */
export type MenuItem={label:string;icon?:string;onSelect:()=>void;disabled?:boolean;danger?:boolean;hidden?:boolean};
export function Menu({label,items,icon='more',align='right',className=''}:{label:string;items:MenuItem[];icon?:string;align?:'right'|'left';className?:string}){
 return <details className={'menu '+className}><Button as="summary" className="icon-btn" aria-label={label} title={label}><Icon name={icon}/></Button><div className={'menu-popover '+align} role="menu">{items.filter(i=>!i.hidden).map(i=><button type="button" role="menuitem" key={i.label} disabled={i.disabled} className={i.danger?'danger':''} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');i.onSelect();}}>{i.icon&&<Icon name={i.icon} size={18}/>}<span>{i.label}</span></button>)}</div></details>;
}

function CopyButton({text,label}:{text:string;label:string}){const [done,setDone]=useState(false);return <Button type="button" className="icon-btn sm" aria-label={label} title={done?'Copied':label} onClick={async()=>{if(await copyText(text)){setDone(true);setTimeout(()=>setDone(false),1600);}}}><Icon name={done?'check':'copy'} size={17}/></Button>;}

type Theme='system'|'light'|'dark';
const TABS=['Overview','Media library','Playlists','Activity','Setup & help'];
const SHORT:Record<string,string>={'Media library':'Media','Setup & help':'Help'};
const DESCRIPTIONS:Record<string,string>={Overview:'Monitor and control what’s playing on every screen.','Media library':'Images and videos ready for your displays.',Playlists:'Sequence your content and publish it to displays.',Activity:'Everything that happened: publishing, uploads, commands, connections and sign-ins.','Setup & help':'Connect TVs, check addresses and validate hardware.'};

function App(){
 const [auth,setAuth]=useState<'loading'|'setup'|'login'|'ready'>('loading'),[password,setPassword]=useState(''),[showPassword,setShowPassword]=useState(false),[tab,setTab]=useState('Overview'),[data,setData]=useState<any>({screens:[],media:[],playlists:[],groups:[],urls:[]}),[notice,setNoticeText]=useState(''),[noticeKind,setNoticeKind]=useState<'info'|'success'|'error'>('info'),[busy,setBusy]=useState(false),[readiness,setReadiness]=useState<any>({}),[pair,setPair]=useState<any>(null),[editing,setEditing]=useState<any>(null),[preview,setPreview]=useState<any>(null);
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('All'),[displayFilter,setDisplayFilter]=useState('All'),[collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('signal-nav')==='mini';}catch{return false;}}),[dragging,setDragging]=useState(false);
 const [theme,setTheme]=useState<Theme>(()=>{try{return (localStorage.getItem('signal-theme') as Theme)||'system';}catch{return 'system';}});
 const [groupDialog,setGroupDialog]=useState<string|null>(null),[quickPreview,setQuickPreview]=useState(false);
 const [palette,setPalette]=useState(false),[selected,setSelected]=useState<Set<string>>(new Set()),[version,setVersion]=useState(0),[live,setLive]=useState(false);
 const input=useRef<HTMLInputElement>(null);
 function setNotice(text:string,kind:'info'|'success'|'error'='info'){setNoticeText(text);setNoticeKind(kind);}

 useEffect(()=>{const root=document.documentElement;if(theme==='system')root.removeAttribute('data-theme');else root.setAttribute('data-theme',theme);try{localStorage.setItem('signal-theme',theme);}catch{}},[theme]);
 useEffect(()=>{try{localStorage.setItem('signal-nav',collapsed?'mini':'full');}catch{}},[collapsed]);
 useEffect(()=>{document.title=(auth==='ready'?tab+' · ':'')+'Signal · Local signage';},[tab,auth]);
 useEffect(()=>{if(!notice||auth!=='ready')return;const t=setTimeout(()=>setNoticeText(''),noticeKind==='error'?12000:5000);return()=>clearTimeout(t);},[notice,noticeKind,auth]);
 useEffect(()=>{function close(target:EventTarget|null){document.querySelectorAll('details.menu[open]').forEach(d=>{if(!target||!d.contains(target as Node))d.removeAttribute('open');});}const click=(e:MouseEvent)=>close(e.target);const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close(null);};document.addEventListener('click',click);document.addEventListener('keydown',key);return()=>{document.removeEventListener('click',click);document.removeEventListener('keydown',key);};},[]);
 // Ctrl/⌘+K (or "/" outside text fields) opens the command palette.
 useEffect(()=>{if(auth!=='ready')return;const key=(e:KeyboardEvent)=>{const typing=/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName)||(e.target as HTMLElement)?.isContentEditable;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPalette(p=>!p);}else if(e.key==='/'&&!typing&&!document.querySelector('[role=dialog]')){e.preventDefault();setPalette(true);}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[auth]);

 async function refresh(){try{setData(await api('/admin/state'));setAuth('ready');}catch(e){setAuth('login');}}
 useEffect(()=>{api('/setup').then(s=>{setReadiness(s);if(s.needsSetup)setAuth('setup');else void refresh();}).catch(e=>setNotice(e.message,'error'));},[]);
 // Live push: server-sent events trigger a debounced refresh; polling stays as a slower fallback.
 useEffect(()=>{if(auth!=='ready'||typeof EventSource==='undefined')return;let es:EventSource|null=null,timer:any=null,retry:any=null,closed=false;
  const connect=()=>{es=new EventSource('/api/admin/events');es.onopen=()=>setLive(true);es.onmessage=()=>{clearTimeout(timer);timer=setTimeout(()=>{api('/admin/state').then(setData).catch(()=>setAuth('login'));setVersion(v=>v+1);},150);};es.onerror=()=>{setLive(false);es?.close();if(!closed)retry=setTimeout(connect,10000);};};
  connect();return()=>{closed=true;es?.close();clearTimeout(timer);clearTimeout(retry);setLive(false);};},[auth]);
 useEffect(()=>{if(auth!=='ready')return;const t=setInterval(()=>{api('/admin/state').then(setData).catch(()=>setAuth('login'));if(!live)setVersion(v=>v+1);},live?20000:4000);return()=>clearInterval(t);},[auth,live]);
 async function action(fn:()=>Promise<any>,message='Saved'){setBusy(true);try{await fn();setNotice(message,'success');await refresh();setVersion(v=>v+1);return true;}catch(e){setNotice((e as Error).message,'error');return false;}finally{setBusy(false);}}
 async function signIn(e:React.FormEvent){e.preventDefault();setBusy(true);setNoticeText('');try{if(auth==='setup')await api('/setup','POST',{password});await api('/login','POST',{password});setPassword('');await refresh();}catch(e){setNotice((e as Error).message,'error');}finally{setBusy(false);}}
 const uploads=useUploads(useCallback(()=>{void refresh();},[]));
 useEffect(()=>{uploads.sync(data.media);},[data.media]);
 function go(t:string,q=''){setTab(t);setQuery(q);setFilter('All');setSelected(new Set());window.scrollTo({top:0});}
 const signOut=()=>action(()=>api('/logout','POST'),'Signed out').then(()=>setAuth('login'));

 /* ---------- Sign-in / first-run ---------- */
 if(auth!=='ready')return <div className="auth-shell"><main className="auth" aria-busy={auth==='loading'}>
  <div className="brand"><span className="brand-mark"><Icon name="signal" size={18}/></span><span className="brand-name">SIGNAL</span></div>
  <h1>{auth==='setup'?'Set up your workspace':'Sign in'}</h1>
  <p className="lead">{auth==='setup'?'Create an administrator password on this PC to get started.':'Use your administrator password to manage displays.'}</p>
  {auth==='setup'&&<div className="callout"><div className="readiness"><span className={readiness.ffmpeg?'ok':'bad'}><Icon name={readiness.ffmpeg?'check':'alert'} size={16}/>FFmpeg {readiness.ffmpeg?'ready':'missing'}</span><span className={readiness.ffprobe?'ok':'bad'}><Icon name={readiness.ffprobe?'check':'alert'} size={16}/>ffprobe {readiness.ffprobe?'ready':'missing'}</span></div>Media stays on this PC in the configured DATA_DIR. Open port 3000 on Private networks, then reserve the PC’s IP in your router.</div>}
  <form onSubmit={signIn}><label className="field">Administrator password<span className="input-affix"><input type={showPassword?'text':'password'} autoComplete={auth==='setup'?'new-password':'current-password'} minLength={auth==='setup'?12:1} required value={password} onChange={e=>setPassword(e.target.value)} aria-describedby="pw-hint"/><Button type="button" className="icon-btn sm" aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} onClick={()=>setShowPassword(!showPassword)}><Icon name={showPassword?'eye-off':'eye'} size={18}/></Button></span></label>
   <small id="pw-hint" className="hint">{auth==='setup'?'At least 12 characters. There is no default password.':'Forgot it? See “Reset password” in the README.'}</small>
   <Button className="primary block lg" loading={busy} disabled={auth==='loading'||!password}>{auth==='setup'?'Create account & continue':'Sign in'}</Button></form>
  <p role="status" className={'auth-status '+(notice?noticeKind:'')}>{notice}</p>
  <a className="link" href="/compat">Open TV compatibility test <Icon name="external" size={14}/></a>
 </main><p className="auth-foot"><Icon name="shield" size={15}/> Local network only · Content never leaves this PC</p></div>;

 /* ---------- Derived data ---------- */
 const groups:any[]=data.groups||[];
 const online=data.screens.filter((s:any)=>s.online).length,offline=data.screens.length-online;
 const ready=data.media.filter((m:any)=>m.status==='ready').length,processing=data.media.filter((m:any)=>m.status==='processing'||m.status==='queued').length,failed=data.media.filter((m:any)=>m.status==='error').length;
 const assignedPlaylists=new Set(data.screens.map((s:any)=>s.playlistId).filter(Boolean)).size;
 const visibleScreens=data.screens.filter((s:any)=>displayFilter==='All'||(displayFilter==='Online')===!!s.online);
 const matches=(m:any)=>m.title.toLowerCase().includes(query.toLowerCase())&&(filter==='All'||m.kind===(filter==='Images'?'image':'video'));
 const visibleMedia=data.media.filter(matches);
 const newDisplay=()=>setEditing({type:'name',title:'Add display',name:'TV '+(data.screens.length+1),endpoint:'/admin/screens',method:'POST',field:'name',submit:'Add display'});
 const newPlaylist=()=>setEditing({type:'name',title:'New playlist',name:'',endpoint:'/admin/playlists',method:'POST',field:'name',submit:'Create playlist'});
const newGroup=()=>setGroupDialog('');
 const editPlaylist=(p:any)=>setEditing({...p,type:'playlist',entries:p.entries.map((e:any)=>({...e})),immediate:false});
 const openSettings=(s:any)=>setEditing({...s,type:'screen',config:{...s.config},immediate:false});
 const pairScreen=(s:any)=>action(async()=>{const r=await api('/admin/screens/'+s.id+'/pair','POST');setPair({...r,id:s.id,name:s.name});},'Pairing code created');
 const themeNext:Record<Theme,Theme>={system:'light',light:'dark',dark:'system'};
 const themeIcon=theme==='system'?'system':theme==='light'?'sun':'moon';
 const playlistUsage=(id:string)=>({displays:data.screens.filter((s:any)=>s.playlistId===id),scheduled:data.screens.filter((s:any)=>(s.schedules||[]).some((r:any)=>r.playlistId===id))});
 const mediaUsage=(id:string)=>data.playlists.filter((p:any)=>p.entries.some((e:any)=>e.mediaId===id));

 /* ---------- Bulk operations ---------- */
 async function sendAll(list:any[],cmd:'play'|'pause'|'next'|'reload',label:string){
  const targets=list.filter((s:any)=>s.online);if(!targets.length){setNotice('No online displays to control','error');return;}
  const results=await Promise.allSettled(targets.map((s:any)=>api('/admin/screens/'+s.id+'/commands','POST',{action:cmd})));
  const bad=results.filter(r=>r.status==='rejected').length;setNotice(bad?`${label} sent to ${targets.length-bad} of ${targets.length} displays`:`${label} sent to ${targets.length} display${targets.length===1?'':'s'}; waiting for acknowledgment`,bad?'error':'success');await refresh();
 }
 async function deleteMedia(ids:string[]){
  const items=ids.map(id=>data.media.find((m:any)=>m.id===id)).filter(Boolean),inUse=items.filter((m:any)=>mediaUsage(m.id).length),deletable=items.filter((m:any)=>!mediaUsage(m.id).length&&m.status!=='processing');
  const ok=await confirmAction({title:items.length===1?`Delete “${items[0].title}”?`:`Delete ${items.length} media items?`,danger:true,confirmLabel:deletable.length===items.length?'Delete':`Delete ${deletable.length}`,
   body:<><p>The original file and every prepared display variant are removed from this PC. This cannot be undone.</p>{inUse.length>0&&<div className="callout warn"><Icon name="alert" size={16}/><div>{inUse.length===items.length&&items.length===1?'This item is used in ':'These items are used in playlists and will be skipped: '}{inUse.map((m:any)=><span key={m.id} className="usage">{items.length>1?m.title+' → ':''}{mediaUsage(m.id).map((p:any)=>p.name).join(', ')}</span>)}</div></div>}</>,
   blockedReason:!deletable.length?'Remove the item from those playlists (or wait for processing to finish) before deleting.':undefined});
  if(!ok)return;setBusy(true);const res=await Promise.allSettled(deletable.map((m:any)=>api('/admin/media/'+m.id,'DELETE')));setBusy(false);
  const done=res.filter(r=>r.status==='fulfilled').length;setNotice(`${done} item${done===1?'':'s'} deleted`+(items.length>done?` · ${items.length-done} skipped`:''),done===items.length?'success':'error');setSelected(new Set());await refresh();
 }
 async function addToPlaylist(p:any,ids:string[]){
  const readyIds=ids.filter(id=>data.media.find((m:any)=>m.id===id)?.status==='ready');if(!readyIds.length){setNotice('Only ready media can be added to a playlist','error');return;}
  if(await action(()=>api('/admin/playlists/'+p.id,'PUT',{name:p.name,entries:[...p.entries,...readyIds.map(mediaId=>({mediaId,duration:10}))],immediate:false}),`${readyIds.length} item${readyIds.length===1?'':'s'} added to “${p.name}” and published`))setSelected(new Set());
 }
 const retryFailed=(ids:string[])=>action(()=>Promise.all(ids.filter(id=>data.media.find((m:any)=>m.id===id)?.status==='error').map(id=>api('/admin/media/'+id+'/retry','POST'))),'Conversions queued');
 const toggleSelect=(id:string)=>setSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});

 /* ---------- Command palette ---------- */
 const commands:Command[]=[
  ...TABS.map(t=>({id:'go-'+t,label:'Go to '+t,group:'Navigate',icon:t,run:()=>go(t)})),
  {id:'add-display',label:'Add display',group:'Actions',icon:'plus',run:()=>{go('Overview');newDisplay();}},
  {id:'new-playlist',label:'New playlist',group:'Actions',icon:'plus',run:()=>{go('Playlists');newPlaylist();}},
  {id:'upload',label:'Upload media',group:'Actions',icon:'upload',run:()=>{go('Media library');setTimeout(()=>input.current?.click(),50);}},
  {id:'quick-preview',label:'Quick preview a local file',group:'Actions',icon:'play',keywords:'play video test try without upload local',run:()=>setQuickPreview(true)},
  {id:'new-group',label:'New display group',group:'Actions',icon:'layers',run:newGroup},
  {id:'play-all',label:'Play on all displays',group:'Actions',icon:'play',keywords:'resume start',run:()=>void sendAll(data.screens,'play','Play')},
  {id:'pause-all',label:'Pause all displays',group:'Actions',icon:'pause',keywords:'stop',run:()=>void sendAll(data.screens,'pause','Pause')},
  {id:'reload-all',label:'Reload all players',group:'Actions',icon:'reload',run:()=>void sendAll(data.screens,'reload','Reload')},
  {id:'theme',label:'Switch theme to '+themeNext[theme],group:'Actions',icon:themeIcon,keywords:'dark light mode appearance',run:()=>setTheme(themeNext[theme])},
  {id:'compat',label:'Open TV compatibility test',group:'Actions',icon:'external',run:()=>window.open('/compat','_blank','noopener')},
  {id:'signout',label:'Sign out',group:'Actions',icon:'logout',keywords:'log out',run:()=>void signOut()},
  ...data.screens.flatMap((s:any)=>[
   {id:'s-set-'+s.id,label:s.name+' · settings',group:'Displays',icon:'settings',hint:s.online?'Online':'Offline',keywords:'display tv screen schedule rotation',run:()=>openSettings(s)},
   {id:'s-prev-'+s.id,label:s.name+' · preview',group:'Displays',icon:'eye',keywords:'display tv screen',run:()=>setPreview(s)},
   ...(s.online?[{id:'s-cmd-'+s.id,label:(s.diagnostics?.state==='playing'?'Pause ':'Play ')+s.name,group:'Displays',icon:s.diagnostics?.state==='playing'?'pause':'play',run:()=>void sendAll([s],s.diagnostics?.state==='playing'?'pause':'play',s.diagnostics?.state==='playing'?'Pause':'Play')}]:[]),
   {id:'s-pair-'+s.id,label:'Pair '+s.name,group:'Displays',icon:'key',run:()=>void pairScreen(s)},
  ]),
  ...groups.map((g:any)=>({id:'g-'+g.id,label:g.name+' · group',group:'Groups',icon:'layers',hint:data.screens.filter((s:any)=>s.groupId===g.id).length+' displays',run:()=>{go('Overview');setTimeout(()=>document.getElementById('group-'+g.id)?.scrollIntoView({behavior:'smooth'}),60);}})),
  ...data.playlists.map((p:any)=>({id:'p-'+p.id,label:'Edit '+p.name,group:'Playlists',icon:'Playlists',hint:p.entries.length+' items',run:()=>{go('Playlists');editPlaylist(p);}})),
  ...data.media.slice(0,200).map((m:any)=>({id:'m-'+m.id,label:m.title,group:'Media',icon:m.kind==='video'?'video':'image',hint:m.status==='ready'?undefined:m.status,run:()=>go('Media library',m.title)})),
 ];

 /* ---------- Display grid (optionally grouped) ---------- */
 const renderCards=(list:any[])=><div className="screens display-list">{list.map((s:any)=><DisplayCard key={s.id} screen={s} data={data} api={api} refresh={refresh} preview={()=>setPreview(s)} settings={()=>openSettings(s)} pair={()=>pairScreen(s)}/>)}</div>;
 const sections=groups.length?[...groups.map((g:any)=>({group:g,list:visibleScreens.filter((s:any)=>s.groupId===g.id),all:data.screens.filter((s:any)=>s.groupId===g.id)})),{group:null,list:visibleScreens.filter((s:any)=>!s.groupId||!groups.some((g:any)=>g.id===s.groupId)),all:data.screens.filter((s:any)=>!s.groupId)}]:[];

 return <div className={'shell'+(collapsed?' nav-collapsed':'')}>
  <a className="skip-link" href="#main">Skip to content</a>
  <header className="masthead">
   <div className="masthead-start"><Button type="button" className="icon-btn nav-toggle" aria-label={collapsed?'Expand navigation':'Collapse navigation'} aria-expanded={!collapsed} onClick={()=>setCollapsed(!collapsed)}><Icon name="menu"/></Button>
    <button type="button" className="brand" onClick={()=>go('Overview')} aria-label="Signal home"><span className="brand-mark"><Icon name="signal" size={18}/></span><span className="brand-name">SIGNAL</span></button></div>
   <button type="button" className="search-trigger" onClick={()=>setPalette(true)} aria-label="Search or run a command (Ctrl+K)"><Icon name="search" size={18}/><span>Search displays, playlists, media…</span><kbd>Ctrl K</kbd></button>
   <div className="masthead-end">
    <span className={'status-pill '+(offline&&data.screens.length?'warn':'ok')} title={live?'Live updates connected · online means a recent browser heartbeat':'Live updates reconnecting; refreshing every few seconds'}><Icon name="online" size={16}/>{online} of {data.screens.length} online</span>
    <Button type="button" className="icon-btn search-mobile" aria-label="Search" onClick={()=>setPalette(true)}><Icon name="search"/></Button>
    <AlertsBell version={version} openActivity={()=>go('Activity')} onAlert={a=>setNotice(a.message,'error')}/>
    <Button type="button" className="icon-btn" aria-label={'Theme: '+theme+'. Switch to '+themeNext[theme]} title={'Theme: '+theme} onClick={()=>setTheme(themeNext[theme])}><Icon name={themeIcon}/></Button>
    <details className="menu account"><summary className="avatar" aria-label="Account menu">A</summary><div className="menu-popover right" role="menu"><div className="menu-header"><span className="avatar">A</span><span><b>Administrator</b><small>Local account</small></span></div><button type="button" role="menuitem" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');go('Activity');}}><Icon name="activity" size={18}/><span>Activity log</span></button><button type="button" role="menuitem" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');go('Setup & help');}}><Icon name="Setup & help" size={18}/><span>Setup & help</span></button><button type="button" role="menuitem" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');void signOut();}}><Icon name="logout" size={18}/><span>Sign out</span></button></div></details>
   </div>
  </header>

  <aside className="sidebar" aria-label="Primary">
   <nav>{TABS.map(t=><Button type="button" className="nav-item" key={t} aria-current={tab===t?'page':undefined} title={collapsed?t:undefined} onClick={()=>go(t)}><Icon name={t} size={22}/><span className="nav-label">{t}</span><span className="nav-short" aria-hidden="true">{SHORT[t]||t}</span>{t==='Media library'&&processing>0&&<span className="nav-badge" aria-hidden="true" title={processing+' processing'}>{processing}</span>}</Button>)}</nav>
   <div className="sidebar-foot"><span className="local"><Icon name="shield" size={16}/><span>Local network only<small>{live?'Live updates connected':'Reconnecting live updates…'}</small></span></span></div>
  </aside>

  <main id="main" tabIndex={-1}>
   <div className="page-header"><div><h1>{tab}</h1><p>{DESCRIPTIONS[tab]}</p></div>
    <div className="page-actions">
     {tab==='Overview'&&<><Menu label="Display actions" icon="more" items={[{label:'Play on all displays',icon:'play',disabled:!online,onSelect:()=>void sendAll(data.screens,'play','Play')},{label:'Pause all displays',icon:'pause',disabled:!online,onSelect:()=>void sendAll(data.screens,'pause','Pause')},{label:'Next item everywhere',icon:'next',disabled:!online,onSelect:()=>void sendAll(data.screens,'next','Next item')},{label:'Reload all players',icon:'reload',disabled:!online,onSelect:()=>void sendAll(data.screens,'reload','Reload')},{label:'New display group',icon:'layers',onSelect:newGroup}]}/><Button className="primary" onClick={newDisplay}><Icon name="plus" size={18}/>Add display</Button></>}
     {tab==='Media library'&&<><Button className="tonal" onClick={()=>setQuickPreview(true)} title="Play a file from this computer without uploading it"><Icon name="play" size={18}/>Quick preview</Button><Button className="primary" onClick={()=>input.current?.click()}><Icon name="upload" size={18}/>Upload media</Button></>}
     {tab==='Playlists'&&<Button className="primary" onClick={newPlaylist}><Icon name="plus" size={18}/>New playlist</Button>}
    </div>
   </div>

   {tab==='Overview'&&<>
    <div className="kpis">
     <button type="button" className="kpi fx-card" aria-label="Show online displays" onClick={()=>setDisplayFilter('Online')}><CardFx icon="online"/><span className="kpi-label"><StatusIcon online size={16}/>Online</span><span className="kpi-value">{online}<em>/ {data.screens.length}</em></span><span className="meter" aria-hidden="true"><span style={{width:(data.screens.length?online/data.screens.length*100:0)+'%'}}/></span></button>
     <button type="button" className={'kpi fx-card'+(offline?' warn':'')} aria-label="Show offline displays" onClick={()=>setDisplayFilter('Offline')}><CardFx icon="offline"/><span className="kpi-label"><Icon name="offline" size={16}/>Offline</span><span className="kpi-value">{offline}</span><span className="kpi-sub">{offline?'Needs attention':'All displays reporting'}</span></button>
     <button type="button" className={'kpi fx-card'+(failed?' warn':'')} aria-label="Open media library" onClick={()=>go('Media library')}><CardFx icon="Media library"/><span className="kpi-label"><Icon name="Media library" size={16}/>Media</span><span className="kpi-value">{data.media.length}</span><span className="kpi-sub">{failed?failed+' failed · ':''}{processing?processing+' processing · ':''}{ready} ready</span></button>
     <button type="button" className="kpi fx-card" aria-label="Open playlists" onClick={()=>go('Playlists')}><CardFx icon="Playlists"/><span className="kpi-label"><Icon name="Playlists" size={16}/>Playlists</span><span className="kpi-value">{data.playlists.length}</span><span className="kpi-sub">{assignedPlaylists} in use on displays</span></button>
    </div>
    <div className="section-title"><h2>Displays</h2>
     <div className="chips" role="group" aria-label="Filter displays">{['All','Online','Offline'].map(f=><Button type="button" key={f} className="chip" aria-pressed={displayFilter===f} onClick={()=>setDisplayFilter(f)}>{f}<span className="chip-count">{f==='All'?data.screens.length:f==='Online'?online:offline}</span></Button>)}</div>
    </div>
    {!data.screens.length&&<div className="empty"><span className="empty-icon"><Icon name="Overview" size={28}/></span><h3>Bring your first display online</h3><p>Add a display, pair your TV, then choose a playlist.</p><Button className="primary" onClick={newDisplay}><Icon name="plus" size={18}/>Add display</Button></div>}
    {!!data.screens.length&&!visibleScreens.length&&<div className="empty compact"><h3>No {displayFilter.toLowerCase()} displays</h3><p>{displayFilter==='Offline'?'Every display has reported recently.':'No display has reported a recent heartbeat.'}</p><Button className="text" onClick={()=>setDisplayFilter('All')}>Show all displays</Button></div>}
    {!groups.length?renderCards(visibleScreens):sections.map(({group:g,list,all})=>(list.length>0||(g&&displayFilter==='All'))&&<section className="group-section" key={g?.id||'ungrouped'} id={g?'group-'+g.id:undefined} aria-label={g?g.name:'Ungrouped displays'}>
     <div className="group-head"><span className="group-title"><Icon name="layers" size={18}/><h3>{g?g.name:'Ungrouped'}</h3><span className="chip-count">{all.length} display{all.length===1?'':'s'}</span></span>
      {g&&<><label className="select-inline compact"><Icon name="Playlists" size={16}/><span className="sr-only">Playlist for group {g.name}</span><select aria-label={'Playlist for group '+g.name} value="" disabled={!all.length} onChange={e=>{const v=e.target.value;if(!v)return;const pid=v==='none'?null:v;void action(()=>api('/admin/groups/'+g.id+'/assign','POST',{playlistId:pid}),`Group “${g.name}” updated`);}}><option value="">Assign playlist to group…</option>{data.playlists.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}<option value="none">No playlist</option></select></label>
       <Menu label={'Actions for group '+g.name} items={[{label:'Play group',icon:'play',onSelect:()=>void sendAll(all,'play','Play')},{label:'Pause group',icon:'pause',onSelect:()=>void sendAll(all,'pause','Pause')},{label:'Rename group',icon:'edit',onSelect:()=>setEditing({type:'name',title:'Rename group',name:g.name,endpoint:'/admin/groups/'+g.id,method:'PATCH',field:'name',submit:'Save name'})},{label:'Delete group',icon:'trash',danger:true,onSelect:async()=>{if(await confirmAction({title:`Delete group “${g.name}”?`,danger:true,confirmLabel:'Delete group',body:<p>{all.length?`Its ${all.length} display${all.length===1?'':'s'} stay paired and keep their playlists; they just become ungrouped.`:'The group is empty.'}</p>}))void action(()=>api('/admin/groups/'+g.id,'DELETE'),'Group deleted');}}]}/></>}
     </div>
     {list.length?renderCards(list):<p className="muted small group-empty">{all.length?'No displays match this filter.':'No displays yet. Choose this group in a display’s settings.'}</p>}
    </section>)}
    <p className="footnote"><Icon name="info" size={15}/>Online means a recent browser heartbeat. Snapshots show what the browser player renders, not a camera view of the physical TV.</p>
   </>}

   {tab==='Media library'&&<div className={'library'+(dragging?' dragging':'')} onDragEnter={e=>{if(e.dataTransfer.types.includes('Files'))setDragging(true);}} onDragOver={e=>{e.preventDefault();}} onDragLeave={e=>{if(e.currentTarget===e.target||!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);uploads.add(e.dataTransfer.files);}}>
    <div className="library-toolbar"><label className="search-field"><Icon name="search" size={18}/><input type="search" aria-label="Search media" placeholder="Search media" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<Button type="button" className="icon-btn sm" aria-label="Clear search" onClick={()=>setQuery('')}><Icon name="x" size={16}/></Button>}</label>
     <div className="chips" role="group" aria-label="Filter by type">{['All','Images','Videos'].map(f=><Button type="button" key={f} aria-pressed={filter===f} className="chip" onClick={()=>setFilter(f)}>{f}</Button>)}</div>
     <span className="result-count">{visibleMedia.length===data.media.length?data.media.length+' items':visibleMedia.length+' of '+data.media.length}</span></div>
    {selected.size>0?<div className="bulk-bar" role="toolbar" aria-label="Bulk media actions"><Button className="icon-btn sm" aria-label="Clear selection" onClick={()=>setSelected(new Set())}><Icon name="x" size={18}/></Button><b>{selected.size} selected</b>
      <Button className="text sm" onClick={()=>setSelected(new Set(visibleMedia.map((m:any)=>m.id)))}>Select all {visibleMedia.length}</Button><span className="spacer"/>
      <Menu label="Add selected to playlist" icon="Playlists" items={data.playlists.length?data.playlists.map((p:any)=>({label:p.name,icon:'plus',onSelect:()=>void addToPlaylist(p,[...selected])})):[{label:'Create a playlist first',disabled:true,onSelect:()=>{}}]}/>
      {[...selected].some(id=>data.media.find((m:any)=>m.id===id)?.status==='error')&&<Button className="tonal sm" onClick={()=>retryFailed([...selected])}><Icon name="reload" size={16}/>Retry failed</Button>}
      <Button className="danger sm" onClick={()=>void deleteMedia([...selected])}><Icon name="trash" size={16}/>Delete</Button></div>
     :<div className="dropzone" role="button" tabIndex={0} aria-label="Upload media: drop files or browse" onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.current?.click();}}} onClick={()=>input.current?.click()}><span className="upload-icon"><Icon name="upload" size={22}/></span><span><b>Drag and drop files to upload</b><small>JPG, PNG, WebP, GIF or MP4 · up to {data.uploadLimitMB} MB each · videos are converted locally to H.264/AAC</small></span><span className="btn secondary sm" aria-hidden="true">Select files</span></div>}
    {!visibleMedia.length&&<div className="empty"><span className="empty-icon"><Icon name={data.media.length?'search':'Media library'} size={28}/></span><h3>{data.media.length?'No matching media':'Your library starts here'}</h3><p>{data.media.length?'Try another search or media type.':'Upload images or videos to start building your playlists.'}</p>{data.media.length>0&&<Button className="text" onClick={()=>{setQuery('');setFilter('All');}}>Clear filters</Button>}</div>}
    <div className={'media-grid'+(selected.size?' selecting':'')}>{visibleMedia.map((m:any)=><article className={'media-card fx-card flat'+(selected.has(m.id)?' is-selected':'')} key={m.id}><CardFx/>
     <div className={'media-thumb '+m.status}>{m.status==='ready'?<img loading="lazy" src={'/api/admin/media/'+m.id+'/thumbnail'} alt=""/>:m.status==='error'?<div className="thumb-state error"><Icon name="alert" size={26}/><span>Conversion failed</span></div>:<div className="thumb-state"><span className="spinner lg"/><span>Processing…</span></div>}
      <label className="select-box" title="Select"><input type="checkbox" checked={selected.has(m.id)} onChange={()=>toggleSelect(m.id)} aria-label={'Select '+m.title}/><span aria-hidden="true"><Icon name="check" size={14}/></span></label>
      {(m.kind!=='video'||m.status==='ready')&&<span className="thumb-badge">{m.kind==='video'?clock(m.duration):<><Icon name="image" size={13}/>Image</>}</span>}</div>
     <div className="media-info"><div className="title-row"><h3 title={m.title}>{m.title}</h3><Menu label={'Actions for '+m.title} items={[{label:'Rename',icon:'edit',onSelect:()=>setEditing({type:'name',title:'Rename media',name:m.title,endpoint:'/admin/media/'+m.id,method:'PATCH',field:'title',submit:'Save name'})},{label:'Select',icon:'check',onSelect:()=>toggleSelect(m.id)},{label:'Retry conversion',icon:'reload',hidden:m.status!=='error',onSelect:()=>void action(()=>api('/admin/media/'+m.id+'/retry','POST'),'Conversion queued')},{label:'Delete',icon:'trash',danger:true,onSelect:()=>void deleteMedia([m.id])}]}/></div>
      <p className="meta">{m.width&&m.height?m.width+' × '+m.height+' · ':''}{fmt(m.size||0)}</p>
      <p className="meta" title={m.original+' · '+new Date(m.created).toLocaleString()}><span className={'status-text '+m.status}>{m.status==='ready'?'Ready':m.status==='error'?'Error':'Processing'}</span> · {relative(m.created)}{mediaUsage(m.id).length>0&&<> · in {mediaUsage(m.id).length} playlist{mediaUsage(m.id).length===1?'':'s'}</>}</p>
      {m.error&&<p className="error small">{m.error}</p>}
      {m.status==='error'&&<Button className="tonal sm" onClick={()=>action(()=>api('/admin/media/'+m.id+'/retry','POST'),'Conversion queued')}><Icon name="reload" size={16}/>Retry conversion</Button>}</div>
    </article>)}</div>
    <div className="drop-overlay" aria-hidden="true"><Icon name="upload" size={40}/><b>Drop to upload</b></div>
   </div>}

   {tab==='Playlists'&&<>
    {!data.playlists.length&&<div className="empty"><span className="empty-icon"><Icon name="Playlists" size={28}/></span><h3>No playlists yet</h3><p>Create your first playlist, add media, then assign it to a display.</p><Button className="primary" onClick={newPlaylist}><Icon name="plus" size={18}/>New playlist</Button></div>}
    <div className="playlist-grid">{data.playlists.map((p:any)=>{const total=p.entries.reduce((n:number,e:any)=>n+seconds(e,data.media),0),{displays:uses,scheduled}=playlistUsage(p.id);return <article className="playlist-card fx-card flat" key={p.id}><CardFx/>
     <button type="button" className="playlist-thumb" aria-label={'Open '+p.name} onClick={()=>editPlaylist(p)}>
      <span className="stack" aria-hidden="true"/>
      <span className="playlist-cover">{p.entries[0]?<img loading="lazy" src={'/api/admin/media/'+p.entries[0].mediaId+'/thumbnail'} alt=""/>:<span className="cover-empty"><Icon name="Playlists" size={30}/></span>}
       <span className="playlist-count"><Icon name="Playlists" size={18}/>{p.entries.length} item{p.entries.length===1?'':'s'}</span>
       <span className="play-all"><Icon name="edit" size={18}/>Edit</span></span>
     </button>
     <div className="media-info"><div className="title-row"><h3 title={p.name}>{p.name}</h3><Menu label={'Actions for '+p.name} items={[{label:'Edit playlist',icon:'edit',onSelect:()=>editPlaylist(p)},{label:'Delete',icon:'trash',danger:true,onSelect:async()=>{const blocked=uses.length||scheduled.length;if(await confirmAction({title:`Delete “${p.name}”?`,danger:true,confirmLabel:'Delete playlist',body:<p>The playlist and its order are removed. Media files stay in your library.</p>,blockedReason:blocked?<>This playlist is still in use{uses.length?<> as the default on <b>{uses.map((s:any)=>s.name).join(', ')}</b></>:null}{uses.length&&scheduled.length?' and':''}{scheduled.length?<> in the schedule of <b>{scheduled.map((s:any)=>s.name).join(', ')}</b></>:null}. Assign another playlist there first.</>:undefined}))void action(()=>api('/admin/playlists/'+p.id,'DELETE'),'Playlist deleted');}}]}/></div>
      <p className="meta">{p.entries.length?duration(total)+' per loop':'Empty playlist'} · revision {p.revision}</p>
      <p className="meta">{uses.length?<><StatusIcon online size={15}/>On {uses.map((s:any)=>s.name).join(', ')}</>:'Not assigned to a display'}{scheduled.length>0&&<> · <Icon name="calendar" size={14}/> scheduled on {scheduled.length}</>}</p>
      <div className="card-buttons"><Button className="tonal sm" onClick={()=>editPlaylist(p)}>Edit playlist</Button></div></div>
    </article>;})}</div>
   </>}

   {tab==='Activity'&&<ActivityPage version={version} screens={data.screens}/>}

   {tab==='Setup & help'&&<div className="help">
    <section className="panel fx-card"><CardFx icon="Overview"/><h2>Connect your displays</h2><ol className="steps"><li><b>Prepare the host.</b> Keep this Windows PC awake and running. Put the PC and TVs on the same private LAN.</li><li><b>Open the player.</b> On each TV open its address below, then enter a code from <em>Pair display</em>.</li><li><b>Publish content.</b> Upload media, publish a playlist, and assign it to a display.</li><li><b>Validate hardware.</b> Run the compatibility checks on each model before relying on unattended playback.</li></ol></section>
    <section className="panel fx-card"><CardFx icon="link"/><h2>Display addresses</h2><p className="panel-sub">Open these on each TV’s browser.</p>
     <div className="table" role="table" aria-label="Display addresses">{data.urls.flatMap((url:string)=>data.screens.map((s:any)=>{const href=url+'/tv/'+s.id;return <div className="row" role="row" key={href}><span role="cell" className="row-name"><StatusIcon online={!!s.online} size={16}/>{s.name}</span><a role="cell" className="mono" href={href} target="_blank" rel="noreferrer">{href}</a><span role="cell" className="row-actions"><CopyButton text={href} label={'Copy address for '+s.name}/><Button as="a" className="icon-btn sm" href={href} target="_blank" rel="noreferrer" aria-label={'Open '+s.name+' player'}><Icon name="external" size={17}/></Button></span></div>;}))}</div>
     {!data.urls.length&&<p className="muted">No LAN address detected.</p>}</section>
    <section className="panel fx-card"><CardFx icon="settings"/><h2>System</h2><dl className="kv"><dt><Icon name="folder" size={17}/>Media folder</dt><dd><code>{data.dataDir}</code></dd><dt><Icon name="clock" size={17}/>PC time zone</dt><dd>{data.timezone} · schedules follow this clock</dd><dt><Icon name="globe" size={17}/>Network</dt><dd>Run <code>ipconfig</code> to find the IPv4 address and reserve it in your router’s DHCP settings. Allow TCP port 3000 for Private networks only. Guest Wi-Fi/client isolation can block TV-to-PC traffic.</dd>{data.license&&<><dt><Icon name="key" size={17}/>License</dt><dd>Licensed to <b>{data.license.customer}</b> · Machine ID <code>{data.license.machine}</code> · {data.license.expires?<>expires {new Date(data.license.expires).toLocaleDateString()}{data.license.expires-Date.now()<30*864e5&&<span className="warning"> (soon — ask your provider for a new activation code)</span>}</>:'no expiry'}</dd></>}<dt><Icon name="search" size={17}/>Shortcuts</dt><dd><kbd>Ctrl</kbd> <kbd>K</kbd> or <kbd>/</kbd> opens the command palette.</dd></dl></section>
    <section className="panel warn-panel fx-card"><CardFx icon="alert"/><h2><Icon name="alert" size={20}/>Hardware validation is still required</h2><p>Browser chrome, fullscreen, autoplay, rotated video, screensavers and reopening after power-on are unverified on your TVs. No kiosk or power control is promised. Production video is pre-rotated; do not use CSS transforms to fix black video.</p><p>Use docs/TV-CHECKLIST.md for the 8-hour and 24-hour soak tests. Validate day-part schedules on real hardware before relying on them unattended.</p><a className="btn secondary" href="/compat" target="_blank" rel="noreferrer">Open compatibility test <Icon name="external" size={16}/></a></section>
   </div>}
   <input ref={input} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.mp4" hidden onChange={e=>{uploads.add(e.target.files);e.target.value='';if(tab!=='Media library')go('Media library');}}/>
  </main>

  {notice&&<div role="status" className={'toast '+noticeKind}><Icon name={noticeKind==='error'?'alert':noticeKind==='success'?'check':'info'} size={18}/><span>{notice}</span><Button type="button" className="icon-btn sm" aria-label="Dismiss notification" onClick={()=>setNoticeText('')}><Icon name="x" size={16}/></Button></div>}
  <UploadPanel q={uploads}/>
  <CommandPalette open={palette} close={()=>setPalette(false)} commands={commands}/>
  <ConfirmHost/>
  {quickPreview&&<QuickPreview close={()=>setQuickPreview(false)} screens={data.screens} upload={f=>{uploads.add([f]);if(tab!=='Media library')go('Media library');}}/>}
  {groupDialog!==null&&<Modal title="New display group" close={()=>setGroupDialog(null)}><form onSubmit={async e=>{e.preventDefault();let id='';if(await action(async()=>{id=(await api('/admin/groups','POST',{name:groupDialog.trim()})).id;},'Group created')){setGroupDialog(null);if(editing?.type==='screen')setEditing((ed:any)=>ed&&{...ed,groupId:id});}}}><p className="muted small">Groups such as “Lobby” or “Floor 2” let you assign a playlist or send commands to several displays at once.</p><label className="field">Group name<input autoFocus required maxLength={120} value={groupDialog} onChange={e=>setGroupDialog(e.target.value)}/></label><div className="modal-actions"><Button type="button" className="ghost" onClick={()=>setGroupDialog(null)}>Cancel</Button><Button type="submit" className="primary" loading={busy} disabled={!groupDialog.trim()}>Create group</Button></div></form></Modal>}

  {editing?.type==='name'&&<Modal title={editing.title} close={()=>setEditing(null)}><form onSubmit={async e=>{e.preventDefault();if(await action(()=>api(editing.endpoint,editing.method,{[editing.field]:editing.name.trim()})))setEditing(null);}}>{editing.hint&&<p className="muted small">{editing.hint}</p>}<label className="field">Name<input autoFocus required maxLength={120} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label><div className="modal-actions"><Button type="button" className="ghost" onClick={()=>setEditing(null)}>Cancel</Button><Button type="submit" className="primary" loading={busy} disabled={!editing.name.trim()}>{editing.submit}</Button></div></form></Modal>}
  {pair&&<Modal title={'Pair '+pair.name} close={()=>setPair(null)}><ol className="steps compact"><li>On the TV, open <span className="inline-copy"><code>{data.urls[0]||location.origin}/tv/{pair.id}</code><CopyButton text={(data.urls[0]||location.origin)+'/tv/'+pair.id} label="Copy TV address"/></span></li><li>Enter this code with the remote:</li></ol><div className="pair-code" aria-label={'Pairing code '+String(pair.code).split('').join(' ')}>{String(pair.code).split('').map((c:string,i:number)=><span key={i}>{c}</span>)}</div><p className="center muted">Single use · expires {new Date(pair.expires).toLocaleTimeString()}. Keep the TV URL stable; the token is stored in its browser.</p><div className="modal-actions"><Button className="primary" onClick={()=>setPair(null)}>Done</Button></div></Modal>}
  {preview&&<Modal title={'Preview · '+preview.name} close={()=>setPreview(null)} wide theater><div className="theater-frame"><iframe title="Display playback preview" src={'/tv/'+preview.id+'?preview=1'} className="preview-frame"/></div><p className="muted small">Native landscape frame preview. A physically mounted portrait TV rotates this frame. Desktop rendering does not verify LG behavior.</p></Modal>}
  {editing?.type==='screen'&&<Modal title={'Settings · '+editing.name} close={()=>setEditing(null)} wide>
   <form onSubmit={async e=>{e.preventDefault();if(await action(()=>api('/admin/screens/'+editing.id,'PUT',{name:editing.name,playlistId:editing.playlistId||null,config:editing.config,immediate:editing.immediate,groupId:editing.groupId||null}),'Display saved; variants will be prepared before publishing'))setEditing(null);}}>
   <div className="three"><label className="field">Display name<input value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})} required maxLength={120}/></label><label className="field">Default playlist<select value={editing.playlistId||''} onChange={e=>setEditing({...editing,playlistId:e.target.value})}><option value="">No playlist (fallback)</option>{data.playlists.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field">Group<select value={editing.groupId||''} onChange={e=>{if(e.target.value==='__new'){newGroup();return;}setEditing({...editing,groupId:e.target.value||null});}}><option value="">No group</option>{groups.map((g:any)=><option key={g.id} value={g.id}>{g.name}</option>)}<option value="__new">+ New group…</option></select></label></div>
   <label className="check keep-awake"><input type="checkbox" checked={editing.config.keepAwake!==false} onChange={e=>setEditing({...editing,config:{...editing.config,keepAwake:e.target.checked}})}/><span><b>Keep screen awake</b><small>Stops the TV browser from dimming or sleeping during image-only slideshows. Uses the browser’s wake lock when allowed, otherwise a tiny silent clip while images show. TV power-saving timers (e.g. auto power off) must still be turned off in the TV’s own settings.{editing.diagnostics?.awake?` Player reports: ${({wakelock:'wake lock active',video:'keep-awake clip playing','content-video':'video content is playing','video-blocked':'blocked — press OK on the remote once',unsupported:'not supported by this browser',released:'wake lock released, retrying',off:'off'} as any)[editing.diagnostics.awake]||editing.diagnostics.awake}.`:''}</small></span></label>
   <details className="disclosure"><summary>Advanced display settings<span>Orientation, sizing and mirroring</span></summary><div className="disclosure-body"><div className="two"><label className="field">Content rotation<select value={editing.config.rotation} onChange={e=>setEditing({...editing,config:{...editing.config,rotation:Number(e.target.value)}})}>{[0,90,180,270].map(n=><option key={n} value={n}>{n}° {n===90?'Portrait':n===270?'Reverse portrait':n===180?'Upside down':'Landscape'}</option>)}</select></label><label className="field">Fit mode<select value={editing.config.fit} onChange={e=>setEditing({...editing,config:{...editing.config,fit:e.target.value}})}><option value="contain">Contain / Fit</option><option value="cover">Cover / Fill</option><option value="stretch">Stretch</option></select></label></div><p className="callout"><Icon name="info" size={16}/>Rotation is clockwise in the native TV frame. Mount the TV in the opposite direction. Video variants are prepared on the PC; hardware results remain unverified.</p><div className="two">{['width','height'].map(k=><label className="field" key={k}>Native frame {k}<input type="number" min={k==='width'?320:240} max={k==='width'?3840:2160} step="2" required value={editing.config[k]} onChange={e=>setEditing({...editing,config:{...editing.config,[k]:Number(e.target.value)}})}/></label>)}</div><label className="field color-field">Background<input type="color" value={editing.config.background} onChange={e=>setEditing({...editing,config:{...editing.config,background:e.target.value}})}/><code>{editing.config.background}</code></label>{['mirrorX','mirrorY'].map(k=><label className="check" key={k}><input type="checkbox" checked={editing.config[k]} onChange={e=>setEditing({...editing,config:{...editing.config,[k]:e.target.checked}})}/>{k==='mirrorX'?'Mirror horizontally':'Mirror vertically'} (separate from rotation)</label>)}</div></details>
   <label className="check"><input type="checkbox" checked={editing.immediate} onChange={e=>setEditing({...editing,immediate:e.target.checked})}/>Apply immediately, interrupt current content once ready</label>
   <div className="modal-actions"><Button type="button" className="ghost" onClick={()=>setEditing(null)}>Cancel</Button><Button className="primary" loading={busy}>Save display</Button></div></form>
   <details className="disclosure" open={!!(editing.schedules||[]).length}><summary>Schedule<span>{(data.screens.find((s:any)=>s.id===editing.id)?.schedules||[]).length?`${(data.screens.find((s:any)=>s.id===editing.id)?.schedules||[]).length} time slot(s)`:'Day-part playlists, e.g. a morning menu and an evening promo'}</span></summary><div className="disclosure-body"><ScheduleEditor key={editing.id} screen={data.screens.find((s:any)=>s.id===editing.id)||editing} playlists={data.playlists} api={api} timezone={data.timezone} saved={(msg,ok)=>{setNotice(msg,ok?'success':'error');if(ok){void refresh();setVersion(v=>v+1);}}}/></div></details>
   <details className="disclosure"><summary>Diagnostics and calibration<span>Latest heartbeat and test patterns</span></summary><div className="disclosure-body"><div className="link-row"><a className="link" href={'/tv/'+editing.id+'?diagnostics=1'} target="_blank" rel="noreferrer">Player diagnostics <Icon name="external" size={14}/></a><a className="link" href="/compat" target="_blank" rel="noreferrer">Calibration <Icon name="external" size={14}/></a></div><pre className="code-block">{JSON.stringify(editing.diagnostics,null,2)||'No heartbeat yet'}</pre></div></details>
   <section className="danger-zone"><div><h3>Danger zone</h3><p>Revoking or removing requires pairing the TV again.</p></div><div className="danger-actions">
    <Button className="ghost" onClick={async()=>{if(await confirmAction({title:`Revoke access for ${editing.name}?`,confirmLabel:'Revoke access',danger:true,body:<p>The TV’s stored token stops working immediately and it shows the pairing screen. Its playlist, schedule and settings are kept. Create a new pairing code to reconnect it.</p>}))void action(()=>api('/admin/screens/'+editing.id+'/revoke','POST'),'Access revoked');}}><Icon name="key" size={17}/>Revoke token</Button>
    <Button className="danger" onClick={async()=>{if(await confirmAction({title:`Remove ${editing.name}?`,confirmLabel:'Remove display',danger:true,body:<p>The display, its schedule and command history are deleted and its TV player loses access. Media and playlists are not affected. This cannot be undone.</p>}))if(await action(()=>api('/admin/screens/'+editing.id,'DELETE'),'Display removed'))setEditing(null);}}><Icon name="trash" size={17}/>Remove display</Button></div></section></Modal>}
  {editing?.type==='playlist'&&<PlaylistEditor value={editing} setValue={setEditing} media={data.media} screens={data.screens} busy={busy} close={()=>setEditing(null)} save={async()=>{if(await action(()=>api('/admin/playlists/'+editing.id,'PUT',editing),'Playlist published'))setEditing(null);}}/>}
 </div>;
}

const modalStack:object[]=[];
export function Modal({title,close,children,wide=false,theater=false,subtitle}:{title:string;close:()=>void;children:React.ReactNode;wide?:boolean;theater?:boolean;subtitle?:React.ReactNode}){const ref=useRef<HTMLElement>(null);const closeRef=useRef(close);closeRef.current=close;useEffect(()=>{const me={};modalStack.push(me);const top=()=>modalStack[modalStack.length-1]===me;const previous=document.activeElement as HTMLElement;const oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';const getFocusable=()=>Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],summary,iframe,[tabindex="0"]')||[]).filter(el=>el.getClientRects().length>0);if(!ref.current?.contains(document.activeElement))(ref.current?.querySelector<HTMLElement>('[autofocus]')||ref.current)?.focus();function key(e:KeyboardEvent){if(!top()||document.querySelector('.palette'))return;if(e.key==='Escape'){if(document.querySelector('details.menu[open]'))return;e.preventDefault();closeRef.current();}if(e.key==='Tab'){const list=getFocusable();const active=document.activeElement;const first=list[0],last=list[list.length-1];if(!first){e.preventDefault();return;}if(e.shiftKey&&(active===first||active===ref.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&active===last){e.preventDefault();first.focus();}}}document.addEventListener('keydown',key,true);return()=>{modalStack.splice(modalStack.indexOf(me),1);document.body.style.overflow=oldOverflow;document.removeEventListener('keydown',key,true);previous?.focus?.();};},[]);
 return <div className={'modal-backdrop'+(theater?' theater':'')} onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={'modal'+(wide?' wide':'')+(theater?' theater':'')}><div className="modal-head"><div><h2>{title}</h2>{subtitle&&<p className="modal-sub">{subtitle}</p>}</div><Button type="button" className="icon-btn" aria-label="Close dialog" onClick={close}><Icon name="x"/></Button></div><div className="modal-body">{children}</div></section></div>;}

createRoot(document.getElementById('root')!).render(<SpectrumTheme><App/></SpectrumTheme>);
