# M4.5 升級 CHECKPOINT（pause 於 2026-11-18 01:58）

> **狀態：已 resume 完成（2026-11-18 03:0x）。** 本檔保留作 mid-flight 診斷史（live≠replay stale-cache 案、clip-trigger probe 記錄都喺下面）；最終結果見 `docs/M4_RESULT.md` M4.5 ADDENDUM。
> 範圍：用戶指定嘅 M4.5 架構升級（果蠅腦 MB-WTA、9 選 1 clip trigger、section 事件＋groove lock、非對稱 AmbientGate）。

## 已完成（code 層，`work/v2/m4/webapp/`）

1. **`src/dsp.ts`** — AmbientGate 改非對稱：tauDown 1500ms（raw<slow 快落）／tauUp 25000ms（raw>slow 極慢上），`recalibrate()`＝重跑 1.2s window。
2. **`src/detector.ts`** —
   - 新 `section` 事件（3s signature EMA shift ≥0.10、cooldown 5s、confirmation 1.5s、music gate：reg≥0.35＋density≥2.0 sustained 成個 confirmation window）；
   - `tempoStepMs` 32→16＋**uniform 16ms grid resample**（max-env per slot、zero-fill skipped）；
   - groove lock：bassCutActive／buildup 期間凍結 tempoBuf＋runTempo；
   - drop 加 bar-phase bonus（±12% bar、+0.05 conf）；event 帶 `cell`（九格）；
   - `ExpStats` seed fix（頭 1s 平均做 seed，唔再用第一個 sample — 舊版令 kick-peak 開場 bias 慢 tracker 10s → 假 bassCut）；
   - `currentCell()`／`signature()`／`nearBarPhase()` helpers；state 加 signature/tempoFrozen/cell。
3. **`src/decision.ts`** — 全重寫：MushroomBody（P 2048×14 固定隨機投射 mulberry32 seed、ReLU、top-5% k-WTA=102、unit-sum）；W 9×2048 零起步；dopamine RPE `learn(kc, cell, denied)`（etaPos 3.0／etaNeg 1.2／clamp ±4）；`priorScores`（share×2.2＋motion colScore）；`decideOnEvent` 9 選 1（softmax temp 0.35、Jev conf、HOLD floor、anti-repeat bag runner≥0.05、override 唔受 bag 限）；MasterSwitch 改 cell-based。
4. **`src/decision.worker.ts`** — 全重寫：14-dim feature vector、每 sample project KC、drop/section 都觸發、override 帶 `denied` 做 RPE、`setTriggerMode`、state 帶 learnCount/lastAutoCell/triggerMode。
5. **`src/protocol.ts`** — `clipConnectPath(layerId, clipId)`。
6. **`main.ts`** — 9 格 cockpit（cand-1..9）、`triggerClip()`（trigger 目標 clip＋clear 同 column 其他兩 layer）、`fireDecision()`（clip/column 雙模式）、`userOverrideCell()`（精準 override＋學習）、grid cell click→overrideCell、`btn-tmode`、`recal-btn`、QC hooks 加 overrideCell/setTriggerMode/getLearnCount/recalibrate。
7. **`index.html`** — 9 格候選 grid、TRIGGER mode 掣、↻ 重新校準底噪掣。
8. **Tests** — `tests/decision.test.ts`＋`tests/gate.test.ts` 全重寫：**64/64 綠**、typecheck 乾淨。覆蓋 MB 稀疏性/determinism/learning、bag、9 選 1、section、groove lock、bar-phase、非對稱 gate、recalibrate、speech 無 section/drop。
9. **QC scripts** — `acceptance-m4.mjs`：piecewise pass-anchor matcher（bandLog head-silence→crash 偵測 restart）、offline replay cross-check（import StructureDetector）、runQuiet 錄 bandLog＋section 計數、wait window +16s cover restart；`acceptance-m4-real.mjs`：clip-level landing check（target clip Connected＋其他兩 layer cleared）。

## 未完成／開緊嘅 diagnostic（resume 由呢度開始）

1. **Acceptance contract (a) 而家 FAIL**（fake 路）：song-b/c 嘅 **offline replay 命中**（+22/+30/+35/+46ms）但 **live journal 缺事件**（song-b live 只有 buildup@25.06，replay 有 section@15.5/buildup@17.5/drop@21.4）。同一 bandLog、同一 source code → live≠replay 強烈暗示 **Vite worker bundle stale cache**（`node_modules/.vite`／worker chunk）。**下一步：restart dev server（清 cache）再跑 acceptance。**
2. **song-a live+replay 都冇 drop**：drop window（24.7s）novLow 2.8／lowDom true 但 **reg≈0.10**（standalone path 要 ≥0.22）；buildup 遲到 28.4s（drop 之後）→ 冇 pending/bassCutMemory context。song-c drop#1 同樣（reg 0.07–0.09）。**疑點：uniform-grid ACF 喺 groove 段 reg 偏軟**（bpm lock 到 125/139 但 peak <0.12 邊緣）；對照 song-b/c drop#2 靠 bassCutMemory pending（reg force 0.5）先過。**候选修法：(a) bassCut threshold 放寬（lowEma < 0.55×lowLong）令 build-up/bassCutMemory 喺 drop 前成立；(b) reg gate 對 post-bassCut 上下文都 force；(c) 查 uniform grid zero-fill 有冇 dilute ACF。**
3. Speech/silence contract (b) 而家 PASS（section gate 生效）。Contract (c) PASS（0.4ms）。
4. Real 路（Arena）未用 M4.5 code 重跑（要 restart Arena＋dev server 後跑 `acceptance-m4-real.mjs`）。
5. 文件對齊（用戶要求 #5 後半）**未做**：根 `HANDOFF.md`、`README.md`、`docs/FLYVJ_HANDOFF.md`、`docs/SPEC_V2.md` 未更新到 M4.5 狀態；`docs/M4_RESULT.md` 未加 M4.5 addendum。

## 環境狀態（pause 時）

- Vite dev server：background job `pwsh-67338610c6764cfc`（port 5200）— **resume 時建議 kill 再起（清 cache）**。
- Arena：已 close（M4 real 路跑完後 Stop-Process）。
- Chrome evidence instance：acceptance 自己 kill；pause 時應該冇殘留（`killStaleEvidenceChrome()` 會清）。
- 證據檔：`work/v2/m4/acceptance-m4.json`（最新一輪 a:false/b:true/c:true）、`acceptance-bands-{song-a,song-b,song-c,silence,speech}.json`、`work/v2/m4/evidence/`。

## Resume 順序建議

1. Kill dev server job → 清 `work/v2/m4/webapp/node_modules/.vite` → 再起。
2. 修 #2（bassCut/reg context）→ `npm test` 64 綠。
3. 跑 `acceptance-m4.mjs` 全套 → 四契約綠。
4. 起 Arena → `acceptance-m4-real.mjs` → clip-level landed＋PrintWindow vision QC（主管 read_image）。
5. 文件對齊（HANDOFF/README/SPEC/M4_RESULT addendum/M5 ticket 微調）。
