'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const DSP = require('../src/flyvj_m3/ui/audio.js');
const { harness } = require('./m3_ui.test.cjs');

// Independent integration counterexamples: production DSP + VM DOM/WebAudio doubles.
// No real decoder, browser, private music, network, mic or audible output is used.
const scope = 'production DSP / VM integration, NOT browser or music-quality QC';

async function loadedSource(t) {
  const h = harness({ dsp: DSP });
  t.after(() => h.window.dispatch('pagehide'));
  await h.choose(new File(['synthetic VM input'], 'QC-GENERATED.wav', { type: 'audio/wav' }));
  await h.metadata();
  await h.play();
  assert.equal(h.el('graph').dataset.sourceState, 'playing', scope);
  return { h, media: h.el('audio-player'), analyser: h.logs.contexts[0].analyser };
}
function pcm(analyser, fill, lowDb = -Infinity, first = fill) {
  analyser.getFloatTimeDomainData = samples => { samples.fill(fill); samples[0] = first; };
  analyser.getFloatFrequencyData = bins => { bins.fill(-Infinity); bins[3] = lowDb; };
}
function advanceFrame(h, media, time) { media.currentTime = time; h.frame(); }
function onsetCount(h) { return Number(h.el('onset-count').textContent); }

for (const scenario of [
  { name: 'positive finite peak +1.0001', fill: .25, first: 1.0001 },
  { name: 'negative finite peak -1.0001', fill: .25, first: -1.0001 },
  { name: 'positive whole-window RMS above 1', fill: 1.0001, first: 1.0001 },
  { name: 'negative whole-window RMS above 1', fill: -1.0001, first: -1.0001 }
]) {
  test('finite float PCM: ' + scenario.name + ' stays playing and reports clipping', { timeout: 3000 }, async t => {
    const { h, media, analyser } = await loadedSource(t);
    pcm(analyser, scenario.fill, -Infinity, scenario.first);
    advanceFrame(h, media, .1);
    assert.equal(h.el('graph').dataset.sourceState, 'playing', 'Finite over-range PCM must not retire the source');
    assert.equal(media.paused, false);
    assert.equal(h.logs.revoked.length, 0, 'The active Blob URL must remain owned until cleanup');
    assert.match(h.el('clipping').textContent, /^CLIPPING/);
    const samples = new Float32Array(2048).fill(scenario.fill); samples[0] = scenario.first;
    const expected = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    assert.ok(Math.abs(Number(h.el('graph').dataset.rms) - expected) < 1e-6, 'Raw RMS preserves real samples rather than clipping them');
    assert.ok(Number(h.el('graph').dataset.energy) >= 0 && Number(h.el('graph').dataset.energy) <= 1, 'Only control energy is bounded');
    if (Math.abs(scenario.fill) > 1) assert.ok(Number(h.el('graph').dataset.rms) > 1, 'Full-scale is not a raw RMS validity limit');
  });
}

for (const scenario of [
  { name: 'short forward seek below .25s', target: 1.1 },
  { name: 'same-time seek', target: 1 }
]) {
  test(scenario.name + ' rebases flux without fake onset and re-arms a genuine later onset', { timeout: 3000 }, async t => {
    const { h, media, analyser } = await loadedSource(t);
    pcm(analyser, 0);
    advanceFrame(h, media, 1);
    assert.equal(onsetCount(h), 0);
    media.seeking = true; media.dispatch('seeking'); h.frame();
    pcm(analyser, .1, -20);
    media.currentTime = scenario.target;
    media.seeking = false; media.dispatch('seeked'); h.frame();
    assert.equal(onsetCount(h), 0, 'Jumping into sound is a seek baseline, not an onset');
    assert.doesNotMatch(h.el('onset').textContent, /^是/);
    advanceFrame(h, media, scenario.target + .02);
    assert.equal(onsetCount(h), 0, 'A stable first post-seek sample must not create a delayed fake onset');
    pcm(analyser, 0);
    advanceFrame(h, media, scenario.target + .24);
    pcm(analyser, .1, -20);
    advanceFrame(h, media, scenario.target + .26);
    assert.equal(onsetCount(h), 1, 'A later real rise must re-arm after seek; onset detection must not stay disabled');
    assert.match(h.el('onset').textContent, /^是/);
    assert.equal(h.el('graph').dataset.sourceState, 'playing');
  });
}

test('real DSP pause freezes measured state and source swap retires/reset without ghost events', { timeout: 3000 }, async t => {
  const { h, media, analyser } = await loadedSource(t);
  pcm(analyser, .1, -20); advanceFrame(h, media, 1);
  const frozen = Object.fromEntries(['time', 'rms', 'energy', 'low', 'mid', 'high', 'candidate', 'onsetCount'].map(k => [k, h.el('graph').dataset[k]]));
  h.el('pause').dispatch('click');
  pcm(analyser, 0); advanceFrame(h, media, 1.1);
  for (const [key, value] of Object.entries(frozen)) assert.equal(h.el('graph').dataset[key], value, 'Paused ' + key + ' must remain frozen');
  await h.choose(new File(['second synthetic VM input'], 'QC-REPLACEMENT.wav', { type: 'audio/wav' }));
  assert.equal(media.paused, true);
  assert.equal(h.logs.sources[0].disconnected, true);
  assert.equal(h.logs.revoked.length, 1);
  assert.equal(h.el('graph').dataset.energy, '0');
  assert.equal(h.el('graph').dataset.onsetCount, '0');
  assert.equal(h.el('candidate').textContent, 'HOLD');
  media.dispatch('error'); media.dispatch('playing');
  assert.equal(h.el('graph').dataset.sourceState, 'loading', 'Retired source events cannot poison replacement');
});
