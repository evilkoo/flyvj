# 2026-11-28 M4.6 Stage A（Phase 0＋1＋2）RESULT：PASS

一句話：Arena 連線安全化（Safe Attach 只讀＋手動 sync 二次確認）、動態 M×N Grid＋語義/實體解耦（`src/mapping.ts`）、實戰模仿學習 Performance Capture（錄製→訓練→還原全鏈）落地；90 unit tests 綠、typecheck/build exit 0、QC Gate 1/2A/2B 全 PASS。

## 0｜範圍

- Stage A＝Phase 0（安全止血＋底層清理）＋Phase 1（動態 M×N Grid）＋Phase 2（M4.6 Capture/Train/Rollback）。全部 2026-11-28 完成。
- Stage B（未動工，按序）＝Phase 3 M5 Tagging + Edit Tab（`docs/M5_TICKET.md`）→ Phase 4 M4.7 Dashboard-First Motor Layer → Phase 5 Perform Mode + M6 3070 Ti 20 分鐘實測。

## 1｜Phase 0（安全止血＋底層清理）

### Safe Attach（預設只讀連線）

- 移除 WS `isComposition` 自動呼叫 `syncManifestToArena()`。
- 改為計算 dry-run `planSync` 差異數並顯示 `#attach-bar`；新增手動 `#btn-sync-arena`，加 `window.confirm` 二次確認。
- 保證：連上真實 5×11 `.avc` 絕不自動覆寫（唔會改動表演片）。

### 零重建即時刷新

- 拆分 `buildGridDom()`（結構／mapping 變化先建 DOM）與 rAF 合併 `updateGridLiveState()`（僅切換 `.connected`／`.col-on` class，零 `innerHTML = ""`）。

### Worker & 效能修復

- `src/decision.worker.ts`：修正 `lastSampleT = m.tMs` 更新。
- `src/decision.ts`：`MushroomBody.project(x)` 改為預先分配 `actBuf`/`topVal`/`topIdx` ＋ O(KC·log K) min-heap（與原 stable sort **bit-for-bit 一致**，經 `BigUint64Array` 單測驗證）。
- `#btn-reset-brain` 加 `window.confirm` 保護；`__flyvj.m4.resetBrain()` 保持無阻擋（程式化調用不受影響）。

## 2｜Phase 1（動態 M×N Grid＋語義/實體解耦）

- 新增純模組 `src/mapping.ts`：
  - 果蠅腦 9 格語義槽（`0..8`）↔ Arena 任意 `L×C` 實體格位解耦。
  - per-layer 角色 `exclusive` / `overlay` / `ignore`（預設 L1–L3=`exclusive`、L4+=`overlay`）。
  - `layersToClearForTarget`：確保 `overlay`／`ignore` 永不被清走。
  - `resolveSemanticToPhysical`：支援池內 Bag 不連撞輪播。
  - `physicalToSemantic`：區分顯式綁定、3×3 預設與未映射（`L4+/C4+`）。
- `src/protocol.ts`：新增 `layerClearPath` 及 `WsLayer.master?`（為 M4.7 預留）。
- UI：`#grid-wrap`（橫向捲動、Arena 層序由上至下、顯示真 Layer 名＋可點擊 `EXCL`/`OVLY`/`IGN` role pill）＋ `#btn-bind-mode` ＋ `#bind-slot-select` 綁定模式。

## 3｜Phase 2 / M4.6（實戰模仿學習 Performance Capture）

- 新增純模組 `src/external-detect.ts`（`ExternalLaunchDetector`）：hydration 靜默、rising-edge only、1500ms self-fire clip/column 抑制。
- `src/capture.ts` 升級：
  - `windowedTrace` 喺 `[t-400ms, t+100ms]` 揀選高顯著性幀，對齊人手反應延遲。
  - `argmaxCellFromTrace` 改用 `balancedBands`（修正舊版用 raw `x[0..2]` 嘅推理偏差）。
  - `batchTrainMB` 跳過未綁定（`cell:null`）與已訓練（`trained:true`）項目、使用類別平衡 `etaScale` 防單格飽和，並回傳 `trainedIndices` 支援一鍵 rollback。
- 類型安全合約：`decision.worker.ts` 匯出 `WorkerInMsg`，`main.ts` 全部經 `postWorker(msg: WorkerInMsg)` 發訊；新增 `tests/worker-contract.test.ts` 覆蓋 `sample -> setRecording -> captureExternal -> override(REC, trained:true) -> trainCapture -> rollbackTrain -> clearCapture` 全流程。
- UI：`#capture-bar`（`#btn-rec`／`#rec-status`／`#btn-train`／`#btn-rollback`／`#btn-clear-rec`、`flyvj.capture.v1` 持久化、`#btn-export-brain` 匯出含 `mapping`＋`capturePairs`）。

## 4｜UI Before / After（1280×720 單屏無溢出）

| 項目 | Before | After |
|---|---|---|
| `#viewport-col` | 960px (16:9) | 580px；canvas backing 580×326 ≤ 1280×720 |
| `#side-col` | — | `flex: 1 1 0; min-width: 0` |
| 整頁 | — | 實測 `scrollWidth 1265 ≤ innerWidth 1280` |
| 5×11 grid | 整頁溢出 | `#grid-wrap` 內部橫向捲動（`scrollWidth 1364 > clientWidth 647`） |

風格：`outline: 1px solid #4ade80`、`120ms/140ms ease-out`、`tabular-nums`；無裝飾性漸層。

## 5｜驗收證據（全部實測 PASS，2026-11-28）

| Gate | 結果 |
|---|---|
| `npm test` | **90 pass / 0 fail / 0 skipped**（原 67 ＋ 新增 23 條：`mapping.test.ts`、`capture.test.ts`、`worker-contract.test.ts` ＋ `decision`/`protocol` 新用例；198ms） |
| `npm run typecheck` | exit 0（0 errors） |
| `npm run build` | exit 0（`index.html` 20.92 kB、`decision.worker` 24.83 kB、`index` 525.99 kB，680ms；`node_modules/.vite` 已清） |
| QC Gate 1（`dfmodel` max） | PASS |
| QC Gate 2A Re-check（`mmodel` max；初輪捉到並已修正 5 處 worker-main 訊息名偏差） | PASS |
| QC Gate 2B Visual Director（`gemini-4-hydrogen` high；0 JS `pageerror`；隔離 Chrome PID 已清理） | PASS |

截圖：`work/v2/m4/evidence/stage-a-01-initial.png`、`work/v2/m4/evidence/stage-a-02-5x11-bind.png`、`work/v2/m4/evidence/stage-a-03-capture-train.png`。

## 6｜5×11 真實 Arena 快速操作指南

1. 連上 Arena（確認頂部顯示 `Safe Attach 只讀連線`，唔會改動你啲片）。
2. 檢查每層 Role Pill（L1–L3 預設 `EXCL` 互斥、L4–L5 預設 `OVLY` 疊層唔會被清）；開 `🔗 綁定語義槽` 將第 4–11 欄常用片綁入 9 個語義槽（或留空只作紀錄）。
3. 撳 `▶ Start` 開 mic → `⏺ 錄製表演` → 直接喺 Arena 親手切 clip 表演 → `⏹ 停止錄製` → `⚡ 訓練果蠅腦`（如唔滿意可撳 `↩ 還原訓練`）。

## 7｜備註

- QC Gate 2A 初輪捉到 worker-main 訊息名 5 處偏差，先落 `WorkerInMsg` 類型合約再 re-check 至 PASS — 類型合約係 compile-time 保證，唔靠人眼。
- 延續舊教訓：build／dev 前清 `node_modules/.vite`（worker bundle stale）。
- 本檔只記 session fit／覆核一致率性質證據，不作任何 accuracy % 宣稱（單測為確定性行為驗證）。

— Stage A 寫於 2026-11-28（Asia/Shanghai）。
