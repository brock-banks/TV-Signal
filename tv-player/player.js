(function(){'use strict';
 var id=location.pathname.split('/').pop(),preview=location.search.indexOf('preview=1')!==-1,diagnose=location.search.indexOf('diagnostics=1')!==-1;
 var storageKey='signage-screen-'+id,secret='',manifest=null,pending=null,index=-1,current=null,timer=null,watchdog=null,paused=false,muted=true,started=0,remaining=0,itemTotal=0,ack=[],seen={},logs=[],state='connecting',connected=false,backoff=2000,stream=null,stopped=false,heartbeatBusy=false,manifestBusy=false;
 var stage=document.getElementById('stage'),fallback=document.getElementById('fallback'),enroll=document.getElementById('enroll'),start=document.getElementById('start'),diag=document.getElementById('diagnostics'),fallbackLabel=document.getElementById('fallback-text'),pairButton=document.getElementById('pair-btn');
 try{secret=localStorage.getItem(storageKey)||'';}catch(e){}
 function log(message){logs.push(new Date().toISOString()+' '+String(message).slice(0,400));if(logs.length>15)logs.shift();diagnostics();}
 function diagnostics(){if(!diagnose)return;diag.style.display='block';diag.textContent='Screen '+id+' | '+state+' | '+(connected?'connected':'disconnected')+' | keep-awake '+(awake?awake.mode:'-')+'\nViewport '+innerWidth+' × '+innerHeight+'\n'+navigator.userAgent+'\nCurrent '+(current?current.title:'none')+'\n'+logs.join('\n');}
 function api(suffix){return '/api/'+(preview?'admin/screens/':'screens/')+id+suffix;}
 function request(method,url,data,done){var x=new XMLHttpRequest();x.open(method,url,true);x.timeout=15000;x.setRequestHeader('X-Signage-Request','1');if(secret)x.setRequestHeader('X-Screen-Token',secret);if(data)x.setRequestHeader('Content-Type','application/json');x.onreadystatechange=function(){if(x.readyState!==4)return;var body={};try{body=JSON.parse(x.responseText);}catch(e){}done(x.status>=200&&x.status<300?null:(body.error||'HTTP '+x.status),body,x.status);};x.onerror=function(){};x.send(data?JSON.stringify(data):null);}
 function pairing(){stopped=true;clearTimeout(timer);clearTimeout(watchdog);stage.innerHTML='';if(stream)stream.close();fallback.style.display='none';enroll.style.display='block';var label=document.getElementById('screen-id');if(label)label.textContent='Display '+id;var input=document.getElementById('code');try{input.focus();}catch(e){}state='unpaired';diagnostics();}
 function fallbackText(text){if(fallbackLabel)fallbackLabel.textContent=text;else fallback.textContent=text;fallback.className=/…$/.test(text)?'busy':'';fallback.style.display='block';}
 function mediaUrl(item){return api('/media/'+item.file)+(preview?'':'?token='+encodeURIComponent(secret));}
 function clearPlayback(){clearTimeout(timer);clearTimeout(watchdog);start.style.display='none';var image=stage.querySelector('img');if(image){image.onload=null;image.onerror=null;}var video=stage.querySelector('video');if(video){video.onended=null;video.onerror=null;video.onloadeddata=null;video.onplaying=null;video.ontimeupdate=null;video.pause();video.removeAttribute('src');video.load();}stage.innerHTML='';}
 function schedule(ms){remaining=ms;started=Date.now();clearTimeout(timer);if(!paused)timer=setTimeout(next,ms);}
 function next(){
  if(stopped)return;clearPlayback();
  if(pending){manifest=pending;pending=null;index=-1;}
  if(!manifest||!manifest.items.length){current=null;state='empty';updateAwake();fallbackText('No content assigned');schedule(5000);diagnostics();return;}
  index=(index+1)%manifest.items.length;current=manifest.items[index];document.body.style.background=manifest.config.background;
  fallback.style.display='none';state=paused?'paused':'playing';var el=document.createElement(current.kind==='video'?'video':'img');el.src=mediaUrl(current);
  var failed=false;function fail(message){if(failed)return;failed=true;state='error';log(message);clearTimeout(watchdog);fallbackText('Content unavailable · retrying next item');timer=setTimeout(next,3000);}
  el.onerror=function(){fail('Media error '+current.mediaId+' '+(el.error?el.error.code:''));};
  watchdog=setTimeout(function(){fail('Media load timed out');},30000);
  if(current.kind==='video'){
   el.autoplay=!paused;el.muted=muted;el.setAttribute('playsinline','');el.setAttribute('webkit-playsinline','');el.preload='auto';
   el.onloadeddata=function(){clearTimeout(watchdog);if(!paused)playVideo(el);};el.onended=next;
   var lastTime=-1,stalledAt=Date.now();
   el.ontimeupdate=function(){if(el.currentTime!==lastTime){lastTime=el.currentTime;stalledAt=Date.now();}};
   function watch(){if(stopped||!stage.contains(el))return;if(!paused&&start.style.display==='none'&&Date.now()-stalledAt>45000){fail('Video stalled for 45 seconds');return;}if(paused)stalledAt=Date.now();watchdog=setTimeout(watch,5000);}
   el.onplaying=function(){clearTimeout(watchdog);stalledAt=Date.now();watch();};
  }else{el.onload=function(){clearTimeout(watchdog);itemTotal=Math.max(1,current.duration||10)*1000;schedule(itemTotal);};}
  stage.appendChild(el);updateAwake();diagnostics();clearTimeout(snapTimer);snapTimer=setTimeout(snapshot,2500);
  // Best-effort bounded preload of only the following image; normal HTTP cache handles storage.
  var following=manifest.items[(index+1)%manifest.items.length];if(following&&following.kind==='image'){var preload=new Image();preload.src=mediaUrl(following);}
 }
 // ---- Keep-awake: TVs and browsers dim, screensave or sleep when no video is playing (image-only slideshows).
 // 1) Screen Wake Lock API where available (needs HTTPS or localhost). 2) Otherwise a tiny muted looping clip,
 // played only while images are on screen; it is fully unloaded during video items so it never competes with
 // content for the TV's (often single) hardware video decoder. TV-level timers (e.g. auto power off) still apply.
 var awake={mode:'off',lock:null,video:null,lockFailed:false};
 function awakeWanted(){return !preview&&!stopped&&!(manifest&&manifest.config&&manifest.config.keepAwake===false);}
 function awakeVideoStop(){var v=awake.video;if(!v)return;try{v.pause();v.removeAttribute('src');v.load();}catch(e){}}
 function awakeVideoStart(){
  var v=awake.video;
  if(!v){v=document.createElement('video');v.id='keepawake';v.muted=true;v.loop=true;v.setAttribute('muted','');v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');v.setAttribute('aria-hidden','true');document.body.appendChild(v);awake.video=v;}
  if(!v.getAttribute('src')){v.setAttribute('src','/player/keepawake.mp4');}
  if(!v.paused){awake.mode='video';return;}
  try{var p=v.play();if(p&&p.then)p.then(function(){awake.mode='video';diagnostics();},function(){awake.mode='video-blocked';log('Keep-awake clip blocked: press OK once to allow playback');});else awake.mode='video';}catch(e){awake.mode='unsupported';}
 }
 function awakeLock(){
  try{navigator.wakeLock.request('screen').then(function(l){awake.lock=l;awake.mode='wakelock';awakeVideoStop();diagnostics();if(l.addEventListener)l.addEventListener('release',function(){awake.lock=null;if(awake.mode==='wakelock')awake.mode='released';});},function(e){awake.lockFailed=true;log('Wake lock refused: '+(e&&e.name||e)+'; using keep-awake clip');updateAwake();});}catch(e){awake.lockFailed=true;}
 }
 function updateAwake(){
  if(!awakeWanted()){if(awake.lock){try{awake.lock.release();}catch(e){}awake.lock=null;}awakeVideoStop();awake.mode='off';return;}
  if(awake.lock)return;
  if(!awake.lockFailed&&window.isSecureContext&&navigator.wakeLock&&document.visibilityState!=='hidden'){awakeLock();return;}
  if(current&&current.kind==='video'){awakeVideoStop();awake.mode='content-video';return;}
  awakeVideoStart();
 }
 document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')updateAwake();});
 // Player snapshot for the dashboard: a small frame of what this browser is rendering (best effort, never blocks playback).
 var snapCanvas=null,snapTimer=null,lastSnap=0;
 function snapshot(){
  if(preview||stopped||!secret||!current||Date.now()-lastSnap<6000)return;
  var el=stage.querySelector('video')||stage.querySelector('img');if(!el)return;
  if(el.tagName==='VIDEO'&&el.readyState<2)return;if(el.tagName==='IMG'&&!el.complete)return;
  try{
   var w=480,h=Math.max(1,Math.round(480*(innerHeight/innerWidth)))||270;
   if(!snapCanvas)snapCanvas=document.createElement('canvas');snapCanvas.width=w;snapCanvas.height=h;
   var ctx=snapCanvas.getContext('2d');ctx.fillStyle=(manifest&&manifest.config&&manifest.config.background)||'#000';ctx.fillRect(0,0,w,h);ctx.drawImage(el,0,0,w,h);
   var data=snapCanvas.toDataURL('image/jpeg',0.7);if(data.indexOf('data:image/jpeg')!==0)return;
   lastSnap=Date.now();request('POST',api('/snapshot'),{image:data},function(){});
  }catch(e){}
 }
 function playVideo(el,callback){try{var p=el.play();if(p&&p.then)p.then(function(){start.style.display='none';state='playing';if(callback)callback(true,'Playing');},function(){state='blocked';start.style.display='block';start.focus();log('Autoplay/audio blocked: remote interaction needed');if(callback)callback(false,'Browser requires remote interaction');});else if(callback)callback(true,'Play requested; browser has no Promise API');}catch(e){state='blocked';start.style.display='block';if(callback)callback(false,String(e));}}
 start.onclick=function(){var el=stage.querySelector('video');if(el){paused=false;playVideo(el);}if(awake.mode==='video-blocked')awakeVideoStart();};
 function fetchManifest(){if(stopped||manifestBusy)return;manifestBusy=true;request('GET',api('/manifest'),null,function(error,m,status){manifestBusy=false;if(status===401){if(!preview)pairing();else fallbackText('Preview requires administrator login');return;}connected=!error;if(error){log(error);setTimeout(fetchManifest,backoff);backoff=Math.min(30000,backoff*2);return;}backoff=2000;
  if(m.revision==='pending'){if(!current)fallbackText(m.error?'Media preparation failed; check dashboard':'Preparing display media…');return;}
  if(!manifest||m.revision!==manifest.revision){if(!current||m.immediate){pending=m;next();}else pending=m;}diagnostics();});}
 function command(c){if(seen[c.id])return;seen[c.id]=true;var el=stage.querySelector('video');function result(ok,message){ack.push({id:c.id,ok:ok,message:message});diagnostics();}
  if(c.action==='reload'){result(true,'Reload accepted');heartbeat(function(){location.reload();});return;}
  if(c.action==='next'){next();result(true,'Advanced');return;}
  if(c.action==='pause'){paused=true;state='paused';if(el)el.pause();else{remaining=Math.max(1,remaining-(Date.now()-started));clearTimeout(timer);}result(true,'Paused');return;}
  if(c.action==='play'){paused=false;state='playing';if(el)playVideo(el,result);else{schedule(remaining||10000);result(true,'Playing');}return;}
  muted=c.action==='mute';if(el){el.muted=muted;if(!paused)playVideo(el,result);else result(true,muted?'Muted':'Unmuted (paused)');}else result(true,muted?'Muted':'Audio enabled for next video, subject to browser policy');
 }
 function heartbeat(done){if(stopped||preview){if(done)done();return;}if(heartbeatBusy){if(done)setTimeout(function(){heartbeat(done);},300);return;}heartbeatBusy=true;var batch=ack.slice();request('POST',api('/heartbeat'),{currentMedia:current?current.mediaId:null,userAgent:navigator.userAgent,viewport:innerWidth+'x'+innerHeight,errors:logs,state:state,muted:muted,awake:awake.mode,ack:batch},function(error,data,status){heartbeatBusy=false;connected=!error;if(!error){ack.splice(0,batch.length);for(var n=0;n<data.commands.length;n++)command(data.commands[n]);}if(status===401)pairing();diagnostics();if(done)done();});}
 function connectEvents(){if(preview||stopped||!window.EventSource)return;stream=new EventSource(api('/events')+'?token='+encodeURIComponent(secret));stream.onmessage=function(){fetchManifest();heartbeat();};stream.onerror=function(){stream.close();stream=null;if(!stopped)setTimeout(connectEvents,10000);};}
 function boot(){stopped=false;enroll.style.display='none';fetchManifest();heartbeat();connectEvents();}
 enroll.onsubmit=function(e){e.preventDefault();if(pairButton){pairButton.disabled=true;pairButton.textContent='Pairing…';}document.getElementById('message').textContent='';request('POST','/api/screens/'+id+'/pair',{code:document.getElementById('code').value},function(error,data){if(pairButton){pairButton.disabled=false;pairButton.textContent='Pair screen';}document.getElementById('message').textContent=error||'';if(!error){secret=data.token;try{localStorage.setItem(storageKey,secret);}catch(e){log('Storage unavailable: pairing will be needed after closing browser');}boot();}});};
 setInterval(fetchManifest,10000);setInterval(snapshot,30000);setInterval(function(){heartbeat();updateAwake();},10000);
 document.onkeydown=function(e){if(e.keyCode===68){diagnose=!diagnose;diag.style.display=diagnose?'block':'none';diagnostics();}};
 window.addEventListener('online',function(){fetchManifest();heartbeat();});
 // Preview-only playback chrome (dashboard iframe): progress bar, title, time, position.
 function pad(n){return n<10?'0'+n:''+n;}
 function clock(sec){sec=Math.max(0,Math.round(sec||0));return Math.floor(sec/60)+':'+pad(sec%60);}
 function chrome(){
  var fill=document.getElementById('bar-fill'),title=document.getElementById('chrome-title'),time=document.getElementById('chrome-time'),pos=document.getElementById('chrome-index');
  if(!current||!manifest||!manifest.items.length||stage.style.display==='none'){title.textContent=state==='empty'?'No content assigned':'Waiting for content';time.textContent='';pos.textContent='';fill.style.width='0';return;}
  var el=stage.querySelector('video'),done=0,total=0;
  if(el){done=el.currentTime||0;total=el.duration||current.duration||0;}
  else{total=itemTotal/1000;done=(itemTotal-remaining+(paused?0:Date.now()-started))/1000;}
  if(total>0)done=Math.min(done,total);
  fill.style.width=(total>0?done/total*100:0)+'%';
  title.textContent=(paused?'Paused · ':'')+(current.title||'');
  time.textContent=clock(done)+' / '+clock(total);
  pos.textContent=(index+1)+' / '+manifest.items.length;
 }
 if(preview){
  document.body.className+=' preview';
  setInterval(chrome,250);
  var idleTimer=null;
  var wake=function(){document.body.className=document.body.className.replace(/\s*idle/g,'');clearTimeout(idleTimer);idleTimer=setTimeout(function(){document.body.className+=' idle';},3000);};
  document.addEventListener('mousemove',wake);wake();
 }
 if(secret||preview)boot();else pairing();
})();
