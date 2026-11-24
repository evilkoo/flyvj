# HANDOFF — Qoder → DSH 本地 OpenAI-compatible 接入

> ⚠️ 呢檔屬 **Qoder proxy session**。FlyVJ／烏蠅VJ 項目交接**唔喺呢度** — 見 `docs/FLYVJ_HANDOFF.md`（最新：M4＋M4.5 果蠅腦 MB-WTA／9 選 1 已 PASS，下一 task＝M5，2026-11-18）。

更新：2026-11-17

## 已完成
- 裝咗 `@qoder-ai/qodercli`（global npm，v1.1.90），用戶已 `qodercli login`（browser OAuth，帳號 fredbykoo@gmail.com）。
- Clone 並改咗 `C:\Users\evilkoo\qorder-proxy`（github: lininn/qorder-proxy）：
  - `clean/models.js` 加入 live model discovery：每次 `/v1/models` 及 model 路由會行 `qodercli --list-models`（cache 5 分鐘），merge 喺靜態清單之上；上游出新 model 自動見到，唔使再改 code。
  - 修正 Windows spawn（.cmd 優先、經 cmd.exe、補 PATH 入面 node 目錄）。
  - `clean/app.js` `/v1/models` 改用 `getModels()`。
- Proxy 行緊：`http://127.0.0.1:3178/v1`（只綁 127.0.0.1）。已驗證 `auto` 同 `qwen4-max` chat 回傳 OK；`/v1/models` 現返回 29 個模型（含 Qwen4-Max、Kimi-K3.1-Pro、GLM-5.3 等新模型）。
- 開機自動重啟：`Startup\QorderProxy.cmd` → `C:\Users\evilkoo\qorder-proxy\qorder-proxy-start.cmd`（用家 level，非 service）。
- DSH 設定備份：`cordis.patch.yml.bak-qoderlocal`（未改 DSH 設定）。

## 待用家手動做
DSH Settings → Models / Providers → 新增 OpenAI-compatible channel：
- Base URL: `http://127.0.0.1:3178/v1`
- API Key: 任意（例 `not-used`）
- 用 Detect models 拉 `/v1/models`（即時清單）
- 注意：每次 chat 請求 proxy 會啟動新 qodercli 子进程，速度較慢（十幾秒級）；工具調用係 prompt 模擬，唔係原生 function calling。

## 常用指令
- 狀態/重啟：`cd C:\Users\evilkoo\qorder-proxy; node bin\qorder-proxy.js status | restart`
- 日誌：`node bin\qorder-proxy.js logs -f`
- Web console：`http://127.0.0.1:3178/ui`

## 風險／未驗收
- 非官方 reverse-engineering，有 Qoder ToS／封號風險（只限本人本机自用）。
- 未驗收：DSH 內以本 channel 做主力 agent（含 tool calling、stream 加工具降級非 stream）嘅長期穩定性。
