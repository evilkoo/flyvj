# FlyVJ v2 Spec（重建專案）

狀態：**已批覆並執行中** — M1／M2／M3／M4／M4.5 全部 PASS（2026-11-18），M5 待開工。定案依據：[CONTEXT.md](../CONTEXT.md)（glossary）、ADR 0001–0007（決定鏈）、`docs/research/` 六份一手來源研究。舊 M0–M3C 全部檔案保留作歷史，唔再係開發基礎（ADR 0001）。

## 0. 產品定義（唯一驗收標準）

**落地使用**：喺表演機（Win11 laptop，RTX 3070 Ti 8GB VRAM）開一場真 set —
`mic 音樂輸入 → 3D 果蠅 VJ 角色有可見反應 → 決策引擎做出決定（顯示喺 cockpit）→ WebSocket trigger Column → Resolume Arena 7.23 真換 clip`，全程冇人手 fallback（人手 override 保留但唔使常用）。

架構一句：純 browser 本地 app（Vite＋TypeScript＋Three.js，普通 Chrome/Edge 視窗，零安裝），WebSocket 直連 Resolume（`ws://127.0.0.1:8080/api/v1`，Preferences→Webserver enable），Web Audio getUserMedia 收音，零 Python sidecar、零 Rust（Tauri 只做後期打包）、零雲端 AI。

### 0.1 全局硬約束（每個 milestone 都適用）

| 約束 | 內容 | 來源 |
|---|---|---|
| 共存 | 唔搶 focus、唔獨佔 input/GPU/audio；禁用的 Windows API 清單見 CONTEXT「禁用 API 清單」 | MS Learn 官方，research/madmapper |
| VRAM | 本工具上限 ~0.3–1GB；WebGL canvas ≤1280×720；Three.js 資源必須 dispose | research/madmapper 推算表，表演機實測為最終證據 |
| 音訊 | WASAPI shared（即 browser getUserMedia 預設）；啟動時 `getSettings()` 讀 AGC 實際狀態並顯示喺 UI；唔假設 AGC 已關閉 | W3C/MDN＋research/edm |
| 授權 | 進入 bundle 嘅 model/weights **逐項核 license，唔睇 code repo LICENSE 就算**；AGPL（Essentia）唔准入；CC-BY-NC 素材（FlyWire 樣本）只可留喺私人自用 build，唔准入公開發布版 | research/fast-decision、flybrain |
| 話術 | 唔宣稱真生物 firing／已驗證準確率／已驗證 FPS；avatar 係「角色」，腦區註釋用 Janelia 官方功能描述（learning／navigation）而非假反射 | research/flybrain §9 禁止話術 |
| 網絡 | 只連 localhost（Arena WebSocket 無認證 = 靠 loopback 隔離）；唔開 port 畀外部 | ADR 0005 |

### 0.2 驗收證據規則（本專案版本）

涉及畫面／3D／交互嘅 task：以**真 screen-cap ＋ vision 覆核**為準（用 design-taste-frontend 嘅 `inspect.mjs` 出截圖＋`read_image` 逐張睇，加現場錄屏）。

派工／token 規則（2026-11-17 更新，取代 Q16-B 嘅「唔派 subagent」權宜決定）：可用 subagent 模型已轉為 **Qoder Qwen3.8-Flash**（`qoder/qfmodel`；舊紀錄：2026-10 曾得 3.8-Max，先有「主管代行」偏離）。規則：(1) 大量閱讀／research 補查交 Flash subagent，只回摘要；(2) 小至中修改、單文件、debug 由主管直接做；(3) vision QC 首次委派前先做一個最小 vision 測試核實 Flash 能力，唔得就由主管 `read_image` 代行並明講邊個做；(4) 每個 implement 起新 session，以本 spec＋ADR＋research 檔為唯一交接物，唔靠舊 session context；(5) 委派只俾目標／檔案範圍／驗收／禁止事項。模型能力列出不等於已驗證；實際 token 用量本 harness 冇可查工具，以上規則係控制手段而非计量。

自動化測試（Node `--test`）每個 milestone 最少覆盖契約級行為。新 run 證據留 `work/v2/`，唔覆蓋舊 `work/runs/`。

---

## Milestone 1 — WebSocket bridge 驗證（最大未知數，先殺）

**目標**：證實「網頁 → Arena 7.23.2 WebSocket API → 真換 clip」喺本環境行得通。
**環境**：開發機（4090 desktop，已裝 Arena **7.23.2**，用戶已批准啟動）。
**做**：
1. 起 Arena（用戶批准咗），enable Preferences→Webserver；用 Resolume Alley 官方 free footage 排 3 layer × 3 column dummy composition。
2. 寫一個最細 HTML/TS page：連 `ws://127.0.0.1:8080/api/v1`，收開機推嘅 composition state，喺 console 顯示；搵出 column trigger 嘅確切 parameter path/action（`subscribe`／`trigger`；OSC 等價 `/composition/columns/N/connect`，WebSocket 寫法以官方 REST reference＋實際 payload 為準）。
3. 逐欄 trigger 9 格，觀察畫面前後變化。

**驗收契約**：(a) 連接成功且收到 composition state JSON；(b) 9/9 column trigger 喺 Arena 熒幕上有可見 clip 變化；(c) 連線 10 分鐘唔斷、subscribe 狀態更新有回推；(d) 失敗路徑：webserver 未 enable 時 app 有明確錯誤提示，唔會崩。
**證據**：screen-cap（瀏覽器＋Arena 同框）、WS 訊息 log 存 `work/v2/m1/`。
**Blocker 處理**：若 7.23 無 WebSocket API 或行為唔同文檔 → 記錄實際回應，轉 OSC＋Tauri/sidecar fallback 路線，即刻報告，唔盲試。

## Milestone 2 — Grid 狀態 ＋ 映射表 v0

**目標**：app 入面有「3×3 欄格」呢個 domain 物件，點格→換 clip→熒幕同畫。
**做**：clip manifest（每格：layer×column、九格分類位、檔案路徑、tag）；UI grid 顯示；WebSocket 雙向（trigger ＋ subscribe 回報實際狀態）；用嗰 9 條片（用戶後補路徑；未補就用 Alley dummy 照走）。
**驗收契約**：(a) 點任一格 → Resolume 該 column 三 layer 全換，app grid 高亮同 Arena 實際狀態一致（以 subscribe 回推為準，唔靠自己記）；(b) 改 manifest 重載即生效，唔改 code；(c) 斷線重連後狀態重新同步。
**證據**：錄屏一氣呵成（點擊→換 clip→拔線→重連→狀態啱）。

## Milestone 3 — Avatar viewport（開始見到「VJ 有反應」）

**目標**：mic → 三頻能量 → 3D 果蠅 VJ 角色身體反應（Q30 默認映射）。
**做**：Vite＋TS＋Three.js 正式 scaffold；`model source → joint/morph parameters → renderer` 可換介面（ADR 0007）；第一版模型＝輕量卡通果蠅（本機生成／開源模型，授權逐項核，含骨骼）；getUserMedia（`autoGainControl:false` 等 constraints＋`getSettings()` 狀態上屏）；AnalyserNode FFT 2048 → LOW/MID/HIGH 能量（沿用舊 DSP 參數：attack 50ms／release 220ms，research 證實合理）；body 映射：LOW→腳/身體、MID→觸鬚/頭、HIGH→翅；需要一次 user gesture 撳「Start」先有聲音分析（autoplay 官方政策，UI 設計成明示按鈕）。
**驗收契約**：(a) 播真歌（喇叭對住 mic）時三個部位明顯唔同頻各自反應，paused/靜音時 2 秒內歸零；(b) canvas ≤1280×720；(c) 開發機 GPU 佔用量記錄（作為表演機推算輸入）；(d) AGC 狀態顯示正確（`getSettings()` 對照 Windows sound 設定截圖）；(e) context-loss 有 dispose＋重建（舊 M3C 嗰個 FAIL 教訓，契約化）。
**證據**：screen-cap vision QC（初始／反應中／靜音三組）、錄屏。

## Milestone 4 — 慢層決策 ＋ Decision Cockpit

**目標**：結構事件偵測 → Column 決定 → cockpit 顯示理由＋置信度 → trigger；人手 override 永遠優先。
**做**：DSP streaming heuristic（research/edm 推薦）：build-up＝bass 下陷＋riser＋onset density 加速；drop＝LOW novelty peak；coarse tempo（onset envelope autocorrelation，TS 內）snap 到 8/16-bar；信心低→HOLD。決策目標＝九格邊格（Region Mapping 表：腦區↔九格↔column，Learn-Mode 染色配對，UI research idea 3）。Cockpit（UI research idea 4 ＋ HAX G2/G8/G9/G12/G17）：n-best 候選列、confidence（Jev 同款算式 `(p_max−1/n)/(1−1/n)`，本地算）、近因 ticker（最近決定＋原因一句）、一鍵 veto／手動選格 override、HOLD 顯示。
**驗收契約**：(a) 3 條標明 drop 時間嘅 EDM 測試歌：drop 落點 ±0.5s 內 app 有決定輸出（實際誤差逐條記錄，唔宣稱統計準確率）；(b) 靜音／說話環境→HOLD 唔亂換；(c) override 輸入後 ≤100ms 生效且自動決定讓位俾用戶直至明確還畀（HAX G17 全局開關）；(d) 全程零 sidecar：所有計算喺 browser worker 內，主訊框唔 BLOCK（開發機 performance log 為證）。
**證據**：測試歌 timecode vs app 決定 log 對照表、錄屏、screen-cap。
**結果**：PASS（2026-11-17，`docs/M4_RESULT.md` 前半）。

## Milestone 4.5 — 果蠅腦 MB-WTA 決策 ＋ 9 選 1 clip trigger（2026-11-18 用戶批准升級）

**目標**：M4 慢層升級為真・果蠅腦啟發模型；決策粒度由 column 改為九格 clip；加段落級換片時機＋groove 鎖拍；底噪追蹤改非對稱。
**做**：
1. **Mushroom Body 稀疏編碼**（CONTEXT「昆蟲腦啟發架構」）：14 維特徵 → 固定隨機投射 2,048 Kenyon cells（seed 可重現）→ ReLU → top-5% k-WTA → 9×2048 可塑權重 W ＋ engineered prior → softmax → Jev confidence。W 零起步＝保持 M4 校準行為。
2. **多巴胺 RPE 在線學習**：override 強化目標格 KC 碼、抑制被否決嘅自動選擇；越用越貼合用家口味。唔宣稱訓練準確率。
3. **防連撞 Bag**（Resolume Autopilot「Bag」哲學，HAX G12）：自動唔連續觸發同一格。
4. **9 選 1 精準 trigger**：`/composition/layers/{L}/clips/{C}/connect`（position-based，實測核證）＋layer-level clear（sibling connect=false 會 undo，probe 證實）＋verify→column fallback（landing 優先於 precision）。保留 column mode 可選。
5. **section 事件**：signature（3s band-share EMA）持續轉移 → breakdown／build-up 都換片；cooldown 5s＋confirmation 1.5s＋music gate（reg≥0.35、density≥2.0 sustained）。
6. **16ms groove lock**：tempo grid 16ms（必須 resample 去均勻 slot，否則 ACF 崩壞）；bass-cut／buildup 期間凍結 tempo；drop 零延遲，bar-phase 只作信心加分。
7. **非對稱 AmbientGate**：tauDown 1.5s／tauUp 25s（8–16s riser 唔被吸）；`recalibrate()`＋UI ↻ 掣。
**驗收契約**：沿用 M4 (a)–(d)，加：(e) section 事件可觸發換片且 speech 下 0 誤觸發；(f) real 路 clip-level 或 column-fallback 至少一條落地（precision 分開記錄）；(g) MB 碼 determinism／sparsity unit-tested。
**證據**：`acceptance-m4.json`（live＋offline replay 一致）、`acceptance-m4-real.json`（landed／precision／fallback 三態）、64 unit tests、PrintWindow vision QC。
**結果**：PASS（2026-11-18，`docs/M4_RESULT.md` M4.5 ADDENDUM）。M4.5.1（實戰錄影修復，`docs/M45_1_RECIPE.md`）已執行完畢：九格 live 機率、乒乓連跳消滅、`rebalanceBands` 解鎖 L2/L3、clip short-press 使 real 路 `precision=true`（開發機）、腦經驗 localStorage 持久化＋人手示範錄製器 — 見 M4_RESULT M4.5.1 ADDENDUM；表演機終判留 M6。

## Milestone 5 — Clip 庫 Tagging Pipeline

**目標**：用戶補路徑後，成個庫入九格。
**做**：本地 ffmpeg（已裝）抽 frame 統計（亮度、幀間差＝運動量、色相分佈）→ 九格建議 → 覆核 UI（app 內編輯，逐格拖放改判）→ 產出正式 manifest＋Resolume composition 匯入建議（DXV/檔案路徑）。
**驗收契約**：(a) 全庫每條 clip 有經用戶覆核嘅格位；(b) manifest↔composition 實際格位抽驗 10% 一致；(c) 未覆核項目喺 UI 有明確「未確認」標示，唔混入可選池。
**證據**：manifest diff、覆核前後對照記錄。

## Milestone 6 — 表演機實測 ＋ 打包

**目標**：產品定義嗰句喺 3070 Ti laptop 真發生；穩定形態交付。
**做**：表演機 checklist：Arena 7.23 Nvidia profile 手動 enable（官方 Optimus 文檔）、三 app＋本工具同開嘅 FPS／VRAM 實測（任務管理器＋capframe 記錄）、mic AGC 實況、9 格實戰；確認穩後先討論 Tauri 打包（**裝 Rust＋MSVC 要另外批准**，1–2GB）。
**驗收契約**：即 §0 落地使用定義喺表演機一段 ≥20 分鐘連續 set 模擬錄得：音樂（放歌對住 mic）→ avatar 反應 → ≥5 次自動 column 換 clip 全部成功落地、冇 crash、冇搶 focus（用戶同時操作 Resolume／MadMapper 唔受阻）。
**證據**：表演機錄屏＋screen-cap vision QC＋決定/落地對照 log。未過呢關唔宣稱「落地」。

---

## 風險與未決（如實記）

1. Clip 庫路徑未補（M5／M2 彈性已處理）。
2. Heuristic drop 偵測準確率：無公開證據基線，M4 只驗 ±0.5s 對照行為，唔宣稱百分比。
3. Laptop mic firmware AGC 可能繞唔到 → M6 實測先知；最壞情況 UI 明示「分析可信度受限」。
4. VRAM 預算係推算 → M6 實測為最終證據。
5. MadMapper 只係共存背景（唔同步、唔控制，Q15），但如果佢同時開 mic 收音，兩邊 analysis 都係 shared mode 合法，互唔獨佔（MS Learn）。
6. 舊 `work/runs`／M3C source 保留唔删（ADR 0001 Consequences：禁止 git clean/reset）。
