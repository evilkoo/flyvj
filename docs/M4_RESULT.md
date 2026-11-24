# M4 RESULT — 慢層決策 ＋ Decision Cockpit PASS

日期：2026-11-17（開發機 RTX 4090）。Ticket：`docs/M4_TICKET.md`；SPEC §Milestone 4。
App：`work/v2/m4/webapp/`（Vite port **5200**；M1–M3 全部保留：grid/WS/watchdog/manifest/avatar/gate）。
QC browser：**Chrome** evidence instance（用戶指定唔再用 Edge；`qc-assets/launch-chrome.mjs`、CDP 9223、anti-throttle flags）。
Arena：開發機 Arena 7.23.2 已批准啟動，載 `work/v2/m1/dummy-grid.avc`（real 路驗收）。

## 驗收契約結果

| 契約 | 結果 | 證據 |
|---|---|---|
| (a) 3 條標明 drop 嘅歌：drop ±0.5s 內有決定輸出 | **PASS** — song-a **+174ms**、song-b **+103ms**、song-c **+75ms / +191ms**（兩個 drop）；全部 AUTO trigger column 1（LOW-dominant，v0 規則正確） | `acceptance-m4.json` matches；`acceptance-bands-*.json`（16ms band log 可 offline replay 覆核）；逐條誤差見下表 |
| (b) 靜音／說話環境 → HOLD 唔亂換 | **PASS** — silence 0 trigger／0 drop event；speech（8 句不同語速、隨機間距 TTS）0 trigger／0 drop event | `acceptance-m4.json` contract-b |
| (c) override ≤100ms 生效＋自動決定讓位直至明確還畀 | **PASS** — override 主訊框同步路徑 **0.2ms**；mode→OVERRIDE；drop 時刻 auto trigger 0 次、SUPPRESSED 1 次；handBack→AUTO 恢復 | `acceptance-m4.json` contract-c；截圖 `m4-override-01/02` |
| (d) 全程零 sidecar、主訊框唔 BLOCK | **PASS** — 全部 detector/decision 計算喺 Web Worker；main-frame sample callback max **0.4–0.5ms**（avg 0.08ms）、worker compute max **0.5–0.8ms**、longtask **0** | `acceptance-m4.json` perf（三歌各一組）；perf line 上屏 |
| 做#4 drop 全身大動作 | **PASS** — dropPulse → 跳起＋六腳張開＋觸鬚後拋＋翅全展；vision QC 截圖可見 | `m4-song-a-01-drop.png`（主管 read_image 覆核） |
| Real 路：決策落地 Arena | **PASS** — pre-trigger col2（強對照）→ app AUTO drop @24.67s trigger col1 → Arena col1 Connected、col2 Disconnected；PrintWindow 截圖 col1 綠框＋Composition Monitor 播 Metaballs | `acceptance-m4-real.json` landed=true；`m4-real-02-arena-output.png` |

Unit tests：**54/54 綠**（`npm test`，含 M3 保留 38＋M4 新增 16）；typecheck 過。

## 契約 (a) timecode 對照表（逐條記錄，唔宣稱統計準確率）

| 歌 | BPM | 標記 drop (s) | app 決定 (s) | 誤差 (ms) | 決定 |
|---|---|---|---|---|---|
| song-a-128 | 128 | 24.500 | 24.674 | **+174** | trigger col 1 conf 0.79 |
| song-b-124 | 124 | 21.355 | 21.458 | **+103** | trigger col 1 conf 0.71 |
| song-c-140 #1 | 140 | 19.143 | 19.218 | **+75** | trigger col 1 conf 0.53 |
| song-c-140 #2 | 140 | 39.714 | 39.906 | **+191** | trigger col 1 conf 0.67 |

時間基准：非 loop fake capture（`--use-file-for-fake-audio-capture` 無 `%`）→ Start click ≈ WAV t=0；
另用 detector `firstSoundT`（WAV 頭 2s 靜音後嘅 crash）self-calibrate δ（實測 δ≈0–17ms）。

## 交付內容

- `src/detector.ts` — streaming heuristic detector（PURE，worker 內）：onset envelope（**raw** band-diff，見 finding 3）→ onset density；LOW novelty peak（running mean/variance）；build-up＝bass cut＋riser＋roll accel（latch 語義）；coarse tempo＝onset envelope autocorrelation snap；regularity gate；**LOW-dominance gate**（drop＝bass 回歸；voice 係 MID-dominant）；bass-cut memory（drop context）。
- `src/decision.ts` — band→column v0（LOW/MID/HIGH→col 1/2/3）、softmax＋**Jev confidence** `(p_max−1/n)/(1−1/n)`、HOLD floor（CONTEXT Column 規則 ≤0.02）、MasterSwitch（AUTO/OVERRIDE/HOLD，HAX G17）。
- `src/decision.worker.ts` — Web Worker：全部偵測＋決策計算（contract (d)）；post decision/state/dropPulse。
- `src/model.ts`／`flyrig.ts`／`renderer.ts` — `bandsToPose(bands, t, dropPulse)` 全身大動作（M3 預留位落地）；pulse decay tau≈350ms。
- `main.ts`＋`index.html` — **Decision Cockpit**：n-best 候選列（≥88×64 hit target、一鍵 override/veto）、categorical confidence chip（HIGH/MED/LOW，PAIR）、近因 ticker＋history（HAX G11/G12）、detector state 行、AUTO/HOLD 大掣（G17）、perf line；M2 grid click 改為 override 語義。
- QC：`make-test-songs-m4.mjs`（3 歌標明 drop timecode＋`test-songs-m4.json` 表）、speech TTS 生成（aperiodic）、`acceptance-m4.mjs`（fake 路 a/b/c/d）、`acceptance-m4-real.mjs`（Arena 落地）、`record-replay.mjs`／`replay-existing.mjs`（16ms band log offline 覆核）、`arena-front.ps1`。

## QC 期間發現並修正嘅真問題（全部有證據）

1. **WAV header bug**：生成器 `bitsPerSample` 寫咗 1（應 16）→ Chrome 當 8-bit 讀、fake capture 全靜音。用 in-page `decodeAudioData`（dur 81s vs 40.5s＝double）確診。
2. **Riser 被 dilute**：單條 sweeping sine 喺 256-bin 闊 HIGH band 嘅 MEAN 入面稀釋到低過 floor（M3 已記錄教訓，我重犯）→ 改 12-tone rising cluster fill band。
3. **Onset density 全程 0**：BandSmoother release 220ms 抹平 snare roll transient，gated bands 讀唔到 onset；且 mean+2.6σ peak-pick 對穩定週期 roll 會 self-swallow。修正：onset envelope 改讀 **raw** bands（energy features 仍食 gated — ticket 契約）；threshold 改 mixed `1.6·mean+1.2·σ`。
4. **Build-up latch**：accel cue 會喺 roll 中段被 onset baseline 吸收而 decay → 改 latch 語義（cross threshold 即 arm，collapse <0.6× 先 disarm）。
5. **Regularly 只喺 drop 分支更新** → state 顯示恆 0.00，gate 無法觀察；改每 ~1Hz tempo pass 同步 refresh。
6. **Speech 測試資產太週期**（同一句重複 6 次 → reg 0.42 高過音樂！）→ 改 8 句不同語速＋隨機間距；同時加 **LOW-dominance** 做 primary music-vs-voice gate（measured: drop low/mid≈2.3 vs speech≈1.2）。
7. **Acceptance matcher bug**：`Math.abs(err) < Math.abs(best.err)` 用咗 undefined → 只保留第一條；且 override 行誤當 drop match。修正：只認 AUTO mode 且 reason 含 DROP 嘅行、比較 `best.errMs`。
8. **Loop capture phase 不可知**（M3 教訓）：`%` loop 模式 absolute timecode 無意義 → acceptance 改非 loop capture（歌長 ≤ capture 時間）。
9. **外來干擾**：一次 song-a run 錄到 4 次 user override（模式變 OVERRIDE → 真 drop 被 SUPPRESSED）→ acceptance 開始時 kill 殘留 evidence Chrome（只 match `chrome-evidence` profile，唔掂用戶瀏覽器）＋run 前 force AUTO＋結束時 interference warning。

## Vision QC（主管 read_image 代行）

SPEC §0.2 指定 Flash `qfmodel` 唔喺當前 subagent 清單（只得 `qoder/qmodel_38max`），按規則由主管代行並明講。逐張覆核：
`m4-song-a-01-drop.png`（果蠅跳起六腳張開＝dropPulse、cockpit COL1 高亮＋ticker 綠字理由＋confidence chip、band meter LOW 主導、AGC 全 OFF 實讀、backing 962×542）；`m4-override-01/02`（OVERRIDE 琥珀態＋SUPPRESSED ticker）；`m4-real-02-arena-output.png`（Arena col1 綠框 connected＋Composition Monitor 播 Metaballs）。

## 已知限制（v1，如實記）

1. **Heuristic 無公開準確率基線** — 只驗 ±0.5s 對照行為（4/4 drop 命中，誤差 75–191ms）；唔宣稱百分比（ticket 禁止）。
2. **Coarse tempo 唔穩**（bpm 估計 78–170 跳動）— envelope ACF octave error 係本質限制；v0 決策唔依賴 bpm（只入 ticker 做參考），snap 8/16-bar 未啟用。
3. **Build-up 事件偏遲／偏早 ±2s** — latch 語義下 cues 齊先 fire；只入 ticker 唔觸發 column，影響有限。
4. **Speech gate 係 heuristic**（LOW-dominance＋regularity）— 重低音人聲／beatbox 可能誤判；現場有 override 兜底（G9/G17）。
5. **Real 路只驗 1 次**（song-a、col1）— 多 column 落地矩陣留 M6 表演機實測。
6. **Arena 未開時 auto trigger 跳過**（grid offline）— ticker 仍顯示決定＋理由（log 有記錄）。

## 下一步

M5 ticket：Clip 庫 Tagging Pipeline（SPEC §M5；用戶 9 條 clip 路徑未補 — M5 前俾就得）。

---

# M4.5 ADDENDUM — 果蠅腦 MB-WTA ＋ 9 選 1 clip trigger ＋ section 事件（2026-11-18）

用戶批准嘅架構升級（SPEC §M4.5）。全部喺 `work/v2/m4/webapp/`。

## 升級內容

1. **真・果蠅腦決策模型**（`src/decision.ts` MushroomBody）：14 維特徵向量（LOW/MID/HIGH 即時、3s signature ×3、斜率 ×2、novLow、density、regularity、buildup/3、total、bpm-known）→ 固定隨機投射 P[2048×14]（mulberry32 seed 1597463809，可重現）→ ReLU → **top-5% k-WTA（102 Kenyon Cells）** unit-sum 稀疏碼 → 9×2048 可塑權重 W ＋ engineered prior → softmax(0.35) → Jev confidence。W 零起步＝行為等於 M4 校好嘅 prior。來源：CONTEXT「昆蟲腦啟發架構」＋research/flybrain-decision-models（mushroom body sparse coding）。
2. **多巴胺 RPE 在線學習**：用戶 override 去某格 → 用嗰一刻嘅 KC 碼強化該格（etaPos 3.0）、抑制被否決嘅自動選擇（etaNeg 1.2）、clamp ±4。Worker 收 `override{cell, denied}`。
3. **防連撞 Bag**：自動唔會連續兩次觸發同一格（有 runner-up prob ≥0.05 就改選）；override 不受 bag 限。
4. **9 選 1 精準 clip trigger**（`main.ts triggerClip`／`protocol.ts clipConnectPath`）：決策目標由 3 column 改為 9 clips（row=LOW/MID/HIGH、col=STATIC/MEDIUM/ACTIVE）。**實測發現（2026-11-18 Arena 7.23.2 probe）**：clip connect 係 position-based `/composition/layers/{L}/clips/{C}/connect`（nested by-id 唔存在）；**對 sibling clips 發 connect=false 會 undo 啱啱嘅 trigger（0/4 latch）**，正確做法係 layer-level `/composition/layers/{N}/clear`（3/3 latch＋清除）。加 verify(900ms)＋column fallback（Q20-B 契約）：landing 優先於 precision。
5. **section 事件 ＋ groove lock**（`src/detector.ts`）：3s signature EMA 主導頻段持續轉移 → section 事件（cooldown 5s、confirmation 1.5s、music gate reg≥0.35＋density≥2.0 sustained）；breakdown／build-up 都能換片。`tempoStepMs` 32→16ms；**發現非均勻 push grid 會令 ACF 崩壞（reg 0.5→0.16）→ 改 resample 去均勻 16ms slot**；bass-cut／buildup 期間凍結 tempoBuf／runTempo（groove lock）；drop 加 bar-phase bonus（±12% bar、+0.05）。
6. **非對稱 AmbientGate**（`src/dsp.ts`）：tauDown 1500ms（raw<slow 快落）／tauUp 25000ms（raw>slow 極慢上）→ 8–16s riser 同持續 bass 唔再被吸走；`recalibrate()`＋UI ↻ 掣支援播歌中途校準。
7. **ExpStats seed fix**：頭 1s 平均做 seed（舊版用第一個 sample → kick-peak 開場 bias 慢 tracker 10s → 假 bassCut）。

## M4.5 驗收結果（`acceptance-m4.json`／`acceptance-m4-real.json`）

| 契約 | 結果 |
|---|---|
| (a) drop ±0.5s | **PASS** — song-a **+44ms**、song-b **+165ms**、song-c **+169/+30ms**；live 同 offline replay 一致；全部 9 格 AUTO trigger（LOW-dominant → L1C1/L1C2） |
| (b) 靜音／說話 HOLD | **PASS** — silence 0、speech 0 trigger／0 drop／**0 section**（section music gate 擋住人聲 onset shift） |
| (c) override ≤100ms | **PASS** — 0.2ms、OVERRIDE 讓位、SUPPRESSED 1、handBack→AUTO |
| (d) 零 sidecar | **PASS** — main-frame max 0.3–0.4ms、worker compute max（含 MB projection）1.3–1.5ms、longtask 0 |
| Real 落地 | **PASS（landed）** — clip trigger L1C1 於 live 環境未 latch → verify+fallback 用 column trigger 成功落地（col1 Connected、pre-armed col2 OFF）；**precision（clip latch＋其他 layer cleared）未達 — 未決風險，留 M6 表演機實測** |

Unit tests：**64/64 綠**（M3 38＋M4.5 26）；typecheck 乾淨。

## M4.5 新教訓（補入 handoff「遺留必讀」）

1. Arena 7.23 clip-level connect 有 race flakiness：sibling `connect=false` 會 undo 目標 trigger；用 layer-level `clear` 先安全。landing 要有 verify＋column fallback。
2. Tempo ACF push grid 必須**時間均勻**：16ms cadence 嘅 jitter（15.8/16.3ms）會令間隔 16/32 交替 → ACF 崩壞。要 resample 去固定 slot。
3. Chrome fake capture 喺負載下會**中途 restart WAV**（song-a 觀察到 @14s restart）→ acceptance 用 bandLog 偵測 head-silence→crash pass anchors 做 piecewise 對時＋offline replay cross-check；real 路要 poll 到 drop decision 即刻 snapshot Arena（後期 section 事件會再移格）。
4. Section 事件要 confirmation＋sustained music gate，否則 silence→speech onset 會誤觸發換片。

## M4.5 已知限制

1. **Clip-level precision 未穩**（live fallback 到 column）— M6 表演機再判；如需真 9 選 1 落地，可能要改用 REST clip transport 或 delay clear。
2. MB 學習係 per-KC Hebbian（無 offline 訓練、無準確率宣稱）；W 只隨 override 漂移，reset 需重載 page。
3. Coarse tempo 仍唔穩（octave error）；bar-phase 只作加分，決策唔依賴 bpm。

— M4.5 addendum 寫於 2026-11-18（Asia/Shanghai）。

---

# M4.5.1 ADDENDUM — 實戰影片審核修復 ＋ 果蠅腦經驗持久化（2026-11-18）

來源：用戶實戰錄影逐幀審核（KI/KI 150 BPM live set · Azure Kinect Mic · Arena 3L×9C），修復指令依 `docs/M45_1_RECIPE.md` Step 1.1–1.4＋§2 執行。

## 五個問題嘅修復結果

| # | 問題 | 修復 | 驗證 |
|---|---|---|---|
| Bug 1 | Build-up 九宮格空白（`candidates: []` 抹走全部） | worker 用 `decideOnEvent(...).candidates` 填 live 候選；`renderCandidates` 空陣列直接 return；state tick 帶 `liveCandidates`（10Hz 實時跳動，保留上次 .top 綠框） | cdp 實測 build-up 期間 `dashCount=0`，九格全部有百分比 |
| Bug 2 | Drop↔Section 1–3 秒乒乓連跳 | Drop 唔再 `sigBase=null`；改 `lastSectionT=t` 共用 5s 冷卻；section 加 `phase==="idle" && !bassCutActive && t-lastDropT>=cooldown`；drop phase 結束後先 re-anchor | unit test「no spurious section within cooldown after drop」綠；acceptance 無 1–3s 連跳 |
| Bug 3 | L1（LOW）壟斷 96%，L2/L3 永唔出頭 | `rebalanceBands()`（對慢速 15s 頻段基準做 tilt 補償，嚴格保持 total 不變）；drop 用瞬時 rebalanced、section/buildup 用 3s signature×total rebalanced | **acceptance 直接證據：drop trigger 落 `L3C1`／`L2C1`／`L3C2`／`L3C2` — L2/L3 解鎖**（M4.5 全部 L1） |
| Bug 4 | Arena clip trigger 用 `value:true` 長按＋次序錯 | 改 short-press（省略 `value`）＋先 clear 其餘兩 layer 再 trigger 目標（M1 協議） | **real 路 PASS：`precision=true`、`clipLanded=true`、`othersCleared=true`、`usedFallback=false`** — 首次真 9 選 1 純淨落地（L3C2 直接 latch，唔再需要 column fallback） |
| 功能 5 | 腦經驗 F5 即消失 | `exportWeights/loadWeights`＋`localStorage flyvj.mb.v1`（learnCount 0 時 remove 唔寫零檔）＋`humanDemoLog`（每次 override 記錄 bands/raw/detector 快照→`flyvj.demo.v1`）＋💾 匯出經驗／🗑 重置記憶掣＋🧠 badge | cdp 實測：override 4 次→badge「已學習: 4 次」→**reload 後保留**→reset 後歸零 |

## Recipe 外部發現：rebalanceBands × CONF_FLOOR 張力（主管裁決）

Recipe 冇預見：`rebalanceBands` 補償頻段 tilt 嘅同時必然壓縮 share 分散度 → Jev confidence 由 ~0.5 跌到 0.24–0.32，全部 drop 撞 `CONF_FLOOR=0.4` HOLD（第一輪 acceptance contract (a) 全 FAIL，journal 清楚顯示「conf event 0.80 / grid 0.27 < 0.4」）。
修復（唔違反 recipe 顯式約束、`priorScores` 原封不動、舊 64 tests 全兼容）：`DecideCtx.bandFloor` 參數化 — **事件 floor（G10「呢個係咪真結構時刻」）維持 0.4 不變**；rebalanced 決策嘅 band floor 用 `GRID_FLOOR_BALANCED=0.20`（物理意義唔同，兩個 floor 分開）；HOLD reason 帶埋 `[event reason]` 方便對照。呢個數由 acceptance 實測校準（song-c drop#2 grid 0.24 係觀察到嘅最低真 drop 值）。

## M4.5.1 驗收

- Unit tests **67/67 綠**（64＋recipe §2 三個新測試）；typecheck 0 error。
- Acceptance 四契約：**全 PASS** — song-a **+156ms**、song-b **+86ms**、song-c **+73/+45ms**（live＝replay 一致）；silence／speech 0 trigger／0 section；override 0.2ms。
- 九格唔空白＋localStorage 持久化＋reload 保留＋reset 掣：cdp 全部驗證（上方表格）。

## M4.5.1 環境教訓（補入 handoff）

1. **Port 5200 可能有 IPv6-only listener**：`Get-NetTCPConnection -LocalPort 5200` 回 empty 但 `netstat -ano | findstr :5200` 見 `[::1]:5200` — 查佔用要用 netstat，唔好信 Get-NetTCPConnection 講「free」。
2. **Chrome 會間歇 throttle 16ms setInterval 到 1s cadence**（song-c 一次 run 錄到 34 個 1s gap → detector 輸入失真 → live＋replay 一齊冇 drop）。呢個係 capture artifact 唔係代碼 bug：判別法＝睇 bandLog gap histogram；處理法＝單獨重跑該 scenario。
3. 匯出經驗檔（`flyvj-brain-*.json`）包含 W＋humanDemoLog，係 M5/M6 之後「用家親手示範餵腦」路線嘅資料基礎。

— M4.5.1 addendum 寫於 2026-11-18（Asia/Shanghai）。
