'use strict';
const test = require.main===module ? require('node:test') : (()=>{});
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../src/flyvj_m3/ui');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const G = require('../src/flyvj_m2/ui/core.js');
const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/flywire783-m1/sample.json'), 'utf8'));
const payload = () => ({schema_version:1,scope:'M3_LOCAL_FILE_AUDIO',dataset:structuredClone(dataset),dataset_fingerprint:'ui-test-only',source_check:{verified:true},render_order:dataset.neurons.map(n=>n.id).reverse(),rule_examples:[],audio_policy:{file_only:true,muted_default:true,no_network:true},mapping_semantics:'人為映射，唔係生物 firing'});

// A deliberately small DOM/Web Audio test double. These are UI glue tests, not browser/DSP QC.
function harness(options={}) {
  const logs={contexts:[],sources:[],measures:[],advances:[],urls:[],revoked:[],fixture:0,wav:0};
  const nodes=new Map(), frames=new Map(); let frameId=0, urlId=0;
  class Events {
    constructor(){this.listeners=new Map();}
    addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
    removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
    dispatch(type,extra={}){const e={type,target:this,preventDefault(){this.prevented=true;},...extra};for(const fn of [...(this.listeners.get(type)||[])])fn(e);return e;}
  }
  class Element extends Events {
    constructor(tag){super();this.tagName=tag.toUpperCase();this.id='';this.value='';this.textContent='';this.children=[];this.dataset={};this.style={};this.disabled=false;this.checked=false;this.attributes=new Map();const classes=new Set();this.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)};this.paused=true;this.ended=false;this.seeking=false;this.readyState=0;this.duration=NaN;this.currentTime=0;this.muted=false;this.volume=1;this.src='';this.error=null;this.files=[];}
    setAttribute(k,v){this.attributes.set(k,String(v));if(k==='src')this.src=String(v);}
    getAttribute(k){return this.attributes.get(k)??null;}
    removeAttribute(k){this.attributes.delete(k);if(k==='src')this.src='';}
    append(...els){this.children.push(...els);}
    replaceChildren(...els){this.children=[...els];}
    replaceWith(el){nodes.set(el.id,el);}
    getBoundingClientRect(){return {width:800,height:500,left:0,top:0};}
    getContext(){return options.gl||null;}
    focus(){} setPointerCapture(){} hasPointerCapture(){return false;} releasePointerCapture(){}
    load(){}
    pause(){const was=!this.paused;this.paused=true;if(was)this.dispatch('pause');}
    play(){if(this.playImpl)return this.playImpl();this.paused=false;this.dispatch('play');this.dispatch('playing');return Promise.resolve();}
  }
  for(const m of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const el=new Element(m[1]);el.id=m[3];for(const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)){el.attributes.set(a[1],a[2]);if(a[1]==='value')el.value=a[2];if(a[1].startsWith('data-'))el.dataset[a[1].slice(5).replace(/-([a-z])/g,(_,v)=>v.toUpperCase())]=a[2];}el.disabled=/\bdisabled\b/.test(m[2]);el.muted=/\bmuted\b/.test(m[2]);nodes.set(el.id,el);
  }
  nodes.get('m3-payload').textContent=JSON.stringify(options.payload||payload());
  const document=new Events();document.hidden=false;document.getElementById=id=>nodes.get(id);document.createElement=tag=>new Element(tag);document.querySelectorAll=()=>[...nodes.values()].filter(n=>['BUTTON','INPUT','SELECT'].includes(n.tagName));
  class AudioNode {constructor(){this.connections=[];this.disconnected=false;}connect(n){this.connections.push(n);return n;}disconnect(){this.disconnected=true;}}
  class Context extends Events {
    constructor(){super();this.sampleRate=48000;this.state='suspended';this.destination=new AudioNode();logs.contexts.push(this);}
    resume(){if(options.resumeImpl)return options.resumeImpl(this);if(options.resumeReject)return Promise.reject(Object.assign(new Error('resume denied'),{name:'NotAllowedError'}));this.state='running';return Promise.resolve();}
    close(){this.state='closed';return Promise.resolve();}
    createMediaElementSource(el){if(logs.sources.some(s=>s.el===el))throw new Error('double connection');const n=new AudioNode();n.el=el;logs.sources.push(n);return n;}
    createAnalyser(){const n=new AudioNode();n.fftSize=2048;n.smoothingTimeConstant=.8;Object.defineProperty(n,'frequencyBinCount',{get:()=>n.fftSize/2});n.getFloatTimeDomainData=a=>a.fill(.25);n.getFloatFrequencyData=a=>a.fill(-40);this.analyser=n;return n;}
    createGain(){const n=new AudioNode();n.gain={value:1};this.monitor=n;return n;}
  }
  const A={
    assignRoles(ids){const sorted=[...ids].sort();return Object.fromEntries(sorted.map((id,i)=>[id,['low','mid','high'][Math.floor(i/2)]]));},
    initialState(ids){return {time:0,energy:0,bands:{low:0,mid:0,high:0},signals:Object.fromEntries(ids.map(id=>[id,0])),roles:this.assignRoles(ids),candidate:null,onset:false,onsetCount:0};},
    measure(t,f,sr,fft){logs.measures.push({t,f,sr,fft});return {rms:t[0],bands:{low:.2,mid:.4,high:.6},clipping:false};},
    advance(s,f,t,playing,gain){logs.advances.push({s,f,t,playing,gain});if(!playing)return s;const energy=Math.min(1,f.rms*gain);return {...s,time:t,energy,bands:{...f.bands},signals:Object.fromEntries(Object.keys(s.roles).map(id=>[id,f.bands[s.roles[id]]])),candidate:energy<=.02?null:G.column(energy)};},
    fixturePcm(){logs.fixture++;return new Float32Array(128);},
    encodeWav(pcm,sr){logs.wav++;assert.equal(sr,16000);assert.ok(pcm instanceof Float32Array);return new Uint8Array([82,73,70,70]);}
  };
  const window=new Events();window.devicePixelRatio=1;if(!options.noAudioContext)window.AudioContext=Context;
  const context={document,window,setTimeout:options.setTimeout||setTimeout,clearTimeout:options.clearTimeout||clearTimeout,FlyVJM2:G,FlyVJM3:options.dsp||A,Blob,File,Float32Array,Uint8Array,Map,Set,Math,Number,JSON,Error,TypeError,console,URL:{createObjectURL(blob){assert.ok(blob instanceof Blob);const url='blob:ui-test/'+(++urlId);logs.urls.push(url);return url;},revokeObjectURL:url=>logs.revoked.push(url)},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)};
  if(options.kinectBridge)context.FlyVJKinectBridge=options.kinectBridge;
  if(options.morphologyGeometry)context.FlyVJPublicMorphology=options.morphologyGeometry;
  if(options.morphologyRenderer)context.FlyVJPublicMorphologyRenderer=options.morphologyRenderer;
  if(options.brainGeometry)context.FlyVJBrainGeometry=options.brainGeometry;
  if(options.brainRenderer)context.FlyVJBrainRenderer=options.brainRenderer;
  vm.runInNewContext(app,context,{filename:'M3 UI glue'});
  const el=id=>nodes.get(id);
  async function flush(){for(let i=0;i<16;i++)await Promise.resolve();}
  async function choose(blob=new File(['pcm'],'PRIVATE-SHOULD-NOT-APPEAR.wav',{type:'audio/wav'})){el('audio-file').files=[blob];el('audio-file').dispatch('change');await flush();return el('audio-player');}
  async function metadata(audio=el('audio-player'),duration=8){audio.duration=duration;audio.readyState=4;audio.dispatch('loadedmetadata');audio.dispatch('canplay');await flush();}
  function frame(){const batch=[...frames.values()];frames.clear();for(const fn of batch)fn(1000);}
  async function play(){el('play').dispatch('click');await flush();}
  return {el,logs,document,window,frames,flush,choose,metadata,frame,play};
}
function fakeGL(){
  const g={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,FLOAT:6,LINES:7,POINTS:8,DYNAMIC_DRAW:9,COLOR_BUFFER_BIT:1,DEPTH_BUFFER_BIT:2,DEPTH_TEST:3,NO_ERROR:0,lost:false,draws:0};
  for(const k of ['createShader','createProgram','createBuffer'])g[k]=()=>({});
  for(const k of ['shaderSource','compileShader','deleteShader','attachShader','linkProgram','deleteProgram','deleteBuffer','viewport','clearColor','clear','useProgram','bindBuffer','disable','enableVertexAttribArray','vertexAttribPointer','uniform1i','bufferData'])g[k]=()=>{};
  g.getShaderParameter=g.getProgramParameter=()=>true;g.getAttribLocation=()=>0;g.getUniformLocation=()=>({});g.getError=()=>0;g.isContextLost=()=>g.lost;g.drawArrays=()=>{g.draws++;};g.getExtension=()=>g.extension||null;return g;
}

test('five exact inline markers, payload ID and local-only CSP',()=>{for(const marker of ['STYLE','PAYLOAD','GEOMETRY','AUDIO','APP'])assert.equal(html.split('__M3_'+marker+'__').length-1,1);assert.match(html,/<script type="application\/json" id="m3-payload">__M3_PAYLOAD__<\/script>/);for(const part of ["default-src 'none'","script-src 'unsafe-inline'","style-src 'unsafe-inline'","connect-src 'self'","media-src blob: data:","img-src data:","base-uri 'none'","form-action 'none'"])assert.ok(html.includes(part));assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('<style>'));});
test('all templates are UTF8 without BOM and inline JS parses',()=>{for(const name of ['index.html','style.css','app.js']){const b=fs.readFileSync(path.join(root,name));assert.notEqual(b.subarray(0,3).toString('hex'),'efbbbf');assert.ok(!b.toString('utf8').includes('\ufffd'));}assert.doesNotThrow(()=>new vm.Script(app));});
test('no networking, arbitrary URL loading, whole-file decoding or M2 mock activity',()=>{assert.doesNotMatch(app,/\bfetch\s*\(|WebSocket|XMLHttpRequest|getUserMedia|decodeAudioData|\.arrayBuffer\s*\(|G\.activation|Math\.sin|localStorage|sessionStorage|\.innerHTML/);assert.doesNotMatch(html,/(?:src|href)="https?:/);assert.doesNotMatch(html,/<input[^>]+id="energy"/);assert.match(html,/type="file"[^>]*accept="audio\/\*"/);});
test('first screen has transport and features before collapsible original data',()=>{for(const id of ['audio-file','test-pcm','play','pause','restart','monitor','rms','energy-value','low-value','mid-value','high-value','candidate','onset'])assert.ok(html.includes('id="'+id+'"'));assert.ok(html.indexOf('id="play"')<html.indexOf('id="original-data"'));assert.match(html,/<details id="original-data">/);assert.ok(html.includes('Selected-edge neuropil（唔係點所在位置）'));});
test('initial no-file is paused and silent; context is lazy',()=>{const h=harness();assert.equal(h.logs.contexts.length,0);assert.equal(h.el('audio-player').paused,true);assert.equal(h.el('monitor').checked,false);assert.equal(h.el('gain-input').value,'4');assert.equal(h.el('graph').dataset.sourceState,'no-file');assert.equal(h.el('energy-value').textContent,'0.0000');assert.equal(h.el('candidate').textContent,'HOLD');});
test('wrong M3 scope fails source gate and never initializes audio',()=>{const p=payload();p.scope='M2_OFFLINE_POINT_GRAPH';const h=harness({payload:p});assert.equal(h.el('source-status').getAttribute('role'),'alert');assert.equal(h.logs.contexts.length,0);assert.equal(h.el('play').disabled,true);});
test('M2 dataset verification still rejects numeric IDs in M3',()=>{const p=payload();p.dataset.neurons[0].id=123;const h=harness({payload:p});assert.equal(h.el('source-status').getAttribute('role'),'alert');assert.equal(h.el('test-pcm').disabled,true);});
test('file metadata loads without a context and without private filename in DOM',async()=>{const h=harness();await h.choose();await h.metadata();assert.equal(h.logs.contexts.length,0);assert.equal(h.el('graph').dataset.sourceState,'paused');assert.equal(h.el('play').disabled,false);for(const id of ['source-status','source-kind','audio-help'])assert.ok(!h.el(id).textContent.includes('PRIVATE'));});
test('size guard rejects oversized file without making URL',async()=>{const h=harness();const b=new File(['x'],'private.wav');Object.defineProperty(b,'size',{value:64*1024*1024+1});await h.choose(b);assert.equal(h.logs.urls.length,0);assert.equal(h.el('graph').dataset.sourceState,'error');assert.equal(h.el('candidate').textContent,'HOLD');});
test('invalid metadata is a real error, not ready',async()=>{for(const duration of [NaN,Infinity,-1,0,900.01]){const h=harness();await h.choose();await h.metadata(undefined,duration);assert.equal(h.el('graph').dataset.sourceState,'error');assert.equal(h.el('source-status').getAttribute('role'),'alert');assert.equal(h.el('play').disabled,true);assert.equal(h.logs.revoked.length,1);}});
test('TEST PCM routes encoded Blob through analyser API (Web Audio double)',async()=>{const h=harness();h.el('test-pcm').dispatch('click');await h.flush();assert.equal(h.logs.fixture,1);assert.equal(h.logs.wav,1);assert.match(h.el('source-kind').textContent,/TEST PCM/);await h.metadata();await h.play();h.el('audio-player').currentTime=1.25;h.frame();assert.equal(h.logs.sources.length,1);assert.equal(h.logs.measures.length,1);const m=h.logs.measures[0];assert.ok(m.t instanceof Float32Array);assert.ok(m.f instanceof Float32Array);assert.equal(m.t.length,2048);assert.equal(m.f.length,1024);assert.equal(m.fft,2048);assert.equal(m.sr,48000);assert.equal(h.logs.contexts[0].analyser.smoothingTimeConstant,0);assert.equal(h.logs.advances.at(-1).t,1.25);assert.equal(h.logs.advances.at(-1).gain,4);});
test('source node connects once per element through play-pause-play',async()=>{const h=harness();await h.choose();await h.metadata();await h.play();h.el('pause').dispatch('click');await h.play();assert.equal(h.logs.contexts.length,1);assert.equal(h.logs.sources.length,1);});
test('monitor is gain-muted by default, analysis continues; checkbox enables monitor',async()=>{const h=harness();await h.choose();await h.metadata();await h.play();h.frame();assert.equal(h.logs.contexts[0].monitor.gain.value,0);assert.equal(h.logs.measures.length,1);h.el('monitor').checked=true;h.el('monitor').dispatch('change');assert.equal(h.logs.contexts[0].monitor.gain.value,1);});
test('paused features are frozen and idle rAF does not loop',async()=>{const h=harness();await h.choose();await h.metadata();await h.play();h.el('audio-player').currentTime=2;h.frame();const energy=h.el('energy-value').textContent;h.el('pause').dispatch('click');h.el('audio-player').currentTime=3;h.frame();assert.equal(h.el('energy-value').textContent,energy);assert.equal(h.logs.measures.length,1);assert.equal(h.frames.size,0);});
test('restart pauses source and clears DSP/candidate/onset baseline',async()=>{const h=harness();await h.choose();await h.metadata();await h.play();h.el('audio-player').currentTime=2;h.frame();h.el('restart').dispatch('click');assert.equal(h.el('audio-player').currentTime,0);assert.equal(h.el('audio-player').paused,true);assert.equal(h.el('energy-value').textContent,'0.0000');assert.equal(h.el('candidate').textContent,'HOLD');assert.equal(h.el('onset-count').textContent,'0');});
test('swap resets state, disconnects old source and revokes URL; old events ignored',async()=>{const h=harness();const old=await h.choose();await h.metadata();await h.play();old.currentTime=2;h.frame();await h.choose();old.duration=999;old.dispatch('loadedmetadata');old.dispatch('error');assert.equal(h.logs.sources[0].disconnected,true);assert.equal(h.logs.revoked.length,1);assert.equal(old.paused,true);assert.equal(h.el('graph').dataset.sourceState,'loading');assert.equal(h.el('candidate').textContent,'HOLD');assert.equal(h.el('energy-value').textContent,'0.0000');});
test('late play rejection from replaced source does not poison current selection',async()=>{const h=harness();const old=await h.choose();await h.metadata();let reject;old.playImpl=()=>new Promise((_,r)=>{reject=r;});h.el('play').dispatch('click');await h.flush();await h.choose();reject(new Error('old failure'));await h.flush();assert.equal(h.el('graph').dataset.sourceState,'loading');});
test('missing AudioContext or resume denial is visible and clears source features',async()=>{for(const opts of [{noAudioContext:true},{resumeReject:true}]){const h=harness(opts);await h.choose();await h.metadata();await h.play();assert.equal(h.el('graph').dataset.sourceState,'error');assert.equal(h.el('source-status').getAttribute('role'),'alert');assert.equal(h.el('audio-player').paused,true);assert.equal(h.el('candidate').textContent,'HOLD');}});
test('decoder error pauses and revokes without fake readiness',async()=>{const h=harness();await h.choose();await h.metadata();await h.play();h.el('audio-player').error={code:3};h.el('audio-player').dispatch('error');assert.equal(h.el('graph').dataset.sourceState,'error');assert.equal(h.el('play').disabled,true);assert.equal(h.logs.revoked.length,1);assert.equal(h.el('audio-player').paused,true);});
test('native audio controls also route through guarded lazy context',async()=>{const h=harness();await h.choose();await h.metadata();await h.el('audio-player').play();await h.flush();h.frame();assert.equal(h.logs.sources.length,1);assert.equal(h.logs.contexts[0].monitor.gain.value,0);assert.equal(h.logs.measures.length,1);});
test('WebGL unavailable is accessible, but audio still measures independently',async()=>{const h=harness();assert.equal(h.el('render-status').getAttribute('role'),'alert');assert.equal(h.el('graph').dataset.renderer,'unavailable');await h.choose();await h.metadata();await h.play();h.frame();assert.equal(h.logs.measures.length,1);assert.equal(h.el('graph').dataset.sourceState,'playing');});
test('context-loss API events stop graph draw, not source analysis (WebGL double)',async()=>{const gl=fakeGL();const h=harness({gl});gl.extension={loseContext(){gl.lost=true;h.el('graph').dispatch('webglcontextlost');},restoreContext(){gl.lost=false;h.el('graph').dispatch('webglcontextrestored');}};h.el('graph').dispatch('webglcontextrestored');await h.choose();await h.metadata();await h.play();h.frame();const draws=gl.draws,selected=h.el('neuron').value;h.el('lose-context').dispatch('click');h.el('audio-player').currentTime=2;h.frame();assert.equal(gl.draws,draws);assert.equal(h.el('graph').dataset.renderState,'context-lost');assert.equal(h.logs.measures.length,2);h.el('restore-context').dispatch('click');h.frame();assert.ok(gl.draws>draws);assert.equal(h.el('neuron').value,selected);assert.equal(h.el('graph').dataset.renderState,'draw-submitted');});
test('unsupported loss extension disables diagnostics with explanation',()=>{const h=harness({gl:fakeGL()});assert.equal(h.el('lose-context').disabled,true);assert.equal(h.el('restore-context').disabled,true);assert.match(h.el('diagnostic-status').textContent,/不可用/);});
test('hidden stops UI rAF; resume passes un-clamped audio time to DSP',async()=>{const h=harness();await h.choose();await h.metadata();await h.play();h.el('audio-player').currentTime=1;h.frame();h.document.hidden=true;h.document.dispatch('visibilitychange');assert.equal(h.frames.size,0);h.el('audio-player').currentTime=50;h.document.hidden=false;h.document.dispatch('visibilitychange');h.frame();assert.equal(h.logs.advances.at(-1).t,50);});
test('selection and camera never change candidate; diagnostics stay DOM-readable',async()=>{const h=harness({gl:fakeGL()});await h.choose();await h.metadata();await h.play();h.frame();h.el('pause').dispatch('click');const candidate=h.el('candidate').textContent;h.el('neuron').value=dataset.neurons[1].id;h.el('neuron').dispatch('change');h.el('graph').dispatch('keydown',{key:'ArrowRight'});h.el('zoom-in').dispatch('click');h.frame();assert.equal(h.el('candidate').textContent,candidate);assert.equal(h.el('graph').dataset.selectedId,dataset.neurons[1].id);assert.ok(Number(h.el('graph').dataset.yaw)>0);assert.ok(Number(h.el('graph').dataset.zoom)>1);assert.equal(h.el('graph').dataset.renderer,'native-webgl');assert.equal(h.el('graph').dataset.renderState,'draw-submitted');assert.ok(h.el('selected-signal').textContent.length>0);});
test('pagehide pauses/disposes/revokes and ignores ghost events',async()=>{const h=harness();const old=await h.choose();await h.metadata();await h.play();h.window.dispatch('pagehide');assert.equal(old.paused,true);assert.equal(h.logs.contexts[0].state,'closed');assert.equal(h.logs.revoked.length,1);assert.equal(h.frames.size,0);old.dispatch('play');old.dispatch('loadedmetadata');assert.equal(h.logs.sources.length,1);h.window.dispatch('pageshow');assert.equal(h.el('graph').dataset.sourceState,'no-file');assert.equal(h.el('candidate').textContent,'HOLD');});
test('post-analyser GainNode is the only monitor mute; required diagnostics are DOM attrs',()=>{assert.doesNotMatch(app,/\.muted\s*=/);assert.doesNotMatch(html,/<audio[^>]*\bmuted\b/);assert.ok(app.includes('s.analyser.connect(s.monitorGain)'));assert.ok(app.includes('s.monitorGain.connect(audioContext.destination)'));for(const key of ['source-mode','file-loaded','audio-paused','audio-time','rms','energy','low','mid','high','candidate','onset-count','selected-signal','render-state'])assert.ok(html.includes('data-'+key+'='));});
test('empty or oversized replacement retires old source and clears old features',async()=>{for(const blob of [new File([],'empty.wav'),Object.defineProperty(new File(['x'],'large.wav'),'size',{value:64*1024*1024+1})]){const h=harness();await h.choose();await h.metadata();await h.play();h.frame();await h.choose(blob);assert.equal(h.el('graph').dataset.sourceState,'error');assert.equal(h.el('graph').dataset.fileLoaded,'false');assert.equal(h.el('graph').dataset.audioPaused,'true');assert.equal(h.el('graph').dataset.energy,'0');assert.equal(h.logs.revoked.length,1);assert.equal(h.logs.sources[0].disconnected,true);}});
test('failed current play promise is visible error and revokes its Blob',async()=>{const h=harness();const audio=await h.choose();await h.metadata();audio.playImpl=()=>Promise.reject(new Error('decoder failed'));await h.play();assert.equal(h.el('source-status').getAttribute('role'),'alert');assert.equal(h.el('graph').dataset.sourceState,'error');assert.equal(h.logs.revoked.length,1);assert.equal(h.el('graph').dataset.energy,'0');});
test('custom and native seeking pass actual discontinuous media time to DSP',async()=>{const h=harness();await h.choose();await h.metadata();await h.play();const audio=h.el('audio-player');audio.currentTime=5;h.frame();audio.seeking=true;audio.dispatch('seeking');h.frame();const count=h.logs.measures.length;audio.currentTime=1;audio.seeking=false;audio.dispatch('seeked');h.frame();assert.equal(h.logs.measures.length,count+1);assert.equal(h.logs.advances.at(-1).t,1);});
test('pagehide prevents queued chooser events from creating orphan Blob URLs',async()=>{const h=harness();h.window.dispatch('pagehide');await h.choose();assert.equal(h.logs.urls.length,0);assert.equal(h.frames.size,0);h.window.dispatch('pageshow');assert.equal(h.el('graph').dataset.sourceState,'no-file');});
module.exports={harness,fakeGL,payload};

// Startup regressions: a suspended context may wait for media playback to unlock.
test('resume waiting for media play does not deadlock custom transport',async()=>{
  let release;
  const h=harness({resumeImpl:ctx=>new Promise(resolve=>{release=()=>{ctx.state='running';resolve();};})});
  const media=await h.choose();await h.metadata();
  let calls=0;
  media.playImpl=()=>{calls++;media.paused=false;release();media.dispatch('play');media.dispatch('playing');return Promise.resolve();};
  await h.play();
  assert.equal(calls,1,'play must be invoked before awaiting resume');
  assert.equal(h.el('graph').dataset.sourceState,'playing');
  assert.equal(h.logs.sources.length,1);
});
test('pending resume is bounded and a late completion cannot restart retired audio',async()=>{
  let release;const timers=new Map();let id=0;
  const h=harness({resumeImpl:ctx=>new Promise(resolve=>{release=()=>{ctx.state='running';resolve();};}),setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)});
  const media=await h.choose();await h.metadata();await h.play();
  assert.ok(timers.size>0,'startup needs an explicit deadline');
  for(const fn of [...timers.values()])fn();await h.flush();
  assert.equal(h.el('graph').dataset.sourceState,'error');
  assert.equal(media.paused,true);assert.equal(h.el('candidate').textContent,'HOLD');
  release();await h.flush();assert.equal(media.paused,true);
  assert.equal(h.el('graph').dataset.sourceState,'error');
});
test('pending media play is bounded even when AudioContext is running',async()=>{
  const timers=new Map();let id=0;
  const h=harness({setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)});
  const media=await h.choose();await h.metadata();media.playImpl=()=>new Promise(()=>{});await h.play();
  assert.ok(timers.size>0);for(const fn of [...timers.values()])fn();await h.flush();
  assert.equal(h.el('graph').dataset.sourceState,'error');assert.equal(media.paused,true);
});

test('AudioContext setup failure never calls direct media playback',async()=>{
 const h=harness({noAudioContext:true});const media=await h.choose();await h.metadata();let calls=0;media.playImpl=()=>{calls++;return Promise.resolve();};await h.play();assert.equal(calls,0);assert.equal(h.el('graph').dataset.sourceState,'error');
});
test('queued native play after Pause cannot resurrect startup',async()=>{
 const h=harness();const media=await h.choose();await h.metadata();await h.play();h.el('pause').dispatch('click');media.dispatch('play');media.dispatch('playing');await h.flush();assert.equal(h.el('graph').dataset.sourceState,'paused');assert.equal(media.paused,true);
});
test('native pending resume fails at 3000ms and remains silent',async()=>{
 const timers=new Map();let id=0;const h=harness({resumeImpl:()=>new Promise(()=>{}),setTimeout:(fn,ms)=>{assert.equal(ms,3000);timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 const media=await h.choose();await h.metadata();media.paused=false;media.dispatch('play');await h.flush();assert.ok(timers.size);for(const fn of [...timers.values()])fn();await h.flush();assert.equal(h.el('graph').dataset.sourceState,'error');assert.equal(media.paused,true);
});
test('old pending action timeout cannot poison Pause then Play',async()=>{
 const timers=new Map();let id=0;let rejectOld;const h=harness({setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 const media=await h.choose();await h.metadata();media.playImpl=()=>new Promise((_,reject)=>{rejectOld=reject;});await h.play();const oldTimers=[...timers.values()];h.el('pause').dispatch('click');media.playImpl=null;await h.play();assert.equal(h.el('graph').dataset.sourceState,'playing');for(const fn of oldTimers)fn();rejectOld(new Error('old failure'));await h.flush();assert.equal(h.el('graph').dataset.sourceState,'playing');assert.equal(media.paused,false);
});
test('pagehide and replacement ignore pending activation completion',async()=>{
 let release;const h=harness({resumeImpl:ctx=>new Promise(resolve=>{release=()=>{ctx.state='running';resolve();};})});const media=await h.choose();await h.metadata();await h.play();h.window.dispatch('pagehide');release();await h.flush();assert.equal(media.paused,true);assert.equal(h.logs.revoked.length,1);assert.notEqual(h.el('graph').dataset.sourceState,'playing');
});
