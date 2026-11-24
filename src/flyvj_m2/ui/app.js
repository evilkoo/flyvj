(function(){
'use strict';
const C=globalThis.FlyVJM2,$=id=>document.getElementById(id),canvas=$('graph'),status=$('render-status');
let payload;
function failure(message){status.setAttribute('role','alert');status.setAttribute('aria-live','assertive');status.textContent=message;status.classList.add('failure');canvas.dataset.renderState='error';canvas.dataset.renderError=message;}
try{payload=C.validatePayload(JSON.parse($('m2-payload').textContent));}catch(error){failure('資料驗證失敗：'+error.message);document.querySelectorAll('button,input,select').forEach(e=>e.disabled=true);return;}
const d=payload.dataset,normalized=C.normalize(d.neurons),byId=new Map(normalized.points.map(n=>[n.id,n])),points=payload.render_order.map(id=>byId.get(id));
let selected=d.neurons[0].id,cam=C.camera(),sim=C.reset(),gl=null,program=null,buffer=null,raf=0,last=null,available=false,lossExtension=null;
$('source-status').textContent='source verified POINT SAMPLE';$('graph-count').textContent=d.neurons.length+' points / '+d.connections.length+' edges';
$('provenance').textContent=[d.provenance.name,d.provenance.version,d.provenance.license,'Source: '+d.provenance.source].join(' · ');
$('coordinates').textContent=d.coordinates.units+' · '+d.coordinates.frame;
$('fingerprint').textContent='Dataset fingerprint: '+payload.dataset_fingerprint;
for(const n of d.neurons){const option=document.createElement('option');option.value=n.id;option.textContent=n.id+' · '+n.region;$('neuron').append(option);}
for(const r of payload.rule_examples){const li=document.createElement('li');li.textContent=r.energy+' → Column '+r.column+' · '+r.reason;$('rules').append(li);}
function selection(){
 $('neuron').value=selected;const n=d.neurons.find(n=>n.id===selected);$('selection').replaceChildren();
 for(const [key,value] of [['ID',n.id],['原始 nm 座標',n.position.join(', ')],['Selected-edge neuropil（唔係點所在位置）',n.region]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;$('selection').append(dt,dd);}
 $('edges').replaceChildren();const edges=C.selectedEdges(d,selected);
 for(const e of edges){const li=document.createElement('li');li.textContent=e.pre_id+' → '+e.post_id+' · '+e.direction+' · selected neuropil '+e.neuropil+' · '+e.weight+' synapses';$('edges').append(li);}
 if(!edges.length){const li=document.createElement('li');li.textContent='呢個 sample 無相關 measured edge。';$('edges').append(li);}request();
}
function controls(){ $('selected-activation').textContent=C.activation(selected,sim.time,sim.energy).toFixed(4);canvas.dataset.playing=String(sim.playing);canvas.dataset.energy=String(sim.energy);canvas.dataset.speed=String(sim.speed);const col=C.column(sim.energy);$('timeline').textContent=sim.time.toFixed(2)+' s';$('energy').value=sim.energy;$('speed').value=sim.speed;$('energy-value').textContent=sim.energy.toFixed(2);$('speed-value').textContent=sim.speed.toFixed(1)+'×';$('play').textContent=sim.playing?'暫停':'播放';$('play').setAttribute('aria-pressed',String(sim.playing));$('column').textContent='Column '+col;$('address').textContent='/composition/columns/'+col+'/connect  [preview only]';}
function stop(){if(raf)cancelAnimationFrame(raf);raf=0;last=null;}
function request(){if(!document.hidden&&available&&!raf)raf=requestAnimationFrame(frame);}
function frame(now){raf=0;if(document.hidden||!available){last=null;return;}sim=C.step(sim,last===null?0:Math.max(0,(now-last)/1000),true);last=now;controls();try{draw();}catch(error){available=false;stop();failure('3D render error：'+error.message+'。資料面板仍可用。');return;}if(sim.playing)request();else last=null;}
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(message||'Shader compile failed');}return s;}
function diagnostics(state){
 const lose=$('lose-context'),restore=$('restore-context'),message=$('diagnostic-status');
 lose.disabled=state!=='ready'||!lossExtension;restore.disabled=state!=='lost'||!lossExtension;
 const messages={ready:'可測試真正 context loss；唔代表 QC 已通過。',lost:'已收到 context lost event；render 已停止。可以恢復 context。',losing:'已要求 context loss；等候真正 event。',restoring:'已要求恢復；等候真正 context restored event。',unavailable:'WEBGL_lose_context 不可用；測試按鈕已停用。'};
 message.textContent=messages[state]||messages.unavailable;canvas.dataset.diagnosticState=state;
}
$('lose-context').addEventListener('click',()=>{
 if(!lossExtension||!available)return;diagnostics('losing');
 try{lossExtension.loseContext();}catch(error){$('diagnostic-status').textContent='要求 context loss 失敗：'+error.message; $('lose-context').disabled=false;}
});
$('restore-context').addEventListener('click',()=>{
 if(!lossExtension||!gl||!gl.isContextLost())return;diagnostics('restoring');
 try{lossExtension.restoreContext();}catch(error){diagnostics('lost');$('diagnostic-status').textContent='要求恢復失敗：'+error.message;}
});
function initialize(){
 try{
 gl=canvas.getContext('webgl',{antialias:true,alpha:false});if(!gl)throw new Error('WebGL unavailable');
 const vs=shader(gl.VERTEX_SHADER,'attribute vec3 a_position; attribute vec3 a_color; attribute float a_size; varying vec3 v_color; void main(){gl_Position=vec4(a_position,1.0); gl_PointSize=a_size; v_color=a_color;}');
 const fs=shader(gl.FRAGMENT_SHADER,'precision mediump float; varying vec3 v_color; uniform bool u_points; void main(){if(u_points && distance(gl_PointCoord,vec2(0.5))>0.5)discard; gl_FragColor=vec4(v_color,1.0);}');
 program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('WebGL program link failed');buffer=gl.createBuffer();if(!buffer)throw new Error('WebGL buffer unavailable');
 lossExtension=gl.getExtension('WEBGL_lose_context');diagnostics(lossExtension?'ready':'unavailable');available=true;canvas.dataset.renderer='native-webgl';canvas.dataset.renderState='initialized';delete canvas.dataset.renderError;status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.classList.remove('failure');status.textContent='原始 point sample · 線段只表示 measured connection，唔係神經形態';last=null;request();
 }catch(error){available=false;stop();lossExtension=null;diagnostics('unavailable');canvas.dataset.renderer=gl?'native-webgl':'unavailable';failure('3D 顯示失敗：'+error.message+'。原始資料面板仍然可用；無替代假腦圖。');}
}
function draw(){
 const rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height;if(w<=0||h<=0)return;const ratio=Math.min(window.devicePixelRatio||1,2),width=Math.max(1,Math.round(w*ratio)),height=Math.max(1,Math.round(h*ratio));if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
 gl.viewport(0,0,width,height);gl.clearColor(.067,.086,.075,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.disable(gl.DEPTH_TEST);
 const attrs=[['a_position',3,0],['a_color',3,12],['a_size',1,24]];for(const [name,size,offset] of attrs){const loc=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,28,offset);}
 const vertex=(n,color,size)=>{const p=C.project(n.position,cam,w,h);return [(p.x/w)*2-1,1-(p.y/h)*2,p.z/10,...color,size*ratio];};
 const lines=[];for(const e of d.connections){const chosen=e.pre_id===selected||e.post_id===selected,color=chosen?[.25,.65,.69]:[.27,.34,.29];lines.push(...vertex(byId.get(e.pre_id),color,1),...vertex(byId.get(e.post_id),color,1));}
 gl.uniform1i(gl.getUniformLocation(program,'u_points'),0);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(lines),gl.DYNAMIC_DRAW);gl.drawArrays(gl.LINES,0,lines.length/7);
 // Sort depth independently of supplied render order so overlap agrees with picking.
 const ordered=[...points].sort((a,b)=>C.project(b.position,cam,w,h).z-C.project(a.position,cam,w,h).z||(a.id<b.id?1:-1));
 const vertices=[];for(const n of ordered){const a=C.activation(n.id,sim.time,sim.energy),color=n.id===selected?[.44,.86,.91]:[.43+.40*a,.49+.44*a,.36+.14*a];vertices.push(...vertex(n,color,n.id===selected?15:9+a*5));}
 gl.uniform1i(gl.getUniformLocation(program,'u_points'),1);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);gl.drawArrays(gl.POINTS,0,vertices.length/7);
 const error=gl.getError();if(gl.isContextLost()||error!==gl.NO_ERROR)throw new Error('WebGL draw failed ('+error+')');
 // Submission evidence only: not a pixel-readback or visual-QC PASS.
 canvas.dataset.renderState='draw-submitted';canvas.dataset.frame=String(Number(canvas.dataset.frame||0)+1);canvas.dataset.mockTime=String(sim.time);
 canvas.dataset.selectedId=selected;canvas.dataset.yaw=String(cam.yaw);canvas.dataset.pitch=String(cam.pitch);canvas.dataset.zoom=String(cam.zoom);
 canvas.dataset.pointCount=String(points.length);canvas.dataset.edgeCount=String(d.connections.length);
 canvas.dataset.renderedEnergy=String(sim.energy);canvas.dataset.renderedSpeed=String(sim.speed);
}
$('neuron').addEventListener('change',()=>{selected=$('neuron').value;selection();});
$('play').addEventListener('click',()=>{sim={...sim,playing:!sim.playing};last=null;controls();request();});
$('timeline-reset').addEventListener('click',()=>{sim=C.reset();last=null;controls();request();});
$('energy').addEventListener('input',()=>{sim={...sim,energy:Number($('energy').value)};controls();request();});
$('speed').addEventListener('input',()=>{sim={...sim,speed:Number($('speed').value)};controls();request();});
const zoom=f=>{cam={...cam,zoom:Math.max(.2,Math.min(5,cam.zoom*f))};request();};
$('zoom-in').addEventListener('click',()=>zoom(1.2));$('zoom-out').addEventListener('click',()=>zoom(1/1.2));$('camera-reset').addEventListener('click',()=>{cam=C.camera();request();});
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-Math.sign(e.deltaY)*.12));},{passive:false});
canvas.addEventListener('keydown',e=>{let handled=true;switch(e.key){case 'ArrowLeft':cam.yaw-=.1;break;case 'ArrowRight':cam.yaw+=.1;break;case 'ArrowUp':cam.pitch-=.1;break;case 'ArrowDown':cam.pitch+=.1;break;case '+':case '=':zoom(1.2);break;case '-':zoom(1/1.2);break;case 'Home':cam=C.camera();break;default:handled=false;}if(handled){e.preventDefault();request();}});
let drag=null;
canvas.addEventListener('pointerdown',e=>{if(e.button!==0||drag)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);canvas.focus();});
canvas.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved=drag.moved||Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>4;if(drag.moved){cam.yaw+=dx*.008;cam.pitch+=dy*.008;request();}drag.x=e.clientX;drag.y=e.clientY;});
canvas.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;const click=!drag.moved;drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(click){const r=canvas.getBoundingClientRect();if(r.width&&r.height){const hit=C.pick(points,cam,r.width,r.height,e.clientX-r.left,e.clientY-r.top,12);if(hit){selected=hit;selection();}}}});
canvas.addEventListener('pointercancel',()=>{drag=null;});canvas.addEventListener('lostpointercapture',()=>{drag=null;});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();available=false;stop();failure('WebGL context lost：3D 暫停。原始資料仍可查閱；等候 context 恢復。');canvas.dataset.renderState='context-lost';diagnostics(lossExtension?'lost':'unavailable');});
canvas.addEventListener('webglcontextrestored',()=>{last=null;initialize();});
document.addEventListener('visibilitychange',()=>{stop();if(!document.hidden)request();});window.addEventListener('resize',request);if(typeof ResizeObserver!=='undefined')new ResizeObserver(request).observe(canvas);
window.addEventListener('pagehide',stop);window.addEventListener('pageshow',()=>{last=null;request();});
selection();controls();initialize();
})();
