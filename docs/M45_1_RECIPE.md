# M4.5.1 RECIPE — 實戰影片審核修復 ＋ 果蠅腦經驗持久化（供 DSH / Qwen Flash 直接執行）

開票日期：2026-11-18  
來源：專案主管＆顧問對用戶實戰錄影 `FlyVJ M4 — Decision Cockpit - Google Chrome 2026-11-18 03-31-27_1.mp4`（KI/KI 150 BPM live set · Azure Kinect Mic · Arena 3L×9C）嘅逐幀審核。  
目標目錄：`work/v2/m4/webapp/`（**只改呢個目錄下嘅檔案，禁止開新目錄**）。

---

## 0｜背景與要解決嘅 5 個具體問題

1. **【Bug 1｜Build-up 九宮格空白】**：片中 `02:35–02:51` 當 `ev.type === "buildup"` 觸發時，`src/decision.worker.ts` 發出 `candidates: []`，令 `main.ts` `renderCandidates()` 將九宮格全部抹成 `—`（0% bar）。
2. **【Bug 2｜1–3 秒乒乓連跳】**：片中出現 `3:33:31 SECTION` → `3:33:32 DROP`（1 秒連跳）同 `3:31:36 DROP` → `3:31:39 SECTION`（3 秒連跳）。原因係：
   - `drop` 觸發時設 `this.sigBase = null`，下一 tick 即刻喺 Drop 瞬態最高峰重新 anchor `sigBase`，3 秒後能量回落即誤觸發 `SECTION`；
   - `section` 喺 `bassCutActive` 或 `buildup` 期間冇被擋住，搶喺 Drop 前 1 秒發射；
   - `drop` 與 `section` 冇共用最小換片間隔。
3. **【Bug 3｜`L1`（LOW）壟斷 96% 機率，`L2/L3` 永不出頭】**：全片 20 次 Trigger 有 17 次落喺 `L1`、`L3` 係 0 次。原因係 FFT 頻段 bin 寬度唔對稱＋空間收音高頻衰減（`LOW` 均值 ~0.24 vs `HIGH` ~0.02），直接用絕對 `bands` 算 share 永遠係 `LOW` 贏；且 `section` 事件傳咗瞬時 `m.bands` 而非 3s `st.signature` 入 `decideOnEvent`。
4. **【Bug 4｜Arena 7.23 Clip Trigger Latch 偶發失靈】**：`main.ts` `triggerClip()` 先發 `clip/connect`（帶 `value: true` 長按唔放）再發 `layer/clear`；按 M1 實測協議，WebSocket `action: "trigger"` **省略 `value` 先係完整 short-press（press+release）**，而且應該先 clear 其餘兩層再 short-press 目標 clip。
5. **【功能 5｜果蠅腦經驗持久化 ＋ 人手示範錄製器】**：目前 `MushroomBody.W` 只留喺 Worker RAM，F5 重載即清零。用戶下一步會「親手玩一首歌錄影＋餵經驗」，需要：
   - `localStorage` 自動保存／載入 `MushroomBody` 權重 `W` 同 `learnCount`；
   - 記錄用戶每次手動撳格（Override）瞬間嘅音樂特徵快照（`humanDemoLog`）；
   - Cockpit 顯示 `🧠 已學習 N 次`，並提供「💾 匯出經驗 JSON」與「🗑 重置腦記憶」按鈕。

---

## 1｜逐檔修改 Recipe（請嚴格按此實作）

### Step 1.1：`work/v2/m4/webapp/src/detector.ts` — 消滅 1–3 秒乒乓連跳

1. 喺 ` StructureDetector.update()` 入面，當 **Drop 觸發時**（約 line 462–469）：
   - **唔好設 `this.sigBase = null`**（否則下一 tick 會喺 Drop 最高峰 anchor）；
   - 改為同步更新 `this.lastSectionT = t;`（令 Drop 後至少 `DET.sectionCooldownMs` 內唔會即刻觸發 Section）。
   ```ts
   this.lastDropT = t;
   this.lastSectionT = t; // 共用換片冷卻：Drop 後 5s 內唔准即刻觸發 Section
   this.phase = "drop";
   this.phaseUntil = t + DET.dropPhaseMs;
   this.buildupFired = false;
   this.buildupSince = 0;
   this.pendingDropUntil = -1e9;
   this.sectionPendingSince = 0;
   ```
2. 喺 **Section 事件檢查條件**（約 line 491–495）：
   - 加入 `this.phase === "idle" && !bassCutActive && t - this.lastDropT >= DET.sectionCooldownMs`，防止喺 Build-up / Bass-cut 期間搶閘換片（消滅 Drop 前 1 秒誤觸發）：
   ```ts
   if (
     warm && this.sigBase !== null &&
     t - this.lastSectionT >= DET.sectionCooldownMs &&
     t - this.lastDropT >= DET.sectionCooldownMs &&
     this.phase === "idle" && !bassCutActive
   ) {
   ```
3. 喺 **Phase bookkeeping**（約 line 531–533），當 `"drop"` 階段結束時，先將 `sigBase` 重設為落定後嘅 `sigEma`：
   ```ts
   if (this.phase === "drop" && t > this.phaseUntil) {
     this.phase = this.buildupScoreEma >= DET.buildupScoreEma ? "buildup" : "idle";
     this.sigBase = { ...this.sigEma }; // Drop 瞬態結束後先 re-anchor 新段落基準
     this.sectionPendingSince = 0;
   }
   ```

---

### Step 1.2：`work/v2/m4/webapp/src/decision.ts` — 頻段相對平衡 `rebalanceBands` ＋ 權重匯出/載入

1. 喺 `MushroomBody` class（約 line 161）新增序列化 helper：
   ```ts
   exportWeights(): { weights: number[]; learnCount: number } {
     return { weights: Array.from(this.W, (v) => +v.toFixed(5)), learnCount: this.learnCount };
   }

   loadWeights(weights: ArrayLike<number>, learnCount = 0): boolean {
     if (!weights || weights.length !== 9 * MB.KC) return false;
     for (let i = 0; i < this.W.length; i++) {
       const v = Number(weights[i]);
       this.W[i] = Number.isFinite(v) ? clampW(v) : 0;
     }
     this.learnCount = Math.max(0, Math.floor(learnCount));
     return true;
   }
   ```
2. 喺 `priorScores` 上方新增 pure 函數 `rebalanceBands(bands: BandEnergy, ref: BandEnergy): BandEnergy`：
   - 用途：喺真實收音環境下，用慢速基準 `ref`（或各頻段自然底線）對三頻做相對突顯度校正，同時**嚴格保持 `low + mid + high === total` 不變**（確保 `HOLD_FLOOR` 完全一致），解鎖 `L2`（MID）與 `L3`（HIGH）：
   ```ts
   export const BAND_REF_FLOOR: BandEnergy = { low: 0.08, mid: 0.03, high: 0.015 };

   /**
    * Rebalance raw/gated band shares against a slow running reference so acoustic spectral
    * tilt (LOW ~0.24 vs HIGH ~0.02 on room mics) does not lock 96% probability onto Row 1.
    * Preserves exact total energy (low + mid + high) so HOLD_FLOOR is unaffected.
    */
   export function rebalanceBands(bands: BandEnergy, ref: BandEnergy = BAND_REF_FLOOR): BandEnergy {
     const total = bands.low + bands.mid + bands.high;
     if (total <= 0) return { low: 0, mid: 0, high: 0 };
     const rl = bands.low / Math.max(ref.low, BAND_REF_FLOOR.low);
     const rm = bands.mid / Math.max(ref.mid, BAND_REF_FLOOR.mid);
     const rh = bands.high / Math.max(ref.high, BAND_REF_FLOOR.high);
     const rSum = rl + rm + rh;
     if (rSum <= 0) return { ...bands };
     return {
       low: total * (rl / rSum),
       mid: total * (rm / rSum),
       high: total * (rh / rSum),
     };
   }
   ```
   *(注意：`priorScores(bands, density)` 本身保持唔變，確保舊有單元測試 100% 兼容！)*

---

### Step 1.3：`work/v2/m4/webapp/src/decision.worker.ts` — 修復 Build-up 空陣列 ＋ 接入 `rebalanceBands` ＋ 權重同步

1. 喺 Worker 頂部新增慢速頻段基準 tracker `bandRef`（tau ≈ 15 秒）：
   ```ts
   import {
     decideOnEvent, MasterSwitch, MushroomBody, rebalanceBands, BAND_REF_FLOOR,
     type CellCandidate, type Decision, type TriggerMode,
   } from "./decision.ts";

   let bandRef: BandEnergy = { ...BAND_REF_FLOOR };
   let lastRefT = 0;
   ```
2. 喺 `InMsg` union 新增載入/重置權重訊息：
   ```ts
   interface LoadWeightsMsg { type: "loadWeights"; weights: number[]; learnCount: number; }
   interface ResetWeightsMsg { type: "resetWeights"; }
   type InMsg = SampleMsg | OverrideMsg | HandBackMsg | HoldMsg | AutoMsg | ResetMsg | ModeMsg | LoadWeightsMsg | ResetWeightsMsg;
   ```
3. 喺 `case "sample":` 入面：
   - 更新 `bandRef`（當 `st.total > 0.04` 時，以 `tau = 15000ms` 慢速追蹤 `st.signature` 嘅絕對能量 `m.bands`）：
     ```ts
     const dtRef = Math.max(1, Math.min(250, m.tMs - lastRefT));
     lastRefT = m.tMs;
     if (st.total > 0.04) {
       const aRef = 1 - Math.exp(-dtRef / 15000);
       bandRef.low += (m.bands.low - bandRef.low) * aRef;
       bandRef.mid += (m.bands.mid - bandRef.mid) * aRef;
       bandRef.high += (m.bands.high - bandRef.high) * aRef;
     }
     ```
   - 計算經過相對平衡嘅決策頻段：
     - 對 `drop` 事件：用瞬時 `rebalanceBands(m.bands, bandRef)`（保留 Drop 瞬間嘅低頻爆發）；
     - 對 `section` 或 `buildup` 事件：將 3 秒 `st.signature` 乘返 `st.total` 再做 `rebalanceBands`，避免俾單一 frame 嘅 kick peak 拉偏！
     ```ts
     const sigScaled: BandEnergy = {
       low: st.signature.low * st.total,
       mid: st.signature.mid * st.total,
       high: st.signature.high * st.total,
     };
     const liveBalanced = rebalanceBands(sigScaled.low + sigScaled.mid + sigScaled.high > 0 ? sigScaled : m.bands, bandRef);
     ```
   - **修復 Bug 1（Build-up 唔再發空 `candidates: []`）**：
     喺 `if (ev)` 入面，當 `ev.type === "buildup"` 時，用 `decideOnEvent(ev, liveBalanced, st.density, { lastAutoCell, kc, mb }, m.tMs, "auto").candidates` 填入 `candidates`，等 Build-up 期間九宮格繼續顯示實時候選機率！
   - 喺 `postState(tMs)` 入面，順便帶上 `liveCandidates`（用 `decideOnEvent` 算當前 9 格候選），令非事件期間九宮格進度條都可以每 100ms 實時跳動！
4. 喺 `case "override":`、`case "loadWeights":`、`case "resetWeights":`：
   - 當 `mb.learn(...)` 或 `mb.resetWeights()` 發生時，向主線程 post `{ kind: "weights", ...mb.exportWeights() }`，等主線程自動寫入 `localStorage`。

---

### Step 1.4：`work/v2/m4/webapp/main.ts` ＆ `index.html` — Arena Clip Short-Press ＋ 經驗記憶鎖 UI

1. **修復 `renderCandidates(d: Decision)`（`main.ts` 約 line 279）**：
   - 開頭加防呆：`if (!d.candidates || d.candidates.length === 0) return;`，永不將九宮格清成 `—`。
   - 支援 `renderLiveCandidates(cands: CellCandidate[])`（喺 `state` 訊息收到 `liveCandidates` 時更新百分比同進度條，但保留上次 Trigger 嗰格嘅 `.top` 綠框）。
2. **修復 `triggerClip()`（`main.ts` 約 line 371）**：
   - 先對其餘兩個 Layer 發 `/composition/layers/${r}/clear`；
   - 再發目標 Clip trigger，**省略 `value` 欄位**（標準 short-press）：
   ```ts
   for (let r = 1; r <= ROWS; r++) {
     if (r === cell.row) continue;
     ws.send(JSON.stringify({ action: "trigger", parameter: `/composition/layers/${r}/clear` }));
   }
   ws.send(JSON.stringify({ action: "trigger", parameter: clipConnectPath(cell.row, cell.col) }));
   ```
3. **新增 `localStorage` 持久化 ＋ 人手示範錄製器（`main.ts` + `index.html`）**：
   - Storage Key：`const BRAIN_STORAGE_KEY = "flyvj.mb.v1";` 同 `const DEMO_STORAGE_KEY = "flyvj.demo.v1";`
   - 啟動時（worker 初始化後）：從 `localStorage.getItem(BRAIN_STORAGE_KEY)` 讀取 `{ weights, learnCount }`，若有則 `worker.postMessage({ type: "loadWeights", weights, learnCount })`。
   - 收到 Worker `{ kind: "weights", weights, learnCount }` 時：自動 `localStorage.setItem(BRAIN_STORAGE_KEY, JSON.stringify({ weights, learnCount, updatedAt: Date.now() }))`，並更新 `#learn-badge` 顯示 `🧠 已學習: ${learnCount} 次`。
   - 每次用戶手動撳格 `userOverrideCell(cell)` 時：喺 `humanDemoLog` push 一條完整快照：
     ```ts
     humanDemoLog.push({
       wall: Date.now(),
       tMs: +songNow().toFixed(1),
       cell: cellLabel(cell),
       row: cell.row,
       col: cell.col,
       bands: { ...bands },
       raw: sampler ? sampler.lastRaw() : null,
       detector: detectorState ? {
         phase: detectorState.phase,
         bpm: detectorState.bpm,
         density: +detectorState.density.toFixed(2),
         novLow: +detectorState.novLow.toFixed(2),
         regularity: +detectorState.regularity.toFixed(3),
         buildupScore: +detectorState.buildupScore.toFixed(2),
         signature: detectorState.signature,
       } : null,
     });
     ```
   - 喺 `index.html` `#master-btns` 加入兩粒按鈕：
     - `<button id="btn-export-brain" title="匯出果蠅腦權重＋人手撳格示範紀錄 JSON">💾 匯出經驗</button>`
     - `<button id="btn-reset-brain" title="清空果蠅腦學習權重">🗑 重置記憶</button>`
     - 喺 `#cockpit-head` 加入 `<span id="learn-badge" style="font-size:12px;color:#a7f3d0;margin-left:auto">🧠 已學習: 0 次</span>`
   - 喺 `__flyvj.m4` QC hooks 暴露：
     - `getHumanDemoLog: () => humanDemoLog`
     - `exportBrain: () => ...`
     - `resetBrain: () => ...`

---

## 2｜新增單元測試（`work/v2/m4/webapp/tests/decision.test.ts`）

喺 `tests/decision.test.ts` 尾段新增以下 4 個契約級測試（並確保原有 64 個測試全綠）：

1. **`detector: no spurious section event within sectionCooldownMs right after a drop`**：
   跑 `edmBands`（0–6s groove → 6–13s build-up → 13s drop → 13–20s groove），驗證 `drop` 觸發後 5 秒內（13s–18s）**0 個 `section` 事件**，亦唔會喺 build-up（6s–13s）期間誤發 `section`。
2. **`rebalanceBands: acoustic bass-heavy tilt unlocks MID and HIGH rows when they rise above reference`**：
   當 `ref = { low: 0.24, mid: 0.04, high: 0.02 }`（真實 Kinect 收音均值）：
   - 當 `mid` 升至 `0.09`（`low=0.18, high=0.02`），`priorScores(rebalanceBands(b, ref), 3)` 最高分必為 `row: 2`（MID）；
   - 當 `high` 升至 `0.06`（`low=0.15, mid=0.03`），最高分必為 `row: 3`（HIGH）；
   - 且 `rebalanceBands` 後三頻總和與原 `total` 誤差 `< 1e-9`。
3. **`MB: exportWeights and loadWeights round-trip preserves learned preferences`**：
   訓練 `mb1.learn(...)` 5 次 → `const dump = mb1.exportWeights()` → 新建 `mb2 = new MushroomBody()` → `mb2.loadWeights(dump.weights, dump.learnCount)` → 驗證 `mb2.learnedScores(kc)` 與 `mb1.learnedScores(kc)` 完全相等且 `mb2.learnCount === 5`。

---

## 3｜執行與驗收步驟（DSH / Qwen Flash Checklist）

1. 按 Step 1.1–1.4 修改：
   - `work/v2/m4/webapp/src/detector.ts`
   - `work/v2/m4/webapp/src/decision.ts`
   - `work/v2/m4/webapp/src/decision.worker.ts`
   - `work/v2/m4/webapp/main.ts`
   - `work/v2/m4/webapp/index.html`
   - `work/v2/m4/webapp/tests/decision.test.ts`
2. **必做清 Cache（M4.5 教訓）**：
   刪除 `work/v2/m4/webapp/node_modules/.vite` 後再重啟 Vite dev server（port 5200）。
3. 跑測試與型別檢查：
   ```powershell
   cd work/v2/m4/webapp
   npm run typecheck
   npm test
   ```
   確認 **67/67 unit tests 全綠**、0 TS error。
4. 跑自動化驗收（遵守用戶規則：只用 `chrome-evidence` profile，**嚴禁 `taskkill /IM chrome.exe`**）：
   - 確認 `node work/v2/m4/qc-assets/acceptance-m4.mjs` 四契約全 PASS；
   - 用 `cdp.mjs` 驗證：
     1. Build-up 期間 `#cand-1..9` 唔再出現 `—`；
     2. Override 撳格後 `localStorage.getItem("flyvj.mb.v1")` 有寫入，Reload 頁面後 `#learn-badge` 仍然保留 `🧠 已學習: N 次`。
5. 完成後更新 `docs/M4_RESULT.md`（加 M4.5.1 小節）同 `docs/FLYVJ_HANDOFF.md`。
