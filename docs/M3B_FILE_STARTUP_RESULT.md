# FILE／TEST PCM 啟動修正 — 2026-10-03

## 結果：程式生命週期限定 QC 通過；內置 Browser 播放仍 BLOCKED

最新 run：m3b-file-startup-fix-02；413 automated checks PASS／0 skip（241 Python＋172 Node），PowerShell syntax gate 通過；manifest 68/68 相符。新 run manual_qc 保留 NOT_RUN，唔等於全 M3 通過。

修正 app.js：同一次 click 先同步建立零 gain 音訊圖，再並行叫 resume／play，唔再先等待 resume 才 play；兩條啟動路徑有 3000ms 上限。Graph setup 失敗唔叫直接 media playback；native queued play／playing 有 paused／wantPlay guards；舊 action timeout／late reply 唔污染新 action。錯誤名只用 whitelist，唔顯示原始私人 error message。

TDD：三個新增回歸先 RED；修正及補生命週期後 targeted 61 PASS；全量新 build 413 PASS。獨立 programmer：46 tests＋6 error-classification probes PASS；visual director 已檢視實際 screenshot，確認 NotAllowedError、監聽 OFF、Mic OFF、OSC OFF、程序腦形可見。兩位 reviewer 指定 Astra low，實際身份未確認。

## 實際 blocker／不能聲稱完成

同一內置 Browser，修正版 TEST PCM metadata 載入後，以 Playwright click 及原生 CUA 畫面 click 各驗一次，均即時 NotAllowedError，播放時間 0、已停止並清零。這唔係 3 秒 timeout；resume 同 media play 共用 catch，所以拒絕來源未定位，唔宣稱已證實特定 autoplay policy。Deadlock 風險由 fake regression 證實，唔等於舊實機卡住根因已完整證實。

actual-iab-blocked.png 係真畫面，但 full-page stitching 下半部重複；只驗錯誤提示／靜態模型，唔當 responsive audit、播放或光流 PASS。未改 browser permissions，未轉 surface 繞過限制；未開 Mic／喇叭監聽／OSC／upload。新 runtime PID 32860 嘅 owned Kinect worker count 0。

入口：C:/Users/evilkoo/Documents/烏蠅VJ/啟動大腦視覺.cmd；http://127.0.0.1:54654/；最新 receipt 見 work/m3/CONTINUE.json。上一版真 Kinect 短測證據保留，唔冒認今版重新 capture 過。

## 下一步

由人類決定是否批准喺現有獨立 Chrome 驗同一 localhost（唔更改 browser 權限／唔開監聽／唔開 Mic）；或者維持內置 Browser，將其執行環境限制交畀 runtime 維護者處理。唔盲重試同段 WAV，唔自動另造音訊 backend 代替驗收。

證據：work/m3b/file-startup/{actual-iab-blocked.json,actual-iab-blocked.png,code_qc.json,visual_qc.json}；RED/GREEN/build log 位於 work/m3b/kinect/file-startup-*.log。
