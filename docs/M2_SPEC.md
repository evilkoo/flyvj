# M2 規格：本機真實小樣本 3D 控制台

## 1｜Goal／完成線

2026-10-02 用戶要求 set goal 到 M2，沿用「同範圍做到尾段、QC 後交付；重大決定先問」工作模式。本機之前無 M2_SPEC，呢份定義今次 M2，唔冒認有舊版已批准嘅 M2 詳細規格。
已核對 M1 checkpoint 26/26 hashes；92 tests／0 skip 係 M1 既有記錄，唔當成今次 M2 測試。Goal 只有完成以下全部驗收才可 complete。

## 2｜範圍／可逆工程方法

- 沿用 M1 6 個真實 string neuron IDs、native nm marked points、3 條 selected-neuropil measured connections；來源仍用原嚴格 offline verification，冇新下載。
- 本機 self-contained HTML/CSS/JavaScript、native WebGL 小樣本 renderer，Python 3.11 standard-library export／驗收；冇 npm/pip 安裝。既有 M0/M1 code 同 immutable run 不改。呢個係可逆 prototype 實作，唔鎖死最終 full-brain viewer。
- Rotate／Zoom／Reset camera、滑鼠點選／鍵盤 ID selector、按 ID 顯示原生座標同 region/weight 語意；render-order 反轉仍對。冇生成腦殼／假 morphology。
- 起始 paused；Play／Pause／Reset mock timeline、energy／speed 控制，顯示明確 mock activity。Column 1/2/3 只做既有 M0 energy 規則 dry-run，OSC-looking address 標未核實；永不發送。點神經只查看，唔觸發 Column。
- Desktop／窄 viewport 功能同可讀性；無 WebGL／context lost 要顯示明確錯誤並保留資料面板，唔冒認 fallback 係成功 3D。

## 3｜固定 UI payload contract／layout

Export JSON：schema_version=1、scope=M2_OFFLINE_POINT_GRAPH、dataset（原 M1 v1 payload）、dataset_fingerprint、source_check（原 offline verifier result）、render_order（所有 string IDs，預設反轉）、rule_examples（M0 真跑 energy boundary decisions）。嵌入 application/json，escape < > & 及 Unicode line separators；metadata 只用 textContent。UI 冇任意資料 import、fetch、WebSocket、Mic、OSC sender 或 external assets。

Layout：上方清楚顯示「真實 point sample／mock activity／OSC OFF」；左大 viewport／右 mock 控制及 selection；下方 ID／原始座標同 measured links。Dark charcoal＋warm lime activity＋cyan selection，用本機 system fonts。除 mock activity 同相機互動，冇裝飾循環 animation；paused 不推進 mock time。Normalization 只做 render centering＋uniform scale；原 native nm 座標保留，唔稱 anatomical transform。原始近鄰點可以重疊，ID selector 用於逐一查閱，唔移動真座標去令畫面好睇。

## 4｜測試／獨立 QC

1. TDD：Python source gate/export/escaping/no-clobber／runner 測試，Node built-in tests 檢查 ID 對應、rule boundaries、控制 invalid 值、camera math／picking／order invariance。
2. 一條 PowerShell build/verify 入口，每次新 run；test count=0、skip、nonzero exit 或 source gate failure 必須 BLOCKED，不繼承 M1 manual QC。Python artifact 要同實際 unittest count 及 OK 結果一致；Node 明確用 TAP。
3. M0/M1 tests 及既有 Verify／real VerifyData 回歸；sample/proof/原始證據不可修改。
4. 實際 browser 測 Rotate／Zoom／selection／play/pause/reset／energy／窄 viewport／WebGL error lifecycle，保存正常 viewport 截圖。Requested 390px viewport 包括 scrollbar，document clientWidth 可係375px；唔將 scrollbar 差值當 overflow。
5. 獨立 programmer＋visual director screen-cap QC，主管整合；run/artifact hashes 留證。未全部完成唔 complete goal。工具 diagnostic 保留，唔當成 product 全面失敗或 driver 全PASS。

## 5｜安全／唔係今次完成聲稱

Private self-use 已定，唔再問商用。唔讀 Mic/Internal／接 Resolume／發真 OSC／安裝／登入／下載／外傳／git commit push。唔係全腦、soma、完整 morphology、生物 firing、LIF、genre/BPM、音樂理解或 Spout。GPU／RTX4090／3070Ti／4K60fps 未實測；唔將 browser 能跑當硬件效能通過。新外部操作／重大架構取捨才停，普通同範圍 debug 不逐步問。

原生無 WebGL 硬件情況未強制實測；實際 context loss／restore 有獨立 browser 證據。HTML 係 self-contained，但 file-origin 手動 double-click 操作未由今次 browser tool 驗證；正式 screen-cap 用 loopback-only preview。以上限制必須保留喺交付。
