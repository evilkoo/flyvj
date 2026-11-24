# 公開形態模型小樣本取得／QC — 2026-10-04

## 結果：來源 hash 同幾何格式通過；跨檔配準未放行

使用者批准查找／下載公開腦區 mesh＋小批神經骨架，最多100MB，本機使用、不安裝整套FlyBrainLab、不外傳私人音樂。本輪只做小樣本取得與QC；唔係正式FlyVJ UI已替換或全M3完成。

資產目錄：data/morphology-candidate-20261004。取得14個hemibrain腦區mesh＋1份Neu3D官方公開demo SWC，連2份README同repository-level LICENSE共18檔、3,157,350bytes（約3.16MB）。來源檔案冇改坐標、冇鏡像補另一半；SWC無source bodyID／units header，唔稱完整全腦或已驗body identity。

Pinned sources：fruitflybrain/ffbo.lib commit e263ae2cc22ddc0646856d5989ddc085eec27022（mesh/hemibrain），fruitflybrain/neu3d commit a731df47c6fc0540340c3671fa2644fc15ec53b1（data/hemibrain_neuron.swc）。source_manifest.json保存每檔來源URL、Git blob SHA1、SHA256、bytes；18/18本機source blob及SHA256相符。原始檔案不可作配準shortcut覆寫。LICENSE係來源repository文件附帶，唔據此虛構每個生物export嘅追溯資料。

14 meshes共18,898vertices／36,948triangles，index有效、finite坐標、0 degenerate triangles。1份SWC：36,044採樣nodes、36,043parent-child edges、4,104branchpoints、1root、無duplicateID／missingparent／cycle。36,044唔係神經數量。

Validator TDD：geometry-red.log保留先見module未存在；geometry-green.log本輪13tests PASS，涵蓋壞index／boolindex／NaN／坏flatlength／重複ID／missingparent／cycle／負radius／multiple roots／長chain非遞歸。數據統計見geometry_qc.json。

## 座標／來源限制

神經bounds在AL_R_ mesh嘅axis-aligned bounds內，只係spatial compatibility檢查，唔係point-in-mesh、解剖registration或biologicalidentity證明。官方公開demo文件未明確提供兩份檔案共同units／template／release／bodyID。Neuro3D adult例子引用flycircuit mesh，不能當目前hemibrain配準証據。官方FlyBrainLab v1.2有mesh/skeleton一致縮放慣例，但冇證據目前兩組demo由該pipelineexport，所以冇乘0.008或自行標μm。

狀態：PASS_SOURCE_HASH_AND_GEOMETRY_ONLY；joint_registration=BLOCKED_UNVERIFIED_SOURCE_PROVENANCE。不得把未配準神經樹直接疊進腦區、不得將此pack當完整全腦。

## 實際3D預覽／安全

QC viewer：work/m3b/morphology-acquisition-20261004/preview.html，self-contained nativeWebGL，14mesh同單一SWC分開視圖，各自整體fit＋相機旋轉，唔改磁碟原始資料，overlay disabled。真Chrome screenshot已拍regions-screen.png同neuron-screen.png，腦區有非橢球嘅結構形態；SWC可見密集真source分枝，keyboard ArrowRight yaw0.15→0.27、draw-submitted，browser查詢error/warn空。唔當連續FPS／4090或3070Ti benchmark。

專用loopback QC server只serve '/'與'/health'，其他path實測404，不提供directory/file proxy，CSP connect-src none，無audio／mic／OSC／external URL載入；2h idle。入口／PID／sha見preview_session.json。它同production54654獨立；既有production manifest68/68相符。未主動發出Mic start／stop、改gain、改喇叭、發OSC、record或upload。原Chrome production tab今次未找到，Mic目前狀態未核對；切到背景可能按既有安全機制停Mic，所以唔聲稱收音狀態保持不變。

Requested independent source/programmer/visual reviewer Astra low，實際model identity未確認。最終独立判定見independent_qc.json；新preview唔沿用原run manualQC或413tests作自己PASS。

## 下一步

正式介面可先接獨立腦區mesh／神經骨架視圖；未知共同配準保持禁疊。要有同時顯示嘅可信neuron＋regions，仍需同一可追溯dataset/release/bodyID export或明確registration資料。參考完整外形亦未達標，hemibrain小樣本不能冒充完整雙側全腦。需要更大範圍素材時沿用100MB總量上限，先提出明確scope，不重新糾纏私人自用。
