# M3B Azure Kinect Mic 輸入規格（2026-10-02）

使用者明確要求加入 Azure Kinect 為 Mic input；授權只限Kinect音訊本機分析，不開RGB／depth、不錄音、不上傳、不發OSC、不裝SDK/driver、不讀其他私人資料。Mic預設OFF，使用者按開始Kinect先capture；無Azure Kinect就failclosed、不用其他mic。

## 已有本機證據

Get-PnpDevice AudioEndpoint present：麥克風排列 (Azure Kinect Microphone Array)，Status OK。WinMM wave input index0名稱含Azure Kinect；waveInOpen(WAVE_FORMAT_QUERY)驗48kHz／PCM16mono回0，未capture。呢個係OS音訊endpoint，不宣稱SDK 7channel／beamforming或硬件品質已驗。

## 路線

保留FILE→WebAudio及M3B程序生成視覺。新增Windows標準WinMM本機Python capture，不需瀏覽器先開未知default mic取得label。Native只開已枚舉＋身份核對Azure Kinect index。raw PCM只喺記憶體buffer，唔寫disk；CPU做RMS及2048point FFT，HTTP只傳current aggregate features。Mic無monitor回放，防回授。

## kinect.py API／worker ownership

KinectError(RuntimeError)。enumerate_kinect_devices() -> list[{index:int,name:str}]，只Azure Kinect matching（case insensitive），不返回其他mic。KinectCapture(backend=None)，default backend WinMMAudio，import不開Mic。backend可injectunitfake，contract list_devices()->all [{index,name}], open(index,sample_rate=48000,frame_size=2048)->reader；reader.read()->bytes PCM16mono或None（nonblocking），reader.close()->確認close，failure應raise。

Capture.list_devices()->onlymatching；start(index=None)->snapshot：必須single matching或explicitmatchingindex，other/default/ambiguous拒絕。open前重新檢查device identity，WinMM用明確index，唔用WAVE_MAPPER。stop()->snapshot idempotent、停止worker、join bounded、只在close確認後active false；native或thread停止失敗要明確error，唔假OFF。snapshot()->dict {state:'off'|'running'|'error',active:bool,device:{index,name}|None,time:float,rms:float,bands:{low,mid,high},clipping:bool,sample_rate:48000,frame_size:2048,frames:int,error:str|None}。time來自processed PCM sample count /48000，不用wallclock造features；start／stop重設量測，error清ghostvalues。thread driverfault要停自己handle；hardwareclosed才標OFF。

measure_pcm16(data,sample_rate=48000)->{rms,bands,clipping}，只2048mono PCM16fullframe，invalidlength/rate拒絕。FFT radix2 standardlibrary（不裝numpy），Blackman window、FFT/N magnitude、maxband clamp(6*mag)；分頻沿現有30–180／180–2500／2500–min(8000,nyquist)Hz。Windowsctypes structures/prototypes清楚，WAVEHDR buffers保持引用直到reset/unprepare/close完成；處理partialalloc／open/start/read/reset/unprepare/close fail，唔use-after-free；四個boundedbuffers，callbacknull＋poll，唔保存rawaudiohistory。目標能安全測已存在device，但worker不得自行start真Mic，主管實機QC才可。

## 本機HTTP橋／主管ownership

沿用只bind127.0.0.1及固定M3bundle，無任意file／URLproxy。GET /mic/config、/mic/devices、/mic/status；POST /mic/start、/mic/stop。runtime nonce只放config，不落盤／不放DOMdiagnostics，不外傳。nonce＋same-origin Origin/Host＋JSONContentType／<=1KiB body防foreignwebsite觸發；不CORS、不支持OPTIONS，不accept任意controllercommand/devicepath。只發deviceindex、只回RMS/bands/time/state等aggregate。每個active client必須持續authenticatedstatusheartbeat；lease6s過期自动stop、server退出finally stop。config只同origin請求，staticheaderconnect-src只增加'self'（只本機featurebridge），不allowexternalnet。

## 前端／主管ownership

新增KINECT MIC status、檢查装置、Kinect selector（只有matching devices）、開始／停止按鈕（manualstart only）。開始Mic先停FILE、clearDSP；Mic currentfeatures交A.advance並沿用音訊clock驅動brain。停止／hidden／pagehide／swaptoFILE／TESTPCM都停nativecapture，clearDSP/packets，ignorelatefetch或oldgeneration。不拿generic播放暗中開Mic。Mic無monitor，filemonitor功能保持；volume/gain只改analysis，visualIntensity只改外觀。Mic不可用唔阻FILE或3D。loopbackHTTPonly，file://Mic disabled並説明。顯示裝置名及狀態，不顯示nonce／原始audio。

## QC

Worker純model/nativeadapterfakeTDD先RED後GREEN；不要真Miccapture。主管HTTP nonce/Origin/Host/leasefailclosedtests、frontfetchraces/state/stop/hidden tests、原FILE／brain全面回歸。新run不覆蓋舊run。獨立programmer QC＋新screen-cap vision；實機capture只此已識別Kinect、短暫且不錄PCM，停止確認後保存aggregate metrics證據。唔將現有258tests當Mic已驗。

## 整合補充

Native snapshot.frames 係2048-sample blocks；time=frames×2048/48000。MicRuntime.start 回覆新增private session；status需X-FlyVJ-Mic，stop body需相同session，舊session不能停新capture。serve只為新run input_capabilities.azure_kinect_mic=True且payload/backend hashes匹配者提供Mic endpoints；舊M3B不會因新server源碼自動獲得收音能力。正式build嘅safety.microphone=False只表示自動測試冇開真咪；runtime能力及之後硬件QC另列，不混用。

## 獨立QC P1修正路線

原WinMM driver類保留只供隔離child用；HTTPprocess改KinectProcessCapture，WinMM枚舉／open／read／close都不在HTTPparent。Child先suspended、放入existingM0 kill-on-close Job後才resume；driver卡死由持有Popen／Job嘅parent限時終止並確認exit，不PIDhunt、不殺其他app。Parent/helper IPC只有有限aggregate JSON，不rawPCM。MicRuntime短state lock外做所有I/O，start前已有pendingcleanup lease，晚reply與旧cleanup不能影响新session。Backendpin亦包括process/worker/M0Job。第一次BLOCKED独立报告保留，修复后必须新recheck，不以原45pass冒认P1已清。

## Final safety candidate

Parent每0.5s給child control heartbeat；child4s control lease獨立watchdog於EOF／過期os._exit硬退（不等待WinMM close／stdout），Job處理parentdeath。Manager有sticky cancel_event＋atomic session/generation/leaseage guard；清理thread兩條paths獨立且launch失敗可重試。候選P1修補需要backend_qc_final獨立放行先真Mic。
