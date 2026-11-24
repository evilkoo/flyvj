# 第一版純 web app：WebSocket 直連 Resolume，原生層延後

ADR 0003 定咗 Tauri＋TypeScript stack，前提是「browser 發唔到 OSC，一定要有原生 bridge」，而本機又未裝 Rust toolchain。其後核實 Resolume 官方 Websocket API 文檔（v7.8 起，https://resolume.com/support/en/websocket-api）：官方明文「allows you to control Resolume Arena from within your browser」— `ws://address:port/api/v1`、JSON、subscribe/set/get/trigger、可 post 增 layer/column、連上即推 composition state。Mic 用 browser 標準 getUserMedia，localhost 係 secure context，權限冇問題（舊 draft 嘅 NotAllowedError 係內置 browser＋手寫 server 嘅組合問題，普通 Chrome 已於 m3b-chrome-pcm QC 通過）。

決定：**第一版係純 web app（Vite + TypeScript + Three.js），喺表演機用普通 Chrome/Edge 視窗開，WebSocket 直連 Resolume Arena 7.23（需在 Preferences → Webserver enable）；零安裝、零 Rust、零 sidecar**。Tauri 打包保留為之後選項（supersedes ADR 0003 嘅「第一版即 Tauri」部分；TypeScript/Vite/Three.js UI 層決定不變）。

## Considered Options

- **即刻裝 Rust＋MSVC Build Tools 行 Tauri**：拒絕作為第一步。1–2GB 安裝卡住 critical path；打包嘅好處（雙擊即開、防 idle）係交付期嘅事，唔影響開發期。
- **Node sidecar 發 OSC**：拒絕。WebSocket 直連已覆蓋控制＋狀態回饋（OSC polling 做到嘅佢用 subscribe 做到），少一個 process 就少一個死法。OSC 保留為 fallback（官方文檔冇提 WebSocket 認證機制，實機驗證前唔可以話佢一定穩）。
- **TouchDesigner/Notch 做埋**：維持拒絕，用戶要自家開發介面。

## Consequences

- 表演機流程：開 Chrome/Edge 一個視窗載入 app（bookmark 或本地 static serve），同 Resolume、MadMapper 並排。要實測「三個 GPU app＋一個 WebGL viewport」喺 3070 Ti 8GB 上嘅表現 — 開發機（4090）結果唔算數。
- WebSocket API 冇官方認證文檔 = 安全靠 loopback 隔離；app 只 bind/connect localhost，呢點要寫死喺實作。
- 舊 ADR 0003 嘅 Rust-only-glue 原則保留：將來如果打包 Tauri，業務邏輯仍然唔入 Rust。
