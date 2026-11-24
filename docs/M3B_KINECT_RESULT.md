# M3B Kinect Mic 結果（2026-10-02）

## 有限範圍通過；唔代表整個M3／無人VJ完成

最新run：work/runs/m3b-kinect-preqc-02；官方405 PASS／0 skip（241 Python＋164 Node），PowerShell syntax gate通過。獨立backend final：PASS_SCOPED_KQR01_05_CLOSED；frontend recheck PASS_BOUNDED_FRONTEND_RECHECK。Native parent-hang、blocked nativeopen／close／stdout watchdog有no-audio Windows實測，driver在child、parent每0.5s心跳、child4s失聯硬退，Job處理parentdeath。唔把fake stress次數當unique tests。

Azure Kinect實機：由介面開始Kinect Mic，device係麥克風排列 (Azure Kinect Microphone [WinMM名被32字元上限截斷]。約24.917秒PCM sampleclock已推進；RMS 0.000756、LOW 0.001061、MID 0.000781、HIGH 0.000025（此刻環境低音量，Energy0.003537低於HOLD門檻，所以冇發光流動packets）。唔用低音量結果冒認音樂品味／強訊號反應已驗。

按停止Mic後，介面收到confirmed off；audio/DSP clock、RMS/bands/packets清零，開始按鈕恢復、停止disabled。冇speaker monitor、rawaudio記錄、上傳、RGB/depth或OSC。只保存aggregate JSON同介面圖片，rawPCM只在child記憶體。

實際WebGL：可見雙側輪廓＋中心body、密集示意分枝；Performance84／Cinematic168示意neurons，線段5208／11592。輪廓/分枝/光流係程序生成示意，真6marked points／3edges係獨立layer，唔稱真全腦／morphology／生物firing。Cinematic完整場景截圖brain-cinematic-off.png。

## 尚未驗／限制

新iab頁TEST PCM出現AudioContext啟動pending、播放時間0（可見／背景各驗一次均同），已清理播放器並reload；所以brain-test-pcm-high.png誤名，只作diagnostic，唔當高頻／光流PASS。原使用者Chrome錄屏FILE三頻已驗係之前M3run，唔冒認此新UI再次FILE通過。Mic已實測有數值、停止確認；強音量Mic→光流視覺、私人歌／genre/BPM、真OSC／Resolume、全腦及4090/3070Ti FPS未驗。

## 使用

雙擊 C:\Users\evilkoo\Documents\烏蠅VJ\啟動大腦視覺.cmd；固定http://127.0.0.1:54654/，2h idle重開即可。按「檢查裝置」→已識別Azure→「開始Kinect Mic」；「停止Mic」確認OFF。Mic defaultOFF，沒有device不fallback其他咪；不需SDK。不能用file://開Mic bridge。

## 證據

work/m3b/kinect/{backend_qc_first.json,backend_qc_recheck.json,backend_qc_final.json,frontend_qc_first.json,frontend_qc_recheck.json,visual_qc.json,actual-kinect-live.json,actual-kinect-stopped.json,actual-kinect-live.png,actual-kinect-stopped.png,brain-cinematic-off.png}。run manualQC保留新run NOT_RUN，限定交付另存此結果，不靜默改成全M3 PASS。
