# 由資產重啟，唔由 code 重啟

舊 draft（M0–M3C）用 Python stdlib 手寫 server 配 native JS/WebGL UI，半年停在 M3C 未 build，並累積咗部署問題：內置 browser autoplay `NotAllowedError`、port 54654 idle 兩小時自動死、「website 開唔到」、launcher 指住舊 bundle。同一時間，「落地使用」嘅核心能力（真 OSC 輸出、素材／選片決策、genre／BPM）一行都未寫。

決定：**保留資料同 domain 規則，捨棄全部 code 骨架**。保留 morphology assets（18 檔，hash 驗證）、FlyWire FAFB783 樣本、三頻定義、Energy→Column 規則、Azure Kinect Mic 隔離設計原則；捨棄 runner／test scaffolding、手寫 Python server、現有 UI，並唔再修 M3C 的 context-loss FAIL test。開發流程同時捨棄舊 QC 儀式（immutable run ID + manifest hash + 大量 screen-cap），改為快速迭代，只在真正高風險改動做獨立覆核。

## Considered Options

- **繼續 M3C**：修 test → build → Chrome 驗收。拒絕原因：做完都只係「外形嵌好」，距離開一場真 set 仲差成個決策引擎同 OSC 層，而舊流程每一步嘅證據成本極高。
- **部分保留 UI 逐步重構**：拒絕原因：用戶已明確拒絕現有腦形，且舊 UI 係 milestone 實驗品（badge 文案都未改完），重構成本同重寫接近。

## Consequences

- 舊 `work/runs/`、manifest、413 PASS 等歷史證據只屬歷史交付，唔可以借用嚟宣稱新版本已驗收。
- 舊 source tree 保留作參考（唔刪），但唔係新開發嘅基礎；禁止 git clean/reset 清走現有內容。
- 「形態資產配準未確認」呢個資料事實仍然成立，新實作一樣唔可以疊加唔同來源嘅模型。
