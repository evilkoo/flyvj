# 第一版 runtime：純 browser TypeScript/WASM，冇 sidecar；avatar 輕模型起步、介面預留換真模型

兩條相關嘅 runtime 決定，同一個原則：**第一版嘅可執行面只有一個 browser 視窗，零額外 process、零 Python、零 Rust**。

決定一（Q24-A）：**唔加 Python sidecar**。fast-decision research（docs/research/fast-decision-models.md）證實純 CPU 細模型（sklearn LR/MLP、LightGBM、VW CB）sub-50ms 綽綽有餘，全部 permissive license，經 ONNX Runtime Web（WASM）喺 browser 內行。BeatNet（Python、CC-BY-4.0）等 BPM 工具被排除出第一版 — ADR 0004 已定結構事件靠聽音樂 judge、唔靠 linear BPM，而且 sidecar 正正係舊 draft「會 idle 死嘅 process」病根。之後如果證明需要 BPM，再議 sidecar＋lease/heartbeat 設計。

決定二（Q25-C）：**Avatar 用輕量卡通果蠅模型起步，但 model 層設計成可換介面**；NeuroMechFly v2（Apache-2.0 code、micro-CT 真實果蠅，見 docs/research/fly-avatar-model-options.md）係科學路線嘅預留升級位。**換入 NeuroMechFly 之前必須先核實佢 mesh assets 嘅獨立授權**（code license ≠ asset license；本項目已見過兩次同類陷阱：madmom model files CC-BY-NC-SA、MERT weights cc-by-nc-4.0）同 MJCF→渲染嘅轉換成本。驅動方式固定：音訊特徵→關節參數 kinematic playback，唔跑物理模擬。

## Considered Options

- **Python sidecar（BeatNet/sklearn 直接跑）**：拒絕。多一個會死嘅 process，違反 ADR 0005「零 sidecar」；第一版 DSP heuristic＋WASM 細模型已覆蓋需求。
- **第一版直接用 NeuroMechFly**：拒絕作為第一步。mesh 授權未核實、MJCF 轉換成本未知、micro-CT 模型面數可能超 VRAM 預算（本工具上限 ~0.3–1GB）；輕模型先至最快見到「音樂令 VJ 有反應」呢個核心驗收畫面。
- **卡通模型唔留換位**：拒絕。用戶底線係科學真實度長期要有升級路；介面分離（avatar renderer vs model source）係低成本保險。

## Consequences

- 授權紀律：所有進入 bundle 嘅 model weights／assets 都要逐項核 license，唔可以只睇 code repo 嘅 LICENSE。
- Avatar 介面契約：`model source → joint/morph parameters → renderer`。換模型只換 source 同參數映射，renderer 同音訊→參數邏輯唔變。
- 第一版冇 BPM 數字可用；所有時間性判斷（結構事件）建基於能量／flux heuristic，準確率期望要喺 spec 寫明係近似。
