# M3 TICKET — Avatar viewport（開始見到「VJ 有反應」）（v2 路線）

開票：2026-11-17（M2 PASS 後）。規格全文見 `docs/SPEC_V2.md` §Milestone 3。

## 目標

mic → 三頻能量 → 3D 果蠅 VJ 角色身體反應（Q30 默認映射）。第一次見到「音樂令 VJ 有反應」。

## 輸入（M1/M2 已交付）

- App 底子：`work/v2/m2/webapp/`（Vite port 5199；`src/protocol.ts`／`manifest.ts`／`watchdog.ts` 复用；grid＋WS 已穩）。
- 協議實測：`docs/M1_RESULT_V2.md`；M2 live findings：`docs/M2_RESULT.md`。
- DSP 參數（research 證實合理，沿用）：AnalyserNode FFT 2048；attack 50ms／release 220ms；三頻 LOW 30–180Hz／MID 180–2500Hz／HIGH 2500–min(8000, Nyquist)Hz。
- 身體映射默認（CONTEXT「三頻身體映射」，可調 taste）：LOW→腳/身體、MID→觸鬚/頭、HIGH→翅、drop→全身大動作（drop 偵測係 M4，M3 只做三頻連續反應）。

## 做

1. **Model source 可換介面**（ADR 0007）：`model source → joint/morph parameters → renderer`。第一版 model source＝**程序化卡通果蠅**（Three.js 幾何直接 build，零外部 asset → 授權 100% 乾淨，免逐項核 license）；介面預留之後換開源骨骼模型／NeuroMechFly v2。
2. getUserMedia constraints：`autoGainControl:false`、`echoCancellation:false`、`noiseSuppression:false`；啟動後 `getSettings()` 讀**實際**狀態並顯示喺 UI（唔假設成功，CONTEXT「AGC 對策」）。
3. 需要一次 user gesture 撳「Start」先有聲音分析（autoplay 政策；UI 明示按鈕）。
4. AudioWorklet 或 ScriptProcessor→AnalyserNode FFT 2048 → 三頻能量（attack/release smoothing）；計算放 worker 或至少唔 BLOCK 主訊框（M4 契約 d 嘅前奏）。
5. Canvas ≤1280×720；Three.js 資源 dispose 契約化；**context-loss 有 dispose＋重建**（舊 M3C FAIL 教訓）。
6. Grid／WS 功能保留（M2 成果唔好拆）。

## 驗收契約（SPEC 原文）

(a) 播真歌（喇叭對住 mic）時三個部位明顯唔同頻各自反應，paused/靜音時 2 秒內歸零；
(b) canvas ≤1280×720；
(c) 開發機 GPU 佔用量記錄（作為表演機推算輸入）；
(d) AGC 狀態顯示正確（`getSettings()` 對照 Windows sound 設定截圖）；
(e) context-loss 有 dispose＋重建。
證據：screen-cap vision QC（初始／反應中／靜音三組）、錄屏。

## 禁止

- 唔碰用戶真 show `.avc`；唔郁 `server.xml`；唔裝新軟件（Three.js 係 npm devDep，OK）。
- 唔宣稱真生物 firing／已驗證 FPS（話術約束）。
- 模型若用外部 asset：逐項核 license 先入 bundle（AGPL 唔准入）。
