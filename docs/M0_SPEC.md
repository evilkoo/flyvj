# 烏蠅 VJ · M0 規格

## 目標

建立可以重複執行、失敗會停、有證據報告嘅安全開發骨架。唔建立真音樂分析、LIF 控制、真腦 viewer 或 Resolume 播出。

## 固定接口

- 入口：PowerShell `scripts/auto-build.ps1 -Mode Verify`；只接受 Verify，冇 Live mode。
- Runtime：已安裝 Python 3.11 或以上、standard library；唔執行 pip/npm、唔登入或下載。
- 流程：語法檢查 → unittest → mock integration；每步預設 timeout 30 秒，上限 300 秒。
- Fixture：4 個合成 energy events，依序產生 Column 1、2、3、1；唔代表音樂或 VJ 品味。
- OSC spy：只保存 in-memory intent；address 係預覽，未核實可用嘅 Resolume 命令。冇 UDP/socket sender、鍵鼠控制或 Mic 擷取。

## 狀態與報告

- 每次用新 run ID，輸出到 `work/runs/<run_id>`；已存在嘅 run 拒絕覆蓋。
- `state.json`：scope、steps、command、exit code、時間、tests count、安全模式、未實作項、manual QC 狀態。
- `logs/`：每步 stdout/stderr；`mock_result.json`：事件／候選／spy 紀錄；`report.html`：離線、冇 JavaScript／外部 assets。
- `PASSED` 只表示 M0 自動檢查；真資料、真音源、3D、GPU、Resolume 均未驗證。
- Test 0 個、skip、非零 exit、timeout、錯誤 mock artifact 皆 BLOCKED；其後步驟 NOT_RUN。
- Runner 唔自動 patch／重試。AI debug 每個獨立問題最多 2 輪，修正之後可重跑；冇新證據唔盲試。

## 驗收

- 正常 run 真正執行 syntax、unittest、mock，全數通過。
- 合成 energy、Column 決策、spy event IDs 一一對應。
- Allowlist 外 Column、invalid events、錯誤排序被拒絕。
- 拒絕覆蓋舊 run；保存失敗 command／error／exit；timeout 用 Windows kill-on-close Job Object 管理自己開嘅 process tree；先 suspended attach，再 resume，唔按名稱掃殺其他 app。
- Code QC／報告截圖由獨立 agent 及主管覆核，唔由 runner 自行宣稱完成。

## 暫不做

真神經資料載入、Mic/Internal、BPM/genre、8/16 小節排程、模型訓練、3D render、Spout、真 OSC、背景永續 AI agent。M1 之前先確認真實資料來源同 ID 對應。