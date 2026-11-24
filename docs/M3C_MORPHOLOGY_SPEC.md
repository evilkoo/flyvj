# M3C：公開模型嵌返原UI＋音訊效果（2026-10-04）

使用者明確要求新模型替換原UI並test音訊效果。保留原FILE／TEST PCM／Azure Kinect／monitor／gain／FFT／Column dry-run／相機／context診斷；只換3D呈現。新預設14個hemibrain腦區mesh；另有1份SWC骨架視圖。舊6點同示意模型可作獨立診斷，不准新模型疊加6點或互相overlay，sourceunits/bodyID/registration保持未確認。部分腦区唔係完整全腦。

所有原始模型檔、M2真6點資料、M3 audio.js／Mic backend不可改；新資料以source manifest SHA256/Git blob pin核對後嵌入self-contained bundle。新payload.morphology schema1，semantics PUBLIC_MORPHOLOGY_DEMO_UNREGISTERED；registration UNVERIFIED_NO_OVERLAY，units UNCONFIRMED，body_id null；regions{id,vertices,faces}，neuron.samples rows[id,x,y,z,r,parent]。不下載新資產，不裝library，保持native WebGL、同一existing audio-clock RAF。

公開幾何模組 independently normalize regions union／single skeleton整體fit，源坐標磁碟不變；14 regions以sorted ID round-robin分3音訊視覺組，SWC以原parent拓撲分叉順序人為分組，唔係生物firing。模型group／line片段數與採樣點/神經份數分開。公開模型沒有fake ellipsoid。

視覺映射獨立：visual=max(0,rawBand-.001)/(max(0,rawBand-.001)+.035)，energy≤.02或intensity0禁音訊亮光。保留原始bands／energy／onset／Column；gain唔調新曲線。基礎模型靜音仍可見；活躍組上色及局部增亮。ROI光點沿實際triangle邊行；SWC光點沿實際parent-child path行。time只用DSP state.time，pause/restart/end/hidden符合原流程；無自稱跟可靠BPM或neuralspike。

Performance／Cinematic保留全部模型幾何，只改DPR同最多128／256骨架光點，ROI最多84光點；唔冒稱GPU FPS。所有buffers/profile切換/contextloss/restore/pagehide需dispose/rebuild。保持原source與Mic安全門；不自動捕捉或重開Mic；monitor預設OFF、OSC不發送。

TDD：幾何array有限／index／SWC topology／bandmapping／deterministic pulse／silence／badpayload／profile一致；GL submission／shaderprecision／dispose／bounds；UI預設models、全controls保留、禁止overlay、mode/profile不中斷DSP、pause/reset／renderer失敗fallback6點唔fakebrain。backendhashpin/tamper／exportmarker／manifest。新immutable run；原run與QC不覆蓋。Chrome syntheticPCM在兩新視圖實測LOW/MID/HIGH、visibleactiveband／packets、pauseclockfreeze、reset0；獨立code同screen-cap vision QC。真音樂／強音Kinect若未實測需標未驗，fullM3／真OSC不完成。
