# M3 RESULT — Avatar viewport（三頻 → 果蠅身體反應）PASS

日期：2026-11-17（開發機 RTX 4090）。Ticket：`docs/M3_TICKET.md`；SPEC §M3。
App：`work/v2/m3/webapp/`（Vite port **5200**；M2 grid/WS/watchdog/manifest 全保留）。
QC browser：**Chrome** evidence instance（用戶指定唔再用 Edge；`--user-data-dir=work/v2/m3/chrome-evidence`、CDP 9223、anti-throttle flags）。

## 驗收契約結果

| 契約 | 結果 | 證據 |
|---|---|---|
| (a) 三部位各自反應 | **PASS**（fake 路：LOW/MID/HIGH/FULL/SILENCE 五類全觀察到；real 路：LOW/MID/FULL 反應） | `acceptance-m3.json` classCounts；evidence PNG |
| (a) 靜音 2s 內歸零 | **PASS**（fake 路嚴格 zero：max **1.42s**；real 路 rest-state ≤2s：0s） | `acceptance-m3.json` zeroEvents；`acceptance-m3-real.json` |
| (b) canvas ≤1280×720 | **PASS**（backing 962×542，cap 數學 unit-tested 8 組 CSS/DPR） | renderer info 行；`tests/rig.test.ts` |
| (c) GPU 佔用記錄 | **PASS**（dev 4090：Chrome 3D engine avg **4.15%**／max 6%；整體 GPU avg 18.4% 含其他 app） | `work/v2/m3/gpu-usage-dev.json` |
| (d) AGC 狀態顯示正確 | **PASS**（fake：AGC/echo/NS 全 false 實讀；real：Kinect mic 全 false 實讀，上屏＋ambient baseline 顯示） | evidence PNG；acceptance json `mic-settings-*` |
| (e) context-loss dispose＋重建 | **PASS**（forced WEBGL_lose_context → teardown → restore → rebuilds +1 → 繼續 render） | `m3-after-context-rebuild.png`（log 行 rebuild #N） |

Unit tests：**38/38 綠**（`npm test`）；typecheck 過。

## 交付內容

- `src/dsp.ts` — FFT 2048 三頻（LOW 30–180／MID 180–2500／HIGH 2500–min(8000,Nyquist)）＋attack 50ms/release 220ms smoother＋**AmbientGate**（per-band DC removal，tau 6s；1.2s Start calibration）。
- `src/audio.ts` — getUserMedia（AGC/echo/NS off 請求）＋getSettings 實讀＋BandSampler（16ms setInterval，**唔靠 rAF**）。
- `src/model.ts` — ModelSource/FlyRig 可換介面（ADR 0007）＋pure `bandsToPose`（Band-Body Mapping）。
- `src/flyrig.ts` — 程序化卡通果蠅（Three.js primitives，零外部 asset，授權乾淨）；dispose registry。
- `src/renderer.ts` — ≤1280×720 cap＋full dispose＋context-loss rebuild（listener 只註冊一次）。
- `main.ts` — Start button（user gesture）、band meters、AGC/ambient 上屏、M2 grid/WS 全保留、QC hooks（`__flyvj.m3.*`）。
- QC 工具：`qc-assets/`（make-test-song／launch-chrome／cdp／acceptance fake+real／gpu-usage-dev／diag-*）。

## QC 期間發現並修正嘅真問題（全部有 unit test 或 acceptance 覆蓋）

1. **Chrome fake-audio 唔 loop** → 檔名加 `%` 後綴。
2. **Context-loss listener 累積**（一次 loss 觸發 N 次 rebuild）→ listener 只註冊一次＋stale renderer dispose。
3. **房間噪聲底**（dev 機 LOW≈0.35/MID≈0.10，ffplay CPU load 令風扇底向上漂）→ 絕對 silence gate 喺真聲路永遠歸唔到零；改 **AmbientGate DC removal**。
4. **rAF 喺 occluded window 被 throttle 到 ~1fps** → calibration 卡死；audio sampling 改 setInterval（分析唔跟 render throttling，M4 契約 d 前奏）＋QC instance 加 anti-throttle flags。
5. **合成歌 HIGH 段 broadband leak**（tick envelope 散到低頻）→ 改 20-tone 3–7.9kHz cluster＋smooth tremolo。

## 已知限制（v1，如實記）

1. **Start 時若音樂已播**，calibration 會食住音樂做 baseline（操作契約：先撳 Start、後播歌；Stop→Start 即刻 re-baseline）。
2. **完全恆定嘅音**會喺 ~tau(6s) 內 fade（DC removal 本質；真音樂有動態，唔影響）。
3. Real 路 band dominance 弱（房間聲路 raw delta 只有 ~0.01–0.05）；嚴格 per-band isolation 以 fake 路＋unit tests 為準，real 路驗「有反應＋停歌即 rest」。
4. GPU 數字係開發機 4090；表演機 3070 Ti 實測留 M6。
5. Arena 未開時 grid 顯示 CONNECTION FAILED（預期；avatar 不受影響，M3 唔依賴 Arena）。

## Vision QC（主管 read_image 代行）

SPEC §0.2 指定 Flash `qfmodel` 唔喺當前 subagent 清單（只得 `qoder/qmodel_38max`），按規則由主管代行並明講。逐張覆核：fake 五段（LOW 腳/身體、MID 觸鬚、HIGH 翅展開、FULL、SILENCE rest）＋rebuild 後＋real LOW：角色清晰、映射正確、meter/AGC/ambient 顯示正確。

## 下一步

M4 ticket：慢層決策＋Decision Cockpit（drop 偵測、confidence、override）。M3 嘅 band sampler＋renderer 係 M4 嘅輸入。
