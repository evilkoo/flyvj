# M1 RESULT（v2 路線）— WebSocket bridge 驗證（2026-11-17）

**結論：PASS。網頁 → Arena 7.23.2 WebSocket API → 真換 clip，喺開發機行得通。**
（舊 M0–M3C 路線嘅 M1 結果見 `docs/M1_RESULT.md`。）

## 環境

- 開發機（Win10 Pro／RTX 4090），Resolume Arena **7.23.2**（build 51094）。
- Composition：`work/v2/m1/dummy-grid.avc`（= Arena 自帶 `default/Example.avc` 嘅 copy；**用戶真 show `.avc` 完全冇碰**）。
- Grid：3 layer × 3 column，9 格各載一個 Arena 內置 generator（Metaballs/Rings/Spiral／LineScape/Tunnelines/Gradient／Stroboscope/Checkered/SolidColor）。
  - **偏離 SPEC 原文**：SPEC 寫「Alley 官方 free footage」，但 Alley 安裝目錄冇附任何 footage 檔（只有 encode presets；AppData 嘅 previews 係用戶自己 renders）。改用 Arena 自帶內置 generator：同為 Resolume 官方 ship、授權乾淨、自包含、9 格視覺差異更大。如要換真 footage，M2 用 `clip_open` 同一條路徑即可。
- Webserver：`Preferences/server.xml` 改 `enabled="1"`；**address 由 0.0.0.0 收緊做 127.0.0.1**（符合 SPEC「只連 localhost」硬約束，比原設定更嚴）。備份：`work/v2/m1/server.xml.bak`、`config.xml.bak`。
- Bridge page：`work/v2/m1/webapp/`（Vite＋TS，port 5199）。

## 驗收契約對照

| 契約 | 結果 | 證據 |
|---|---|---|
| (a) 連接成功＋收到 composition state JSON | **PASS** | `ws-log.json`（open→state layers=3 columns=9→sources_update→effects_update） |
| (b) 9/9 column trigger 有可見 clip 變化 | **PASS** | `acceptance-9cell.json`（9/9 cells echo Connected，exit 0）＋`caps/final-0{1,2,3}-monitor.png` 三欄畫面明顯唔同（LineScape+Metaballs／Checkered+Tunnelines／Spiral+Gradient）＋`caps/final-00-monitor.png` baseline 黑 |
| (c) 連線 10 分鐘唔斷＋subscribe 有回推 | **PASS** | `stability-10min.json`：600s、stillOpen=true、closes=0、errors=0、parameter_update 回推 44 次、periodic trigger round-trip 9/9 |
| (d) webserver 未 enable 時有明確錯誤、唔崩 | **PASS** | `caps/final-04-failpath.png`：紅底「CONNECTION FAILED — Arena webserver not reachable at ws://127.0.0.1:9999/api/v1…Auto-retrying…」＋log 顯示 WS close code=1006 後自動重試 loop，page 冇崩 |

## 協議實測（7.23.2，全部由本機 Arena 實測／官方 example bundle 拆出）

- Endpoint：`ws://127.0.0.1:8080/api/v1`。開機即推 composition state（含 layers/columns/clips 全樹）＋`sources_update`＋`effects_update`。
- 訊息：`{action:"trigger"|"set"|"subscribe"|"unsubscribe", parameter:"<path>", value?}`；server 回 `parameter_get/set/update/subscribed {id,value}`。
- Column trigger：`{action:"trigger", parameter:"/composition/columns/by-id/<id>/connect", value:true|false}`；**value 省略＝short press（press+release 一齊發）**。
- **`connected` 係 ParamState 字串 enum：`"Empty"|"Disconnected"|"Connected"`，唔係 boolean**（第一輪測試用 `===true` 誤判過）。
- Subscribe：`{action:"subscribe", parameter:"/parameter/by-id/<paramId>"}`，之後該 param 變化推 `parameter_update`。
- REST 補充：`POST /composition/columns/{i}/connect` body 要 raw `"true"` 先 latch（JSON object body 無效）；param 寫入用 **PUT** `/parameter/by-id/{id}`；`GET /composition/layers/{i}/clips/active` 喺冇 connected clip 時 404（正常語義）。
- Grid 可全 script 管理：`DELETE /composition/columns/{i}`、`POST /composition/layers/{L}/clips/{C}/open` body `source:///video/<Name>`、`PUT clip` 改名。

## 重要發現（帶去 M2/M6）

1. **長時間運行退化**：Arena 開咗 ~50 分鐘、期間幾十個 WS client 連/斷之後，connect trigger 同 subscribe echo 變得 intermittent（REST 204 但狀態唔變、subscribe 冇回推）。**重啟 Arena 即完全恢復**，fresh session 9/9 一次過 PASS。呢個對表演機「≥20 分鐘連續 set」係真實風險 → M6 要測長 run；M2 要有「狀態唔對就重連/重 subscribe」嘅 watchdog（bridge page 已有 reconnect，但未覆蓋「連住但 channel 死」嘅情況）。
2. Composition Monitor 喺縮細視窗（~980×760）會折疊/黑屏，screen-cap 證據必須喺 maximize 視窗截（用戶 2026-11-17 親眼確認放大後有畫面，糾正咗我嘅誤判）。
3. `clip_open` 載入 source 後 clip name 保留舊 metadata，要另外 PUT 改名先至證據清晰。

## 證據檔清單（work/v2/m1/）

- `ws-log.json`（開機 state push）、`ws-trigger-log.json`（第一輪 trigger，含 ParamState 學習過程）
- `acceptance-9cell.json`（9/9 PASS）、`stability-10min.json`（10 分鐘）
- `caps/final-00-baseline.png`＋`final-00-monitor.png`（全黑 baseline）
- `caps/final-01..03-*.png`（三欄 full screen：Edge bridge page＋Arena 同框）＋`final-0{1,2,3}-monitor.png`（monitor crop）
- `caps/final-04-failpath.png`（失敗路徑 UI）
- Scripts：`ws-probe.mjs`、`acceptance-9cell.mjs`、`stability-10min.mjs`、`setup-dummy-grid.ps1`、`screencap-region.ps1`、`crop.ps1`、`window-ctl.ps1`、`enum-windows.ps1`、`webapp/`（Vite bridge page）

## 未完成／風險

- ~~Stability 10 分鐘~~ 已 PASS（見上表）。
- 長 run 退化問題未 root-cause（只知重啟可解；10-min fresh run 完全穩定，退化係 ~50 分鐘＋大量連斷後先出現）；M2 watchdog 設計要 cover，M6 測 ≥20 分鐘。
- Webserver 設定改動未還原（enabled=1 loopback 保留俾 M2 用；還原指令：用 `work/v2/m1/server.xml.bak`）。
