# M2 RESULT（v2 路線）— Grid 狀態 ＋ 映射表 v0（2026-11-17）

**結論：PASS。三條驗收契約全部通過，watchdog 契約化並 unit-test 覆蓋。**

## 交付物

- App：`work/v2/m2/webapp/`（Vite port 5199；modules：`src/protocol.ts`、`src/manifest.ts`、`src/watchdog.ts`；UI glue `main.ts`）
- Manifest：`work/v2/m2/webapp/public/manifest.json`（九格：3 energy × 3 motion；改檔＋reload 即生效）
- Unit tests：`webapp/tests/`（17 tests，`npm test`＝`node --test`，全 PASS；tsc strict 0 error）
- Acceptance：`work/v2/m2/acceptance-m2.mjs` → `acceptance-m2.json`（exit 0）
- 證據：`work/v2/m2/caps/`（screen-cap 8 組＋錄屏 2 條）

## 驗收契約對照

| 契約 | 結果 | 證據 |
|---|---|---|
| (a) 點任一格 → 該 column 三 layer 全換；高亮以 subscribe 回推為準 | **PASS** | acceptance (a) 9/9 cells Connected（全部經 subscribe push 判定，唔係本地記憶）；`caps/cap-03-*`（**外部** WS trigger column 2 → page 自動綠框，證明高亮非 click handler 驅動）；`caps/cap-05-*`（CDP 真 mouse click L3C3 → Arena monitor 顯示 Spiral/Gradient/SolidColor，page column 3 綠框） |
| (b) 改 manifest 重載即生效，唔改 code | **PASS** | acceptance (b)：REST 改 Arena clip name → 模擬 reload（新 WS connect）→ `planSync`（app 同一 module）產出 open+rename → 執行 → Arena 回復 manifest；unit tests 覆蓋 planSync 全路徑 |
| (c) 斷線重連後狀態重新同步 | **PASS** | acceptance (c)：close → reconnect → re-subscribe → 狀態同斷線前一致＋post-reconnect trigger echo OK；`caps/drop-frame-2.png`（紅屏失敗路徑：「CONNECTION FAILED…Auto-retrying…」＋「arena: (no state)」）→ `drop-frame-4.png`（自動重連後回復 CONNECTED＋高亮）；錄屏 `drop-reconnect-recording.mp4` |

## Watchdog（M1 發現 #1 契約化）

- 設計：liveness 而非 readyState。trigger echo timeout 2s、heartbeat 30s（re-subscribe 一個已驗證 action 做 liveness read）、strike→forceReconnect（重連＋重 subscribe）、3 strikes→可見錯誤但繼續恢復。
- **Strikes 跨重連保留**（否則死 channel 會無限重連唔報錯）；只有真 liveness 訊號（state push／reply）先 reset。
- Unit tests 7 個（fake clock）：echo 及時／超時 strike、heartbeat 週期、reply 取消 strike、3 strikes 升級、liveness reset、stop 停錶。
- Live 觀察：全程 strikes 0；Arena 喺 disconnect-all 後會向 live connection 推全量 state（handler 當正常 state 更新處理，無害）。

## 新 live findings（帶去 M3/M6）

1. **Live WS 唔會喺 REST open/rename 後推新 composition state** — state 只喺 connect 時推。所以 manifest sync 執行 ops 後要 force reconnect 刷新（main.ts 已做，syncRounds≤3 防無限 loop）。
2. Arena 視窗會被用戶操作 minimize／失去 topmost；截圖前必須 restore＋topmost（M1 發現 #2 嘅延伸）。
3. 雙 display 全錄太雜；之後錄屏用單 display region（D2）先睇得清 UI 狀態。

## 環境備忘

- Evidence Edge：獨立 instance（`--user-data-dir=work/v2/m2/edge-evidence`＋CDP 9223），已 kill；用戶主 Edge 冇碰。
- Arena：仍 running（dummy grid 3L×3C，disconnect-all 乾淨狀態）；webserver enabled=1 loopback 冇改。
- Vite dev server（port 5199）係 background job，session 結束後要重起：`cd work/v2/m2/webapp && npm run dev`。
