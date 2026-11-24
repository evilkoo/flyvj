# 無人 VISUAL JOCKY / FlyVJ：跨 agent 詳細研究及工程交接

文件日期：2026-11-16，Asia/Shanghai。呢個日期係交接核對日期，唔係全部測試完成日期。最後主要實作／實機證據來自2026-10-02至10-04。

Workspace：C:\Users\evilkoo\Documents\烏蠅VJ

## 1. 接手先讀：最重要結論

現階段係 M3C「將公開形態模型嵌返原完整 UI」開發中。唔係完整無人VJ，亦未完成新模型音訊實機驗收。

最後有實機限定QC嘅正式bundle係 work/runs/m3b-file-startup-fix-02，413 automated checks PASS／0 skip，241 Python＋172 Node。普通Chrome合成PCM／舊程序腦形反應已驗；嗰個模型仍係三個橢球殼。用戶明確表示外形不符合FlyBrainLab參考，不能把功能QC當外觀合格。

Source working tree已包含未完成M3C修改。新公開模型已接入app.js、exporter、runner，亦有新幾何／renderer，但未有m3c正式run。啟動大腦視覺.cmd仍指向舊m3b-file-startup-fix-02，唔會自動展示未build source。

2026-11-16重新跑6份相關Node測試，77 tests／76 PASS／1 FAIL／0 skip。失敗係context loss/restore新模型資源處理。今輪只做交接與核對，冇修code、冇啟動Mic、冇跑全量build、冇聲稱新畫面已QC。

2026-11-16比對舊bundle manifest，原68筆中有6個current files已因M3C開發而不同：exporter.py、runner.py、ui/app.js、ui/index.html、tests/m3_ui.test.cjs、tests/m3_brain_renderer.test.cjs；另外8份M3C新code/test/spec檔案存在。呢個係預期working-tree差異，唔係源資料損毀，亦表示舊68/68只屬歷史交付。證據：work/handoff-20261116/source_vs_last_bundle.json。

舊HANDOFF／CONTINUE主要停喺模型取得階段，未完整記錄中斷前M3C實作。接手優先以本文件、current source、今輪test log判斷，唔好只睇舊status字串。

## 2. 用戶真正要做嘅產品

用戶係VJ／AI藝術創作者。目標係工具聽到現場音樂後，根據類型、拍子、能量及音樂高低起伏，揀影像並經OSC控制Resolume Layer／Column／Clip。UI展示具結構感嘅3D腦及神經，音訊引發可讀嘅局部視覺反應。

用戶唔接受用三個透明球＋隨機曲線冒充參考腦形。亦唔接受新模型另開簡化頁後，原本播放／Kinect／gain等操作消失。最後明確授權嘅實作任務係：把新模型換入原UI，再test音訊在新模型上的效果。

原本完整UI必須保留選檔、合成TEST PCM、播放／暫停／由頭、監聽、分析gain、Azure Kinect裝置選擇／開始／停止、RMS／三頻／Energy、Column候選、相機與renderer診斷。外形先達標，再處理視覺靈敏度，最後才真OSC。工作分期唔等於可以換掉產品目標。

現況沒有訓練模型、沒有genre識別、沒有可靠BPM、沒有生物神經模擬。三頻分組係人為映射；資料幾何真實唔代表firing真實。

## 3. 階段與驗收歷史

| 階段 | 內容 | 狀態／實際證據 | 界線 |
|---|---|---|---|
| M0 | 本機auto-build／process／timeout／report | 歷史工程QC通過，初期29 tests，後續回歸增加 | Runner執行checks，唔係自動寫code AI；唔接真音源或OSC |
| M1 | 真實FlyWire小樣本與來源一致性 | docs/M1_RESULT.md；m1-real-preqc-01，92 PASS／0skip | 6個marked points、3條selected-neuropil edges，非完整神經形態 |
| M2 | 離線3D點圖控制台 | m2-final-03，144 PASS／0skip，manualQC REVIEWED | mock timeline／energy，Column dry-run；只此階段goal曾完成 |
| M3 | FILE實際PCM／FFT | Chrome舊FILE錄屏、TEST PCM等限定QC有證據 | 未達完整產品驗收，未真OSC |
| M3B視覺 | 三橢球＋程序分枝／光點 | 能畫、可反應音訊，但用戶拒絕外形 | 功能PASS唔等於reference視覺PASS |
| M3B Kinect | Azure Kinect本機音訊輸入 | m3b-kinect-preqc-02：405 PASS／0skip，約24.917秒實機及停止證據 | 只音訊；quiet-level測試唔證明強音樂光效 |
| M3B播放修復 | resume/play並行、3秒超時 | m3b-file-startup-fix-02：413 PASS／0skip；2026-10-04普通Chrome限定實機PASS | 內置Browser NotAllowedError未解除 |
| 公開形態取得 | 14ROI mesh＋1SWC，獨立QC預覽 | 18 source files／3.16MB，13validator tests，獨立geometry與screen-cap QC | 部分hemibrain，共同配準未確認；未接完整UI |
| M3C目前 | 新模型嵌原UI＋音訊效果 | source已有，backend14 targeted PASS歷史；今輪前端76/77 | 未build／未實機／未finalQC，不可標complete |

後續M4等未有經確認正式編號。本文件唔自行編造已批准階段。

## 4. 研究來源：參考、提案、實際採用分開

以下連結係今次對話已提供或本機資料保存嘅來源。今輪係整理，冇重新上網核實可達性或最新版本；唔等於每個工具都已裝／測通。原始C:/Users/evilkoo/Desktop/SUMMARY.txt係Gemini討論摘要，今輪已讀取，其描述及數量屬二手構想，唔直接升格成工程事實。

### 4.1 用戶提供嘅方向參考

| 來源 | 連結 | 本項目用途／狀態 |
|---|---|---|
| Fruit Fly Brain Observatory | https://www.fruitflybrain.org/#/ | 最初腦結構／神經視覺參考 |
| FlyBrainLab | https://flybrainlab.fruitflybrain.org/ | 用戶問可否用現成工具；未安裝完整平台 |
| FlyBrainLabWeb | https://flybrainlab.github.io/FlyBrainLabWeb/ | 之前研究3D神經／腦區互動介面；唔代表現有程式用了該套viewer |
| NeuroNLP參考圖片 | https://github.com/FlyBrainLab/Tutorials/blob/master/tutorials/getting_started/images/neuronlp_bar.png | 用戶目前提供嘅視覺參考；唔係可直接載入嘅3D資料 |
| 遊戲影片 | https://www.youtube.com/watch?v=L3R4GfdLu2Q | 早期靈感；冇可引用完整轉錄／實驗重現證據 |
| FlyBrain-HalfLife | https://github.com/Yusuftmle/FlyBrain-HalfLife | 曾比較，用戶後來明確叫放低Half-Life方向；唔再沿此線開發 |

### 4.2 Gemini SUMMARY提出，但未在本項目落地嘅工具／構想

| 名稱 | 摘要記錄嘅入口 | 接手注意 |
|---|---|---|
| FlyWire Codex | https://codex.flywire.ai/ | 本項目用咗其公開FAFB783匯出小樣本，唔係全庫 |
| Virtual Fly Brain | https://virtualflybrain.org/ | 背景參考，未接入 |
| neuPrint | https://neuprint.janelia.org/ | 背景／未來可追溯export候選，未登入查庫 |
| FlyGym / NeuroMechFly | https://github.com/Neuro-Robotics-Laboratory/flygym | 生物力學方向，未使用；目前唔需要MuJoCo／步態模擬 |
| NAVIS | https://navis.readthedocs.io/ | 幾何工具候選，未安裝 |

摘要亦提到caveclient、python-osc、TouchDesigner、Spout、GLSL Compute Shader。佢哋係建議工具鏈，現有實作唔使用上述套件作主鏈。唔因摘要出現就自動安裝／登入。

Giant Fiber→Kick、CPG→Hi-Hat、逃跑反射觸發Glitch等係Gemini提出嘅創意映射，未有本項目重現或科學驗證，唔可宣稱已實現真生物反射。

摘要OSC例子包括 /composition/layers/1/clips/{1-4}/connect、/composition/layers/1/video/effects/invert/opacity、/composition/layers/2/video/opacity。全部未對用戶Resolume版本、composition或effects地址實機確認；唔可照抄即發。

### 4.3 已採用M1 FlyWire FAFB783來源

資料入口：https://storage.googleapis.com/flywire-data/codex/data/fafb/783/

固定object generation：

- connections：https://storage.googleapis.com/flywire-data/codex/data/fafb/783/connections.csv.gz?generation=1733428416885848
- coordinates：https://storage.googleapis.com/flywire-data/codex/data/fafb/783/coordinates.csv.gz?generation=1733428431583877

原始取得紀錄：data/flywire783-m1/source/acquisition_receipt.json。Connections只下載頭65,536bytes，唔係完整50MB物件；coordinates完整5,314,546bytes，receipt記錄CRC32C核對。兩者合共5,380,082bytes，屬早期M1取得，唔係今次新模型下載。

固定Codex source commit：3477b6cfccaf3bf976e6af0d40513ad221311a36：

- https://raw.githubusercontent.com/murthylab/codex/3477b6cfccaf3bf976e6af0d40513ad221311a36/codex/data/local_data_loader.py
- https://raw.githubusercontent.com/murthylab/codex/3477b6cfccaf3bf976e6af0d40513ad221311a36/codex/data/neuron_data_initializer.py
- https://raw.githubusercontent.com/murthylab/codex/3477b6cfccaf3bf976e6af0d40513ad221311a36/codex/utils/formatting.py

本地權威：sample.json、source_proof.json、source_review.json。Neuron IDs必須用string避免JS大整數精度損失。position係vendor marked annotation point，唔係已確認soma；region係所選edge neuropil，唔係point解剖位置；weight係該neuropil row count，唔係完整pair總突觸數。

### 4.4 已下載公開形態來源

Neu3D：https://github.com/fruitflybrain/neu3d
固定commit：a731df47c6fc0540340c3671fa2644fc15ec53b1。

ffbo.lib：https://github.com/fruitflybrain/ffbo.lib
固定commit：e263ae2cc22ddc0646856d5989ddc085eec27022。

來源manifest：data/morphology-candidate-20261004/source_manifest.json。14個腦區：AL_L_、AL_R_、MB_L_、MB_R_、EB、FB、PB、LAL_L_、LAL_R_、GNG、LO_R_、LOP_R_、ME_R_、LH_R_。

總共18檔，包括14meshes、1SWC、2README、1repository LICENSE；3,157,350bytes。14 meshes有18,898vertices／36,948triangles；SWC係1份骨架，36,044nodes／36,043edges／4,104branchpoints。唔可將採樣點數報成神經數量。完整逐檔URL及hash列喺附錄A。

### 4.5 共同配準研究及未解問題

- Adult demo：https://github.com/fruitflybrain/neu3d/blob/a731df47c6fc0540340c3671fa2644fc15ec53b1/examples/adult.html
- Adult manifest：https://github.com/fruitflybrain/neu3d/blob/a731df47c6fc0540340c3671fa2644fc15ec53b1/data/adult_mesh.json
- SWC introduction：https://github.com/fruitflybrain/neu3d/commit/c24f0e50081ff7ac3ec2386908e8566f523b2ad1
- Mesh update：https://github.com/fruitflybrain/ffbo.lib/commit/3f8f0c43e78605a20e64b35be451c8fe1ebeaacf
- FlyBrainLab hemibrain v1.2文件：https://github.com/FlyBrainLab/datasets/blob/c9b8e6530f32d19c351214f3ec12eb9ff24ef9cc/hemibrain/v1.2/README.md
- 匯入notebook：https://github.com/FlyBrainLab/datasets/blob/c9b8e6530f32d19c351214f3ec12eb9ff24ef9cc/hemibrain/v1.2/Hemibrain_Neuprint_to_NeuroArch.ipynb

之前研究發現v1.2 notebook同時對mesh／skeleton乘0.008，並保留bodyID；但冇證據目前demo檔由嗰個pipeline匯出。唔可再乘0.008或自行標μm。Adult demo引用flycircuit，唔係目前hemibrain mesh。

目前units、bodyID、release、共同registration未確認。神經bbox落喺AL_R_ bbox內只支持空間相容性，唔證明point-in-mesh或解剖配準。Hemibrain唔係完整雙側全腦；禁止鏡像複製假裝全腦、禁止逐件縮放塞入腦區、禁止與FAFB783真6點直接疊加。

## 5. 現有架構同數據路徑

本機Python3.11＋原生JavaScript／HTML／CSS＋Native WebGL。唔係React、R3F、Unity或完整FlyBrainLab部署，唔為換模型擅自重寫stack。

FILE路徑：使用者揀Blob／TEST PCM生成WAV → HTMLAudioElement → MediaElementAudioSource → Analyser FFT2048 → post-analyser GainNode → destination。Monitor預設0gain，分析繼續；唔用element.muted假設PCM一定保留。

Kinect路徑：Azure WinMM專用child → PCM16 mono48kHz → RMS／三頻aggregate → 本機Mic bridge → 共用A.advance → renderer與Column preview。無getUserMedia fallback到其他咪，無RGB／depth。

DSP：LOW30–180Hz；MID180–2500Hz；HIGH2500–min(8000,Nyquist)Hz。Energy由RMS×gain後限制／平滑。分析gain範圍0.1–32；bands唔直接乘analysis gain。平滑attack50ms／release220ms。Energy≤.02→HOLD、<.4→Column1、<.75→Column2、其餘Column3，候選切換另有0.8秒與初始化／時間不連續例外。Onset只係候選，唔係可靠BPM。

TEST PCM係8秒合成音，包含80／880／4200Hz等段落。Column變化同時受fixture振幅變化影響，唔可話Column係音樂類型／頻段分類。

Mic隔離：所有WinMM native操作在owned child，CREATE_SUSPENDED＋CREATE_NO_WINDOW，加入Windows Job後resume。Parent0.5秒heartbeat；child4秒lease／EOF watchdog；manager pending6秒；確認child退出先OFF。Native parent掛起等no-audio測試有證據，唔代表整個OS凍結可恢復。

Mic API同源Host／Origin／Sec-Fetch-Site、nonce與session token，1KiB JSON上限，無CORS及任意file proxy。Token不得存DOM、export、log或磁碟。hidden/pagehide／切換來源會stop，停止未確認唔放行新來源。唔把歷史Mic OFF當目前狀態。

## 6. 已有實機證據及正確解讀

| 證據目錄 | 可支持嘅結論 | 唔支持 |
|---|---|---|
| work/m3/file-video-qc-20261002-175921 | 舊FILE錄屏三頻、點亮度、Column、結尾HOLD | 新模型或最新build驗收 |
| work/m3b/kinect | 真Azure約24.917秒量測、停止確認、child0歷史紀錄 | 現在裝置仍開／關、強音樂效能 |
| work/m3b/file-startup | 並行啟動／timeout等code QC，iab真NotAllowedError畫面 | iab播放已修好 |
| work/m3b/chrome-pcm-qc-20261004 | 同舊bundle在普通Chromestartup／三頻顏色／pause／resume／ended／reset | M3C、長時間、真歌選片或全GPU性能 |
| work/m3b/music-video-qc-20261004 | 用戶音樂錄屏frame0/8/16，LOW偏強及畫面弱反應 | 完整連續動畫／FPS測量 |
| work/m3b/morphology-acquisition-20261004 | 來源hash、geometry13tests、分開預覽真mesh/SWC截圖 | 原完整UI已換／新模型音訊已驗 |

用戶錄屏約第8秒LOW.0739／MID.0293／HIGH.0012，視覺強度已2.0。舊renderer線性乘band*3.2令HIGH貢獻極低。呢個證明視覺mapping需要改善，唔足以單憑畫面判斷歌曲、喇叭、房間或Mic邊個造成頻段差異。

## 7. M3C已寫內容，未等於完成

核心規格：docs/M3C_MORPHOLOGY_SPEC.md。

| 檔案 | 已寫／待驗內容 |
|---|---|
| src/flyvj_m3/morphology.py | 固定manifest SHA256、18assets有界本機讀取、path／reparse拒絕、geometry／SWC拓撲驗證 |
| src/flyvj_m3/exporter.py | payload.morphology embedding、M3C visual_policy、兩個新增inline modules |
| src/flyvj_m3/runner.py | 新tests／assets加入manifest，測試後再次驗來源避免中途竄改 |
| src/flyvj_m3/ui/public-morphology.js | 原始mesh與SWC→分開整體fit、三頻人為分組、視覺curve、沿實際邊嘅pulse |
| src/flyvj_m3/ui/public-morphology-renderer.js | source shape基礎可見、三頻增亮／光點、buffer dispose與input validation |
| src/flyvj_m3/ui/app.js | 預設regions、neuron獨立view、原音訊UI保留、禁止publicview疊真6點、音訊time傳renderer |
| src/flyvj_m3/ui/index.html | 新模型選項、inline markers、部分M3C文案；仍有舊badge等未改完 |
| tests/test_m3c_morphology.py | backend14 targeted tests歷史PASS |
| tests/m3c_morphology*.test.cjs | geometry／renderer／完整UI及lifecycle測試 |

payload.morphology契約：schema_version1；semantics PUBLIC_MORPHOLOGY_DEMO_UNREGISTERED；registration UNVERIFIED_NO_OVERLAY；units UNCONFIRMED；body_id null；regions每筆id/vertices/faces；neuron.samples每行[id,x,y,z,r,parent]；source_hashes保存來源。

M3C視覺曲線proposal已寫入source：n=max(0,band-.001)，visual=min(1,n/(n+.035)×intensity)。Energy≤.02或intensity0清零音訊光效；原DSP bands／Energy／onset／Column唔受visualcurve影響。呢個係固定映射，唔係自動校準或分頻自適應，亦未有真音樂實機效果驗收。

14ROI按sortedID循環人為分LOW/MID/HIGH；1份SWC按分叉拓撲分組。ROI pulse沿triangle邊；骨架pulse沿parent-child路径。模型時間跟DSPstate.time，唔係生物firing。Performance／Cinematic保留全部source geometry，改DPR與有限pulse數量；上限唔係保證實際發光數或FPS。

## 8. 目前阻塞、已知需補項

P1：新模型context loss清理未通過。app.js webglcontextlost handler目前只disposeBrain()，冇disposeMorphology()；相關新UI測試檢查old.disposed失敗。呢個係本機source觀察同RED吻合嘅直接線索，仍須修正後重測restore／pagehide，唔可只改assert去綠燈。

P1：未有M3C完整build／實際Chrome音訊畫面。新source不能直接當已交付。先用新run ID，唔覆蓋舊run。

P2：tests/test_m3b_visual.py仍expect舊visual_policy semantics PROCEDURAL_ILLUSTRATION_NOT_CONNECTOME，exporter已係PUBLIC_MORPHOLOGY_DEMO_UNREGISTERED；需按新契約更新測試，同時保留legacy truth檢查，唔盲刪test。

P2：index.html title已M3C，但masthead仍M3B，badge仍「示意模型」，labels仍舊「腦輪廓／神經分枝／訊號流」。上輪字串replace未全部命中。要按真實DOM修好，區分public形態與人為音訊映射。

P2：需要實際兩新view色彩／構圖／可讀性／noise response、切view不中斷PCM、暫停凍結、reset清零、contextlost恢復、monitor OFF與Mic互斥。Mock GL測試唔能證shader一定在真GPU可用。

共通配準仍未確認，view分開先可交付。完整FlyBrainLab式全腦、選取神經／腦區互動細節、解剖相機方向等仍未驗收。不要自行鏡像半腦。

最後一次全Python255tests／6errors係2026-10-04當時modules未建立。依家modules已存在，所以唔可把舊FileNotFoundError當現況；需要新run取實際結果。本輪冇重跑全Python。

## 9. 接手優先工作次序

1. 只讀本文件、第8節涉及source與tests、M3C spec。保留現有未完成修改，確認無其他writer；先修contextloss資源清理、truth文案／舊policy測試。
2. 跑相關Node及Python tests，再跑scripts/m3-build.ps1用全新run ID。檢查新bundle確實含public模型payload、原音訊控制、Mic能力source pin及所有assets manifest。唔借舊413PASS。
3. 新owned runtime以receipt身份管理，先用新build試好，再將正式launcher切到新run。唔kill未知port owner；唔用舊PID猜process仍存活。
4. 已批准普通Chrome；在同完整UI兩個新view各驗合成TEST PCM。取三頻數字＋真screen-cap，驗pause/resume/ended/reset、view/profile/context lifecycle；Mic與monitor先OFF。Kinect真音樂需檢查現場音源與既有明確scope，唔自動播喇叭。
5. 獨立programmer及visual director QC，修完再驗。記錄限制、source/buildhash、runtime receipt，更新CONTINUE／handoff，保留舊BLOCKED／RED。只完成有證據嘅M3C有限範圍，唔mark整個VJ complete。

## 10. 重現指令與入口

PowerShell工作目錄：C:\Users\evilkoo\Documents\烏蠅VJ
Python歷史明確路徑：C:\Users\evilkoo\AppData\Local\Programs\Python\Python311\python.exe。Node用Get-Command node核對，不安裝。

以下係下一agent修完後用嘅命令，今輪唔執行build或改服務。

~~~powershell
Set-Location -LiteralPath 'C:\Users\evilkoo\Documents\烏蠅VJ'
node --test tests/m3c_morphology.test.cjs tests/m3c_morphology_renderer.test.cjs tests/m3c_morphology_ui.test.cjs tests/m3_ui.test.cjs tests/m3b_ui.test.cjs tests/m3_kinect_ui.test.cjs
$env:PYTHONPATH = Join-Path $PWD 'src'
& 'C:\Users\evilkoo\AppData\Local\Programs\Python\Python311\python.exe' -m unittest discover -s tests -p 'test_m3c_morphology.py' -v
& '.\scripts\m3-build.ps1' -RunId '<全新唯一run-id>'
& '.\scripts\m3-start.ps1' -RunId '<已驗證新run-id>' -Port 54654 -IdleSeconds 7200 -NoBrowser
~~~

若54654已有本project舊runtime，先核對receipt／executable／commandline／health再用scripts/m3-stop.ps1 -SessionFile '<精確receipt>'。Stop script可能exit shell，應獨立呼叫，唔假設同一命令後續一定執行。Start-Process background helper用WindowStyle Hidden。

原主UI http://127.0.0.1:54654/；獨立模型QC歷史URL http://127.0.0.1:65034/。兩者2h idle會退出；2026-11-16冇查health，唔假設活着。65034不是完整UI，不可當正式產品入口。

## 11. 證據檔案索引

原始需求：C:/Users/evilkoo/Desktop/SUMMARY.txt。
M0流程：PROCESS.md、docs/M0_SPEC.md。
M1：docs/M1_RESULT.md、data/flywire783-m1/{sample,source_proof,source_review}.json。
M2：docs/M2_RESULT.md、work/runs/m2-final-03/{state,manifest}.json。
M3：docs/M3_SPEC.md、docs/M3_FILE_VIDEO_QC.md、docs/M3_CHECKPOINT.md。
Kinect：docs/M3B_KINECT_RESULT.md、docs/M3B_KINECT_SPEC.md、work/m3b/kinect/backend_qc_final.json、frontend_qc_recheck.json、actual-kinect-live/stopped.json與png。
播放：docs/M3B_FILE_STARTUP_RESULT.md、docs/M3B_CHROME_PCM_QC.md、work/m3b/file-startup、work/m3b/chrome-pcm-qc-20261004。
模型：docs/M3B_MORPHOLOGY_ASSET_QC.md、data/morphology-candidate-20261004/source_manifest.json、work/m3b/morphology-acquisition-20261004/{geometry_qc,independent_qc,asset_acceptance}.json、regions-screen.png、neuron-screen.png。
M3C：docs/M3C_MORPHOLOGY_SPEC.md、work/m3c/frontend-red.log、frontend-green-01.log；backend-red/20261004-195247-754553/red.log；backend-green/20261004-195407-120910/{green,full-python}.log。
今輪現況核對：work/handoff-20261116/current-targeted-tests.log。

注意：brain-test-pcm-high.png曾誤名，實際time0，唔係high-frequency PASS。Full-page stitching有重複／裁切圖片，不可當完整responsive或animation QC。單張screen-cap唔證明連續packet軌跡／FPS。

## 12. 未做嘅產品能力

未有真OSC sender／Resolume Layer、Clip、Column mapping驗證／回饋／rate limit／手動接管／安全停止；未有素材庫、tag、style分類、選片決策、轉場策略、播放歷史去重；未有genre模型、可靠BPM／beat phase／bar對齊／音樂結構；未有訓練資料、離線evaluation、可測品味指標；未有完整全腦或科學neural dynamics；未有Spout輸出／Notch／TouchDesigner整合；未有4090與3070Ti實機FPS／顯存／長時間穩定性。呢啲係後續backlog，唔係本輪擅自開工範圍。

## 13. 授權、資料與agent注意事項

私人自用已確定，唔重問商用license。保留來源README／LICENSE作記錄，缺配準證據係資料正確性問題，唔係藉機卡私人使用。

已有授權：本機prototype build/debug/test/QC；Azure Kinect音訊輸入；普通Chrome測試；公開mesh/SWC取得100MB內；原UI整合新模型並測試音訊。授權唔包括RGB/depth、raw recording、私人音樂上傳、亂讀其他文件、對外訊息、install／OAuth、未知processkill、任意檔案覆蓋或未確認OSC實機控制。

用戶最新AGENTS取代舊版，廣東話、必要時詳細，唔附和、唔稱讚開場。模型身份／effort不可假稱。主agent負責最終驗收；local worker係第二意見。沒有local_general/local_vision可用工具證據時不要假裝跑過。

每輪委派先查免費list，但匿名OpenCode池已由用戶指令標LANE_LOCKED暫停；不能由DSH alias繞過、唔逐模型probe。EAC仍候選未核實，不能偷讀credentials。OpenRouter顯示free唔代表連線／授權／vision已驗。若按能力或渠道限制採Codex原生Astra/Sol，要公開route／指定model／effort，實際身份不足就未確認。今輪只做文件QC，不傳private素材到外部CLI。

Git狀態今輪大量src/tests/docs/data顯示untracked，唔假設已有可靠commit歷史。禁止git clean/reset、bulkdelete或重建把現有內容清走。新run immutable，manualQC永遠從NOT_RUN開始；獨立scoped report可另外放，唔把413pass自動轉manualREVIEWED。

## 14. 可直接交畀新agent嘅開工指令

> 繼續 C:/Users/evilkoo/Documents/烏蠅VJ 嘅M3C。先讀 docs/AGENT_SUMMARY_2026-11-16.md 同 docs/M3C_MORPHOLOGY_SPEC.md，只按需讀current source/tests，唔讀舊chat或整份歷史。目標係公開14ROI／1SWC分開嵌返原完整UI，再做新模型音訊QC。Source已改但未build；今輪Node77中76PASS／1FAIL係contextloss dispose。先修root cause及truthmetadata/test契約，保留音訊功能同sourceassets，再newrun全量build、普通Chrome兩view合成PCM驗收、獨立code＋screen-cap vision QC。唔做未知配準overlay、唔把sample nodes當neurons、唔擅開OSC／record／install；Mic只限既有Azure授權。唔重問已批准範圍。交付要清楚舊bundle同新source唔同，唔mark全M3/無人VJ完成。

## 附錄A：18份形態來源逐檔URL及SHA256

以下由本機source_manifest.json直接整理，避免手抄版本／hash。

### hemibrain_neuron.swc

- Bytes：1467104
- Repo／commit：fruitflybrain/neu3d / a731df47c6fc0540340c3671fa2644fc15ec53b1
- URL：https://raw.githubusercontent.com/fruitflybrain/neu3d/a731df47c6fc0540340c3671fa2644fc15ec53b1/data/hemibrain_neuron.swc
- SHA256：`8a41e829c24a1c8efdd09096985d3f1d5150d0c97447b5a95329a9963085ea55`
- Git blob SHA1：`2124c421fcdf7b971ce3bd87be496280a61653c8`

### sources/neu3d-README.md

- Bytes：4942
- Repo／commit：fruitflybrain/neu3d / a731df47c6fc0540340c3671fa2644fc15ec53b1
- URL：https://raw.githubusercontent.com/fruitflybrain/neu3d/a731df47c6fc0540340c3671fa2644fc15ec53b1/README.md
- SHA256：`fd378507e84691d0692ac582a1d7fb2de0d5b29c0679c4325df47f8884ab7000`
- Git blob SHA1：`32f418f56b5125a1f4b958402df6bb3dafc09635`

### meshes/AL_L_.json

- Bytes：68547
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/AL_L_.json
- SHA256：`0e4ed15dd5e369c3d58e30da3b8a218720a2ca05d3579e01426d93cb5b526e32`
- Git blob SHA1：`62625fef8e1812774d7a85a7ebb314328b49d5cc`

### meshes/AL_R_.json

- Bytes：177147
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/AL_R_.json
- SHA256：`bdc0d85fc6b3cddee2c3c35bccb1e0b7e4ccaea34112f3522130047538d90ee8`
- Git blob SHA1：`8a7f22df3c9887ae88b9c932a6ce9f583d8c4646`

### meshes/MB_L_.json

- Bytes：122765
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/MB_L_.json
- SHA256：`a41ab8d2cdc2385df88245c6c777efc01fad6d00e92a6a9644520eee167ce51c`
- Git blob SHA1：`5bbf33e75c4025d348a5bd708d21ae1b77ee28f5`

### meshes/MB_R_.json

- Bytes：267496
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/MB_R_.json
- SHA256：`09b293aaca9a50dd719320aaac18ba169014238ea92845fce8e2e7be69762ee0`
- Git blob SHA1：`d898e1daa1ed2623662e05b78fb92a03e71c9f00`

### meshes/EB.json

- Bytes：65454
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/EB.json
- SHA256：`2d6597a755f3d411df247b0e842b67f1b8f677493331ddb638e5a114dcc0eccf`
- Git blob SHA1：`e24feb3a6b7217023284b40eb9997cc25215d61d`

### meshes/FB.json

- Bytes：153070
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/FB.json
- SHA256：`c898759da64f6fc0f274f50895eb5ada9a691c79f6c8f03f678e3aa2bc9b2fa7`
- Git blob SHA1：`df5a60d8c47e67ef530faf4d855a30cc46c2e2f4`

### meshes/PB.json

- Bytes：59478
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/PB.json
- SHA256：`09af355ce98a07a564a8fd69e313a2a31cf5344fa7bd8754218c06d51ee17bf5`
- Git blob SHA1：`692f38c01fb36c9a48bc72492af3e28cef1e750a`

### meshes/LAL_L_.json

- Bytes：68554
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/LAL_L_.json
- SHA256：`aac98a9c56317818fad9beb82e928a32ee8e910295369eaf3d08c5484f698aec`
- Git blob SHA1：`d542c50689cee215921d23978eac63c5b62f4979`

### meshes/LAL_R_.json

- Bytes：132523
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/LAL_R_.json
- SHA256：`961350b6c60e9abc29e18770c7f1adbda298acfbdae3f01748e2029fcc3f6fd0`
- Git blob SHA1：`728f1a7c6eb21fa2dd4d96dd72b3d30f92d7880a`

### meshes/GNG.json

- Bytes：123357
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/GNG.json
- SHA256：`0be5a37d41263f601b9976a216cd32085971fe81f6200863a4799b352354b204`
- Git blob SHA1：`4bc4cc40bd016aed0517c2f39acfc3264976e82a`

### meshes/LO_R_.json

- Bytes：241324
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/LO_R_.json
- SHA256：`6679d2158ae135e11e37e2a6982cc1d588e4338b8891233f4963b2ffb8d02cfc`
- Git blob SHA1：`e75288061c7f56103a6920fcb996af0d839dac29`

### meshes/LOP_R_.json

- Bytes：55639
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/LOP_R_.json
- SHA256：`55f854dcd4381b7a32d4c97ed82d2870f2525dfc6207ecaac440c1a71f2e432e`
- Git blob SHA1：`3d3359fbc2614bf888e67dee5524f74f3131b9b2`

### meshes/ME_R_.json

- Bytes：51492
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/ME_R_.json
- SHA256：`9869b6448ec0b91ea9c4ad622c678636ae6d967b21158b03162160177125a286`
- Git blob SHA1：`6e1a55ea29dd1ae05236265cefd32e36fbf4824a`

### meshes/LH_R_.json

- Bytes：96902
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/mesh/hemibrain/LH_R_.json
- SHA256：`54d59caf585df1576b053279b567a24f8af727442f327fa3ca4c837fa650f867`
- Git blob SHA1：`9b236022b3d23f5cb18ecd11292bfd2192cc65ed`

### sources/ffbo.lib-README.md

- Bytes：52
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/README.md
- SHA256：`704e1d791aafe60cb4d678048d30eebe721ea6d5bd15f24c0d5128d04fd5539c`
- Git blob SHA1：`4ce9530f87f4fe15cb1ad8383f6c9224ee077fdf`

### sources/ffbo.lib-LICENSE.md

- Bytes：1504
- Repo／commit：fruitflybrain/ffbo.lib / e263ae2cc22ddc0646856d5989ddc085eec27022
- URL：https://raw.githubusercontent.com/fruitflybrain/ffbo.lib/e263ae2cc22ddc0646856d5989ddc085eec27022/LICENSE.md
- SHA256：`a5a3b65c9cafd9e14f7ef1f8a0e7f16af44362215c8f196cf30bd8e20b82e8b4`
- Git blob SHA1：`3aaaa12403b8610da213073dc29293429c7c5ae2`

