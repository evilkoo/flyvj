# M4 TICKET — 慢層決策 ＋ Decision Cockpit（v2 路線）

開票：2026-11-17（M3 PASS 後）。規格全文見 `docs/SPEC_V2.md` §Milestone 4。

## 目標

結構事件偵測（build-up/drop）→ Column 決定 → cockpit 顯示理由＋置信度 → trigger；人手 override 永遠優先。第一次見到「VJ 自己揀 clip」。

## 輸入（M1–M3 已交付）

- App 底子：`work/v2/m3/webapp/`（Vite port **5200**；`src/protocol|manifest|watchdog|dsp|audio|model|flyrig|renderer.ts` 全复用）。
- **三頻輸入契約（M3 新增）**：食 `BandSampler` gate 後嘅 bands（AmbientGate DC removal tau 6s）；raw 用 `getRawBands()` QC hook。Start 必須喺播歌前撳（calibration 1.2s）。
- DSP 參數沿用：FFT 2048、attack 50ms／release 220ms、三頻邊界同 CONTEXT。
- 決策研究：`docs/research/edm-structure-detection.md`（streaming heuristic：drop＝LOW novelty peak＋energy 回升；build-up＝bass cut＋riser＋onset density 加速；coarse tempo＝onset envelope autocorrelation snap 8/16-bar）、`docs/research/fast-decision-models.md`（confidence 算式 `(p_max−1/n)/(1−1/n)`）。
- UI 研究：`docs/research/vj-console-ui-patterns.md` idea 4（cockpit）＋HAX G2/G8/G9/G12/G17。
- Grid／WS trigger（M2）：`triggerColumn(colId, n)` 已封裝；Region Mapping 表（腦區↔九格↔column）見 CONTEXT。

## 做

1. **Streaming heuristic detector**（worker 內，主訊框唔 BLOCK — 契約 d）：
   - onset envelope（spectral flux 或 band-diff）→ onset density；
   - LOW novelty peak（relative to running mean/variance）→ drop 候選；
   - build-up：bass cut（LOW 下陷）＋HIGH riser＋onset density 加速；
   - coarse tempo：onset envelope autocorrelation → BPM 估計 → snap 8/16-bar grid；
   - 信心低 → HOLD（唔換）。
2. **Decision → Column**：drop 確認後按 Region Mapping／九格能量級揀 column（LOW/MID/HIGH dominant → column 1/2/3 v0，可調 taste）；trigger 經 M2 WS path。
3. **Decision Cockpit UI**（側欄新增 panel）：n-best 候選列、confidence、近因 ticker（最近決定＋原因一句）、HOLD 顯示、一鍵 veto／手動選格 override（HAX G17 全局開關：override 後自動決定讓位直至明確還畀）。
4. **Drop 全身大動作**（M3 預留位）：drop 確認時 avatar 全身動作（bandsToPose 加 `dropPulse` 輸入）。
5. 保留 M3 全部（avatar、gate、grid、WS、watchdog、context-loss 契約）。

## 驗收契約（SPEC 原文）

(a) 3 條標明 drop 時間嘅 EDM 測試歌：drop 落點 ±0.5s 內 app 有決定輸出（實際誤差逐條記錄，唔宣稱統計準確率）；
(b) 靜音／說話環境 → HOLD 唔亂換；
(c) override 輸入後 ≤100ms 生效且自動決定讓位俾用戶直至明確還畀；
(d) 全程零 sidecar：所有計算喺 browser worker 內，主訊框唔 BLOCK（開發機 performance log 為證）。
證據：測試歌 timecode vs app 決定 log 對照表、錄屏、screen-cap vision QC。

## 禁止

- 唔碰用戶真 show `.avc`；唔郁 `server.xml`；唔裝新軟件。
- 唔引入 Python 模型／雲端 API（ADR 0007）；唔宣稱已驗證準確率百分比。
- 唔用 ready-made offline 結構模型硬改 streaming（research 已證實失敗）。
- QC 唔用 Edge（用戶指定）；用 `qc-assets/launch-chrome.mjs`。

## 測試資產提示

- 合成 EDM 測試歌可用 `qc-assets/make-test-song.mjs` 擴展（加明確 drop 時間戳段）；3 條標明 drop 時間嘅歌要記錄 timecode 表。
- 說話環境測試：TTS 或真說話錄一段 wav 做 fake capture。
