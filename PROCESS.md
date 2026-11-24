# 烏蠅 VJ · 開發流程

## M0 已建立嘅入口

```powershell
& "C:\Users\evilkoo\Documents\烏蠅VJ\scripts\auto-build.ps1" -Mode Verify
```

只執行標準庫驗證，唔裝套件、唔接真音源／OSC。Runner唔係自動寫 code 嘅 AI；寫／debug／獨立 QC 由主管 task 管理。

## 今次 TDD 同實機證據

- `work/m0-red-tests.log`：先見 22 個失敗，當時未有 production code。
- `work/m0-green-tests.log`：首輪 22 個通過。
- `work/m0-red-regression.log`：補 skipped tests／錯誤 artifact 等 regression。
- `work/m0-qc-red.log`：独立 QC 找到 process-tree timeout、interrupt 落盤、manual QC 顯示問題，再補測試見 4 個失敗。
- `work/m0-qc-green.log`：修正後 29 個通過。
- `work/runs/m0-verified-01/state.json`：真正 PowerShell 入口 29 pass、0 skips、syntax/unit/mock 三步 PASS。
- `work/m0-failure-evidence.json`：故意設一個失敗 test，實際子程序 exit 1；狀態 BLOCKED、後續 mock NOT_RUN、retry 0。
- 重跑已存在 run ID 被拒絕，原 state SHA256 不變；外部 cwd 呼叫入口亦通過。

## 失敗流程

先讀失敗 step 嘅 command、exit code、stderr；提出新原因假設先 patch。每個獨立問題最多兩輪修復；冇新證據唔盲目重試。唔自動 git reset／刪資料／覆蓋舊 run。

Windows child 先暫停，附着到只屬於該 step 嘅 Job Object，再恢復；正常結束、timeout、中止都收回自己嘅 child tree。失去 Job 權限就停止，唔無保護 fallback。

Ctrl+C best-effort 寫 BLOCKED/INTERRUPTED；硬 kill、停電或磁碟寫入失敗唔能夠保證落盤。留低嘅 RUNNING 報告唔係 PASS。

## 驗收界線

M0 PASS 唔等於真音樂、真神經、3D 或 Resolume 過關。新的 run 預設 manual QC NOT_RUN，唔沿用上次人工覆核；今次交付報告只可以喺實際獨立覆核完成後附證據。

M1 才處理真資料來源、授權、神經 ID／運算／幾何一致性；唔自動下載 dataset，唔擅自將 synthetic 圖稱為 REAL。
## M0 歷史驗收

独立 code／desktop／窄畫面 Vision QC 通過；report-qc.png 已確認 REVIEWED、4/29 tests來源分清、未完成項目冇冒認。最終 M0 checkpoint 喺 HANDOFF.md。

## M1 本機接口進度

本機strict JSON／不可變dataset／ID-keyed engine→view packet已建立。只支援interchange v1小樣本，包括點座標同weighted links；未接原生FlyWire CSV/NPZ、SWC、mesh/GLTF，唔代表完整神經形態已載入。

- `work/m1-red-tests.log`：先見31新tests失敗，舊M0 29通過。
- `work/m1-constructor-red.log`／green：直接constructor同可變座標／bool座標嘅regression。
- `work/m1-report-red-02.log`：M1 tab title同未執行gate唔可以假報已BLOCKED。
- `work/m1-qc-red.log`／green：mixed UNC、deep JSON、lone surrogate、mapped drive及reparse path；修正後73 tests通過。
- `work/runs/m1-verified-01`：真PS VerifyData接口PASSED、真資料BLOCKED/REAL_DATA_NOT_PROVIDED；原Verify亦73PASS。Synthetic、自報real、deep-invalid實際gate分別拒絕／未確認／INVALID_DATASET。

歷史記錄（當時）：Code QC及截圖有獨立覆核；真資料冇，唔沿用software QC當成生物來源／license確認。URI／ADS raw-before-normalization曾待回歸；之後已於M1最終驗收關閉，以末段75-test記錄為準。

圖像截圖以實際JPEG儲存；只係HTML report viewport，唔係3D renderer/GPU驗收。Raw長ID以字串保存，fingerprint只證明內容一致，唔係authenticity證明。
## M1 最終驗收

raw URI／ADS父目錄正規化case先見2FAIL再修正；全套75PASS。獨立probe確認raw拒絕前drive_type/lstat/open皆0calls，該P2已關閉。m1-final-01接口PASSED／真資料BLOCKED；m0-after-m1-final-01 PASS。software QC與真資料關卡分開，不假放行。

M1最後software QC區已獨立視覺確認PASS；75 full tests與6/4 targeted來源分清，真資料BLOCKED保留。Browser舊tab一次attach timeout已保存error，按文件換新owned tab恢復，冇盲目重試／影響core驗證。

## 交接文件更新

本機記錄時間：2026-10-02T00:39:03+08:00。用戶要求write handoff；已更新HANDOFF與work/NEXT_CHAT_START，保留原handoff快照。只做docs更新；查到14個reviewed source hashes全部相符、named artifacts齊，無重跑／改code。下一task先驗證handoff，再處理真資產授權，不能自動開始M2。

本次交接text/QC＋既有report-qc截圖覆核PASS；完整目標、75/0skip、software REVIEWED與real BLOCKED一致。handoff_verified保留false等下一task獨立驗證，冇開新feature或讀外部資料。


## M1 真實小樣本尾段（UTC記錄 2026-10-01T19:18:38+00:00）

用戶明確要求set goal，直接build到目前M尾段，QC後先交付，重大決定先停；沿用私人自用，冇再問商用。公開取得conn gzip首65,536bytes＋完整coord gzip5,314,546bytes，無登入／install／GB級下載。6 IDs／3neuropil-specific edges，JSON1,873bytes；source由獨立QC重現raw rows、CRC32C及nm定義。

provenance TDD RED（module未有）→9 targeted GREEN；integration RED→GREEN。主管全套92PASS／0skip；m1-real-preqc-01 real/interfacePASSED／exit0；m0-after-real-m1-preqc-01 PASS。m1-missing-after-real-01仍預期BLOCKED／exit1；CLI synthetic／self-declared real負例亦拒絕。

獨立programmer17 targeted PASS＋85 core fault checks；visual director實際view3張正常viewport PASS。fullPage stitching失敗artifact保留且排除；QC driver錯誤假設PNG已保留error，3個JPEG byte-identical .jpg copies／format recovery exit0。冇改raw source或把原driverexit1冒認成功。

舊file://來源報告安全blocker保持歷史狀態；今次新M1 run正常用窄scope loopback HTTP preview，只serve該新report、無directory/file browsing，冇開被拒頁。最終manualQC區／交接差異驗收見delivery_qc.json；唔代表full morphology／3D／音樂／GPU／Resolume完成。


## M2 完成線（2026-10-02）

Goal明確只做offline真實小樣本3D控制台，唔讀真音源／發OSC／裝依賴。Final03：144 PASS／0skip（116Python＋28Node）；M0/M1各116／0skip回歸PASS，baseline code/test/script16/16不變。
CodeQC找出矛盾successful artifact/log；修正＋CRLF回歸。實際screen-cap捉到CSS BOM；修utf-8-sig。Visual director發現spec中文618個?，根因PS5ASCIIpipeline，已改直接UTF8，原檔留證。
Chrome15/15domain checks，真context lost／restore；driver/IABdiagnostic保留唔冒認全PASS。Final03與已目視final02 console/payload逐byte相同，6張圖及browser證據hash不變；新manualQC經明確覆核先REVIEWED，唔自動繼承。
Ownedpreview／tabs／viewport已清理。交接QC由獨立programmer另驗docs/state/hashes，PASS後主管先completeGoal；唔開M3。冇git stage/commit/push。


## M3 checkpoint（2026-10-02）

直接下一階段：不推断新goal，用plan續建。M2 baseline交接27/27+source30/30先驗；newM3僅localFile／realPCM FFT／human mapping／Column dryrun。Candidate220/0skip+PSAST；code／visualPASS_SCOPED，nativeTEST RIFF WAV9browsercases。三段RMS .0702/.1413/.212對應三頻及Column1/2/3。不是手拉Energy，亦不是私人歌／全VJ能力QC。
獨立QC捉到floatPCM overshoot被停播、shortforwardseek假onset、runtime optionalmanifestfailopen，全已修並回歸；startupJSreplace $suffix令PSparser壞亦保留error＋ASTgate修正。新source凍結46/46，M2原30/30不變。
Major permission gate：filechooser.setFiles CDPNotAllowed，與file://URLpolicyblock分開保存；無改權限／繞過。Phase仍未完成。人類只授權一個generated測試WAV，主管再做FILEmodeQC，不要求人類判品質。Candidate受限HTTP runtime＋Chromehandoff頁必要待user，idle30min退出；viewportreset、oldertestserver已停。


## M3 website repair（2026-10-02）

User網站不能開：oldPID29916已停／HTTPfail，93minold30minidle且空errorlog；idleexpiry係inference。Fix固定54654+idle7200+根目錄啟動M3.cmd+matchingowner/run/hash/idle安全reuse；QC捉到reuse忽略idle，已加第5個red/green regression及拒絕mismatch。
Repair02自動225/0skip+AST，HTTP200、同owner重用、錯idle拒絕後仍200。Currentpage自動vision遇BrowserpolicyBLOCKED，停止且冇alternate/rawCDP/permission繞過；未宣稱visualPASS／M3complete。CONTINUE已指repair02live服務，2h idle；無BroaderChrome權限變更，FILEmode仍待user單檔授權。
