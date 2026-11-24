/* Purely procedural illustration: no source neurons or anatomical registration. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlyVJBrainGeometry = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var models = new WeakSet();
  var SEMANTICS = 'PROCEDURAL_ILLUSTRATION_NOT_CONNECTOME';
  var ILLUSTRATION_DESCRIPTION = 'Brain purely procedural; optic-like lobes and central body are schematic, not anatomical registration or source neurons.';
  var LOBES = [
    { x: -0.94, rx: 0.70, ry: 0.82, rz: 0.70 },
    { x: 0.94, rx: 0.70, ry: 0.82, rz: 0.70 },
    { x: 0, rx: 0.61, ry: 0.62, rz: 0.55 }
  ];

  // Integer-only PRNG state; fold high bits so safe-integer seeds are not truncated.
  function randomFor(seed) {
    var state = ((seed >>> 0) ^ (Math.floor(seed / 4294967296) >>> 0)) >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function surface(lobe, latitude, longitude, rows, columns) {
    var theta = Math.PI * latitude / rows;
    var phi = 2 * Math.PI * longitude / columns;
    var dx = Math.sin(theta) * Math.cos(phi);
    var dy = Math.cos(theta);
    var dz = Math.sin(theta) * Math.sin(phi);
    var nx = dx / lobe.rx, ny = dy / lobe.ry, nz = dz / lobe.rz;
    var length = Math.hypot(nx, ny, nz);
    return [lobe.x + lobe.rx * dx, lobe.ry * dy, lobe.rz * dz,
      nx / length, ny / length, nz / length];
  }

  function triangle(mesh, a, b, c) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var facing = (uy * vz - uz * vy) * a[3] + (uz * vx - ux * vz) * a[4] + (ux * vy - uy * vx) * a[5];
    if (facing < 0) { var swap = b; b = c; c = swap; }
    mesh.push.apply(mesh, a); mesh.push.apply(mesh, b); mesh.push.apply(mesh, c);
  }

  function makeShell(rows, columns) {
    var mesh = [];
    LOBES.forEach(function (lobe) {
      for (var row = 0; row < rows; row++) {
        for (var col = 0; col < columns; col++) {
          var a = surface(lobe, row, col, rows, columns);
          var b = surface(lobe, row + 1, col, rows, columns);
          var c = surface(lobe, row + 1, col + 1, rows, columns);
          var d = surface(lobe, row, col + 1, rows, columns);
          // One triangle at each pole, avoiding degenerate duplicated pole vertices.
          if (row > 0) triangle(mesh, a, b, d);
          if (row < rows - 1) triangle(mesh, d, b, c);
        }
      }
    });
    return new Float32Array(mesh);
  }

  function bounded(point) {
    var limits = [1.60, 0.78, 0.65];
    return point.map(function (v, axis) { return Math.max(-limits[axis], Math.min(limits[axis], v)); });
  }

  function interior(lobe, random) {
    var y = random() * 1.6 - 0.8;
    var angle = random() * 2 * Math.PI;
    var radius = 0.45 + random() * 0.35;
    var ring = Math.sqrt(1 - y * y);
    return [lobe.x + lobe.rx * ring * Math.cos(angle) * radius,
      lobe.ry * y * radius, lobe.rz * ring * Math.sin(angle) * radius];
  }

  function curve(start, end, segments, random, band, phase) {
    var bend = (random() < 0.5 ? -1 : 1) * (0.18 + random() * 0.22);
    var c1 = bounded([
      start[0] * 0.72 + end[0] * 0.28 + (random() - 0.5) * 0.25,
      start[1] * 0.72 + end[1] * 0.28 + bend,
      start[2] * 0.72 + end[2] * 0.28 + 0.22
    ]);
    var c2 = bounded([
      start[0] * 0.28 + end[0] * 0.72 + (random() - 0.5) * 0.25,
      start[1] * 0.28 + end[1] * 0.72 - bend,
      start[2] * 0.28 + end[2] * 0.72 - 0.22
    ]);
    var points = [start.slice()];
    for (var i = 1; i < segments; i++) {
      var t = i / segments, s = 1 - t;
      points.push([0, 1, 2].map(function (axis) {
        return s * s * s * start[axis] + 3 * s * s * t * c1[axis] +
          3 * s * t * t * c2[axis] + t * t * t * end[axis];
      }));
    }
    points.push(end.slice());
    return { points: points, band: band, phase: phase };
  }

  function createModel(options) {
    if (options === undefined) options = {};
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object');
    var profile = options.profile === undefined ? 'performance' : options.profile;
    var seed = options.seed === undefined ? 783 : options.seed;
    if (profile !== 'performance' && profile !== 'cinematic') throw new RangeError('profile must be performance or cinematic');
    if (!Number.isSafeInteger(seed)) throw new TypeError('seed must be a safe integer');
    var cinematic = profile === 'cinematic';
    var neurons = cinematic ? 168 : 84;
    var trunkSegments = cinematic ? 24 : 20;
    var branchSegments = cinematic ? 15 : 14;
    var random = randomFor(seed);
    var shell = makeShell(cinematic ? 32 : 18, cinematic ? 48 : 28);
    var somata = new Float32Array(neurons * 4);
    var paths = [];
    var branchAt = cinematic ? [7, 13, 19] : [6, 11, 16];
    for (var n = 0; n < neurons; n++) {
      // Balanced lateral populations plus central somata; no biological identity implied.
      var zone = n % 3, band = Math.floor(n / 3) % 3;
      var start = interior(LOBES[zone], random);
      var end = interior(LOBES[zone === 2 ? n % 2 : 2], random);
      var trunk = curve(start, end, trunkSegments, random, band, random());
      paths.push(trunk);
      somata.set([start[0], start[1], start[2], band], n * 4);
      for (var branch = 0; branch < 3; branch++) {
        var endpoint = interior(LOBES[(zone + branch + 1) % 3], random);
        paths.push(curve(trunk.points[branchAt[branch]], endpoint, branchSegments, random, band, random()));
      }
    }
    var lineSegments = neurons * (trunkSegments + 3 * branchSegments);
    var fibers = new Float32Array(lineSegments * 10);
    var cursor = 0;
    paths.forEach(function (path) {
      for (var p = 1; p < path.points.length; p++) {
        for (var pair = p - 1; pair <= p; pair++) {
          var point = path.points[pair];
          fibers[cursor++] = point[0]; fibers[cursor++] = point[1]; fibers[cursor++] = point[2];
          fibers[cursor++] = path.band; fibers[cursor++] = path.phase;
        }
      }
    });
    var model = {
      profile: profile, seed: seed, semantics: SEMANTICS,
      illustrationDescription: ILLUSTRATION_DESCRIPTION,
      shell: shell, fibers: fibers, somata: somata, paths: paths,
      counts: { shellTriangles: shell.length / 18, neurons: neurons, lineSegments: lineSegments },
      bounds: { min: [-1.64, -0.82, -0.70], max: [1.64, 0.82, 0.70] }
    };
    models.add(model);
    return model;
  }

  function overlaps(a, b) {
    return a.buffer === b.buffer && a.byteOffset < b.byteOffset + b.byteLength &&
      b.byteOffset < a.byteOffset + a.byteLength;
  }

  function fillPulses(model, time, bands, target) {
    if (!models.has(model)) throw new TypeError('model must be returned by createModel');
    if (!Number.isFinite(time) || time < 0) throw new RangeError('time must be finite and nonnegative');
    if (!(Array.isArray(bands) || ArrayBuffer.isView(bands)) || bands.length !== 3) throw new TypeError('bands must contain three values');
    for (var b = 0; b < 3; b++) {
      if (!Number.isFinite(bands[b]) || bands[b] < 0 || bands[b] > 1) throw new RangeError('bands must be finite values in 0..1');
    }
    if (!(target instanceof Float32Array) || target.length !== model.paths.length * 5) throw new TypeError('target must be Float32Array(paths.length * 5)');
    if (overlaps(target, model.shell) || overlaps(target, model.fibers) || overlaps(target, model.somata)) {
      throw new TypeError('target must not overlap geometry buffers');
    }
    // Cache scalar bands before any writes: bands may be a view into target.
    var low = bands[0], mid = bands[1], high = bands[2];
    // Reduce time before multiplication to remain finite even at Number.MAX_VALUE.
    // Ping-pong avoids a packet jumping across a disconnected end-to-start seam.
    var travel = (time % 10) / 5;
    for (var i = 0; i < model.paths.length; i++) {
      var path = model.paths[i];
      var cycle = (travel + path.phase * 2) % 2;
      var fraction = cycle <= 1 ? cycle : 2 - cycle;
      var position = fraction * (path.points.length - 1);
      var segment = Math.min(Math.floor(position), path.points.length - 2);
      var mix = position - segment;
      var a = path.points[segment], c = path.points[segment + 1];
      var offset = i * 5;
      target[offset] = a[0] + (c[0] - a[0]) * mix;
      target[offset + 1] = a[1] + (c[1] - a[1]) * mix;
      target[offset + 2] = a[2] + (c[2] - a[2]) * mix;
      target[offset + 3] = path.band;
      target[offset + 4] = path.band === 0 ? low : path.band === 1 ? mid : high;
    }
    return target;
  }

  return { createModel: createModel, fillPulses: fillPulses };
}));


