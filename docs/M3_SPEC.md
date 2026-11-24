# M3：本機音訊檔 → features → 神經小樣本映射 → Column dry-run

## 1｜人類應該見到咩／完成線

2026-10-02 用戶要求直接下一階段。今次唔再用手拉 Energy 當成音訊輸入：用戶主動揀本機音訊檔，播放時由 Web Audio 讀實際 PCM／FFT，能量同低／中／高頻帶動真實小樣本點嘅亮度，再顯示 Column 候選。開場清楚教「揀檔 → 播放 → 睇三頻同 Column」。
唔讀 Mic／系統音訊、不發真 OSC／控制 Resolume。選檔只喺用戶 browser 本機處理，唔搜尋私人音樂目錄、唔 upload 外網。呢個係 M3 音訊檔案階段，唔宣稱訓練模型／生物模擬／完整VJ已完成。

## 2｜可逆實作／權限

- 新 src/flyvj_m3、scripts/m3-build.ps1 同 tests；唔改 M0/M1/M2 code、舊 run、sample/proof/raw。沿用 Python3.11／現有 Node、standard library/native browser API；冇新增依賴或外部讀取。
- 音源一個：用戶揀嘅 local File，透過 Blob URL＋HTMLAudioElement＋MediaElementAudioSourceNode 串去 AnalyserNode。串流解碼，唔把成首歌 decode 成巨大 AudioBuffer；64MiB／15分鐘上限，錯檔／超限要停同清零舊features。格式由 browser decoder 決定，QC 用標準PCM WAV，唔承諾全部MP3等codec都支援。
- 初始冇檔、paused、冇自轉／假activity；播放／暫停／由頭／換檔，gain 預設4。監聽預設靜音，分析照運作；只有用戶開監聽先有聲。選檔／播放唔需要Mic權限。
- 保留 source verified 真實6個marked points／3條selected-neuropil measured edges。低／中／高頻係人為控制映射，唔等於真neuron功能／firing；原生nm同ID查閱保留，圖唔假扮全腦。
- QC有「合成測試音訊」按鈕，但必須標 TEST PCM，走真實播放器／analyser，而唔係按時間預填features。用戶歌曲同fixture唔混淆；私人檔名唔寫入export/report。

## 3｜固定 DSP／UI contract

Payload沿用M2 build_payload來源閘，scope=M3_LOCAL_FILE_AUDIO，增加 audio_policy（file-only／muted-default／no-network）同 mapping_semantics（人為）。M2 core.js以 inline geometry.js 形式重用（FlyVJM2），唔改原檔。新 audio.js UMD global=FlyVJM3／CommonJS。

API：measure(timeData,freqDb,sampleRate,fftSize) → {rms,bands:{low,mid,high},clipping}；timeData為normalized float PCM，freqDb長fftSize/2，-Infinity代表silence；RMS=sqrt(mean(sample²))，bands由峰值dB轉線性幅度×6，clamp0..1，30–180／180–2500／2500–min(8000,Nyquist)Hz。
assignRoles(ids) → exact string ID keyed low/mid/high（sorted IDs每兩個一組，六個ID固定）；initialState(ids)／advance(state,features,audioTime,playing,gain=4) → {time,energy,bands,signals,roles,candidate,onset,onsetCount,...}。signals keyed ID，唔用array位置／sin mock。gain RMS×4 clamp，約0.05s attack／0.22s release；onset只係energy/low正向突變≥0.16＋0.22s cooldown嘅「拍點候選」，唔叫BPM。
Column依舊 <.4→1，<.75→2，其餘→3；energy≤.02係HOLD／silent，candidate改變最少隔.8s。Pause凍結時間同顯示，Restart／換檔清零；seek/time倒退或hidden後大dt重設onset基線，唔憑空補拍點。點neuron只查閱，唔改candidate。
fixturePcm(sampleRate=16000,duration=8)生成0–.8silence、.8–2.8s80Hz amplitude.1、2.8–4.8s880Hz amplitude.2、4.8–6.8s4200Hz amplitude.3、其後silence，邊界softfade；encodeWav(pcm,sampleRate)回傳Uint8Array16-bit mono RIFF WAV。

UI模板marker：__M3_STYLE__、__M3_PAYLOAD__（script id=m3-payload）、__M3_GEOMETRY__、__M3_AUDIO__、__M3_APP__。CSP default-src none／connect-src none／media-src blob: data:／script-style unsafe-inline／img data，冇external assets／fetch／WebSocket。metadata用textContent。無WebGL或AudioContext／解碼／play拒絕顯示真error，唔標假READY。

Layout：頂部品牌＋音源狀態＋OSC OFF；第一行揀檔／TEST PCM／播放暫停／由頭／監聽；主區3D左、右實測RMS/energy/三頻/onset候選/Column；原始ID資料下方可摺。控制同實測features優先可見，唔再藏到長資料面板後。深灰＋暖低頻／青中頻／紫高頻；系統字體，唔用外網font。Canvas DOM data屬性只作draw提交／features/time/source/candidate診斷，唔叫QC PASS。

## 4｜验收唔混埋講

1. 自動測試：DSP silence／sin RMS／frequency-bin bands／invalid floats／ID-order invariant／onset cooldown／seek／pause／candidate cooldown／WAV header；Python source gate/export/CSP/escaping/no-clobber/runner fail-closed，M2 Node及全Python回歸。
2. Browser真正選入generated QC WAV（唔係私人歌曲），靜音播放，觀察PCM RMS／low-mid-high依段落改變、ID brightness跟signals、Column1/2/3；停止／暫停／換檔／壞檔處理。合成按鈕單獨標TEST，唔等同真音樂理解。
3. 真正file-origin使用若工具支援就驗；被政策拒絕唔繞過或冒認。至少loopback本機預覽驗收＋可用啟動入口，清楚註明未實測部分。
4. 独立 programmer＋visual director／實際screen-cap vision，再交付。新run人工QC先NOT_RUN，唔自動繼承；source/exports/run artifact hashes保存，不覆寫舊run。
5. 最後分欄說明：PCM/FFT分析已測；私人House/Techno音樂品味、BPM準度、genre、8/16小節、全腦morphology、LIF、Spout、GPU效能、真OSC／Resolume全部未驗／未做。唔靠總test count宣稱核心VJ能力已完成。

## 5｜安全／工作方式

沿用私人自用，唔重問商用。普通同範圍本機可逆工程／debug一路做到QC；真Mic/Internal／真OSC／新下載安裝／登入／外傳／重要路線改變先確認。今次用plan繼續，唔因「下一階段」自行建立新goal。M2 checkpoint27/27＋30/30已核對；日期用2026-10-02。

## M3 QC 修正／正式 runtime

Finite float PCM 可能超過 nominal ±1；clipping 只標示超 full-scale，唔當成壞檔。RMS 保留實測值（可大於1），控制 energy／signals 才clamp；NaN／Infinity 仍拒絕。advance第6參數 explicitRebase=false，由真seeking／seeked事件置true，短距／同時間seek也重設flux／cooldown基線，唔假造拍點。
Browser工具拒絕 file:// URL，已保存政策error，唔重試、唔改permission、唔以其他surface繞過或標成file-originPASS。正式使用改為受限M3 loopback WebApp runtime：m3-start.ps1／m3-stop.ps1，只有固定M3 bundle及healthroute，唔係任意檔案proxy。File-origin維持未驗／工具BLOCKED；HTTP原生音訊操作另作獨立驗收。
