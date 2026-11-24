# FLYVJ — 架構現況 ＋ 模仿學習（M4.6）與參數層（M4.7）分析摘要

日期：2026-11-19（Asia/Shanghai）
用途：交畀外部分析（Argon）。本文自包含，唔假設讀者睇過其他文件；關鍵檔案路徑全部列喺 §7。
撰寫：Cloud 主管（gpt-6-astra 路線）。§3 嘅 API 數字係**喺用戶實機 live probe 攞嘅**，其餘標明設計判斷／未證實。

---

## 0. 一句話問題

我哋有一個「用果蠅腦做 VJ 決策」嘅瀏覽器 app。佢而家只識得**揀 9 格入面邊一格 clip**（discrete 分類）。用戶問：「fader、knob、effect 點樣 judge？點樣令佢明白使用？」

本文要分析嘅核心取捨：**要唔應該、以及用咩架構，將呢個 discrete 分類器擴展到連續參數控制（模仿用戶嘅 fader／effect 操作）。**

---

## 1. 專案背景與硬約束

**產品定義**：VJ 表演時，一個本地 AI 層觀察音樂＋觀察 Resolume Arena 狀態，自動揀 clip／調參數；VJ 隨時可以 override，並且能透過 override 將自己嘅 taste 教畀個 AI。

**技術路線（已定，ADR 級）**
- 純瀏覽器 app（Vite + TypeScript + Three.js），WebSocket 直連 Resolume Arena 7.23.2 `ws://127.0.0.1:8080/api/v1`。
- **zero sidecar、zero cloud AI、localhost-only**。所有 DSP／決策數學喺瀏覽器內（Web Worker）。呢個係硬約束，唔可以為咗模型能力引入後端或雲端 API。
- 唔上傳素材、唔用雲端視覺 API。

**表演約束**
- 音訊只靠 mic 收音（`getUserMedia`），冇 DJ 機 metadata、冇 Ableton Link、冇 line-in。
- 16ms 取樣節拍；主幀 callback ≤0.5ms、worker compute ≤1.5ms、longtask 0（已達標）。
- 決策唔可以 block 主幀（contract (d)）。

**兩層決策架構（ADR 0004）**
- 慢層（brain-level）：偵測結構事件（build-up / drop / section），做 discrete 揀 clip。
- 快層（VNC-level motor）：連續參數反應。
- 官方果蠅腦文獻將 brain 層描述為 sensory integration + decision、VNC 層為 motor control；呢個同我哋嘅兩層結構同構，係我哋用「brain / motor」呢套語言嘅依據。

---

## 2. 現有模型（M4.5 / M4.5.1 已交付）

### 2.1 感覺輸入
串流 DSP（無 ML 模型、無離線分段）：
- 三頻能量 LOW/MID/HIGH（FFT 2048）＋ RAW（pre-gate）頻段用做 onset envelope。
- 非對稱 AmbientGate（tauDown 1500ms / tauUp 25000ms）去 DC／底噪，解決「riser 被慢 tracker 吸走」。
- Onset density、LOW novelty z-score、bass-cut / riser / roll-accel buildup（帶 latch）、coarse tempo（onset envelope 喺均勻 16ms grid 上做 ACF）＋ regularity gate、LOW-dominance 音樂 vs  speech gate、section events（3s band-share signature EMA）。
- `rebalanceBands()`：用 15s 慢參考補償 mic／房間嘅 spectral tilt（否則 LOW 永遠佔 96%，MID/HIGH 行永遠贏唔到）。

### 2.2 決策核心：Mushroom Body（果蠅腦 KWTA 隱喻嘅實作）
```
x (14-dim 特徵)
  → 固定隨機投影 P [2048 × 14]（mulberry32 seed 1597463809，唔需要訓練資料）
  → ReLU → k-WTA top-5%（102 / 2048 Kenyon cells，unit-sum）
  → logits = priorScores(cell) + learnGain · (W[9 × 2048] · kc)
  → softmax(temp 0.35) → Jev confidence = (p_max − 1/n)/(1 − 1/n)
```
- 14 維特徵：instant bands ×3、3s signature ×3、signature slopes ×2、novLow、density、regularity、buildupScore/3、total、bpm-known flag。
- `W` 初始為 0 → 基線行為 = 工程化先驗（band dominance × onset density 對應嘅 motion tier）。
- 先驗：row score = rebalanced band share × 2.2；col score = STATIC(<2.5/s) / MEDIUM(2.5–6) / ACTIVE(>6) 匹配度。

### 2.3 學習機制（而家得一種）
**Dopamine-RPE 在線學習**：用戶喺九宮格撳一格 =
- `W[chosen] += etaPos(3.0) · kc`（強化）
- `W[vetoedAutoChoice] -= etaNeg(1.2) · kc`（壓抑 AI 原本揀錯嗰格）
- clamp ±4.0；`learnCount` 計數；權重落 localStorage（`flyvj.mb.v1`）可匯出 JSON。

另有 anti-repeat bag（唔連發同一格）、MasterSwitch AUTO/OVERRIDE/HOLD、低信心 HOLD。

### 2.4 輸出
9 選 1 精準 clip trigger：先 `/composition/layers/{N}/clear` 清同 column 其他 layer，再 short-press（省略 `value`）目標 clip；900ms 後 REST 驗證，未 latch 就 fallback 成整列 trigger（landing 優先於 precision）。

---

## 3. 用戶問題：fader / knob / effect 點辦

### 3.1 現況：**零認知**
而家個模型嘅**動作空間只有「揀邊格 clip」**。fader、knob、effect 參數、opacity、transform、transition、clip speed／playhead — 全部冇建模、冇觀察、冇記錄。無證據顯示佢識呢啲嘅存在。

### 3.2 觀察端已通（用戶實機 live probe，2026-11-19）
我哋直接連用戶部 Arena 讀 composition tree，確認呢啲參數全部暴露，而且 **layer fader 可以 subscribe 並收到實時 `parameter_update` 推送**：

| 層級 | 參數 | 範圍 | 可訂閱 |
|---|---|---|---|
| Layer | `master`（fader） | 0..1 | ✅ 實測收到連續 update |
| Layer | `video.opacity` | 0..1 | 推定 ✅ |
| Layer | `crossfadergroup` / `faderstart` / `bypassed` / `solo` / `maskmode` | enum/bool | 推定 ✅ |
| Layer | `transition.duration` / `blend_mode` | 0..10 / enum | 推定 ✅ |
| Layer | `video.effects[].params.*` | 見下 | 推定 ✅ |
| Composition | `crossfader.phase` | −1..1 | 推定 ✅ |
| Composition | `tempocontroller.{tempo,tempo_pull,tempo_push,tempo_tap,resync}` | — | 存在已確認 |
| Clip | `video.r/g/b/a` | — | 存在已確認 |
| Clip | `transport.position` / `controls.{speed,playmode,playdirection,playmodeaway,duration}` | 0..49200 / 0..10 | 存在已確認 |
| Clip | `video.effects[].params.{Position X/Y, Scale, Scale W/H, Rotation X/Y/Z, Anchor X/Y/Z}` | Scale 0..1000、Rotation ±180、Position ±32768、Anchor ±16384 | 存在已確認 |

**Effect 實測細節**：每個 layer／clip 而家只掛咗 1 個 effect，名 `Transform`（有 `display_name`、`params`）。即係用戶尚未用花嘅 effect — 呢個對下一步設計有好處（動作空間細）。

**重要**：probe 到嘅 layer `master` 數值（L1≈0.003、L2=0、L3=0、L4=0、L5=1）係**嗰一刻嘅表演狀態快照**，唔係預設值，唔好當基線引用。

### 3.3 探測時發現嘅兩個事實（要處理）

**(A) 用戶嘅 composition 唔係 3×3。**
- 實測：composition 名 `for training use`，**5 layers × 11 columns**。
- Layer 名：`low`、`mid`、`圖層 #`、`圖層 #`、`圖層 #`。
- App 硬編 `ROWS=3, COLS=3`（來自 `ENERGIES`／`MOTIONS` 兩個常數），即係佢只觀察／控制到 L1=low、L2=mid、L3（未命名）同 col 1–3。
- 後果：如果而家 record 用戶表演，個腦睇唔到 L4/L5 同 col 4–11 — 訓練資料天生殘缺。

**(B) 用戶已經用緊真片。**
- 實測 clip source path：`E:\VJ Visual\第658期\第658期 (4).mov`（1920×1080、30fps、duration 7.97s）。
- 即係原 M5 ticket 寫嘅「用戶 9 條 clip 路徑未補 — 開工前 blocker」實際上已部分解決。

---

## 4. 我哋建議嘅架構（待分析覆核）

**同一套感覺表徵（MB 稀疏碼 kc）＋ 每個參數一條線性回歸權重（motor map）。**

```
x (14-dim) → MB project → kc (102/2048 sparse, unit-sum)
                              ├─→ W[9×2048] · kc → softmax → 揀邊格 clip   （已有）
                              └─→ θ[param] · kc → clamp → 連續參數目標值    （提議新增）
```

三個支持理由：
1. **符合已定 ADR**：慢層 = brain（discrete 揀 clip），快層 = VNC（連續 motor 輸出）。線性 descending command → motor neuron 正正係果蠅 VNC 嘅功能，metaphor 變返真架構對應。
2. **感覺唔使重學**：MB 已經編好「而家係咩音樂時刻」。motor map 只係將呢個時刻映射到「呢個時刻你會將 fader 推去邊」。
3. **16ms 預算夠**：推理只係一個 dot product（2048 float，稀疏 102），比現有 9 格 softmax 平；訓練可喺 record session 之後 offline 閉式解（ridge regression）。

---

## 5. 三個要提前講清楚嘅限制（唔想後先喊）

**(a) 連續參數冇 RPE 訊號 — 只能純模仿，唔係強化學習。**
揀 clip 有明確 discrete 事件：「你揀錯，我改」→ 可以對 vetoed 格做負向強化。fader 冇 `_denied_` 值 — 用戶推去 0.6 唔代表 0.4 係「錯」，可能只係偏好。所以 motor 層嘅學習目標函數係**回歸用戶做嘅值**，唔係 maximize reward。呢兩樣唔應該宣稱做同一種「學習」，UI 都應該分開表達信心。

**(b) 唔好重建 Arena 已經做得好嘅嘢。**
Resolume 官方明言內置 FFT 音訊分析可以驅動 clip／effect 參數「bounce to the incoming sound source」。如果我哋嘅 motor 層去學「逐拍 wobble」，一定比原生差，仲會撞（兩層同時驅動同一參數）。
→ 設計要求：motor 層只擁有**慢分量／結構性設定**（「呢段你將 fader 留喺 0.6」、「呢段關掉 Transform 嘅 Rotation」），**排除 beat-rate 分量**。具體如何分離（低通 cutoff？只學 section 邊界嘅 step change？）係需要分析嘅開放問題。

**(c) 動作空間可能爆炸。**
5 layers × 11 columns × 每個 layer 嘅 fader／opacity／transition／effects，加埋 clip-level r/g/b/a／speed／position。如果全部納入，參數數量級係幾百到幾千，而用戶一次表演只產生幾十個觀測點 → 嚴重欠定。
→ 需要分析：邊啲參數值得學？係咪要一個「用戶標記要學嘅參數」機制（類似 Resolume Dashboard 哲學：唔需要知道每個 effect 設定，只睇住常用嗰幾個）？

---

## 6. 未完成工作 ＋ 我建議嘅順序

**已起好一半（M4.6 Performance Capture）**：
用戶想「record 我自己 play 一次，再畀佢做 training」。呢個唔喺原 SPEC 里程碑入面，係模仿學習（imitation learning）。已寫：`capture.ts`（`nearestTrace` / `argmaxCellFromX` / `sanitizeSession`）。未寫：worker capture ring、REC／TRAIN UI、**Arena 外部動作偵測**（關鍵：要分辨「用戶自己喺 Arena 撳咗 clip」vs「我哋 app 自己 trigger 咗」— 用 self-fire 排除＋WS parameter flip 偵測）。

**一個已經確認嘅重要性質**：W 索引係**格位**（`cellIdx = (row−1)·3 + (col−1)`），唔係 clip 檔名／路徑。clip 身份從未進入模型。所以用 dummy 片訓練出嘅 taste **可以無縫轉移**到真 clip 庫 — 因為 row = 音樂邊個頻段主導、col = 音樂 onset 密度，兩樣都係從音樂計出嚟，同格入面擺緊咩片無關。

**我嘅判斷順序：3 → 1 → 2**
1. 先修 grid 假設（5×11 可配置）— 否則 record 到嘅資料天生殘缺
2. 再做 M4.6 clip 模仿（record→train）
3. 先至起 M4.7 motor 層（fader／effect 回歸）

---

## 7. 關鍵檔案（如果要深究）

| 內容 | 路徑 |
|---|---|
| 專案入口／風險紀錄 | `docs/FLYVJ_HANDOFF.md` |
| 規格與里程碑定義 | `docs/SPEC_V2.md` |
| M4/M4.5/M4.5.1 成果與時間碼對照 | `docs/M4_RESULT.md` |
| 兩層決策 ADR | `docs/adr/0004-local-two-layer-decision-engine.md` |
| 腦區映射角色 ADR | `docs/adr/0002-brain-as-mapping-carrier-not-engine.md` |
| 果蠅腦決策模型文獻綜述 | `docs/research/flybrain-decision-models.md` |
| 快層模型可行性研究（含延遲推算） | `docs/research/fast-decision-models.md` |
| Resolume 原生能力 vs 自建工具（含 OSC/REST 地址核證） | `docs/research/resolume-native-vs-custom-tool.md` |
| VJ console UI 模式研究（Dashboard 哲學出處） | `docs/research/vj-console-ui-patterns.md` |
| EDM 結構偵測（全部 offline 呢個關鍵發現） | `docs/research/edm-structure-detection.md` |
| 決策數學（純模組，可 node 單測） | `work/v2/m4/webapp/src/decision.ts` |
| 結構偵測 | `work/v2/m4/webapp/src/detector.ts` |
| Worker 編排（感覺→決策） | `work/v2/m4/webapp/src/decision.worker.ts` |
| Arena 協議實測紀錄 | `work/v2/m4/webapp/src/protocol.ts` |
| M4.6 模仿學習（進行中） | `work/v2/m4/webapp/src/capture.ts` |
| 主程式（WS／觸發／localStorage） | `work/v2/m4/webapp/main.ts` |

---

## 8. 請 Argon 分析嘅開放問題

1. 將 discrete 分類器擴展到連續參數，除咗「共享 kc ＋ 線性 motor map」之外有冇更適合 zero-sidecar 瀏覽器架構嘅做法？（考慮：唔可以跑大模型、16ms 預算、訓練可 offline）
2. 點樣將用戶操作嘅**慢結構分量**同 Arena 內置 FFT bounce 嘅**快分量**分離，避免我哋學到 beat-rate wobble 然後同原生撞？
3. 冇明確 reward 訊號嘅情況下，motor 層點樣向用戶表達「我學到幾多／有幾可信」？（現有 Jev confidence 係 softmax 分佈性質，連續回歸冇對應物）
4. 動作空間膨脹（幾百參數 vs 一次表演幾十觀測）：應該用用戶標記白名單、定自動參數重要性篩選？
5. 模仿學習嘅样本效率：一次 20 分鐘 set 得返幾十個 discrete 標記 ＋ 連續軌跡，夠唔夠更新 9×2048 嘅 W？有冇必要加 data augmentation（例如對 kc 做 noise／temporal shift）？
6. 5×11 grid 可配置化之後，「row = 音樂頻段主導」呢個語義假設仲成立嗎？（多過 3 層要點樣映射到 band？）

---

## 9. 證據等級聲明（避免誤信）

- **實測（用戶實機）**：§3.2 全部 API 路徑／範圍／可訂閱性；§3.3 composition 尺寸、layer 名、clip 真路徑。
- **已交付並有單元測試／驗收紀錄**：§1–§2 嘅 DSP、MB、RPE、trigger 契約（67/67 tests；acceptance json 喺 `work/v2/m4/`）。
- **設計判斷（我哋嘅推論，無一手來源證明效果）**：§4 架構建議、§6 順序建議、§5(b) 只學慢分量。
- **未證實／風險**：M4.6 模仿學習未跑過真實效果；motor 層完全未實作；clip-level precision 喺開發機仍有 fallback（表演機 M6 終判）；coarse BPM 唔穩定（八度錯誤，但決策唔依賴佢）。
- **禁止宣稱**：本專案無公開準確率基線，唔得出任何「準確率百分比」數字。
