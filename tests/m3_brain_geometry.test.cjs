'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.join(__dirname, '../src/flyvj_m3/ui/brain-geometry.js');
const geometry = require(file);
const options = {profile: 'performance', seed: 783};
function finite(array) { for (const value of array) assert.ok(Number.isFinite(value)); }
function inBounds(xyz, bounds) {
  xyz.forEach((v, i) => assert.ok(v >= bounds.min[i] - 1e-6 && v <= bounds.max[i] + 1e-6));
}

test('CommonJS and DOM-free UMD expose exactly the model functions', () => {
  assert.equal(typeof geometry.createModel, 'function');
  assert.equal(typeof geometry.fillPulses, 'function');
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /Math\.random|\b(document|fetch|XMLHttpRequest)\b/);
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.FlyVJBrainGeometry.createModel, 'function');
  assert.equal(sandbox.FlyVJBrainGeometry.createModel(options).counts.neurons, 84);
});

test('both profiles have exact typed-array strides, counts and bounded dense branches', () => {
  for (const profile of ['performance', 'cinematic']) {
    const m = geometry.createModel({profile, seed: 783});
    assert.equal(m.profile, profile); assert.equal(m.seed, 783);
    assert.equal(m.semantics, 'PROCEDURAL_ILLUSTRATION_NOT_CONNECTOME');
    assert.match(m.illustrationDescription, /purely procedural/i);
    assert.equal(m.counts.neurons, profile === 'performance' ? 84 : 168);
    assert.ok(m.shell instanceof Float32Array); assert.ok(m.fibers instanceof Float32Array);
    assert.ok(m.somata instanceof Float32Array);
    assert.equal(m.shell.length, m.counts.shellTriangles * 18);
    assert.equal(m.fibers.length, m.counts.lineSegments * 10);
    assert.equal(m.somata.length, m.counts.neurons * 4);
    assert.equal(m.paths.length, m.counts.neurons * 4);
    assert.ok(m.counts.lineSegments >= m.counts.neurons * 50);
    assert.ok(m.counts.lineSegments <= 12000);
    finite(m.shell); finite(m.fibers); finite(m.somata);
    const limits = [1.7, .9, .8];
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(m.bounds.min[axis] >= -limits[axis]);
      assert.ok(m.bounds.max[axis] <= limits[axis]);
      assert.ok(m.bounds.max[axis] - m.bounds.min[axis] > [3, 1.4, 1.2][axis]);
    }
    for (const [array, stride] of [[m.shell, 6], [m.fibers, 5], [m.somata, 4]]) {
      for (let i = 0; i < array.length; i += stride) inBounds(Array.from(array.slice(i, i + 3)), m.bounds);
    }
  }
});

test('seed is byte deterministic, changes fibers, and cinematic adds mesh and path detail', () => {
  const a = geometry.createModel(options), b = geometry.createModel(options);
  for (const key of ['shell', 'fibers', 'somata']) assert.deepEqual(a[key], b[key]);
  assert.deepEqual(a.paths, b.paths); assert.deepEqual(a.bounds, b.bounds);
  assert.notDeepEqual(a.fibers, geometry.createModel({...options, seed: 784}).fibers);
  const c = geometry.createModel({profile: 'cinematic', seed: 783});
  assert.ok(c.counts.shellTriangles > a.counts.shellTriangles);
  assert.ok(c.counts.lineSegments > a.counts.lineSegments);
  assert.ok(c.paths[0].points.length > a.paths[0].points.length);
});

test('shell has two large lateral lobes, central body, depth, unit outward normals and valid triangles', () => {
  const m = geometry.createModel(options);
  const zones = [{x: -.94, rx: .70, ry: .82, rz: .70}, {x: .94, rx: .70, ry: .82, rz: .70}, {x: 0, rx: .61, ry: .62, rz: .55}];
  const hits = [0, 0, 0];
  for (let i = 0; i < m.shell.length; i += 6) {
    const [x,y,z,nx,ny,nz] = m.shell.slice(i,i+6);
    assert.ok(Math.abs(Math.hypot(nx,ny,nz) - 1) < 1e-5);
    const zone = zones.findIndex(q => Math.abs(((x-q.x)/q.rx)**2+(y/q.ry)**2+(z/q.rz)**2-1) < 1e-5);
    assert.ok(zone >= 0); hits[zone]++;
    assert.ok((x-zones[zone].x)*nx+y*ny+z*nz > 0);
  }
  hits.forEach(count => assert.ok(count > 500));
  for (let i=0;i<m.shell.length;i+=18) {
    const a=m.shell.slice(i,i+3), b=m.shell.slice(i+6,i+9), c=m.shell.slice(i+12,i+15);
    const u=b.map((v,j)=>v-a[j]), v=c.map((w,j)=>w-a[j]);
    const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    assert.ok(Math.hypot(...cross)>1e-7);
    assert.ok(cross.reduce((sum,w,j)=>sum+w*m.shell[i+3+j],0)>0);
  }
});

test('paths are curved, depthful branches with matching batch fibers and soma roots', () => {
  const m = geometry.createModel(options); let cursor = 0;
  for (let n=0;n<m.counts.neurons;n++) {
    const group=m.paths.slice(n*4,n*4+4), trunk=group[0];
    assert.deepEqual(Array.from(m.somata.slice(n*4,n*4+3)), trunk.points[0].map(Math.fround));
    for (const branch of group.slice(1)) assert.ok(trunk.points.some(p=>p.every((v,j)=>v===branch.points[0][j])));
  }
  for (const p of m.paths) {
    assert.ok([0,1,2].includes(p.band)); assert.ok(p.phase>=0 && p.phase<=1);
    assert.ok(p.points.length >= 15);
    const first=p.points[0], last=p.points.at(-1), d=last.map((v,i)=>v-first[i]);
    const curved=p.points.some(q=>{
      const a=q.map((v,i)=>v-first[i]);
      return Math.hypot(a[1]*d[2]-a[2]*d[1],a[2]*d[0]-a[0]*d[2],a[0]*d[1]-a[1]*d[0]) > .001;
    });
    assert.ok(curved); assert.ok(Math.max(...p.points.map(q=>q[2]))-Math.min(...p.points.map(q=>q[2]))>.01);
    p.points.forEach(q=>{finite(q);inBounds(q,m.bounds);});
    for(let i=1;i<p.points.length;i++) {
      for(const q of [p.points[i-1],p.points[i]]) {
        assert.deepEqual(Array.from(m.fibers.slice(cursor,cursor+5)), [...q,p.band,p.phase].map(Math.fround)); cursor+=5;
      }
    }
  }
  assert.equal(cursor,m.fibers.length);
});

test('pulses reuse exact caller buffer, zero bands hide, and activity never leaks across bands', () => {
  const m=geometry.createModel(options), target=new Float32Array(m.paths.length*5);
  assert.equal(geometry.fillPulses(m,2,[0,0,0],target),target);
  for(let i=0;i<m.paths.length;i++) assert.equal(target[i*5+4],0);
  geometry.fillPulses(m,2,[.25,0,1],target);
  for(let i=0;i<m.paths.length;i++) {
    assert.equal(target[i*5+3],m.paths[i].band);
    assert.equal(target[i*5+4],[.25,0,1][m.paths[i].band]);
    inBounds(Array.from(target.slice(i*5,i*5+3)),m.bounds);
  }
});

test('fixed time is stable, motion stays on paths, and pulse sampling never mutates geometry', () => {
  const m=geometry.createModel(options);
  const before={shell:m.shell.slice(),fibers:m.fibers.slice(),somata:m.somata.slice(),paths:structuredClone(m.paths)};
  const a=new Float32Array(m.paths.length*5), b=a.slice();
  geometry.fillPulses(m,1,[1,1,1],a); geometry.fillPulses(m,1,[1,1,1],b); assert.deepEqual(a,b);
  geometry.fillPulses(m,2,[1,1,1],b); assert.notDeepEqual(a,b);
  for(const time of [0,.25,10,1e9,Number.MAX_VALUE]) { geometry.fillPulses(m,time,[1,1,1],b);finite(b); }
  for(const key of ['shell','fibers','somata','paths']) assert.deepEqual(m[key],before[key]);
});

test('invalid profiles, seeds and options are rejected', () => {
  for(const profile of ['Performance','bad','',null,0]) assert.throws(()=>geometry.createModel({profile,seed:783}));
  for(const seed of [NaN,Infinity,1.5,'783',null,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>geometry.createModel({profile:'performance',seed}));
  for(const arg of [null,[],42,'x']) assert.throws(()=>geometry.createModel(arg));
});

test('invalid pulse inputs reject without partially writing target', () => {
  const m=geometry.createModel(options), target=new Float32Array(m.paths.length*5).fill(99);
  for(const time of [-1,NaN,Infinity,'1',null]) assert.throws(()=>geometry.fillPulses(m,time,[0,0,0],target));
  for(const bands of [null,[],[0,0],[0,0,0,0],[-.1,0,0],[0,1.1,0],[0,NaN,0],[0,Infinity,0],['0',0,0]]) assert.throws(()=>geometry.fillPulses(m,0,bands,target));
  for(const bad of [null,[],new Float64Array(target.length),new Float32Array(target.length-1),new Float32Array(target.length+1)]) assert.throws(()=>geometry.fillPulses(m,0,[0,0,0],bad));
  assert.throws(()=>geometry.fillPulses({},0,[0,0,0],target));
  assert.ok(target.every(v=>v===99));
});

test('both profiles sample actual line segments, including typed bands and wrap boundaries', () => {
  for (const profile of ['performance','cinematic']) {
    const m=geometry.createModel({profile,seed:783}), target=new Float32Array(m.paths.length*5);
    for (const time of [0,4.999999,5,9.999999,10,100.375]) {
      geometry.fillPulses(m,time,new Float32Array([0,.5,1]),target);
      for (let i=0;i<m.paths.length;i++) {
        const q=Array.from(target.slice(i*5,i*5+3)), points=m.paths[i].points;
        assert.ok(points.slice(1).some((end,j)=>{
          const start=points[j], delta=end.map((v,k)=>v-start[k]);
          const length2=delta.reduce((sum,v)=>sum+v*v,0);
          const t=q.reduce((sum,v,k)=>sum+(v-start[k])*delta[k],0)/length2;
          return t>=-1e-5 && t<=1+1e-5 && Math.hypot(...q.map((v,k)=>v-start[k]-t*delta[k]))<2e-6;
        }));
        assert.equal(target[i*5+4],[0,.5,1][m.paths[i].band]);
      }
    }
  }
});

test('band buffer aliasing cannot change activity while target is filled', () => {
  const m=geometry.createModel(options), target=new Float32Array(m.paths.length*5);
  target.set([0,.5,1]);
  geometry.fillPulses(m,3,target.subarray(0,3),target);
  for(let i=0;i<m.paths.length;i++) assert.equal(target[i*5+4],[0,.5,1][m.paths[i].band]);
});

test('target aliasing a geometry buffer is rejected before mutation', () => {
  const m=geometry.createModel(options), before=m.fibers.slice();
  const target=new Float32Array(m.fibers.buffer,0,m.paths.length*5);
  assert.throws(()=>geometry.fillPulses(m,0,[1,1,1],target));
  assert.deepEqual(m.fibers,before);
});

