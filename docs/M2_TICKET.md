# M2 TICKET — Grid 狀態 ＋ 映射表 v0（v2 路線）

開票：2026-11-17（M1 PASS 後）。規格全文見 `docs/SPEC_V2.md` §Milestone 2。

## 目標

app 入面有「3×3 欄格」domain 物件：點格→換 clip→熒幕同畫。

## 輸入（M1 已交付）

- Bridge page：`work/v2/m1/webapp/`（Vite＋TS；WS 協議、ParamState enum、trigger/subscribe 寫法全部實測過，見 `docs/M1_RESULT_V2.md`）。
- Dummy grid：`work/v2/m1/dummy-grid.avc`＋`setup-dummy-grid.ps1`（可重建）。
- 用戶 9 條真 clip 路徑仍未補 → 用 dummy 照走（SPEC 允許）。

## 做

1. Clip manifest（JSON）：每格 layer×column、九格分類位、檔案路徑（或 `source:///` URL）、tag；改 manifest 重載即生效、唔改 code。
2. UI grid 顯示 3×3；點格 → WS trigger 該 column。
3. 狀態以 **subscribe 回推**為準（唔靠自己記）：grid 高亮＝Arena 實際 connected 狀態。
4. 斷線重連後重新 subscribe＋重新同步狀態。
5. **Watchdog（M1 發現 #1 帶落嚟）**：連住但 channel 死（trigger 後 N 秒冇 echo／subscribe 冇回推）→ 自動重連＋重 subscribe；連續失敗先報錯。閾值待定（建議 trigger echo timeout 2s、heartbeat 每 30s 讀一次 composition）。

## 驗收契約（SPEC 原文）

(a) 點任一格 → Resolume 該 column 三 layer 全換，app grid 高亮同 Arena 實際狀態一致（以 subscribe 回推為準）；
(b) 改 manifest 重載即生效，唔改 code；
(c) 斷線重連後狀態重新同步。
證據：錄屏一氣呵成（點擊→換 clip→拔線→重連→狀態啱）。

## 禁止

- 唔碰用戶真 show `.avc`；唔郁 `server.xml`（已 enabled=1 loopback）；唔裝新軟件。
