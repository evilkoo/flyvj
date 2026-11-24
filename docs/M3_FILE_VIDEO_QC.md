# M3 FILE 錄屏驗收（2026-10-02）

## 結果：PASS_SCOPED；M3 整體仍未完成

使用者提供 2026-10-02 17-59-21 錄屏（13.871767 秒）。主管用本機 ffmpeg 精準時間抽取畫面，亦用離線 FFT 量度呢條錄屏嘅音軌；冇開 Mic／system capture、冇上傳、冇改 browser permission、冇新安裝、冇改 app source。

## 新增可核對證據

| 錄屏時間 | UI 分析時間 | 可見主頻／Raw RMS／Energy | Column |
|---|---|---|---|
| 3.80s | 1.40s | LOW 0.1156；RMS 0.0703；Energy 0.2849 | 1 |
| 6.50s | 4.10s | MID 0.2271；RMS 0.1413；Energy 0.5658 | 2 |
| 7.80s | 5.40s | HIGH 0.3704；RMS 0.2122；Energy 0.8484 | 3 |
| 10.50／12.50s | 8.00s | RMS 0；HOLD；features 已凍結 | HOLD |

- 錄片音軌 FFT：3.5–4.5s 主峰 80Hz、RMS 約 0.0706；5.5–6.5s 主峰 880Hz、RMS 約 0.1412；7.5–8.5s 主峰 4200Hz、RMS 約 0.2120；9.5s 之後抽樣為靜音。呢啲係錄片音軌嘅量度，唔係直接攞 app PCM，更唔係人耳聽音／端到端延遲測試。
- 畫面顯示 LOCAL FILE、監聽 ON、OSC OFF；候選只有 preview／DRY-RUN，冇真 Resolume 控制。
- 重要因果界線：fixture 三段音訊嘅聲量亦逐段增加。served advance() 用 Energy ≤0.02→HOLD、<0.4→Column1、<0.75→Column2、其餘→Column3；三頻帶動 point signals。今次可見 LOW/MID/HIGH 段落同 Column1/2/3 對應，唔代表 Column 係按主頻類別選，更唔係 genre／音樂理解驗收。
- 開頭係之前播完嘅 8.00s。2.25s 見原生播放器 play 被點，2.40s 轉 0.00s 並播放，之後播到 8.00s。可確認原生播放器從結尾重新播放嘅可見流程；唔等於 app「由頭（暫停）」清零按鈕已驗。
- 主頻相應嘅 point 亮度有變化；呢個係人為 band mapping，唔係全腦 morphology／生物 firing。
- 原生 file input 載入後會清空 value，畫面仍顯示「未選擇任何檔案」。已核對 served console：loadBlob(file, 'file') 後清空 value；唔據此誤判音源未載入。標為 UX 誤導，今次冇改 code。
- 結尾 Energy 0.0039／HIGH 0.0017 係可見殘留值；Raw RMS 為零、Energy 低於 0.02、候選 HOLD 並凍結，符合已定結尾顯示／HOLD 規則，唔要求所有平滑值一定清零。

## 仍未驗／不可宣稱完成

實際 FILE 模式嘅「由頭（暫停）」清零按鈕、換檔／壞檔處理完整互動仍待驗；之前 TEST PCM／unit tests 唔冒認為新 FILE 操作證據。舊截图只展示暫停狀態，未量度長時間凍結。file:// 與自動 fileChooser 工具限制未解除，冇換 surface 繞過。

M3 只係 PCM／FFT → 6 marked points／3 edges 人為映射 → Column preview。未做／未驗 genre、可靠 BPM、全腦、训练模型、GPU 效能、Spout、Mic／Internal、真 OSC／Resolume。唔因今次錄屏而 mark M3／goal complete。

## 本機證據位置

work/m3/file-video-qc-20261002-175921/extraction.json、audio_spectrum.json、panels.png、graphs-controls.png、replay-controls.png、visual_review.json、delivery_review.json、file_qc.json。
影片 SHA256：308b27c1bd59710816c1c1cead76de3d9265332bd05666192e16f0076ca5349a。
served console SHA256：fbf5992fb102e88e89efa4416a9634a4f1d30260eafff3492b3db6d78e49d382（同 repair02 已知 bundle 相同）。

下一步係收尾實際 FILE 控制／異常路徑驗收，唔使再驗同一條 8 秒三頻播放。
