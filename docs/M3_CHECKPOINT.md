# M3 checkpoint：真 PCM／FFT 已接，實際選檔 QC 等單檔授權

## 狀態

2026-10-02。M3 **未完成**，唔係正式交付。候選run：work/runs/m3-candidate-01；自動220 PASS／0skip（130Python＋90Node）及PowerShell AST gate通過。Code／visual只係PASS_SCOPED。冇新goal被建立／markcomplete。

## 已驗咗咩

同一原生HTMLAudioElement／AnalyserNode pipeline解碼實際generated RIFF PCM WAV Blob，唔係按時間預填Energy。8秒測試訊號80Hz／880Hz／4200Hz分段：RMS .0702／.1413／.2120；對應LOW／MID／HIGH同Column1／2／3。9/9 browser fixture cases，pause/reset／exactID映射／窄屏亦有證據。
圖片留work/runs/m3-preqc-03/audio-high-selected.jpg及audio-narrow.jpg；visual_qc.json係實際目視。candidate console／payload逐byte相同，tested-ui-equivalence.json留證；唔冒認新capture。audio-high-paused、audio-mid-frozen誤命名capture只保留diagnostic，唔作對應pause/MID證據。
finite PCM overshoot、短seek假onset、missing runtime manifest三個獨立QC問題已修；PSstartup replacement token parser問題亦已修並納入ASTgate。CodeQC work/m3/code_qc.json。

## 真正 blocker／唔可以擴權或假PASS

自動fileChooser.setFiles收到CDP -32000 Not allowed；工具指示需要Chrome ChatGPT extension嘅Allow access to file URLs。呢個係較闊嘅localfileURL權限，未獲批／未改。冇改用另一surface／rawCDP繞過，actualFileChooser仍NOT_VERIFIED。
file://導航另被Browser URLpolicy拒絕，保留error、未重試、唔標file-originPASS。正式M3只係受限loopbackWebApp runtime，固定ownM3bundle＋health、冇任意檔案proxy／外網／upload。
**建議最小授權：使用者喺Chrome M3頁主動揀一個generated測試WAV，之後由主管繼續全部QC。唔係叫人類驗品質。** 唔需要私人歌或開較闊extensionpermission。

## 續接

權威runtime/receipt/URL見work/m3/CONTINUE.json，頁面已重設NO FILE、監聽OFF，Chrome testtab留handoff。Server只bind127.0.0.1，30分鐘idle自動退出；expired用scripts/m3-start.ps1 -RunId m3-candidate-01 -NoBrowser重啟，唔auto讀私人file。停止用m3-stop.ps1 -SessionFile該receipt。
需要使用者只揀 C:\Users\evilkoo\Documents\烏蠅VJ\work\m3\audio-fixtures\m3-pcm-test.wav（自己生成、PCM16mono8秒）。揀完回覆已揀。之後claim已知M3 HTTP tab，核對sourceMode=file（唔係test-pcm）、native解析duration8、同一三頻／Column／pause/swap/error路徑，再判M3是否完成。

## 範圍／風險

只係6真實marked points／3edges＋人為audio band映射；唔係全腦、soma、morphology、biologicalfiring、訓練模型。未驗私人House/Techno品味／BPM準度／genre／8-16小節／GPU／Spout；冇Mic/Internal／真OSC／Resolume。用途私人自用已定，唔再問商用。M2 source manifest30/30保留；舊runs／sample／proof／raw冇改。
