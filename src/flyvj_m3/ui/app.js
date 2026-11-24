(function () {
  'use strict';
  const G = globalThis.FlyVJM2, A = globalThis.FlyVJM3;
  const B = globalThis.FlyVJBrainGeometry, BR = globalThis.FlyVJBrainRenderer;
  const M = globalThis.FlyVJPublicMorphology, MR = globalThis.FlyVJPublicMorphologyRenderer;
  const $ = id => document.getElementById(id);
  const canvas = $('graph'), renderStatus = $('render-status'), sourceStatus = $('source-status');
  const MAX_BYTES = 64 * 1024 * 1024, MAX_SECONDS = 900, FFT_SIZE = 2048;
  let payload, normalized, roles, state;
  function setMessage(element, message, isError) {
    element.setAttribute('role', isError ? 'alert' : 'status');
    element.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    element.textContent = message;
    if (isError) element.classList.add('error'); else element.classList.remove('error');
  }
  try {
    payload = JSON.parse($('m3-payload').textContent);
    if (!payload || payload.scope !== 'M3_LOCAL_FILE_AUDIO') throw new Error('M3 scope 唔正確');
    if (!G || !A) throw new Error('Geometry／DSP 模組缺失');
    G.validatePayload({ ...payload, scope: 'M2_OFFLINE_POINT_GRAPH' });
    normalized = G.normalize(payload.dataset.neurons);
    roles = A.assignRoles(payload.dataset.neurons.map(n => n.id));
    state = A.initialState(payload.dataset.neurons.map(n => n.id));
  } catch (error) {
    setMessage(sourceStatus, '來源閘／payload 驗證失敗；音訊同 renderer 未啟動。', true);
    setMessage(renderStatus, 'Point graph 未啟動：來源資料未通過驗證。', true);
    canvas.dataset.sourceState = 'error'; canvas.dataset.renderState = 'blocked';
    document.querySelectorAll('button,input,select').forEach(el => { el.disabled = true; });
    return;
  }
  const dataset = payload.dataset, ids = dataset.neurons.map(n => n.id);
  const byId = new Map(normalized.points.map(n => [n.id, n]));
  const points = payload.render_order.map(id => byId.get(id));
  let selected = ids[0], camera = G.camera();
  let audio = $('audio-player'), session = null, generation = 0, audioContext = null;
  let sourceMode = 'none', sourceState = 'no-file', sourceName = '', disposed = false, raf = 0;
  let brainRenderer = null, brainModel = null, morphRenderer = null, morphModel = null;
  let visualMode = payload.morphology ? (M && MR ? 'regions' : 'points') : (B && BR ? 'brain' : 'points');
  let visualProfile = 'performance', visualIntensity = 1;
  let features = silence();
  let mic = null, micTime = 0, micState = { state: 'disabled', active: false }, micIntent = 0;
  let gl = null, program = null, buffer = null, renderable = false, lossExtension = null;

  function silence() { return { rms: 0, bands: { low: 0, mid: 0, high: 0 }, clipping: false }; }
  function active(s) { return !!s && session === s && s.token === generation && !disposed; }
  function finiteTime(s) { return s && Number.isFinite(s.element.currentTime) ? s.element.currentTime : 0; }
  function live(s) {
    return active(s) && s.metadataValid && sourceState === 'playing' && !s.element.paused &&
      !s.element.ended && !s.element.seeking && s.element.readyState >= 2 &&
      audioContext && audioContext.state === 'running' && !!s.analyser;
  }
  function signal(id) {
    const value = state.signals[id];
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('無效 DSP signal');
    return value;
  }
  function gainValue() {
    const value = Number($('gain-input').value);
    if (!Number.isFinite(value) || value < .1 || value > 32) throw new Error('Gain 必須介乎 0.1–32');
    return value;
  }
  function candidateLabel() { return state.energy > .02 && [1, 2, 3].includes(state.candidate) ? 'Column ' + state.candidate : 'HOLD'; }
  function resetFeatures() { state = A.initialState(ids); features = silence(); }
  function diagnosticsDom() {
    Object.assign(canvas.dataset, {
      sourceMode, sourceState, fileLoaded: String(!!session && session.metadataValid),
      audioPaused: String(sourceMode === 'kinect-mic' ? micState.state !== 'running' : !session || session.element.paused), audioTime: String(sourceMode === 'kinect-mic' ? micTime : finiteTime(session)),
      time: String(state.time), rms: String(features.rms), energy: String(state.energy),
      low: String(state.bands.low), mid: String(state.bands.mid), high: String(state.bands.high),
      candidate: candidateLabel(), onsetCount: String(state.onsetCount), selectedSignal: String(signal(selected)),
      selectedId: selected, yaw: String(camera.yaw), pitch: String(camera.pitch), zoom: String(camera.zoom),
      pointCount: String(points.length), edgeCount: String(dataset.connections.length),
      visualMode, visualProfile, visualTime: String(state.time),
      illustrativeNeuronCount: String(visualMode === 'brain' && brainModel ? brainModel.counts.neurons : 0),
      morphRegionCount: String(morphModel ? morphModel.counts.regions : 0),
      morphSkeletonCount: String(morphModel ? morphModel.counts.skeletons : 0),
      morphNodeCount: String(morphModel ? morphModel.counts.nodes : 0),
      morphLineSegments: String(morphModel ? morphModel.counts.lineSegments : 0),
      morphologyRegistration: publicMode() ? 'UNVERIFIED_NO_OVERLAY' : 'INDEPENDENT_DIAGNOSTIC',
      modelSemantics: publicMode() && morphModel ? morphModel.semantics : (visualMode === 'brain' && brainModel ? brainModel.semantics : 'REAL_MARKED_POINTS_ONLY')
    });
  }
  function updateUi() {
    $('rms').textContent = features.rms.toFixed(4);
    $('energy-value').textContent = state.energy.toFixed(4);
    for (const band of ['low', 'mid', 'high']) {
      const value = state.bands[band];
      $(band + '-value').textContent = value.toFixed(4);
      $(band + '-meter').style.width = (value * 100).toFixed(2) + '%';
      $(band + '-meter').setAttribute('aria-valuenow', String(value));
    }
    const candidate = candidateLabel();
    $('candidate').textContent = candidate;
    $('address').textContent = candidate === 'HOLD' ? '無 address 候選' : '/composition/columns/' + state.candidate + '/connect  [preview only]';
    $('onset').textContent = state.onset ? '是 · 候選' : '否';
    $('onset-count').textContent = String(state.onsetCount);
    $('timeline').textContent = state.time.toFixed(2) + ' s';
    $('clipping').textContent = features.clipping ? 'CLIPPING · 實測 PCM' : '無 clipping';
    $('selected-signal').textContent = signal(selected).toFixed(4);
    $('selected-role').textContent = roles[selected].toUpperCase();
    $('feature-state').textContent = (live(session) || (sourceMode === 'kinect-mic' && micState.state === 'running')) ? '實測中' : '已凍結';
    $('gain-value').textContent = Number($('gain-input').value).toFixed(1) + '×';
    $('monitor-state').textContent = $('monitor').checked ? 'ON' : 'OFF';
    $('audio-file-name').textContent = sourceState === 'error' ? '檔案載入失敗' : sourceName || '未載入音檔';
    $('visual-intensity-value').textContent = visualIntensity.toFixed(1) + '×';
    $('model-count').textContent = publicMode() && morphModel ? (visualMode === 'regions' ? morphModel.counts.regions + ' 公開腦區 / ' + morphModel.counts.shellTriangles + ' triangles' : '1 份神經骨架 / ' + morphModel.counts.nodes + ' 採樣點') : (visualMode === 'brain' && brainModel ? brainModel.counts.neurons + ' 示意神經 / ' + brainModel.counts.lineSegments + ' 分枝線段' : '真實 marked points');
    $('show-measured').disabled = publicMode();
    if (publicMode()) $('show-measured').checked = false;
    $('show-shell').disabled = visualMode === 'neuron';
    $('show-fibers').disabled = visualMode === 'regions';
    $('model-semantics').textContent = publicMode() ? '公開 hemibrain demo：部分腦區／1份骨架，唔係完整全腦。三頻分組同光點係人為視覺映射，非生物 firing；units／bodyID／共同配準未確認，禁止疊加真6點或兩種模型。' : visualMode === 'brain' ? '程序生成示意：腦輪廓／分枝／流動唔係真實全腦、morphology 或生物 firing；真 6 點疊加只係對照，唔係解剖配準。' : '真實小樣本：6 marked points／3 measured connections，唔係完整神經形態；cyan 外圈只表示選取。';
    $('source-kind').textContent = sourceMode === 'kinect-mic' ? 'KINECT MIC' : sourceMode === 'test-pcm' ? '合成 TEST PCM' : sourceMode === 'file' ? 'LOCAL FILE' : 'NO FILE';
    const usable = active(session) && session.metadataValid && sourceState !== 'error';
    $('play').disabled = !usable || live(session) || sourceState === 'starting';
    $('pause').disabled = sourceMode === 'kinect-mic' ? micState.active === false : !usable || (session.element.paused && sourceState !== 'starting');
    $('monitor').disabled = sourceMode === 'kinect-mic';
    $('restart').disabled = !usable;
    diagnosticsDom();
  }
  function sourceMessage(status, message, isError = false) {
    sourceState = status; setMessage(sourceStatus, message, isError); updateUi();
  }
  function requestFrame() { if (!disposed && !document.hidden && !raf) raf = requestAnimationFrame(frame); }
  function stopFrames() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function frame() {
    raf = 0;
    if (disposed || document.hidden) return;
    if (live(session)) {
      const s = session;
      try {
        s.analyser.getFloatTimeDomainData(s.timeData);
        s.analyser.getFloatFrequencyData(s.freqData);
        features = A.measure(s.timeData, s.freqData, audioContext.sampleRate, s.analyser.fftSize);
        // Pass the REAL media time without dt clamping; DSP handles seek/background discontinuities.
        state = A.advance(state, features, s.element.currentTime, !s.element.paused && s.metadataValid, gainValue(), !!s.dspRebase);
        s.dspRebase = false;
      } catch (error) { audioFailure(s, 'PCM／FFT 分析失敗；已停音訊並清零 features。'); }
    }
    updateUi();
    if (renderable) {
      try { draw(); } catch (error) { graphFailure('Native WebGL 繪圖失敗；音訊分析同原始資料仍可用。'); }
    }
    if (live(session)) requestFrame();
  }

  function micStatus(s) {
    micState = s;
    const labels = { disabled: 'Mic 不可用：請用 http://127.0.0.1 本機 bridge；FILE 仍可用。', off: 'Mic OFF · 已確認停止／未開始', starting: 'Kinect Mic 開始中…', running: 'Kinect Mic 實測中 · 無喇叭監聽', stopping: 'Mic 停止中；等待確認', unknown: '連線狀態未知；capture 停止未確認，heartbeat lease 6 秒後應由 server 關閉，請重新確認。', error: 'Mic 錯誤；capture 停止未確認，請撳停止重試。' };
    setMessage($('kinect-status'), labels[s.state] || labels.error, ['error', 'unknown'].includes(s.state));
    $('kinect-scan').disabled = s.state === 'disabled' || s.active !== false;
    $('kinect-stop').disabled = ['disabled', 'off'].includes(s.state);
    $('kinect-start').disabled = s.state !== 'off' || !$('kinect-device').children.length;
    if (sourceMode === 'kinect-mic') {
      if (s.state !== 'running') { micTime = 0; resetFeatures(); }
      sourceMessage(s.state, labels[s.state] || labels.error, ['error', 'unknown'].includes(s.state));
      requestFrame();
    }
  }
  async function stopMic() {
    micIntent++;
    if (sourceMode === 'kinect-mic') { micTime = 0; resetFeatures(); updateUi(); requestFrame(); }
    if (!mic || (micState.active === false && ['off', 'disabled'].includes(micState.state))) return micState;
    return mic.stop();
  }
  if (globalThis.FlyVJKinectBridge) {
    mic = new globalThis.FlyVJKinectBridge({ onState: micStatus, onSample(sample) {
      if (disposed || document.hidden || sourceMode !== 'kinect-mic' || micState.state !== 'running') return;
      try {
        features = { rms: sample.rms, bands: { ...sample.bands }, clipping: sample.clipping };
        micTime = sample.time;
        state = A.advance(state, features, micTime, true, gainValue());
        updateUi(); requestFrame();
      } catch (_) { void stopMic(); }
    } });
    micStatus(mic.publicState());
  } else micStatus(micState);
  $('kinect-scan').addEventListener('click', async () => {
    if (!mic || $('kinect-scan').disabled) return;
    const devices = await mic.scan();
    $('kinect-device').replaceChildren(...devices.filter(d => /azure\s+kinect/i.test(d.name)).map(d => {
      const option = document.createElement('option'); option.value = String(d.index); option.textContent = d.name; return option;
    }));
    $('kinect-device').disabled = !devices.length;
    micStatus(mic.publicState());
    if (!devices.length && micState.state === 'off') setMessage($('kinect-status'), '搵唔到 Azure Kinect；唔會改用 default Mic。', true);
  });
  $('kinect-start').addEventListener('click', async () => {
    if (!mic || $('kinect-start').disabled || document.hidden || disposed) return;
    const value = $('kinect-device').value;
    if (!/^\d+$/.test(value)) return;
    micIntent++; generation++; retire(session); session = null;
    sourceMode = 'kinect-mic'; sourceName = ''; micTime = 0; resetFeatures();
    $('monitor').checked = false; $('audio-file').value = '';
    await mic.start(Number(value)); updateUi(); requestFrame();
  });
  $('kinect-stop').addEventListener('click', () => { void stopMic(); });

  // One fresh HTMLAudioElement per selected Blob. Old listeners/nodes are detached before retirement.
  // This prevents queued decoder/play events for a previous src from poisoning a new source.
  function retire(s) {
    if (!s) return;
    s.listeners.forEach(([type, fn]) => s.element.removeEventListener(type, fn)); s.listeners = [];
    s.wantPlay = false; s.action++;
    s.element.pause();
    for (const node of [s.mediaSource, s.analyser, s.monitorGain]) {
      if (node) { try { node.disconnect(); } catch (_) { /* Already detached. */ } }
    }
    s.element.removeAttribute('src'); s.element.load();
    if (s.url) { URL.revokeObjectURL(s.url); s.url = null; }
  }
  function playerElement() {
    const el = document.createElement('audio');
    el.id = 'audio-player'; el.controls = true; el.preload = 'metadata'; el.disableRemotePlayback = true;
    el.setAttribute('controlslist', 'nodownload noremoteplayback');
    el.setAttribute('aria-label', '本機音訊播放器');
    audio.replaceWith(el); audio = el; return el;
  }
  function audioFailure(s, message) {
    if (s && !active(s)) return;
    if (session) { retire(session); session.metadataValid = false; session.wantPlay = false; }
    resetFeatures(); sourceMessage('error', message, true); requestFrame();
  }
  function validMetadata(s) {
    if (!active(s)) return false;
    const duration = s.element.duration;
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS || s.element.error) {
      audioFailure(s, '音訊 metadata／duration 無效，或者超過 15 分鐘；已停同清零。請揀支援嘅 PCM WAV。'); return false;
    }
    s.metadataValid = true; return true;
  }
  function listen(s, type, fn) {
    const guarded = event => { if (active(s)) fn(event); };
    s.listeners.push([type, guarded]); s.element.addEventListener(type, guarded);
  }
  function startupDeadline(promise) {
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Audio startup timeout'), { name: 'TimeoutError' })), 3000);
    });
    return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
  }
  async function ensureAudio(s) {
    if (!active(s)) return;
    if (s.activationPromise) return s.activationPromise;
    const task = (async () => {
      if (!audioContext) {
        const Constructor = window.AudioContext || window.webkitAudioContext;
        if (!Constructor) throw new Error('AudioContext unavailable');
        audioContext = new Constructor();
        const ownedContext = audioContext;
        ownedContext.addEventListener('statechange', () => {
          if (disposed || audioContext !== ownedContext || !active(session)) return;
          if (ownedContext.state === 'closed') audioFailure(session, 'AudioContext 已關閉；請重新揀音訊。');
          else if (ownedContext.state === 'suspended' && !session.element.paused && sourceState === 'playing') {
            pauseSource(session, 'AudioContext 已暫停；features 凍結。撳播放再恢復。');
          }
        });
      }
      if (!s.connected) {
        // Never create a second MediaElementAudioSourceNode for this element.
        if (!s.mediaSource) s.mediaSource = audioContext.createMediaElementSource(s.element);
        s.analyser = audioContext.createAnalyser(); s.analyser.fftSize = FFT_SIZE; s.analyser.smoothingTimeConstant = 0;
        s.monitorGain = audioContext.createGain();
        s.monitorGain.gain.value = $('monitor').checked ? 1 : 0;
        s.mediaSource.connect(s.analyser); s.analyser.connect(s.monitorGain); s.monitorGain.connect(audioContext.destination);
        s.timeData = new Float32Array(s.analyser.fftSize); s.freqData = new Float32Array(s.analyser.frequencyBinCount);
        s.connected = true;
      }
      // Mute ONLY with GainNode AFTER analyser: HTMLAudioElement.muted can suppress PCM.
      if (audioContext.state !== 'running') await startupDeadline(audioContext.resume());
      if (active(s) && audioContext.state !== 'running') throw new Error('AudioContext not running');
    })();
    s.activationPromise = task;
    try { await task; } finally { if (s.activationPromise === task) s.activationPromise = null; }
  }
  async function nativePlay(s) {
    if (!active(s) || s.element.paused || !validMetadata(s)) return;
    // Custom transport owns activation and deadline; do not start it twice.
    if (s.wantPlay && sourceState === 'starting') return;
    const action = s.action; s.wantPlay = true;
    sourceMessage('starting', '正在啟動本機 AudioContext／PCM pipeline…');
    try {
      await ensureAudio(s);
      if (!active(s) || action !== s.action || !s.wantPlay || s.element.paused) return;
      sourceMessage('playing', (sourceMode === 'test-pcm' ? '合成 TEST PCM' : '本機 File') + ' · 播放／實際 PCM 分析中'); requestFrame();
    } catch (error) { if (active(s) && action === s.action) audioFailure(s, 'AudioContext 啟動失敗／播放被拒絕；已停音訊並清零。'); }
  }
  async function playSource(s) {
    if (!active(s) || !s.metadataValid || sourceState === 'error') return;
    const action = ++s.action; s.wantPlay = true;
    sourceMessage('starting', '正在啟動本機音訊；監聽由 OFF／ON 控制。');
    canvas.dataset.audioStartupError = '';
    try {
      // Both calls run inside the click before any await. A suspended context
      // can need media start to unlock; awaiting resume first can deadlock.
      const activation = ensureAudio(s);
      // Failed graph setup must not bypass the zero-gain monitor via direct media output.
      const playback = s.connected ? new Promise(resolve => resolve(s.element.play())) : Promise.resolve();
      await startupDeadline(Promise.all([activation, playback]));
      if (!active(s) || s.action !== action || !s.wantPlay) return;
      if (!s.element.paused) { sourceMessage('playing', (sourceMode === 'test-pcm' ? '合成 TEST PCM' : '本機 File') + ' · 播放／實際 PCM 分析中'); requestFrame(); }
     } catch (error) {
      if (active(s) && s.action === action) {
        const code = ['NotAllowedError', 'NotSupportedError', 'AbortError', 'TimeoutError', 'InvalidStateError'].includes(error && error.name) ? error.name : 'AudioStartupError';
        canvas.dataset.audioStartupError = code;
        audioFailure(s, '播放未能啟動（' + code + '）；已停止並清零。' + (code === 'NotAllowedError' ? 'Browser 拒絕音訊播放；唔會繞過權限。' : '請重新揀檔；啟動上限 3 秒。'));
      }
    }
  }
  function pauseSource(s, message = '已暫停 · features 凍結；無新拍點候選') {
    if (!active(s)) return;
    s.wantPlay = false; s.action++; s.element.pause();
    if (sourceState !== 'error') sourceMessage('paused', message);
    requestFrame();
  }
  function loadBlob(blob, mode, displayName, stopped = false) {
    if (!stopped && mic && !['off', 'disabled'].includes(micState.state)) {
      const closing = stopMic(), intent = micIntent;
      void closing.then(s => { if (!disposed && intent === micIntent && s.active === false) loadBlob(blob, mode, displayName, true); });
      return;
    }
    micIntent++;

    sourceName = mode === 'test-pcm' ? '合成 TEST PCM.wav' : typeof displayName === 'string' ? displayName.slice(0, 160) : '已載入本機音檔';
    if (disposed) return;
    generation++; retire(session); session = null; resetFeatures(); sourceMode = mode;
    $('monitor').checked = false;
    if (!(blob instanceof Blob) || !Number.isFinite(blob.size) || blob.size <= 0 || blob.size > MAX_BYTES) {
      playerElement(); sourceMessage('error', '檔案無效／空檔，或者超過 64 MiB；舊音訊已停並清零。', true); requestFrame(); return;
    }
    const element = playerElement();
    const s = { token: generation, element, url: null, metadataValid: false, listeners: [], connected: false,
      mediaSource: null, analyser: null, monitorGain: null, activationPromise: null, wantPlay: false, action: 0 };
    session = s;
    listen(s, 'loadedmetadata', () => { if (validMetadata(s)) { sourceMessage('paused', '音訊 metadata 已載入 · 已暫停；撳播放先開始實測。'); requestFrame(); } });
    listen(s, 'durationchange', () => { if (s.element.readyState >= 1) { validMetadata(s); updateUi(); } });
    listen(s, 'canplay', () => {
      if (!s.metadataValid && !validMetadata(s)) return;
      if (s.element.paused && sourceState !== 'starting') sourceMessage('paused', '音訊已載入 · 已暫停；監聽預設 OFF。');
      updateUi(); requestFrame();
    });
    listen(s, 'play', () => { void nativePlay(s); });
    listen(s, 'playing', () => {
      if (s.metadataValid && s.wantPlay && audioContext && audioContext.state === 'running' && s.analyser && !s.element.paused) {
        sourceMessage('playing', (sourceMode === 'test-pcm' ? '合成 TEST PCM' : '本機 File') + ' · 播放／實際 PCM 分析中'); requestFrame();
      }
    });
    listen(s, 'pause', () => {
      s.wantPlay = false; s.action++;
      if (sourceState !== 'error' && sourceState !== 'loading' && sourceState !== 'ended') sourceMessage('paused', '已暫停 · features 凍結；無新拍點候選');
      requestFrame();
    });
    listen(s, 'waiting', () => { sourceMessage('buffering', '等候本機 decoder／PCM；features 暫時凍結。'); requestFrame(); });
    listen(s, 'seeking', () => { s.dspRebase = true; state = { ...state, onset: false }; updateUi(); requestFrame(); });
    listen(s, 'seeked', () => { s.dspRebase = true; state = { ...state, onset: false }; updateUi(); requestFrame(); });
    listen(s, 'ended', () => { s.wantPlay = false; s.action++; sourceMessage('ended', '播放結束 · features 凍結；由頭會清零。'); requestFrame(); });
    listen(s, 'error', () => { audioFailure(s, '音訊解碼／載入失敗；已停同清零。Browser 唔一定支援所有 codec；請揀 PCM WAV。'); });
    sourceMessage('loading', mode === 'test-pcm' ? '合成 TEST PCM · 載入實際 WAV Blob，未開始分析' : '正在載入你揀嘅本機 File；未開始分析');
    try { s.url = URL.createObjectURL(blob); element.src = s.url; element.load(); }
    catch (error) { audioFailure(s, '本機 Blob 音源建立失敗；已停並清零。'); }
    requestFrame();
  }

  $('audio-file').addEventListener('change', () => {
    const file = $('audio-file').files && $('audio-file').files[0];
    if (!file) return;
    loadBlob(file, 'file', file.name); $('audio-file').value = '';
  });
  $('test-pcm').addEventListener('click', () => {
    try { loadBlob(new Blob([A.encodeWav(A.fixturePcm(), 16000)], { type: 'audio/wav' }), 'test-pcm'); }
    catch (error) { audioFailure(session, '合成 TEST PCM 建立失敗；無預填 features。'); }
  });
  $('play').addEventListener('click', () => { void playSource(session); });
  $('pause').addEventListener('click', () => { if (sourceMode === 'kinect-mic') void stopMic(); else pauseSource(session); });
  $('restart').addEventListener('click', () => {
    const s = session; if (!active(s) || !s.metadataValid || sourceState === 'error') return;
    pauseSource(s);
    try { s.element.currentTime = 0; resetFeatures(); sourceMessage('paused', '已由頭／清零 DSP 同拍點基線 · 已暫停'); requestFrame(); }
    catch (error) { audioFailure(s, '音訊 seek 失敗；已停並清零。'); }
  });
  $('monitor').addEventListener('change', () => { if (session && session.monitorGain) session.monitorGain.gain.value = $('monitor').checked ? 1 : 0; updateUi(); });
  $('gain-input').addEventListener('input', () => {
    try { gainValue(); updateUi(); requestFrame(); }
    catch (error) { audioFailure(session, '分析 gain 無效；必須介乎 0.1–32。'); }
  });

  // The original point geometry remains immutable; selection only changes inspection/highlight.
  $('source-proof').textContent = 'source verified POINT SAMPLE';
  $('graph-count').textContent = ids.length + ' points / ' + dataset.connections.length + ' edges';
  $('provenance').textContent = [dataset.provenance.name, dataset.provenance.version, dataset.provenance.license, 'Source: ' + dataset.provenance.source].join(' · ');
  $('coordinates').textContent = dataset.coordinates.units + ' · ' + dataset.coordinates.frame;
  $('fingerprint').textContent = 'Dataset fingerprint: ' + payload.dataset_fingerprint;
  $('mapping-semantics').textContent = typeof payload.mapping_semantics === 'string' ? payload.mapping_semantics : 'Low／mid／high 係人為控制映射，唔代表真實神經功能／firing。';
  for (const n of dataset.neurons) { const option = document.createElement('option'); option.value = n.id; option.textContent = n.id + ' · ' + roles[n.id].toUpperCase(); $('neuron').append(option); }
  for (const rule of payload.rule_examples) { const li = document.createElement('li'); li.textContent = rule.energy + ' → Column ' + rule.column + ' · ' + rule.reason; $('rules').append(li); }
  function selection() {
    $('neuron').value = selected;
    const n = dataset.neurons.find(n => n.id === selected); $('selection').replaceChildren();
    for (const [key, value] of [['ID', n.id], ['原始 nm 座標', n.position.join(', ')], ['Selected-edge neuropil（唔係點所在位置）', n.region], ['人為 frequency role', roles[selected].toUpperCase()]]) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; $('selection').append(dt, dd);
    }
    $('edges').replaceChildren();
    const edges = G.selectedEdges(dataset, selected);
    for (const e of edges) { const li = document.createElement('li'); li.textContent = e.pre_id + ' → ' + e.post_id + ' · ' + e.direction + ' · selected neuropil ' + e.neuropil + ' · ' + e.weight + ' synapses'; $('edges').append(li); }
    if (!edges.length) { const li = document.createElement('li'); li.textContent = '呢個 sample 無相關 measured edge。'; $('edges').append(li); }
    updateUi(); requestFrame();
  }
  $('neuron').addEventListener('change', () => { const value = $('neuron').value; if (byId.has(value)) { selected = value; selection(); } });

  function rendererDiagnostics(status) {
    $('lose-context').disabled = status !== 'ready' || !lossExtension;
    $('restore-context').disabled = status !== 'lost' || !lossExtension;
    const messages = { ready: 'Extension 可用；只作真正 lifecycle 測試，唔代表 QC 已通過。', lost: '已收到 context lost event；graph 停止。可以恢復 context；音訊分析獨立運作。', losing: '已要求 context loss；等候真正 event。', restoring: '已要求恢復；等候真正 restored event。', unavailable: 'WEBGL_lose_context 不可用；測試按鈕已停用。' };
    $('diagnostic-status').textContent = messages[status] || messages.unavailable;
    canvas.dataset.diagnosticState = status;
  }
  function graphFailure(message, status = 'error') {
    renderable = false; canvas.dataset.renderState = status; canvas.dataset.renderError = message;
    setMessage(renderStatus, message, true);
  }
  function compile(type, source) {
    const shader = gl.createShader(type); if (!shader) throw new Error('Shader allocation failed');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Shader compile failed'); }
    return shader;
  }
  function publicMode() { return visualMode === 'regions' || visualMode === 'neuron'; }
  function disposeMorphology() { if (morphRenderer) { morphRenderer.dispose(); morphRenderer = null; } }
  function rebuildMorphology() {
    disposeMorphology(); disposeBrain(); brainModel = null; morphModel = null;
    try {
      if (!M || !MR || !payload.morphology || !gl) throw new Error('Public morphology unavailable');
      morphModel = M.createModel(payload.morphology, visualMode, visualProfile);
      morphRenderer = MR.createRenderer(gl, morphModel, M);
      canvas.dataset.publicModelState = 'ready'; delete canvas.dataset.publicModelError;
      setMessage(renderStatus, '公開模型 · ' + (visualMode === 'regions' ? '14 個部分腦區' : '1 份神經骨架') + ' · 音訊人為映射，非生物 firing', false);
    } catch (error) {
      disposeMorphology(); morphModel = null; visualMode = 'points'; $('visual-mode').value = 'points';
      canvas.dataset.publicModelState = 'error'; canvas.dataset.publicModelError = '公開模型初始化失敗';
      setMessage(renderStatus, '公開模型初始化失敗；退回獨立真6點，音訊控制保留。', true);
    }
  }
  function disposeBrain() { if (brainRenderer) { brainRenderer.dispose(); brainRenderer = null; } }
  function releaseVisualResources() {
    disposeBrain(); disposeMorphology();
    if (gl) { if (program) gl.deleteProgram(program); if (buffer) gl.deleteBuffer(buffer); }
    program = null; buffer = null; renderable = false;
  }
  function rebuildBrain() {
    disposeMorphology(); morphModel = null; disposeBrain(); brainModel = null;
    if (!B || !BR || !gl) { visualMode = 'points'; $('visual-mode').value = 'points'; canvas.dataset.brainState = 'unavailable'; return; }
    try {
      brainModel = B.createModel({ profile: visualProfile, seed: 783 });
      brainRenderer = BR.createRenderer(gl, brainModel, B);
      canvas.dataset.brainState = 'ready'; delete canvas.dataset.brainError;
    } catch (error) {
      disposeBrain(); brainModel = null; visualMode = 'points'; $('visual-mode').value = 'points';
      canvas.dataset.brainState = 'error'; canvas.dataset.brainError = '示意模型初始化失敗';
      setMessage(renderStatus, '示意模型初始化失敗；已退回真實小樣本，音訊分析仍可用。', true);
    }
  }
  function visualControls() {
    $('visual-mode').value = visualMode; $('visual-profile').value = visualProfile;
    for (const id of ['show-shell', 'show-fibers', 'show-flow']) $(id).checked = true;
    $('show-measured').checked = false;
    $('visual-mode').addEventListener('change', () => {
      const value = $('visual-mode').value;
      if (!['regions', 'neuron', 'brain', 'points'].includes(value) || (['regions', 'neuron'].includes(value) && (!M || !MR || !payload.morphology))) { $('visual-mode').value = visualMode; return; }
      visualMode = value;
      if (publicMode()) rebuildMorphology();
      else if (visualMode === 'brain') rebuildBrain();
      else { disposeMorphology(); morphModel = null; disposeBrain(); brainModel = null; }
      updateUi(); requestFrame();
    });
    $('visual-profile').addEventListener('change', () => {
      const value = $('visual-profile').value;
      if (value !== 'performance' && value !== 'cinematic') { $('visual-profile').value = visualProfile; return; }
      visualProfile = value; if (gl && renderable) { if (publicMode()) rebuildMorphology(); else if (visualMode === 'brain') rebuildBrain(); } updateUi(); requestFrame();
    });
    for (const id of ['show-shell', 'show-fibers', 'show-flow', 'show-measured']) $(id).addEventListener('change', () => { updateUi(); requestFrame(); });
    $('visual-intensity').addEventListener('input', () => {
      const value = Number($('visual-intensity').value);
      if (Number.isFinite(value) && value >= 0 && value <= 2) visualIntensity = value;
      else $('visual-intensity').value = String(visualIntensity);
      updateUi(); requestFrame();
    });
  }
  function initializeRenderer() {
    releaseVisualResources();
    renderable = false;
    try {
      gl = canvas.getContext('webgl', { antialias: true, alpha: false });
      if (!gl) throw new Error('WebGL unavailable');
      canvas.dataset.renderer = 'native-webgl';
      const vs = compile(gl.VERTEX_SHADER, 'attribute vec3 a_position;attribute vec3 a_color;attribute float a_size;varying vec3 v_color;void main(){gl_Position=vec4(a_position,1.0);gl_PointSize=a_size;v_color=a_color;}');
      const fs = compile(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec3 v_color;uniform bool u_points;void main(){if(u_points&&distance(gl_PointCoord,vec2(0.5))>0.5)discard;gl_FragColor=vec4(v_color,1.0);}');
      program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('WebGL link failed');
      buffer = gl.createBuffer(); if (!buffer) throw new Error('WebGL buffer failed');
      lossExtension = gl.getExtension('WEBGL_lose_context'); rendererDiagnostics(lossExtension ? 'ready' : 'unavailable');
      renderable = true; canvas.dataset.renderState = 'initialized'; delete canvas.dataset.renderError;
      if (publicMode()) rebuildMorphology(); else if (visualMode === 'brain' || !payload.morphology) rebuildBrain();
      if (!publicMode() && canvas.dataset.publicModelState !== 'error' && canvas.dataset.brainState !== 'error') setMessage(renderStatus, visualMode === 'brain' ? 'M3B 程序生成腦形／神經分枝 · 示意模型，非解剖標本' : '原始 marked points／measured edges · 無 anatomy shell', false);
      updateUi(); requestFrame();
    } catch (error) {
      if (!gl) canvas.dataset.renderer = 'unavailable';
      lossExtension = null; rendererDiagnostics('unavailable');
      graphFailure('3D 顯示失敗／WebGL unavailable；音訊分析同原始 ID／nm 資料仍然可用。');
    }
  }
  function draw() {
    const rect = canvas.getBoundingClientRect(), w = rect.width, h = rect.height;
    if (w <= 0 || h <= 0) return;
    const cap = (visualMode === 'brain' || publicMode()) ? (visualProfile === 'cinematic' ? 1.75 : 1.25) : 2;
    const ratio = Math.min(window.devicePixelRatio || 1, cap), width = Math.max(1, Math.round(w * ratio)), height = Math.max(1, Math.round(h * ratio));
    canvas.dataset.backingWidth = String(width); canvas.dataset.backingHeight = String(height); canvas.dataset.renderDpr = String(ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height); gl.clearColor(.035, .063, .084, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    canvas.dataset.activePackets = '0'; canvas.dataset.shellTriangles = '0';
    if (publicMode() && morphRenderer) {
      try {
        const result = morphRenderer.draw({ camera, width: w, height: h, ratio, time: state.time,
          bands: [state.bands.low, state.bands.mid, state.bands.high], energy: state.energy,
          intensity: visualIntensity, showShell: $('show-shell').checked, showFibers: $('show-fibers').checked, showFlow: $('show-flow').checked });
        canvas.dataset.publicModelState = 'draw-submitted'; canvas.dataset.brainRenderedTime = String(result.time);
        canvas.dataset.activePackets = String(result.activePackets); canvas.dataset.shellTriangles = String(result.shellTriangles);
        [canvas.dataset.visualLow, canvas.dataset.visualMid, canvas.dataset.visualHigh] = result.visualBands.map(String);
      } catch (error) {
        if (gl.isContextLost()) throw error;
        disposeMorphology(); morphModel = null; visualMode = 'points'; $('visual-mode').value = 'points';
        canvas.dataset.publicModelState = 'error'; canvas.dataset.publicModelError = '公開模型繪圖失敗';
        setMessage(renderStatus, '公開模型繪圖失敗；退回獨立6點，音訊分析保留。', true); updateUi();
      }
    }
    if (visualMode === 'brain' && brainRenderer) {
      try {
        const result = brainRenderer.draw({ camera, width: w, height: h, ratio, time: state.time,
          bands: [state.bands.low, state.bands.mid, state.bands.high], energy: state.energy,
          intensity: visualIntensity, showShell: $('show-shell').checked,
          showFibers: $('show-fibers').checked, showFlow: $('show-flow').checked });
        canvas.dataset.brainState = 'draw-submitted'; canvas.dataset.brainRenderedTime = String(result.time);
        canvas.dataset.activePackets = String(result.activePackets); canvas.dataset.shellTriangles = String(result.shellTriangles);
      } catch (error) {
        if (gl.isContextLost()) throw error;
        disposeBrain(); visualMode = 'points'; $('visual-mode').value = 'points';
        canvas.dataset.brainState = 'error'; canvas.dataset.brainError = '示意模型繪圖失敗';
        setMessage(renderStatus, '示意模型繪圖失敗；退回真實點圖，音訊分析仍然運作。', true); updateUi();
      }
    }
    if (visualMode === 'points' || (!publicMode() && $('show-measured').checked)) {
    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.disable(gl.DEPTH_TEST);
    for (const [name, size, offset] of [['a_position', 3, 0], ['a_color', 3, 12], ['a_size', 1, 24]]) {
      const loc = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 28, offset);
    }
    const vertex = (n, color, size) => { const p = G.project(n.position, camera, w, h); return [p.x / w * 2 - 1, 1 - p.y / h * 2, p.z / 10, ...color, size * ratio]; };
    const lines = [];
    for (const edge of dataset.connections) {
      const color = edge.pre_id === selected || edge.post_id === selected ? [.22, .50, .53] : [.23, .30, .25];
      lines.push(...vertex(byId.get(edge.pre_id), color, 1), ...vertex(byId.get(edge.post_id), color, 1));
    }
    gl.uniform1i(gl.getUniformLocation(program, 'u_points'), 0); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW); gl.drawArrays(gl.LINES, 0, lines.length / 7);
    const ordered = [...points].sort((a, b) => G.project(b.position, camera, w, h).z - G.project(a.position, camera, w, h).z || (a.id < b.id ? 1 : -1));
    const colors = { low: [.92, .77, .40], mid: [.32, .82, .86], high: [.71, .57, .94] }, vertices = [];
    for (const n of ordered) {
      const value = signal(n.id), size = 9 + value * 7;
      const color = colors[roles[n.id]].map(channel => .19 + channel * (.15 + .66 * value));
      if (n.id === selected) vertices.push(...vertex(n, [.36, .78, .82], size + 5)); // Selection ring, NOT activation.
      vertices.push(...vertex(n, color, size));
    }
    gl.uniform1i(gl.getUniformLocation(program, 'u_points'), 1); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW); gl.drawArrays(gl.POINTS, 0, vertices.length / 7);
    }
    if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw new Error('WebGL submission failed');
    // DOM evidence describes a draw submission, never a browser/pixel QC PASS.
    canvas.dataset.renderState = 'draw-submitted'; canvas.dataset.frame = String(Number(canvas.dataset.frame || 0) + 1);
    canvas.dataset.renderedTime = String(state.time); canvas.dataset.renderedEnergy = String(state.energy);
    canvas.dataset.renderedSelectedSignal = String(signal(selected));
    canvas.dataset.renderedYaw = String(camera.yaw); canvas.dataset.renderedPitch = String(camera.pitch); canvas.dataset.renderedZoom = String(camera.zoom);
  }
  $('lose-context').addEventListener('click', () => {
    if (!lossExtension || !renderable) return;
    rendererDiagnostics('losing');
    try { lossExtension.loseContext(); } catch (error) { rendererDiagnostics('ready'); $('diagnostic-status').textContent = 'Context loss 要求失敗；未收到 event。'; }
  });
  $('restore-context').addEventListener('click', () => {
    if (!lossExtension || !gl || !gl.isContextLost()) return;
    rendererDiagnostics('restoring');
    try { lossExtension.restoreContext(); } catch (error) { rendererDiagnostics('lost'); $('diagnostic-status').textContent = 'Context restore 要求失敗；graph 仍然失效。'; }
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); disposeBrain(); canvas.dataset.brainState = 'context-lost';
    graphFailure('WebGL context lost：graph 已停止；音訊分析／selection／Column 狀態保留。', 'context-lost');
    rendererDiagnostics(lossExtension ? 'lost' : 'unavailable');
    if (!live(session)) stopFrames();
  });
  canvas.addEventListener('webglcontextrestored', initializeRenderer);
  const zoom = factor => { camera.zoom = Math.max(.2, Math.min(5, camera.zoom * factor)); updateUi(); requestFrame(); };
  $('zoom-in').addEventListener('click', () => zoom(1.2)); $('zoom-out').addEventListener('click', () => zoom(1 / 1.2));
  $('camera-reset').addEventListener('click', () => { camera = G.camera(); updateUi(); requestFrame(); });
  canvas.addEventListener('wheel', event => { event.preventDefault(); zoom(Math.exp(-Math.sign(event.deltaY) * .12)); }, { passive: false });
  canvas.addEventListener('keydown', event => {
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft': camera.yaw -= .1; break; case 'ArrowRight': camera.yaw += .1; break;
      case 'ArrowUp': camera.pitch -= .1; break; case 'ArrowDown': camera.pitch += .1; break;
      case '+': case '=': zoom(1.2); break; case '-': zoom(1 / 1.2); break; case 'Home': camera = G.camera(); break;
      default: handled = false;
    }
    if (handled) { event.preventDefault(); updateUi(); requestFrame(); }
  });
  let drag = null;
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId); canvas.focus();
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.moved = drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
    if (drag.moved) { camera.yaw += dx * .008; camera.pitch += dy * .008; updateUi(); requestFrame(); }
    drag.x = event.clientX; drag.y = event.clientY;
  });
  canvas.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const click = !drag.moved; drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    if (click && (visualMode === 'points' || (!publicMode() && $('show-measured').checked)) && rect.width > 0 && rect.height > 0) {
      const hit = G.pick(points, camera, rect.width, rect.height, event.clientX - rect.left, event.clientY - rect.top, 12);
      if (hit) { selected = hit; selection(); }
    }
  });
  canvas.addEventListener('pointercancel', () => { drag = null; }); canvas.addEventListener('lostpointercapture', () => { drag = null; });
  document.addEventListener('visibilitychange', () => { stopFrames(); if (document.hidden) void stopMic(); else requestFrame(); });
  window.addEventListener('resize', requestFrame);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(requestFrame).observe(canvas);
  window.addEventListener('pagehide', () => {
    disposed = true; void stopMic(); generation++; stopFrames(); retire(session); session = null;
    if (audioContext) { const context = audioContext; audioContext = null; try { void context.close().catch(() => {}); } catch (_) { /* Already closed. */ } }
    releaseVisualResources();
    $('monitor').checked = false; $('audio-file').value = ''; sourceMode = 'none'; sourceName = ''; resetFeatures();
    sourceMessage('disposed', '頁面已停止；音訊已關閉／Blob 已釋放。');
  });
  window.addEventListener('pageshow', () => {
    if (disposed) { disposed = false; playerElement(); sourceMessage('no-file', '未揀檔 · 已暫停 · 監聽 OFF'); initializeRenderer(); }
    requestFrame();
  });
  visualControls(); selection(); sourceMessage('no-file', '未揀檔 · 已暫停 · 監聽 OFF'); initializeRenderer();
})();
