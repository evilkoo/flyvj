# M5 TICKET — Clip 庫 Tagging Pipeline（v2 路線）

開票：2026-11-17（M4 PASS 後）。規格全文見 `docs/SPEC_V2.md` §Milestone 5。

## 目標

用戶補路徑後，成個庫入九格：本地 ffmpeg 抽 frame 統計 → 九格建議 → app 內覆核 UI（逐格拖放改判）→ 產出正式 manifest＋Resolume composition 匯入建議。**冇排好嘅庫，Region Mapping 無嘢可映、OSC 冇地址可發 — 呢個係落地 critical path。**

## 輸入（M1–M4 已交付）

- App 底子：`work/v2/m4/webapp/`（Vite port **5200**；protocol/manifest/watchdog/dsp/audio/model/flyrig/renderer/detector/decision/worker 全复用）。
- 九格分類（CONTEXT）：3 能量級（LOW/MID/HIGH-dominant）× 3 運動級（靜/中/動）；每格目標 5–15 clip。
- Manifest schema（M2 `src/manifest.ts`）：`{layer, column, energy, motion, source, name, tags}`；planSync 已封裝（open＋rename ops）。
- 用戶 9 條測試 clip 路徑（**未補 — 開工前問用戶攞；未補就用 Alley dummy 照走，同 M2 彈性**）。
- ffmpeg 已裝（本地，已批准合成測試音檔；抽 frame 統計同屬本地處理，唔上傳素材）。
- UI 研究：`docs/research/vj-console-ui-patterns.md` idea 3（Learn Mode 映射配對）＋Edit/Perform 雙態（idea 1）。

## 做

1. **Tagging script**（Node＋ffmpeg，本地）：每條 clip 抽 N 幀（例如每秒 2 幀、上限 200 幀）→ 統計：
   - 亮度 mean/variance；
   - 幀間差（運動量）mean/p95；
   - 色相分佈（dominant hue bins）；
   → 映射建議：運動量→motion 軸（靜/中/動 三分位，threshold 入 config JSON 可調）；能量軸**暫用用戶手填或檔名 hint**（視覺統計推唔到音訊能量 — 九格能量軸對應音樂 band，唔係畫面亮度；呢個係設計判斷，ticket 要明寫）。
2. **覆核 UI**（app 內 Edit tab，idea 1 雙態）：九格 board＋未分池；逐格拖放改判；未覆核項目有明確「未確認」標示，唔混入可選池（契約 c）。
3. **產出**：正式 `manifest.json`（M2 schema）＋Resolume composition 匯入建議（DXV/檔案路徑對照表，markdown）。
4. 保留 M1–M4 全部（grid/WS/watchdog/avatar/gate/decision/cockpit）。

## 驗收契約（SPEC 原文）

(a) 全庫每條 clip 有經用戶覆核嘅格位；
(b) manifest↔composition 實際格位抽驗 10% 一致；
(c) 未覆核項目喺 UI 有明確「未確認」標示，唔混入可選池。
證據：manifest diff、覆核前後對照記錄、screen-cap vision QC。

## 禁止

- 唔碰用戶真 show `.avc`；唔郁 `server.xml`；唔裝新軟件。
- 唔上傳素材、唔用雲端視覺 API（CONTEXT「自動 Tagging 工序」）。
- 唔將視覺統計當音訊能量證據（九格能量軸＝音樂 band dominance，要用戶覆核或音訊分析）。
- QC 唔用 Edge；用 `qc-assets/launch-chrome.mjs`。

## 測試資產提示

- 用戶 9 條 clip 未補前：用 Alley dummy generators（M1 dummy-grid）＋ffmpeg 可合成嘅簡單測試片（亮度/運動量已知）做 pipeline 驗證。
- 覆核 UI 驗收可用 CDP 模擬拖放（`qc-assets/cdp.mjs` eval）。

— 開票 2026-11-17。
