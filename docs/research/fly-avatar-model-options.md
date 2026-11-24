# 3D 果蠅「VJ 角色」模型選項研究

研究日期：2026-11-17。研究方式：主管親自用 web_fetch 抓一手來源（Q16-B：唔再用 subagent）。**純文檔研究，冇實機驗證任何渲染效能或模擬行為。**

## 一句結論

**NeuroMechFly v2 / FlyGym 係目前唯一有一手來源支持嘅真實果蠅 3D 模型**：micro-CT 掃描真實成年雌性 *Drosophila melanogaster* 建成嘅 biomechanical model，**Apache-2.0 授權（已核 LICENSE 原文）**，而且官方已經有 browser WASM viewer。但佢係 MuJoCo 物理模擬模型（MJCF/XML 格式），唔係為「UI 角色」設計 — 用作 avatar 需要額外工程，而且**驅動方式應該係「音訊 → 關節角度直接 playback」，唔係跑物理模擬**。

## 已核實事實（全部帶一手來源）

### 舊資料糾正

`docs/AGENT_SUMMARY_2026-11-16.md` 第 4.2 節記錄嘅 FlyGym 連結係 **`https://github.com/Neuro-Robotics-Laboratory/flygym`** — 呢個 URL **已失效（HTTP 404，2026-11-17 實測）**。`Neuro-Robotics-Laboratory/NeuroMechFly` 同樣 404。

正確嘅官方 repo 係 **`https://github.com/NeLy-EPFL/flygym`**（由官方文檔頁嘅 repo 連結核實）。舊 v1 已遷去 `https://github.com/NeLy-EPFL/flygym-gymnasium`，文檔喺 `https://gymnasium.neuromechfly.org/`。

### NeuroMechFly v2 / FlyGym

| 項目 | 內容 | 來源 |
|---|---|---|
| 官方文檔 | https://neuromechfly.org/ （redirect 去 `/2.1.1/`） | 實測 HTTP 200 |
| 官方 repo | https://github.com/NeLy-EPFL/flygym | 文檔頁 repo 連結 |
| **授權** | **Apache License 2.0**，`Copyright 2023-2026 The NeuroMechFly v2 Authors` | LICENSE 原文：https://raw.githubusercontent.com/NeLy-EPFL/flygym/main/LICENSE（實測 HTTP 200，全文已讀） |
| 論文 | NeuroMechFly v2，Nature Methods | https://www.nature.com/articles/s41592-024-02497-y |
| 開發單位 | Neuroengineering Laboratory（Ramdya lab），EPFL | 文檔首頁 |
| 模型根據 | **micro-CT 掃描一隻真實成年雌性果蠅**；若干 body segments（尤其 antennae）經調整以更貼近生物現實 | 文檔 Key features |
| 視覺 | 複眼由 ommatidia 組成，六角 lattice 排列；已模擬視網膜視覺輸入 | 文檔 Key features |
| 嗅覺 | antennae ＋ maxillary palps 有 odor receptors；已模擬化學強度輸入 | 文檔 Key features |
| **層級控制** | CNS 分 **brain**（sensory integration ＋ **decision making**）同 **VNC**（ventral nerve cord，motor control），兩部分之間有 **descending**（brain→VNC）同 **ascending**（VNC→brain）representation 介面 | 文檔 Key features |
| 其他 | leg adhesion（可 toggle）、mechanosensory feedback（joint angles／actuator forces／contact forces） | 文檔 Key features |
| 效能（2.x，2026-04 rewrite） | CPU 模擬 ~10x 加速，**~2x real-time throughput**；GPU（Warp/MJWarp）~250x 加速，**~50x real-time** | 文檔 April 2026 Update |
| **Browser WASM viewer** | 官方文檔頁內嵌「Open viewer in full-screen」指向 `../wasm/viewer/viewer.html`；static assets 由 `python scripts/dev/build_wasm_viewer_assets.py` 從同一個 model 重新生成 | 文檔 Interact with NeuroMechFly 節 |
| API 結構 | `flygym.compose.fly`：`base_fly`／`flybody`／`musculoskeletal`／`neuromechfly` 四種模型；`flygym.compose.world` 有 `tethered_world`（固定唔郁嘅世界，適合 avatar）；另有 `flygym.rendering`、`flygym.warp.*` | 文檔 API Reference 目錄 |
| 相關 tutorial | 8. Recording and rendering trajectories；4a CPG locomotion controller；5b FlyBody walking controller；1a/1b model composition | 文檔 Code Tutorials |

### 對本專案最關鍵嘅兩點

**一、`tethered_world` ＋ kinematic playback 先係正確用法。** 官方有 `flygym.compose.world.tethered_world`（tethered = 固定住，唔使行路）同 tutorial「2. Replaying experimental recordings」＋「5a. Replaying experimental flybody onball」。即係**官方已支援「直接餵 joint angles 播放」呢種用法**，唔使跑物理。做 VJ avatar 正正係呢種用法：音訊特徵 → 關節角度 → 播放。呢樣嘢比跑 MuJoCo 物理便宜幾個數量級。〔判斷，基於官方 API 名稱與 tutorial 標題；未實測〕

**二、官方嘅 brain/VNC 層級架構同本項目已定嘅 Two-Layer Decision 結構同構。** 官方描述 brain 層負責「sensory integration and decision making」，VNC 層負責「motor control」，中間有 descending/ascending 介面。我哋 ADR 0004 定嘅係「慢層偵測結構事件決定換 clip／快層連續跟音樂做 parameter」。**呢個唔係巧合，係可以直接借用嘅 domain 語言**：慢層 = brain-level decision，快層 = VNC-level motor output，兩層之間嘅 descending representation = clip 決定，ascending = Resolume 實際狀態回饋。呢個令「果蠅做 VJ」呢個 metaphor 由裝飾變成真實架構對應。〔設計判斷，一手來源只支持官方嘅架構描述〕

## 未核實／需要進一步查證（唔可以當已知）

1. **micro-CT 掃描資料本身嘅授權**：Apache-2.0 覆蓋 code。但 mesh／model assets 可能另有條款（例如 CC-BY、CC-BY-NC，或者跟 Nature Methods 論文嘅 data availability statement）。**呢點未查，係採用前必須確認嘅 blocker** — 之前 fast-decision research 已經發現同類陷阱（madmom code 係 BSD 但 model files 係 CC-BY-NC-SA；MERT code Apache 但 weights cc-by-nc-4.0）。
2. **Browser WASM viewer 到底係「播放錄製軌跡」定係「瀏覽器內跑 live 模擬」**：文檔只話 assets 從同一個 model 生成，冇講明能力邊界。要讀 repo 入面 `wasm/viewer/` 嘅實際 code 先確認。
3. **MJCF → Three.js 嘅轉換路徑**：MuJoCo 用 MJCF/XML，Three.js 唔識直接載入。要用 Three.js 渲染就要（a）用 mujoco_wasm 自帶 renderer，或者（b）把 mesh 抽出來轉 glTF。**repo 入面 mesh 檔案嘅位置同格式未查。**
4. **模型面數／VRAM 負擔**：micro-CT 掃描模型通常面數好高。喺 8GB VRAM 要同 Resolume＋MadMapper 爭嘅表演機上，需要減面（decimation）。實際面數未查。
5. **FlyBody vs NeuromechFly vs musculoskeletal 四個模型邊個最輕**：未查。
6. **`~2x real-time` CPU throughput 係完整物理模擬嘅數字**，唔代表 kinematic playback 嘅成本；亦唔代表 browser WASM 環境下嘅數字。**唔可以借用呢個數字宣稱 avatar 效能。**

## 其他候選路線（未深入查證，只列方向）

| 路線 | 一句話 | 要查乜 |
|---|---|---|
| **用返現有 hemibrain ROI mesh** | 手上已有 14 個 hash 驗證嘅 brain region mesh（見 `data/morphology-candidate-20261004/`），直接做「腦做 instrument panel」而唔做角色 | 用戶 Q22 已表明「不一定係腦部」，所以呢條唔係首選，但係 fallback |
| **Sketchfab / Poly Pizza 等模型庫嘅卡通果蠅** | 快、輕、有 rig，適合做「角色」；但係藝術家創作，唔係科學資料 | 授權（CC-BY vs CC0）、有冇骨骼 rig、面數 |
| **Mixamo 式 rig ＋ 自製果蠅 mesh** | 完全可控，但要建模工時 | 用戶有冇 3D 建模能力／時間預算 |
| **AI 生成 3D 模型** | 本 session 有 image 生成工具但**冇 3D 生成工具**，唔適用 | — |

## 推薦（待用戶裁決）

**第一步唔好急住揀模型，先揀「角色要表達乜」。** 因為：
- 如果角色只係「有反應嘅嘢」（觸鬚跟 LOW 震、腳跟 beat tap、wing 跟 HIGH 開合），咁**任何有骨骼嘅輕模型都夠**，卡通果蠅最快落地。
- 如果角色要係「真實科學資料」（用戶底線：唔接受假腦形冒充真實神經資料），咁就必須用 NeuroMechFly，而佢帶嚟嘅工程成本（MJCF 轉換、減面、授權核實）係實打實嘅。

呢兩條路嘅工時差可能係 3 倍。所以要先答：**avatar 嘅科學真實度係咪硬性要求？**

## 安全界線遵守聲明

- 冇安裝任何軟件／package，冇下載任何二進位檔或 dataset，冇跑模擬，冇 build。
- 冇讀取 credential／私人資料。
- 除本檔外冇改任何現有檔案。
- 冇 git commit/push。
- 冇宣稱已實機驗證任何渲染／模擬效能。
- `web_search` 工具喺本 session 已確認壞咗（subagent 報 DeepSeek API 401），全程用 `web_fetch` 直接抓一手來源。
