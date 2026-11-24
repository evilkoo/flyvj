# Stack：Tauri（Rust 殼）＋ TypeScript/Vite/Three.js（UI）

舊 draft 用 Python stdlib 手寫 localhost server 配 browser UI，撞正三個部署死症：Chrome autoplay `NotAllowedError`、port 54654 idle 兩小時自動死、用戶報「website 開唔到」。同時表演機要同 Resolume Arena 7.23 與 GarageCube MadMapper 爭 8GB VRAM，所以 Electron（連 Chromium 帶住走、食 200MB+ RAM）唔適合。

決定：**Tauri 2 做外殼＋原生 bridge，TypeScript + Vite + Three.js 做 UI**。分工：UI 層由用戶自家開發（TypeScript，生態同 AI 輔助最成熟）；Rust 嗰層只係幾百行胶水（UDP socket 發 OSC、必要時原生音訊），由 agent 寫，用戶唔使學 Rust。Tauri 用 Windows 內置 WebView2，所以 bundle 細、記憶體負擔低，同時有官方 single instance／autostart plugin，解決「唔會自己死」同「唔會開兩份」。

## Considered Options

- **Electron**：Node `dgram` 一樣可以發 UDP，生態更大。拒絕原因：整個 Chromium 打包，RAM 負擔明顯高過 Tauri，而呢部機嘅資源要優先俾 Resolume 同 MadMapper。
- **純靜態 web UI ＋獨立 Node/Rust sidecar**：功能等價，部署差啲（兩個 process 要各自管理、sidecar 會 idle 死，正正係舊 draft 嘅病）。
- **瀏覽器開 localhost（舊路線）**：直接拒絕，已證明有 autoplay/permission 同 idle 問題。
- **TouchDesigner／Notch 做埋視覺層**：可能根本唔使寫 app，但用戶已明確要自家開發介面，且要保留果蠅腦映射呢個自訂 domain 邏輯。

## Consequences

- 有一個硬事實要記住：**Web 瀏覽器唔可以直接發 OSC**（OSC 行 UDP，browser 冇 raw UDP socket）。所以只要輸出係 OSC，就一定要有原生層。例外：如果改用 Resolume 嘅 WebSocket API，瀏覽器層可能可以直連 — 呢條正在研究中，未定。
- Rust 只限 bridge 層。禁止把業務邏輯（映射表、決策規則）寫入 Rust，否則用戶改唔到、亦違反「UI 自家開發」嘅分工。
- 舊 draft 嘅 Azure Kinect 原生 mic 隔離設計原則（owned child process、Job object、lease/heartbeat）保留作參考，但新實作用 mic 而非 Kinect（見 CONTEXT.md「音訊輸入」）。
