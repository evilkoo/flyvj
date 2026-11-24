# M3B 大腦視覺模型／特效規格（2026-10-02）

## 已批准目標／安全

使用者要求執行大腦視覺模型同特效。今次係可辨認烏蠅式雙側腦形、神經分枝、音訊觸發發光／訊號流動；唔再只顯示6點3線。沿用本機 Native WebGL、Python311 export、Web Audio實測；不下載資產、不裝新套件、不讀Mic／系統音訊、不發OSC、不上傳。真實 sample JSON／M2幾何核心／M3 DSP／舊runs不可改。

新增輪廓／分枝／粒子全部 deterministic 程式生成，明確標示 PROCEDURAL ILLUSTRATION NOT CONNECTOME。真實6 marked points／3 measured connections保持資料不可變，係可獨立切換嘅真樣本層；唔將示意神經當作真source神經，亦唔做假的 anatomical registration。UI以「大腦示意」為預設；有「真實小樣本」視圖。

## Layout

頂部：M3B 大腦視覺＋FILE狀態＋示意模型badge＋OSC OFF。
音訊列：保留選檔／TEST PCM／播放暫停／由頭／監聽／gain；新增獨立檔名顯示，唔因 native input刻意清空誤判未載入。
主區：大3D viewport＋視圖／Performance-Cinematic／輪廓／分枝／訊號流控制；右側保留RMS、Energy、三頻同Column。原始ID來源資料放可摺面板。唔改候選規則：Energy選Column，band只驅動視覺。

## 模型模組API（brain-geometry.js）

UMD global FlyVJBrainGeometry，同時 CommonJS export。
createModel({profile:'performance'|'cinematic',seed:783})回傳：profile、seed、semantics字串、shell Float32Array interleaved xyz+normal（三角形mesh）、fibers Float32Array interleaved xyz+band+phase（line pairs）、somata Float32Array interleaved xyz+band、paths array（每條points array of xyz，band0/1/2，phase0..1）、counts {shellTriangles,neurons,lineSegments}、bounds {min:[xyz],max:[xyz]}。world範圍x約±1.7、y±.9、z±.8。左右optic-like lobes同central body係示意幾何，唔標解剖真實性。Performance約72–96示意neurons、Cinematic約144–192；lineSegments <=12000；Cinematic點／mesh更多。無Math.random、無網絡／DOM。
fillPulses(model,time,bands,target) fills caller allocated Float32Array(paths.length*5), layout xyz+band+strength，回傳同target。time finite >=0，bands低中高array3各0..1。粒子沿示意paths走，phase deterministic；strength只由相應band驅動、zero band=>strength0；唔造音訊／activity。geometry arrays不受fillPulses影響。validate壞profile／seed／time／bands／target，唔默默NaN。

## Renderer／特效

保持1 canvas／1 existing RAF loop；新增GL program畫mesh輪廓、batch線、somata光暈、沿分枝packet。用固定buffers＋typedarrays重用，bounded shader，唔裝Three/R3F。特效time只用state.time，pause／end／hidden凍結；冇wallclock decorative動畫。silence energy<=.02=>流動光packet隱藏，仍保留可辨認静態模型；visualIntensity只改外觀，不改DSP/Column。
Performance DPR<=1.25；Cinematic<=1.75。唔將profile label當4090／3070Ti效能證明。context lost時音訊繼續、標清visual失效；restore重建自己嘅GL資源，不改sample/source/audio状态。變更profile時dispose舊geometry/buffers/program，exit也dispose。

## 驗收

TDD：純模型數值有限、seed deterministic、形狀有depth／分枝、不修改資料、samplePulses zero/strong bands／pause時間穩定／invalid參數拒絕；app integration視圖／profiles／toggles／context lifecycle／existing audio/camera/source regression；Python exporter marker包含visual模組／policytruth／CSP仍無network，runner包含新tests。
新run不覆蓋舊run，人工QC從NOT_RUN開始。獨立programmer覆核diff與test證據；實際新版本screen-cap vision先可判畫面完成。若browser policy仍擋，唔換surface繞過／冒認PASS；保存candidate、具體限制及最小權限需要。效能硬件未驗、全腦morphology／生物firing／trained VJ／OSC維持未做。

## QC 修正（同日）

NET shader共享u_kind同為明確mediump int；跨stagevaryings明確mediump。窄屏projection fit=min(.82,width/height*.55)，default zoom不剪左右optic-like lobes；使用者放大仍可有意裁切。兩項有先RED後GREEN regression。新入口啟動大腦視覺.cmd只指向M3B新run，唔覆蓋舊啟動M3.cmd。正式screen-cap vision未做之前唔標完成。
