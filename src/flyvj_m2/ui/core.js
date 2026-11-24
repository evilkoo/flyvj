(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FlyVJM2=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const fail=m=>{throw new TypeError(m);};
const num=(v,min=-Infinity,max=Infinity)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail('Invalid finite numeric parameter');return v;};
const id=v=>{if(typeof v!=='string'||!v.trim())fail('ID must be an exact nonempty string');return v;};
const vector=p=>{if(!Array.isArray(p)||p.length!==3)fail('Expected 3D coordinates');p.forEach(v=>num(v));};
function column(e){num(e,0,1);return e<.4?1:e<.75?2:3;}
function validatePayload(p){
 if(!p||p.schema_version!==1||p.scope!=='M2_OFFLINE_POINT_GRAPH')fail('Unsupported payload');
 if(!p.source_check||p.source_check.verified!==true)fail('Source verification required');
 if(typeof p.dataset_fingerprint!=='string'||!p.dataset_fingerprint.trim())fail('Missing fingerprint');
 const d=p.dataset;
 if(!d||d.schema_version!==1||!d.coordinates||d.coordinates.units!=='nm'||typeof d.coordinates.frame!=='string'||!d.provenance||d.provenance.kind!=='real')fail('Invalid original dataset metadata');
 for(const k of ['name','version','source','license'])if(typeof d.provenance[k]!=='string'||!d.provenance[k])fail('Missing provenance');
 if(!Array.isArray(d.neurons)||!d.neurons.length||!Array.isArray(d.connections))fail('Invalid graph');
 const ids=new Set();d.neurons.forEach(n=>{id(n.id);if(ids.has(n.id))fail('Duplicate ID');ids.add(n.id);vector(n.position);if(typeof n.region!=='string'||!n.region)fail('Missing region');});
 d.connections.forEach(e=>{id(e.pre_id);id(e.post_id);if(!ids.has(e.pre_id)||!ids.has(e.post_id))fail('Unknown endpoint');num(e.weight,0,Number.MAX_SAFE_INTEGER);if(!Number.isInteger(e.weight))fail('Synapse count must be integer');});
 if(!Array.isArray(p.render_order)||p.render_order.length!==ids.size||p.render_order.some((v,i)=>v!==d.neurons[d.neurons.length-1-i].id))fail('Expected all exact IDs in reversed render order');
 if(!Array.isArray(p.rule_examples))fail('Missing rule examples');p.rule_examples.forEach(r=>{if(!r||r.column!==column(r.energy)||typeof r.reason!=='string'||!r.reason)fail('Invalid rule example');});
 return p;
}
function normalize(neurons){
 if(!Array.isArray(neurons)||!neurons.length)fail('Empty points');const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 neurons.forEach(n=>{id(n.id);vector(n.position);n.position.forEach((v,i)=>{lo[i]=Math.min(lo[i],v);hi[i]=Math.max(hi[i],v);});});
 const center=lo.map((v,i)=>v/2+hi[i]/2);const extent=Math.max(...hi.map((v,i)=>v-lo[i]));num(extent,0);const scale=extent?1.6/extent:1;num(scale,0);
 return {center,scale,points:neurons.map(n=>({...n,position:n.position.map((v,i)=>(v-center[i])*scale)}))};
}
const camera=()=>({yaw:0,pitch:0,zoom:1});
function project(p,c,w,h){
 vector(p);num(w,Number.MIN_VALUE);num(h,Number.MIN_VALUE);num(c.yaw);num(c.pitch);num(c.zoom,.2,5);
 const cy=Math.cos(c.yaw),sy=Math.sin(c.yaw),cp=Math.cos(c.pitch),sp=Math.sin(c.pitch);
 const x=p[0]*cy+p[2]*sy,z=-p[0]*sy+p[2]*cy,y=p[1]*cp-z*sp,depth=p[1]*sp+z*cp;
 const nx=x*c.zoom*h/w,ny=y*c.zoom;
 return {x:(nx+1)*w/2,y:(1-ny)*h/2,z:depth,visible:Math.abs(nx)<=1&&Math.abs(ny)<=1&&Math.abs(depth)<=10};
}
function pick(points,c,w,h,x,y,radius=12){
 num(x);num(y);num(radius,0);let best=null;
 points.forEach(n=>{id(n.id);const p=project(n.position,c,w,h),distance=Math.hypot(p.x-x,p.y-y);if(p.visible&&distance<=radius&&(!best||distance<best.distance||(distance===best.distance&&(p.z<best.z||(p.z===best.z&&n.id<best.id)))))best={id:n.id,distance,z:p.z};});return best?best.id:null;
}
const reset=()=>({time:0,energy:0,speed:1,playing:false});
function step(s,dt,visible=true){num(s.time,0);num(s.energy,0,1);num(s.speed,.1,4);num(dt,0);if(typeof s.playing!=='boolean'||typeof visible!=='boolean')fail('Invalid simulation state');return {...s,time:s.time+(s.playing&&visible?Math.min(dt,.05)*s.speed:0)};}
function activation(neuronId,time,energy){id(neuronId);num(time,0);num(energy,0,1);let hash=2166136261;for(let i=0;i<neuronId.length;i++){hash^=neuronId.charCodeAt(i);hash=Math.imul(hash,16777619);}return energy*(.25+.75*(.5+.5*Math.sin(time*1.7+(hash>>>0)/4294967296*Math.PI*2)));}
function selectedEdges(d,selected){id(selected);if(!d.neurons.some(n=>n.id===selected))fail('Unknown selected ID');const lookup=new Map(d.neurons.map(n=>[n.id,n]));return d.connections.filter(e=>e.pre_id===selected||e.post_id===selected).map(e=>({...e,direction:e.pre_id===selected?'outgoing':'incoming',neuropil:lookup.get(e.pre_id).region===lookup.get(e.post_id).region?lookup.get(e.pre_id).region:'not specified — do not infer across regions'}));}
return {validatePayload,normalize,column,camera,project,pick,reset,step,activation,selectedEdges};
});
