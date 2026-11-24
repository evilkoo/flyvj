# 2026-11-18 FlyVJ 交接入口：M4＋M4.5＋M4.5.1 已 PASS，下一 task＝M5（`docs/M5_TICKET.md`）

> 注意：workspace 根 `HANDOFF.md` 已被另一個 session（Qoder proxy 接入）覆寫，唔關 FlyVJ 事。FlyVJ 項目交接以**本檔**為入口；M4＋M4.5＋M4.5.1 證據全文見 `docs/M4_RESULT.md`（含兩份 ADDENDUM）。

## 0｜一句話狀態

旧 M0–M3C 路線終結（保留唔删）。v2 定案落檔（SPEC_V2＋7 ADR＋CONTEXT＋6 research）。**M1–M4 全 PASS；M4.5（果蠅腦 MB-WTA／9 選 1／section／非對稱 gate）PASS；M4.5.1（2026-11-18 依 `docs/M45_1_RECIPE.md` 完成實戰錄影審核修復）PASS**：(1) build-up 九宮格唔再空白＋10Hz live 機率；(2) drop↔section 1–3s 乒乓連跳消滅（共用 5s 冷卻）；(3) `rebalanceBands` 解鎖 L2/L3（acceptance 實測 drop 落 L3C1/L2C1/L3C2，唔再 L1 壟斷）；(4) Arena clip trigger 改 short-press（省略 value）＋先 clear 後 trigger；(5) 果蠅腦經驗 `localStorage` 持久化＋人手示範錄製器（`flyvj.mb.v1`／`flyvj.demo.v1`）＋💾匯出／🗑重置掣＋🧠 badge（cdp 驗證 reload 保留）。**67 unit tests 綠、acceptance 四契約全 PASS（+45~+156ms）、typecheck 0 error、Arena real 路 precision=true（首次真 9 選 1 純淨落地，唔使 fallback）。下一動作＝Milestone 5（`docs/M5_TICKET.md`）。**

## 1｜新 session 第一個確切動作

1. 只讀：本檔 → `docs/SPEC_V2.md`（全份）→ `CONTEXT.md` → `docs/M5_TICKET.md`。M4＋M4.5＋M4.5.1 交付／findings 喺 `docs/M4_RESULT.md`（含兩份 ADDENDUM）；M4.5.1 修復指令原文 `docs/M45_1_RECIPE.md`（已執行完畢，保留作審核依據）；M3 `docs/M3_RESULT.md`；協議實測 `docs/M1_RESULT_V2.md`；M2 `docs/M2_RESULT.md`；M4.5 mid-flight 診斷史 `docs/M45_CHECKPOINT.md`。
2. App 喺 `work/v2/m4/webapp/`（**Vite port 5200**，`npm run dev`；M1–M4.5 modules 全保留＋`detector/decision/decision.worker`）。Arena 要手動起（`Arena.exe work/v2/m1/dummy-grid.avc`；webserver 已 enabled）；grid 重建 `work/v2/m1/setup-dummy-grid.ps1`。**改過 src 之後要清 `node_modules/.vite` 再重起 dev server**（worker bundle 會 stale：live≠replay 嘅實測教訓）。
3. QC browser＝**Chrome** evidence instance（用戶指定唔再用 Edge）：`node work/v2/m4/qc-assets/launch-chrome.mjs fake|real`（CDP 9223、anti-throttle flags）；截圖/eval 用 `qc-assets/cdp.mjs`；acceptance 全自動 `qc-assets/acceptance-m4.mjs`（fake 路）／`acceptance-m4-real.mjs`（Arena 落地）。**用戶規則：唔可以重複開 browser** — 每次只容許一個 evidence instance；acceptance script 開頭已自帶 `killStaleEvidenceChrome()`（只 match profile `chrome-evidence`，**永遠唔可以用 `/IM chrome.exe`**，會殺用戶自己瀏覽器）＋結束 kill by PID tree。
4. 派工規則同 SPEC §0.2。M5 結果：成功→更新本檔＋落 M6 ticket；失敗→按 SPEC blocker 條報告。

### 遺留俾之後嘅事（必讀）

1. **長 run 退化**：M6 仍要測 ≥20 分鐘（watchdog strikes 跨重連保留）。
2. `connected` 係 ParamState 字串 enum；REST connect raw body `"true"`；param 寫入 PUT。
3. Screen-cap Arena 要 **PrintWindow by handle**（`m1/printwindow-cap.ps1`）— z-order 截圖會被其他 app 蓋住；Composition Monitor 縮細會黑屏（M1/M2 教訓）。
4. Live WS 唔會喺 REST open/rename 後推新 state → sync 後 force reconnect；syncRounds≤3。
5. **M3 教訓**：(a) Chrome occluded window throttle rAF — audio sampling 用 setInterval；(b) AmbientGate calibration 1.2s，Start 必須喺播歌前撳；(c) fake-audio WAV 要 `%` 後綴先 loop — **但 acceptance 用非 loop capture**（`%` loop phase 不可知，absolute timecode 無意義，M4 教訓）；(d) context-loss listener 只註冊一次。
6. **M4 新教訓**：(a) 合成 WAV header bitsPerSample 必須 16（寫錯 Chrome 當 8-bit 讀、capture 全靜音）；(b) 單條 sine 喺闊 band 嘅 MEAN 入面會 dilute — riser／crash 要 multi-tone cluster fill band；(c) onset/rhythm features 要讀 **raw** bands（BandSmoother 220ms release 抹平 transient），energy features 先食 gated；(d) mean+kσ peak-pick 對穩定週期 roll 會 self-swallow（用 mixed 1.6·mean+1.2·σ）；(e) speech 測試資產要 aperiodic（同句重複會俾假 regularity）；(f) acceptance 開始要 kill 殘留 evidence Chrome（profile match `chrome-evidence`，唔掂用戶瀏覽器）＋force AUTO，防外來 click 污染。
7. SPEC §0.2 指定 Flash `qfmodel` 唔喺 subagent 清單（只得 `qoder/qmodel_38max`）→ vision QC 由主管 read_image 代行並明講。
8. **M4.5 新教訓**：(a) **Arena 7.23 clip-level trigger 有 race flakiness** — 對 sibling clips 發 `connect=false` 會 **undo** 啱啱嘅 clip trigger（probe 0/4 latch）；正確係 layer-level `/composition/layers/{N}/clear`（3/3）＋verify(900ms)→column fallback（landing 優先於 precision）；nested by-id clip path 唔存在，path 係 position-based。(b) **Tempo ACF push grid 必須時間均勻**：16ms cadence 嘅 sample jitter 令間隔 16/32 交替 → ACF 崩壞（reg 0.5→0.16）；要 resample 去固定 slot（max-env、zero-fill）。(c) **Vite worker bundle 會 stale**：改咗 `src/*.ts` 之後 live 行為可以同 offline replay 唔同（同一份 code！）→ 清 `node_modules/.vite` 重起先算。(d) **Chrome fake capture 會喺負載下中途 restart WAV**（song-a @14s 觀察到）→ acceptance 用 bandLog 偵測 head-silence→crash pass anchors 做 piecewise 對時＋replay cross-check（分辨 detector 回歸 vs capture artifact）；real 路要 poll 到 drop decision 即刻 snapshot Arena（後續 section 事件會合法地再移格）。(e) section 事件要 confirmation（1.5s）＋sustained music gate，否則 silence→speech onset 誤觸發換片。(f) `ExpStats` 唔可以用第一個 sample 做 seed（kick-peak 開場會 bias 慢 tracker ~tau）→ 頭 1s 平均做 seed。(g) 非對稱 gate（tauDown 1.5s／tauUp 25s）解決咗 M4「riser 被吸」問題，bassCutFrac 因 byte-spectrum splatter 要放到 0.70。
9. **用戶規則（2026-11-18 明確指示）**：唔可以重複開 browser。QC 每次只容許一個 evidence instance；只 kill 自己 launch 嘅 PID tree 或 match `chrome-evidence` profile 嘅程序，**禁止 `taskkill /IM chrome.exe`**（會殺用戶自己瀏覽器）。
10. **M4.5.1 新教訓**：(a) **Port 5200 可能有 IPv6-only listener** — `Get-NetTCPConnection -LocalPort 5200` 回 empty 但 `netstat -ano | Select-String ":5200"` 先見到 `[::1]:5200`；查佔用／清場要用 netstat。(b) **Chrome 會間歇將 16ms setInterval throttle 到 ~1s cadence**（song-c 一次 run 錄到 34 個 1s gap → detector 輸入失真 → live＋replay 一齊冇 drop）。判別法：睇 bandLog gap histogram；處理法：單獨重跑該 scenario，唔好當代碼 bug。(c) `rebalanceBands` 必然壓縮 Jev confidence（tilt 補償嘅副產品）— 事件 floor（G10）同 band 分布 floor 要分開（`CONF_FLOOR=0.4` vs `GRID_FLOOR_BALANCED=0.20`），唔好拿 raw-band 校準嘅 floor 去套 rebalanced 分布。(d) 重置腦記憶時 learnCount=0 應該 `removeItem` 唔好寫 36KB 零檔。(e) 改 src 後重起 dev server 要確認舊 process 真係死晒（port race 會令新 server 起動失敗而舊 server 繼續 serve stale code）。

## 2｜已定決定（唔使重問）

同舊版：純 browser 本地 app（Vite＋TS＋Three.js）、WS 直連 Resolume、兩層決策（慢層結構事件／快層三頻）、3D 果蠅角色（model source 可換、零外部 asset）、九格分類、硬約束表（VRAM ≤1GB、canvas ≤1280×720、dispose、context-loss 重建、AGC 實讀上屏、只連 localhost）、授權紀律（AGPL 唔准入、CC-BY-NC 只私人自用）。M3 新增：**AmbientGate（per-band DC removal）係三頻輸入契約**。M4 新增：**onset/rhythm 食 raw bands、energy 食 gated bands**；**LOW-dominance 係 music-vs-voice primary gate**；**decision 全計算喺 Web Worker**（contract d）；**override＝HAX G17 全局開關**（讓位直至明確還畀）。M4.5 新增：**決策＝果蠅腦 MB sparse coding（2048 KC／top-5% k-WTA／9×2048 可塑 W）＋多巴胺 RPE 在線學習＋防連撞 Bag**；**觸發粒度＝九格 9 選 1 clip（預設），Column 全換保留為可選模式**（Q20-B 作 fallback）；**換片時機＝drop＋section（breakdown/build-up 等段落轉移），cooldown 5s**；**groove lock＝buildup 期間凍結 tempo、16ms 均勻 grid**；**AmbientGate 非對稱 tauDown 1.5s／tauUp 25s＋↻ 校準掣**。

## 3｜必要檔案索引

| 位置 | 用途 |
|---|---|
| `docs/SPEC_V2.md` | 開工唯一主檔（含 §M4.5 定案） |
| `docs/M4_RESULT.md` | M4 交付＋四契約證據＋timecode 表＋**M4.5 ADDENDUM**（MB-WTA／9 選 1／section／非對稱 gate＋M4.5 教訓） |
| `docs/M45_CHECKPOINT.md` | M4.5 mid-flight 診斷史（pause 檔，含 live≠replay stale-cache 案） |
| `docs/M45_1_RECIPE.md` | **當前執行 Recipe**：實戰錄影審核修復＋果蠅腦 `localStorage` 持久化＆人手示範錄製器 |
| `docs/M5_TICKET.md` | **下一 task**（M4.5.1 完成後開工） |
| `work/v2/m4/webapp/` | app（port 5200） |
| `work/v2/m4/qc-assets/` | QC 工具（launch-chrome／cdp／acceptance fake+real／make-test-songs-m4／record-replay／replay-existing／arena-front） |
| `work/v2/m4/evidence/` | screen-cap PNG |
| `work/v2/m4/acceptance-bands-*.json` | 16ms band log（offline replay 覆核證據） |
| `CONTEXT.md`／`docs/adr/`／`docs/research/` | glossary／決定鏈／一手研究 |

## 4｜授權狀態

**已批准**：開發機啟動 Arena 做驗證；Alley free footage dummy grid；只讀掃描用戶後補 clip 資料夾；subagent 路線按 SPEC §0.2；Chrome evidence instance（獨立 profile）；ffmpeg 本地合成測試音檔；Windows TTS 本地合成 speech 測試檔。
**未批准／要再問**：裝任何軟件（Rust/MSVC、Tauri 依賴）；啟動 MadMapper；表演機任何操作；對外網絡發送／登入／OAuth；clip 庫以外私人資料夾掃描；public 發布。

## 5｜已知風險／未決

1. 用戶 9 條測試 clip 路徑未補（**M5 critical path** — 冇排好嘅庫 Region Mapping 無嘢可映）。
2. Heuristic drop 偵測無公開準確率基線 — 只驗 ±0.5s 對照行為（M4.5：4/4 命中，+44~+165ms）；coarse tempo 唔穩（octave error），決策唔依賴 bpm。
3. Laptop mic firmware AGC 可能繞唔到 → M6 實測；最壞 UI 明示「分析可信度受限」。
4. VRAM 預算係推算 → M6 終判（M3 dev 機 Chrome 3D avg 4.15%／max 6% @4090 只作輸入）。
5. AmbientGate：非對稱 tauUp 25s 後 riser／持續 bass 唔會被吸（M4.5 解決）；但完全恆定音仍會慢 fade；Start 時音樂已播可撳 ↻ 重新校準。
6. ~~**M4.5 clip-level precision 未穩**~~ → **M4.5.1 已解決（開發機）**：short-press（省略 value）＋先 clear 後 trigger，real 路 `precision=true`、`usedFallback=false`（L3C2 純淨 latch，同 column 其他 layer 確被 clear）。verify→column fallback 保留作保險；表演機（3070 Ti laptop）M6 終判。
7. MB 在線學習係 per-KC Hebbian，W 只隨 override 漂移、冇 offline 訓練、唔宣稱準確率；重載 page 即 reset。

— 交接寫於 2026-11-18（Asia/Shanghai），M4.5 PASS 後更新。
