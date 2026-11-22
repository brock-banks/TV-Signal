import React,{useId,useRef,useEffect,useLayoutEffect,useState,useCallback} from 'react';

/**
 * Design-system primitives.
 * Native <button>s give full control over every interaction state
 * (rest, hover, pressed, focus-visible, disabled, busy) and keep correct
 * semantics for keyboard, screen readers and automated tests.
 */
export function SpectrumTheme({children}:{children:React.ReactNode}){return <>{children}</>;}

/* ==========================================================================
   Liquid ink effect
   A displaced SVG blob follows the pointer, stretches with pointer speed and
   springs open/closed; pressing fires a ripple ring. An inverted copy of the
   label is clipped to the same blob so text stays legible on the ink.
   Only behaviour is added — each variant keeps its own resting look.
   ========================================================================== */
const clamp=(v:number,min:number,max:number)=>Math.min(max,Math.max(min,v));
const NOISE={baseX:0.035,baseY:0.08};
const reducedMotionQuery=typeof window!=='undefined'&&window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
const reducedMotion=()=>!!reducedMotionQuery?.matches;

/** Copy the label into the inverted layer; text is drawn via ::before{content:attr(...)} so it exists in the DOM only once. */
function cloneInvertedContent(source:HTMLElement,dest:HTMLElement){
 const fragment=document.createDocumentFragment();
 source.childNodes.forEach(node=>{const clone=node.cloneNode(true);if(clone instanceof Element){clone.removeAttribute('id');clone.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));}fragment.append(clone);});
 fragment.normalize();
 fragment.querySelectorAll('svg title, svg desc').forEach(el=>el.remove());
 const walker=document.createTreeWalker(fragment,NodeFilter.SHOW_TEXT);const texts:Text[]=[];
 while(walker.nextNode())texts.push(walker.currentNode as Text);
 for(const text of texts){if(!text.data.trim()||text.parentNode instanceof SVGElement)continue;const label=document.createElement('span');label.setAttribute('data-liquid-text',text.data);text.replaceWith(label);}
 dest.replaceChildren(fragment);
}

type Handlers=Pick<React.ButtonHTMLAttributes<HTMLButtonElement>,'onPointerEnter'|'onPointerMove'|'onPointerLeave'|'onPointerDown'|'onPointerUp'|'onPointerCancel'|'onFocus'|'onBlur'>;

function useLiquid(disabled:boolean,user:Handlers){
 const rawId=useId();const base='liquid-'+rawId.replace(/[^a-zA-Z0-9-_]/g,'');const filterId=base+'-filter',clipId=base+'-clip';
 const button=useRef<HTMLElement|null>(null),svg=useRef<SVGSVGElement|null>(null),blob=useRef<SVGEllipseElement|null>(null),clip=useRef<SVGEllipseElement|null>(null),displacement=useRef<SVGFEDisplacementMapElement|null>(null),turbulence=useRef<SVGFETurbulenceElement|null>(null),ripple=useRef<SVGCircleElement|null>(null),content=useRef<HTMLSpanElement|null>(null),inverted=useRef<HTMLSpanElement|null>(null);
 const [pressed,setPressed]=useState(false);
 const st=useRef({x:0,y:0,radius:0,radiusVelocity:0,pointerActive:false,focusActive:false,targetSpeed:0,speed:0,targetAngle:0,angle:0,stretch:1,frame:0,lastFrame:0,lastPointerTime:0,lastPointerX:0,lastPointerY:0,disabled,time:0,jx:0,jy:0,ringProgress:0,ringPhase:0,ringX:0,ringY:0,ringEscapeAngle:0,ringPeakScale:.58,ringDipRatio:.86,ringSpeedMult:1});
 st.current.disabled=disabled;

 const dims=useCallback(()=>{const s=svg.current,b=button.current;if(!s||!b)return {width:0,height:0,rect:null as DOMRect|null};return {width:b.clientWidth,height:b.clientHeight,rect:s.getBoundingClientRect()};},[]);
 const toLocal=useCallback((cx:number,cy:number)=>{const {rect,width,height}=dims();if(!rect||width<=0||height<=0||rect.width<=0||rect.height<=0)return null;return {x:clamp((cx-rect.left)*width/rect.width,0,width),y:clamp((cy-rect.top)*height/rect.height,0,height),width,height};},[dims]);
 const setShape=(el:SVGEllipseElement|null,rx:number,ry:number,angle:number)=>{if(!el)return;const s=st.current,x=s.x+s.jx,y=s.y+s.jy;el.setAttribute('cx',String(x));el.setAttribute('cy',String(y));el.setAttribute('rx',String(Math.max(0,rx)));el.setAttribute('ry',String(Math.max(0,ry)));el.setAttribute('transform',`rotate(${angle} ${x} ${y})`);};
 const render=useCallback(()=>{
  const {width,height}=dims();if(width<=0||height<=0)return;const s=st.current,reduce=reducedMotion();
  const axis=Math.sqrt(s.stretch);setShape(blob.current,s.radius*axis,s.radius/axis,s.angle);setShape(clip.current,s.radius*axis,s.radius/axis,s.angle);
  if(turbulence.current&&!reduce){const b=1+Math.sin(s.time*2.5)*.12;turbulence.current.setAttribute('baseFrequency',`${(NOISE.baseX*b).toFixed(4)} ${(NOISE.baseY*(2-b)).toFixed(4)}`);}
  const ringTurb=s.ringPhase>0?(1-s.ringProgress)*18:0;
  displacement.current?.setAttribute('scale',(reduce?0:4.5+s.speed*18+Math.sin(s.time*4)*1.5+ringTurb).toFixed(2));
  const r=ripple.current;if(!r)return;
  if(s.ringPhase>0){const peak=Math.min(width,height)*s.ringPeakScale,dip=peak*s.ringDipRatio;let rad=0,op=0,stroke=2.4;
   if(s.ringPhase===1){rad=(1-Math.pow(1-s.ringProgress,3))*peak;op=.95-s.ringProgress*.12;stroke=2.6-s.ringProgress*.3;}
   else if(s.ringPhase===2){rad=peak-Math.sin(s.ringProgress*Math.PI)*(peak-dip);op=.88;stroke=2.3;}
   else{const p=s.ringProgress;rad=dip+p*Math.max(width,height)*.85;op=Math.max(0,.88*(1-p));stroke=Math.max(1,2.3*(1-p*.6));}
   r.setAttribute('cx',String(s.ringX+s.jx*.5));r.setAttribute('cy',String(s.ringY+s.jy*.5));r.setAttribute('r',String(Math.max(0,rad)));r.setAttribute('opacity',String(Math.max(0,op)));r.style.strokeWidth=stroke.toFixed(2)+'px';r.style.display='block';}
  else r.style.display='none';
 },[dims]);

 const tick=useRef<(now:number)=>void>(()=>{});
 const schedule=useCallback(()=>{const s=st.current;if(s.frame===0)s.frame=requestAnimationFrame(n=>tick.current(n));},[]);
 tick.current=(now:number)=>{
  const s=st.current;s.frame=0;const dt=s.lastFrame===0?1/60:clamp((now-s.lastFrame)/1000,1/240,1/30);s.lastFrame=now;s.time+=dt;
  const {width,height}=dims();if(width<=0||height<=0)return;const reduce=reducedMotion();
  if(reduce){s.jx=0;s.jy=0;s.ringPhase=0;s.ringProgress=0;}
  else{const t=s.time;s.jx=Math.sin(t*3.7)*2.2+Math.sin(t*7.1+1.2)*1.4+Math.cos(t*11.3)*.8;s.jy=Math.cos(t*3.1)*1.8+Math.sin(t*6.3+2.4)*1.2+Math.sin(t*13.1)*.6;}
  s.speed+=(s.targetSpeed-s.speed)*(1-Math.exp(-dt/.105));s.targetSpeed=0;
  const desired=1+s.speed*.55+(s.pointerActive&&!reduce?Math.sin(s.time*2.8)*.04:0);s.stretch+=(desired-s.stretch)*(1-Math.exp(-dt/.08));
  s.angle+=(((s.targetAngle-s.angle+540)%360)-180)*(1-Math.exp(-dt/.075));
  if(!reduce){
   if(s.ringPhase===1){s.ringProgress+=dt*3.8*s.ringSpeedMult;if(s.ringProgress>=1){s.ringPhase=2;s.ringProgress=0;}}
   else if(s.ringPhase===2){s.ringProgress+=dt*7.8*s.ringSpeedMult;if(s.ringProgress>=1){s.ringPhase=3;s.ringProgress=0;}}
   else if(s.ringPhase===3){s.ringProgress+=dt*3.5*s.ringSpeedMult;const g=Math.max(width,height)*1.55*dt*s.ringSpeedMult;s.ringX+=Math.cos(s.ringEscapeAngle)*g;s.ringY+=Math.sin(s.ringEscapeAngle)*g;if(s.ringProgress>=1){s.ringPhase=0;s.ringProgress=0;}}
  }
  const active=(s.pointerActive||s.focusActive)&&!s.disabled;
  const corner=Math.max(Math.hypot(s.x,s.y),Math.hypot(width-s.x,s.y),Math.hypot(s.x,height-s.y),Math.hypot(width-s.x,height-s.y));
  const target=active?corner*Math.sqrt(s.stretch)*1.14:0;
  if(reduce){s.radius=target;s.radiusVelocity=0;}else{s.radiusVelocity+=((target-s.radius)*150-s.radiusVelocity*24)*dt;s.radius+=s.radiusVelocity*dt;}
  if(s.radius<0){s.radius=0;s.radiusVelocity=0;}
  render();
  if(active||s.ringPhase>0||Math.abs(s.radius)>.1)s.frame=requestAnimationFrame(n=>tick.current(n));
  else{s.lastFrame=0;s.radius=0;s.radiusVelocity=0;s.stretch=1;s.speed=0;s.ringPhase=0;render();}
 };

 const setOrigin=(cx:number,cy:number)=>{const p=toLocal(cx,cy);if(!p)return;st.current.x=p.x;st.current.y=p.y;render();};
 const impulse=(cx:number,cy:number)=>{
  const p=toLocal(cx,cy);if(!p)return;const s=st.current;
  s.ringX=p.x;s.ringY=p.y;s.ringPhase=1;s.ringProgress=0;
  turbulence.current?.setAttribute('seed',String(Math.floor(Math.random()*9999)+1));
  s.ringPeakScale=.56+Math.random()*.09;s.ringDipRatio=.82+Math.random()*.08;s.ringSpeedMult=.92+Math.random()*.22;
  const dx=p.x-p.width/2,dy=p.y-p.height/2;s.ringEscapeAngle=(Math.hypot(dx,dy)>2?Math.atan2(dy,dx):-Math.PI/2)+(Math.random()-.5)*.85;
  s.radiusVelocity+=130+Math.random()*50;
  try{navigator.vibrate?.(10);}catch{}
  schedule();
 };
 const velocity=(e:React.PointerEvent)=>{const now=performance.now(),s=st.current;if(s.lastPointerTime>0){const dx=e.clientX-s.lastPointerX,dy=e.clientY-s.lastPointerY;s.targetSpeed=clamp(Math.hypot(dx,dy)/Math.max(8,now-s.lastPointerTime)/1.65,0,1);if(Math.hypot(dx,dy)>.5)s.targetAngle=Math.atan2(dy,dx)*180/Math.PI;}s.lastPointerTime=now;s.lastPointerX=e.clientX;s.lastPointerY=e.clientY;};

 useEffect(()=>{const b=button.current;if(!b)return;const sync=()=>{const {width,height}=dims();if(width<=0||height<=0)return;const s=st.current;if(s.x===0&&s.y===0){s.x=width/2;s.y=height/2;}render();};sync();
  if(typeof ResizeObserver==='undefined')return;const o=new ResizeObserver(()=>{sync();if(st.current.radius>0)schedule();});o.observe(b);return()=>o.disconnect();},[dims,render,schedule]);
 useEffect(()=>{const blur=()=>{const s=st.current;s.pointerActive=false;s.focusActive=false;s.lastPointerTime=0;setPressed(false);schedule();};window.addEventListener('blur',blur);return()=>window.removeEventListener('blur',blur);},[schedule]);
 useEffect(()=>{if(disabled){const s=st.current;s.pointerActive=false;s.focusActive=false;setPressed(false);schedule();}},[disabled,schedule]);
 useEffect(()=>()=>{const s=st.current;if(s.frame)cancelAnimationFrame(s.frame);s.frame=0;},[]);
 useLayoutEffect(()=>{const src=content.current,dest=inverted.current;if(!src||!dest)return;const sync=()=>cloneInvertedContent(src,dest);sync();const o=new MutationObserver(sync);o.observe(src,{subtree:true,childList:true,characterData:true,attributes:true});return()=>o.disconnect();},[]);

 const handlers:Required<Handlers>={
  onPointerEnter:e=>{user.onPointerEnter?.(e);if(disabled||e.pointerType==='touch')return;st.current.pointerActive=true;setOrigin(e.clientX,e.clientY);velocity(e);schedule();},
  onPointerMove:e=>{user.onPointerMove?.(e);if(disabled||e.pointerType==='touch')return;st.current.pointerActive=true;setOrigin(e.clientX,e.clientY);velocity(e);schedule();},
  onPointerLeave:e=>{if(e.pointerType!=='touch')setOrigin(e.clientX,e.clientY);st.current.pointerActive=false;st.current.lastPointerTime=0;setPressed(false);schedule();user.onPointerLeave?.(e);},
  onPointerDown:e=>{if(!disabled&&e.button===0){st.current.pointerActive=true;setPressed(true);setOrigin(e.clientX,e.clientY);impulse(e.clientX,e.clientY);}user.onPointerDown?.(e);},
  onPointerUp:e=>{setPressed(false);if(e.pointerType==='touch'){st.current.pointerActive=false;schedule();}user.onPointerUp?.(e);},
  onPointerCancel:e=>{st.current.pointerActive=false;st.current.lastPointerTime=0;setPressed(false);schedule();user.onPointerCancel?.(e);},
  onFocus:e=>{const visible=!disabled&&!!button.current?.matches(':focus-visible');st.current.focusActive=visible;if(visible){const {width,height}=dims();st.current.x=width/2;st.current.y=height/2;render();schedule();}user.onFocus?.(e);},
  onBlur:e=>{st.current.focusActive=false;schedule();user.onBlur?.(e);},
 };
 const layers=<>
  <svg ref={svg} className="liquid-svg" aria-hidden="true" focusable="false">
   <defs>
    <filter id={filterId} x="-35%" y="-45%" width="170%" height="190%" colorInterpolationFilters="sRGB">
     <feTurbulence ref={turbulence} type="fractalNoise" baseFrequency={`${NOISE.baseX} ${NOISE.baseY}`} numOctaves={2} seed={8} result="liquid-noise"/>
     <feDisplacementMap ref={displacement} in="SourceGraphic" in2="liquid-noise" scale={5} xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <clipPath id={clipId} clipPathUnits="userSpaceOnUse"><ellipse ref={clip} cx={0} cy={0} rx={0} ry={0}/></clipPath>
   </defs>
   <ellipse ref={blob} className="liquid-blob" filter={`url(#${filterId})`} cx={0} cy={0} rx={0} ry={0}/>
   <circle ref={ripple} className="liquid-ripple" filter={`url(#${filterId})`} cx={0} cy={0} r={0} style={{display:'none'}}/>
  </svg>
 </>;
 return {button,content,inverted,pressed,handlers,layers,clipStyle:{'--liquid-clip':`url(#${clipId})`} as React.CSSProperties};
}

type ButtonProps=React.ButtonHTMLAttributes<HTMLButtonElement>&{loading?:boolean;as?:'button'|'summary'|'a';href?:string;target?:string;rel?:string};
/** Matches whole class names only (classes are split on whitespace, never regex word boundaries). */
const hasClass=(className:string,names:string[])=>className.split(/\s+/).some(c=>names.includes(c));
const VARIANTS=['primary','danger','danger-solid','ghost','tonal','text','nav-item'];
/** Controls that keep their own base class instead of the .btn pill. */
const OWN_SHAPE=['icon-btn','chip','player-control','yt-btn','nav-item'];

/**
 * Every pressable control in the dashboard: pill buttons, icon buttons, chips,
 * player controls, menu triggers (<summary>) and icon links (<a>).
 * All share the liquid ink behaviour; each class keeps its own resting look.
 */
export function Button({children,className='',type,onClick,loading=false,disabled,style,as='button',onPointerEnter,onPointerMove,onPointerLeave,onPointerDown,onPointerUp,onPointerCancel,onFocus,onBlur,...rest}:ButtonProps){
 const off=!!(disabled||loading);
 const liquid=useLiquid(off,{onPointerEnter,onPointerMove,onPointerLeave,onPointerDown,onPointerUp,onPointerCancel,onFocus,onBlur});
 const own=hasClass(className,OWN_SHAPE);
 const base=own?'':'btn ',variant=own||hasClass(className,VARIANTS)?'':' secondary';
 const Tag:any=as,isButton=as==='button';
 return <Tag {...rest} {...liquid.handlers} ref={liquid.button} data-liquid-button="" type={isButton?type??(onClick?'button':'submit'):undefined} className={(base+'liquid '+className+variant+(liquid.pressed?' is-pressed':'')).trim()} style={{...liquid.clipStyle,...style}} onClick={onClick} disabled={isButton?off:undefined} aria-disabled={!isButton&&off?true:undefined} aria-busy={loading||undefined}>
  {liquid.layers}
  <span ref={liquid.content} className="liquid-content">{loading&&<span className="spinner" aria-hidden="true"/>}{children}</span>
  <span ref={liquid.inverted} className="liquid-inverted" aria-hidden="true"/>
 </Tag>;
}
