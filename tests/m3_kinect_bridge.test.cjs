'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Bridge=require('../src/flyvj_m3/ui/mic-bridge.js');
const snap=(time=0)=>({state:'running',active:true,device:{index:0,name:'Azure Kinect Microphone Array'},time,rms:.2,bands:{low:.1,mid:.2,high:.3},clipping:false,sample_rate:48000,frame_size:2048,frames:Math.round(time*48000/2048),error:null});
const off=()=>({...snap(),state:'off',active:false,device:null,rms:0,bands:{low:0,mid:0,high:0}});
function setup(overrides={}){const calls=[],timers=[],samples=[];const fetch=async(url,opt)=>{calls.push({url,...opt});if(overrides[url]){const result=await overrides[url](opt);return {ok:true,json:async()=>result};}return {ok:true,json:async()=>url.endsWith('config')?{token:'SECRET'}:url.endsWith('devices')?{devices:[{index:0,name:'Azure Kinect Microphone Array'},{index:1,name:'Default'}]}:url.endsWith('start')?{...snap(),session:'PRIVATE'}:url.endsWith('stop')?off():snap(2048/48000)};};const b=new Bridge({origin:'http://127.0.0.1:8765',fetch,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},onSample:s=>samples.push(s)});return {b,calls,timers,samples};}
test('constructor capture-free; file and non-loopback disabled',async()=>{const h=setup();assert.equal(h.calls.length,0);for(const origin of ['file://','http://localhost:8765','https://127.0.0.1:8765']){const b=new Bridge({origin,fetch:()=>assert.fail()});assert.equal(b.publicState().state,'disabled');await b.start(0);}});
test('scan Azure only and manual authenticated start/stop',async()=>{const h=setup();assert.equal((await h.b.scan()).length,1);await h.b.start(0);assert.deepEqual(JSON.parse(h.calls.find(c=>c.url.endsWith('start')).body),{index:0});await h.timers.at(-1)();assert.equal(h.calls.at(-1).headers['X-FlyVJ-Mic'],'PRIVATE');assert.equal(h.samples.length,1);assert.doesNotMatch(JSON.stringify(h.b.publicState()),/SECRET|PRIVATE|session|token/);await h.b.stop();assert.deepEqual(JSON.parse(h.calls.at(-1).body),{session:'PRIVATE'});assert.equal(h.b.publicState().state,'off');});
test('late start after stop is closed with private session and never emits',async()=>{let resolve;const h=setup({'/mic/start':()=>new Promise(r=>resolve=r)});const start=h.b.start(0);for(let i=0;i<12;i++)await Promise.resolve();const stop=h.b.stop();resolve({...snap(),session:'PRIVATE'});await Promise.all([start,stop]);assert.equal(h.calls.at(-1).url,'/mic/stop');assert.equal(h.samples.length,0);assert.equal(h.b.publicState().state,'off');});
test('inflight status ignored after stop',async()=>{let resolve;const h=setup({'/mic/status':()=>new Promise(r=>resolve=r)});await h.b.start(0);const poll=h.timers.at(-1)();await h.b.stop();resolve(snap(2048/48000));await poll;assert.equal(h.samples.length,0);});
test('invalid snapshot is error not fake off',async()=>{const h=setup({'/mic/stop':()=>({state:'off'})});await h.b.start(0);await h.b.stop();assert.equal(h.b.publicState().state,'error');assert.notEqual(h.b.publicState().active,false);});
test('network failure preserves unknown closure',async()=>{const h=setup({'/mic/stop':()=>{throw Error('PRIVATE');}});await h.b.start(0);await h.b.stop();assert.equal(h.b.publicState().state,'unknown');assert.doesNotMatch(JSON.stringify(h.b.publicState()),/PRIVATE/);});
test('duplicate PCM sample not emitted twice',async()=>{const h=setup();await h.b.start(0);await h.timers.at(-1)();await h.timers.at(-1)();assert.equal(h.samples.length,1);});
test('stop during config before native start is confirmed OFF without capture',async()=>{let resolve;const h=setup({'/mic/config':()=>new Promise(r=>resolve=r)});const start=h.b.start(0);await Promise.resolve();const stop=h.b.stop();resolve({token:'SECRET'});await Promise.all([start,stop]);assert.equal(h.b.publicState().state,'off');assert.equal(h.calls.filter(c=>c.url.endsWith('start')).length,0);});
test('stop prevents restarting while start/cleanup is unresolved',async()=>{let resolve;const h=setup({'/mic/start':()=>new Promise(r=>resolve=r)});const a=h.b.start(0);for(let i=0;i<12;i++)await Promise.resolve();const stopping=h.b.stop();await h.b.start(0);assert.equal(h.calls.filter(c=>c.url.endsWith('start')).length,1);resolve({...snap(),session:'PRIVATE'});await Promise.all([a,stopping]);});
test('malformed start with valid private session can still be stopped',async()=>{const h=setup({'/mic/start':()=>({session:'PRIVATE',state:'running',active:true})});await h.b.start(0);assert.equal(h.b.publicState().state,'error');await h.b.stop();assert.equal(h.b.publicState().state,'off');});
test('invalid running status clears state and never emits fake features',async()=>{const h=setup({'/mic/status':()=>({...snap(),rms:NaN})});await h.b.start(0);await h.timers.at(-1)();assert.equal(h.b.publicState().state,'error');assert.equal(h.samples.length,0);});
test('native error is not replaced with OFF',async()=>{const h=setup({'/mic/status':()=>({...snap(),state:'error',error:'driver failure'})});await h.b.start(0);await h.timers.at(-1)();assert.equal(h.b.publicState().state,'error');assert.equal(h.b.publicState().active,true);});
test('public state copy cannot mutate internal device and session',async()=>{const h=setup();await h.b.start(0);const p=h.b.publicState();p.device.name='DEFAULT';assert.match(h.b.publicState().device.name,/Azure/);});
test('sample clock consistency rejects seconds computed from block count as samples',async()=>{const h=setup({'/mic/status':()=>({...snap(2048/48000),time:1/48000})});await h.b.start(0);await h.timers.at(-1)();assert.equal(h.samples.length,0);assert.equal(h.b.publicState().state,'error');});
test('unknown lost start reply can recover only after authenticated stop confirmation',async()=>{const h=setup({'/mic/start':()=>{throw Error('lost response');}});await h.b.start(0);assert.equal(h.b.publicState().state,'unknown');await h.b.stop();assert.equal(h.calls.at(-1).url,'/mic/stop');assert.equal(h.b.publicState().state,'off');});
test('late start cleanup preserves native error even with closed handle',async()=>{let resolve;const h=setup({'/mic/start':()=>new Promise(r=>resolve=r),'/mic/stop':()=>({...off(),state:'error'})});const start=h.b.start(0);for(let i=0;i<12;i++)await Promise.resolve();const stop=h.b.stop();resolve({...snap(),session:'PRIVATE'});await Promise.all([start,stop]);assert.equal(h.b.publicState().state,'error');});
test('config same-origin, all operations authenticated, polling bounded below lease',async()=>{const h=setup();await h.b.scan();await h.b.start(0);for(const c of h.calls){assert.equal(c.mode,'same-origin');assert.equal(c.redirect,'error');assert.equal(c.cache,'no-store');if(!c.url.endsWith('config'))assert.equal(c.headers['X-FlyVJ-Token'],'SECRET');}await h.b.stop();assert.equal(h.calls.at(-1).keepalive,true);});
test('concurrent stop callers share one native close request',async()=>{let resolve;const h=setup({'/mic/stop':()=>new Promise(r=>resolve=r)});await h.b.start(0);const one=h.b.stop(),two=h.b.stop();for(let i=0;i<12;i++)await Promise.resolve();assert.equal(h.calls.filter(c=>c.url.endsWith('stop')).length,1);resolve(off());await Promise.all([one,two]);});
test('off status releases private server session before another explicit start',async()=>{const h=setup({'/mic/status':()=>off()});await h.b.start(0);await h.timers.at(-1)();await h.b.start(0);assert.equal(h.calls.filter(c=>c.url.endsWith('start')).length,2);});
// Manual scheduler: request deadlines never sleep, and are separate from heartbeat timers.
function deadlineHarness(hangPath,hangBody=false){
  const deadlines=new Map(),polls=new Map(),calls=[],samples=[],states=[];let id=0,resolveLate;
  const response=data=>({ok:true,json:async()=>data});
  const late=new Promise(r=>resolveLate=r);
  const b=new Bridge({origin:'http://127.0.0.1:8765',requestTimeoutMs:3000,
    setRequestTimeout(fn,ms){assert.equal(ms,3000);deadlines.set(++id,fn);return id;},clearRequestTimeout(i){deadlines.delete(i);},
    setTimeout(fn){polls.set(++id,fn);return id;},clearTimeout(i){polls.delete(i);},
    onState:s=>states.push(s),onSample:s=>samples.push(s),
    fetch:async(path,options)=>{calls.push({path,signal:options.signal});if((Array.isArray(hangPath)?hangPath.includes(path):path===hangPath))return hangBody?{ok:true,json:()=>late}:late;
      return response(path.endsWith('config')?{token:'SECRET'}:path.endsWith('start')?{...snap(),session:'PRIVATE'}:path.endsWith('stop')?off():snap(2048/48000));}});
  const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
  const expire=()=>{assert.equal(deadlines.size,1,'exactly one request deadline');[...deadlines.values()][0]();};
  const poll=()=>{assert.equal(polls.size,1);const [key,fn]=[...polls][0];polls.delete(key);return fn();};
  return {b,deadlines,polls,calls,samples,states,flush,expire,poll,resolveLate,response};
}
test('timeout aborts hung start, clears timer, stays unknown and ignores late response',async()=>{
  const h=deadlineHarness('/mic/start');assert.equal(h.calls.length,0);assert.equal(h.deadlines.size,0);
  const start=h.b.start(0);await h.flush();h.expire();await start;
  assert.equal(h.calls.at(-1).signal.aborted,true);assert.equal(h.deadlines.size,0);assert.equal(h.b.publicState().state,'unknown');
  h.resolveLate(h.response({...snap(),session:'PRIVATE'}));await h.flush();assert.equal(h.b.publicState().state,'unknown');assert.equal(h.polls.size,0);assert.equal(h.samples.length,0);
  assert.doesNotMatch(JSON.stringify(h.states),/SECRET|PRIVATE|token|session/);
});
test('stop during hung start settles after deadline and authenticated close, not forever',async()=>{
  const h=deadlineHarness('/mic/start');const start=h.b.start(0);await h.flush();const stop=h.b.stop();await h.flush();h.expire();await Promise.all([start,stop]);
  assert.equal(h.calls.at(-1).path,'/mic/stop');assert.equal(h.b.publicState().state,'off');assert.equal(h.deadlines.size,0);
  h.resolveLate(h.response({...snap(),session:'PRIVATE'}));await h.flush();assert.equal(h.b.publicState().state,'off');assert.equal(h.polls.size,0);
});
test('hung stop cannot report OFF or permit a fresh start',async()=>{
  const h=deadlineHarness('/mic/stop');await h.b.start(0);const stopping=h.b.stop();await h.flush();h.expire();await stopping;
  assert.equal(h.b.publicState().state,'unknown');assert.equal(h.b.publicState().active,null);await h.b.start(0);assert.equal(h.calls.filter(c=>c.path==='/mic/start').length,1);
  h.resolveLate(h.response(off()));await h.flush();assert.equal(h.b.publicState().state,'unknown');assert.equal(h.deadlines.size,0);
});
test('status body deadline aborts, stops heartbeat and ignores late aggregates',async()=>{
  const h=deadlineHarness('/mic/status',true);await h.b.start(0);const poll=h.poll();await h.flush();h.expire();await poll;
  assert.equal(h.calls.at(-1).signal.aborted,true);assert.equal(h.b.publicState().state,'unknown');assert.equal(h.polls.size,0);assert.equal(h.deadlines.size,0);
  h.resolveLate(snap(2048/48000));await h.flush();assert.equal(h.samples.length,0);assert.equal(h.b.publicState().state,'unknown');
  await h.b.stop();assert.equal(h.b.publicState().state,'off');
});
test('successful requests clear every deadline and maintain one heartbeat',async()=>{
  const h=deadlineHarness('never');await h.b.start(0);assert.equal(h.deadlines.size,0);assert.equal(h.polls.size,1);assert.ok(h.calls.every(c=>c.signal instanceof AbortSignal));
  await h.poll();assert.equal(h.deadlines.size,0);assert.equal(h.polls.size,1);await h.b.stop();assert.equal(h.deadlines.size,0);assert.equal(h.polls.size,0);
});
test('hung start and hung cleanup both expire; stop resolves unknown without guessing closure',async()=>{
  const h=deadlineHarness(['/mic/start','/mic/stop']);const start=h.b.start(0);await h.flush();const stop=h.b.stop();h.expire();await h.flush();
  assert.equal(h.calls.at(-1).path,'/mic/stop');h.expire();await Promise.all([start,stop]);assert.equal(h.b.publicState().state,'unknown');assert.equal(h.b.publicState().active,null);assert.equal(h.deadlines.size,0);assert.equal(h.polls.size,0);
});
test('hung config expires without any native start and does not leak a late token',async()=>{
  const h=deadlineHarness('/mic/config');const start=h.b.start(0);await h.flush();h.expire();await start;
  assert.equal(h.b.publicState().state,'unknown');assert.equal(h.calls.length,1);assert.equal(h.deadlines.size,0);
  h.resolveLate(h.response({token:'SECRET'}));await h.flush();assert.equal(h.calls.length,1);assert.doesNotMatch(JSON.stringify(h.states),/SECRET|PRIVATE|token|session/);
});
const qcFlush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
test('FQC-01 poll-off cleanup and explicit stop share one close request',async()=>{
  let release,stopCalls=0,inflight=0,maxInflight=0;
  const gate=new Promise(resolve=>release=resolve);
  const h=setup({'/mic/status':()=>off(),'/mic/stop':async()=>{stopCalls++;inflight++;maxInflight=Math.max(maxInflight,inflight);try{return await gate;}finally{inflight--;}}});
  await h.b.start(0);const poll=h.timers.at(-1)();await qcFlush();
  const explicit=h.b.stop(),secondExplicit=h.b.stop();await qcFlush();
  try{assert.equal(stopCalls,1);assert.equal(maxInflight,1);}
  finally{release(off());await Promise.all([poll,explicit,secondExplicit]);}
  assert.equal(h.b.publicState().state,'off');assert.equal(h.samples.length,0);
  assert.doesNotMatch(JSON.stringify(h.b.publicState()),/SECRET|PRIVATE|token|session/);
});
test('FQC-01 shared close failure stays unknown, releases single-flight and permits explicit retry',async()=>{
  let reject,stopCalls=0,failClose=true;
  const gate=new Promise((_,r)=>reject=r);
  const h=setup({'/mic/status':()=>off(),'/mic/stop':()=>{stopCalls++;return failClose?gate:off();}});
  await h.b.start(0);const poll=h.timers.at(-1)();await qcFlush();const explicit=h.b.stop();await qcFlush();
  try{assert.equal(stopCalls,1);}
  finally{reject(new Error('synthetic-close-fault'));await Promise.all([poll,explicit]);}
  assert.equal(h.b.publicState().state,'unknown');assert.equal(h.b.publicState().active,null);assert.equal(h.samples.length,0);
  failClose=false;await h.b.stop();assert.equal(stopCalls,2);assert.equal(h.b.publicState().state,'off');
});
