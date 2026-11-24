# Chrome 合成 TEST PCM 驗收 — 2026-10-04

## 結果：同一修正版喺普通 Chrome 通過限定播放／三頻畫面 QC

本輪使用者明確批准現有 Chrome，同一 localhost／immutable run m3b-file-startup-fix-02。冇改 source、browser 權限、install 或 upload；只用頁面合成 8 秒 TEST PCM，監聽／Mic／OSC OFF。冇測新增外部 FILE chooser。

正式自動測試沿用上輪 413 PASS／0 skip（241 Python＋172 Node），本輪冇重跑全量；重新核對 manifest 68/68 相符。HTTP health 確認 bundle SHA256 669b1c8671bb46bac88de3fde201e9ee01f458be45cdf4ce5400183223df158a。

Startup 實機 sourceState playing、audioPaused false、startup error 空、time0.093191。三段實測：LOW time1.661416，band0.115537／energy0.286106 → Column1，金黃分枝；MID time3.777939，band0.227140／energy0.565793 → Column2，青藍分枝；HIGH time5.888，band0.370387／energy0.848702 → Column3，紫色分枝。Column 係 energy 規則，唔係已訓練音樂分類；本輪三個取樣唔係 threshold boundary 測試。

暫停兩個隔450ms快照：media time6.008不變、brainRenderedTime6.005213不變、energy0.848535不變。恢復後兩份同一高頻段截圖／JSON：media／render time6.035391→6.51865，frame56→62，activePackets108；連續動畫平滑度／FPS尚未验。high-paused-brain.png有完整腦形可見，Performance84示意神經／5208線段，非真全腦、morphology、connectome、生物firing。

自然結束：media time8、sourceState ended、energy/RMS/三頻0、HOLD、packets0；DSP最後取樣時間7.55283凍結，唔錯寫所有時鐘都8。由頭後：paused、media/DSP0、energy/bands/onset0、HOLD／packets0，monitor false／Mic OFF；runtime PID29644 owned Kinect worker count0。Chrome error/warn log查詢本輪空。

## 界線／下一步

普通 Chrome 同一版本冇重現播放卡住；唔代表內置 Browser NotAllowedError已解除，亦未定位內置拒絕係resume定play。冇喺Chrome改權限或绕过內置政策。本輪唔覆蓋私人音樂、強音量Kinect／gain校準、FILE chooser、長時間穩定性、Cinematic／兩張GPU FPS、可靠BPM／genre、真OSC／Resolume或全M3完成。

獨立 reviewer 先已view_image驗三段顏色／JSON同畫面一致；最終scope見本目錄 independent_qc.json。Requested Astra low，實際模型身份未確認；唔用軟件或截圖QC冒認全項完成。

日常先用普通Chrome開 http://127.0.0.1:54654/；本輪留下TEST PCM載入但由頭暫停。下一步係真實音樂经已批准Azure Kinect做gain／視覺反應校準，唔再重試同段TEST PCM；要有現場音源，唔會自動開喇叭或另揀咪。

證據目錄：work/m3b/chrome-pcm-qc-20261004（startup、low/mid/high、pause、flow-1/2、ended、reset、health）。
