# VJ Console UI 模式研究：真實軟件介面模式與可借用設計語言

> 研究日期：2026-11-17。所有 claim 帶官方來源 URL；研究員自己嘅設計判斷明確標「設計判斷」。
> 本文檔只係研究筆記，**冇任何軟件功能經過實機驗證**——所有「某軟件有某功能」嘅陳述均来自官方文檔文字，唔代表我哋跑過佢。
> 適用對象：烏蠅VJ console（TypeScript + Vite + Three.js，可能配 Tauri；一人喺黑暗 club 同時操作本 app + Resolume Arena 7.23 + MadMapper，RTX 3070 Ti 8GB）。

---

## 一句結論

呢個 console 應該係一個「**Perform Mode 優先嘅單窗口儀表**」：借 TouchDesigner 嘅 Perform/Designer 雙模式分離（F1 切換、表演模式唔會見到編輯 UI）、Resolume 嘅 Dashboard「只放常用參數一眼睇晒」哲學、同 MadMapper/Resolume 嘅 Learn Mode（進入映射模式→界面變色→撳配對→Esc 離開，全程冇 modal dialog）；3D 腦 viewport 佔主畫面，決策用「n-best 候選列＋一鍵 veto」顯示而唔係彈窗；所有 mapping 表喺一個獨立 Edit tab 改，表演中永远唔會出現阻擋式對話框。

---

## 現有 VJ 軟件介面盤點

| 軟件 | Panel 結構 | 表演中操作策略 | 來源 URL |
|---|---|---|---|
| **Resolume Arena/Avenue** | Clip grid（clips × layers × columns × decks × groups × composition）、Composition/Layer/Clip panel、Monitor（可 duplicate、可揀 monitor 乜：Composition/Preview/Groups/Layers/Crossfader 等）、Dashboard（panel 頂部一排 dial）、Autopilot tab、Clip Time Panel、Notes Panel；panel 可以 hide/drag/undock 去第二個 screen，layout 可以 save 做 XML preset | Keyboard/MIDI/OSC shortcut 系統係核心：「during a live performance, you'll want to have more control than what the mouse can offer」；Composition Bypass（黑屏）做 panic button；Dashboard 哲學＝「你唔需要知道每個 effect 設定，只需要睇住常用嗰幾個」；Notes Panel + Clip Time Panel 官方建議組合做「director monitoring setup」 | Layouts: https://resolume.com/support/en/layouts ・Dashboard: https://resolume.com/support/en/dashboard ・Keyboard: https://resolume.com/support/en/keyboard-shortcuts ・MIDI: https://resolume.com/support/en/midi-shortcuts ・OSC: https://resolume.com/support/en/osc ・Clip Time: https://resolume.com/support/en/clip-time-panel ・Notes: https://resolume.com/support/en/notes-panel ・Undo: https://resolume.com/support/en/undo ・Autopilot: https://resolume.com/support/en/autopilot ・Vocabulary: https://resolume.com/support/en/vocabulary |
| **VDMX6 (VIDVOX)** | 兩個核心 inspector：Workspace Inspector（layers/plugins/video inputs/assets/presets 六個 tab）＋ UI Inspector（contextual，撳邊個 control 就 inspect 邊個）；其餘係用家自己砌嘅 window（可以 tab、可以 snap、可以 lock） | 官方設計哲學原文：兩個 inspector「have been designed to be closed: when you're done using them to define your interface you can hide them, freeing up valuable screen space you can use for your performance interface」；Window > **Lock Windows** 鎖定所有 window 位置防止表演中誤拖；所有 UI item 都可以 MIDI/OSC/DMX remote | https://docs.vidvox.net/vdmx/vdmx_inspectors.html ・手冊目錄: https://docs.vidvox.net/vdmx/ |
| **Synesthesia** | Control Panel 分三個 bank：**Scene Controls**（每個 scene 自己嘅控制項）／**Meta Controls**（全域：Master brightness、Invert、Color、Mirror、Audio Reactivity、Limit Colors、Alpha Channel）／**Media**（overlay/playback/transform/color + folder tabs）；每個 bank 有 Lock/Default/Random/Undo 四鍵 | Bank-level **Lock**（防止誤觸成組 control）；Master brightness 特意唔存入 preset（表演中可以即場調唔會搞壞 saved look）；MIDI/OSC 可以 bind 幾乎任何 control、Fav Slot、playlist action | Controls & Interface: https://app.synesthesia.live/docs/manual/controls.html ・Hotkeys: https://app.synesthesia.live/docs/manual/control_hotkeys.html ・OSC: https://app.synesthesia.live/docs/manual/osc.html |
| **TouchDesigner** | Designer Mode（network editor）vs **Perform Mode**（只 render 一個指定嘅 Window COMP，network editing window 唔開）；F1/Esc 切換；Palette（component library，drag-drop）；可以設定 project 啟動即入 Perform Mode（慳 Designer UI 記憶體） | Perform Mode 就係「表演中唔好低頭睇」嘅制度化答案：表演者只會見到自己砌嘅 control panel，唔會誤觸 network；官方仲有 Full-Screen Exclusive Mode（Windows）避免 Desktop Compositor 引致 stutter | Perform Mode: https://docs.derivative.ca/Perform_Mode ・Palette: https://docs.derivative.ca/Palette |
| **Notch Builder** | Reference > User Interface 分：Nodegraph、Viewport（Navigation/Handles/Overlays/Rendering）、Inspector、Timeline、Resources Panel、Profiler、Log、Scopes、Curve Editor、Launcher；有官方 Keyboard Shortcuts 頁（viewport 導航 Alt+LMB orbit 等） | 有完整 keyboard shortcuts 體系；Project Settings 有「Keyboard Transport/Composition Selection」選項俾 exported standalone app 用 keyboard 做播放 transport 同 composition 切換 | Keyboard Shortcuts: https://manual.notch.one/2026.2/en/docs/reference/user-interface/keyboard-shortcuts/ ・UI Reference 目錄: https://manual.notch.one/2026.2/en/docs/reference/user-interface/ ・Project Settings: https://manual.notch.one/2026.2/en/docs/reference/user-interface/project-settings/ |
| **MadMapper** | 官方描述 UI 三大塊：左側 Media/Projects tab（Media Library、Surfaces list + Surface Inspector、Master Settings）、中央 **Input View**（揀 media 邊部份入 surface，即 UV）＋ **Stage Preview**（surface warp 到投影幾何）、右下 Toolbar & Workspace（Conductor/Timelines）；界面可以成個 collapse | **Control List**（Tools > Control List / Ctrl+L）係所有外部控制嘅中央 hub，按 protocol 分 tab（Keyboard/MIDI/DMX/OSC/Audio/Gamepad/…）；三種 assign 方式：right-click > Add Control、**Learn Mode**（toggle，所有可 map item 按 protocol 變色）、Edit menu；已 assign 嘅 trigger value 會直接顯示喺 UI item 上面；Audio input 可以 map 到 amplitude/bass/medium/treble、bpm、beatCount | Interface Overview: https://docs.madmapper.com/madmapper/6/2.-the-interface/interface-overview/ ・Live Performance & Control: https://docs.madmapper.com/madmapper/6/11.-live-performance-and-control/ |
| **CoGe (Image Tasks)** | 官方站/macOS VJ app；本次研究中官方文檔抓取被擋（HTTP 403 "Missing Authentication Token"），未能核實 panel 結構 | 未能核實 | https://imagetasks.com/ （抓取被擋，未驗證） |
| **Magic Music Visuals** | 官方站被 Cloudflare challenge 擋（HTTP 403），未能核實 | 未能核實 | https://magicmusicvisuals.com/ （抓取被擋，未驗證） |
| **Vuo** | 官方站回 HTTP 406（hosting 商擋），未能核實 | 未能核實 | https://vuo.org/ （抓取被擋，未驗證） |

跨軟件共性（設計判斷，基於上表全部官方文檔）：
1. **「編輯態／表演態」分離**係行業標準：TouchDesigner Perform Mode、VDMX「inspector 設計成可以閂」、Resolume hide panels + layout presets、MadMapper collapse UI。
2. **一切 control 皆可 external mapping**（MIDI/OSC/keyboard），而且有統一嘅 shortcut/learn 管理面板（Resolume Shortcuts panel、MadMapper Control List、Synesthesia MIDI & OSC mapping）。
3. **Monitor/Preview 與 Output 分開**：Resolume 可以 duplicate monitor、揀 monitor 乜、undock 去第二個 screen（https://resolume.com/support/en/layouts）。
4. **Lock 機制**防止表演中誤觸：VDMX Lock Windows、Synesthesia bank/group Lock、MadMapper Lock Surfaces Movement。

---

## 暗環境可讀性硬規則

全部數字引自 W3C WCAG 2.2 官方 Understanding 文檔。

### 對比度（WCAG 2.2 SC 1.4.3 Contrast (Minimum), Level AA）
來源：https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

- 正文 text 同背景對比率 **≥ 4.5:1**。
- **Large text ≥ 3:1**。Large text 官方定義：**18 point（≈24px）或 14 point bold（≈18.5px）**；官方換算 `1pt = 1.333px`。
- 對比率公式 `(L1 + 0.05) / (L2 + 0.05)`，範圍 1:1 到 21:1。
- 4.5:1 嘅理據：補償 20/40 視力（約 80 歲典型视力）嘅對比敏感度損失（3 × 1.5 = 4.5）；AAA（SC 1.4.6）用 **7:1** 對應 20/80 視力。
- 官方 advisory：**避免 red-on-black**（protanopia 用戶對長波長色 against 暗背景特別差）——呢點對暗環境 VJ UI 直接相關。
- 4.499:1 **唔算**過 4.5:1（threshold 唔四捨五入）。

### 非文字對比（SC 1.4.11 Non-text Contrast, Level AA）
來源：https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html

- UI component 嘅視覺識別資訊＋狀態顯示（selected/focused）對相鄰色 **≥ 3:1**。
- 需要理解內容嘅圖形部分同樣 ≥ 3:1。
- 2.999:1 唔算過 3:1。
- Focus indicator 要同相鄰背景有足夠對比（配合 SC 2.4.7 Focus Visible）。

### 字級
- WCAG **冇規定最小 px 字級**——佢用相對定義（large text = 18pt/24px 或 14pt bold/18.5px，見上）同 SC 1.4.4 Resize Text：**text 要可以放大到 200% 而唔損失內容或功能**（https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html）。
- 設計判斷：club 暗環境下，console 正文直接用 ≥18.5px（等同 WCAG large-text bold 門檻，可以食 3:1 而不是 4.5:1），重要狀態數字用 ≥24px。咁樣唔係 WCAG 硬性要求，係我哋喺 WCAG 定義上面揀嘅工作假設。

### Hit target（SC 2.5.8 Target Size (Minimum), Level AA — WCAG 2.2 新增）
來源：https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

- Pointer input target **≥ 24×24 CSS pixels**，或者細 target 之間有足夠 spacing（以 24px 直徑圓放喺 bounding box 中心，圓唔可以同其他 target/圓相交）。
- 更嚴嘅 AAA（SC 2.5.5 Target Size Enhanced）係 **44×44 CSS pixels**（官方 Understanding 2.5.8 頁面明文提及）。
- 設計判斷：一人暗環境操作應該直接以 44px 做目標而唔係 24px 下限；Resolume 類 clip grid 嘅大 button 先至合理。

### 閃爍閾值（SC 2.3.1 Three Flashes or Below Threshold, Level A）
來源：https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html

官方確切數字（下文 flashing 矛盾節會再展開）：
- Web page 唔可以有嘢 **喺任何一秒鐘期間閃多過 3 次**，除非低於 general flash / red flash threshold。
- **General flash** 定義：一對相對亮度（relative luminance）相反變化 **≥ 10%**（maximum relative luminance 1.0 嘅 10%），而較暗狀態嘅 relative luminance **< 0.80**；「一對相反變化」＝升後跌或跌後升。
- **Red flash** 定義（WCAG 2.2 新工作定義，引 ISO 9241-391）：一對相反 transition 之中有一個 transition 係去/離 **R/(R+G+B) ≥ 0.8** 嘅狀態，而且兩狀態喺 **CIE 1976 UCS chromaticity diagram 相差 > 0.2**（unitless；距離 = `SQRT((u'1-u'2)² + (v'1-v'2)²)`）。
- **面積例外**：同時發生嘅閃爍合併面積 **≤ 0.006 steradians**，即任何 **10 度視野嘅 25%**；官方換算成 CSS pixel：以 1024×768 觀看時，10 度視野 ≈ **341 × 256 pixel** 嘅矩形，即閃爍面積 **≤ 87,296 CSS pixels²**。10 度視野取自 central vision（人對光刺激最敏感嘅範圍）。
- **細圖案例外**：white noise 或棋盤格等 fine balanced pattern，方格 **< 0.1 度**（典型觀看距離嘅視野角）邊長，唔違反 threshold。
- 官方註明：**blinking ≠ flashing**——blinking 係 distract 問題（短時間可以，要可停止）；flashing 係 seizure 問題（「cannot be allowed even for a second」，連關都來唔切）；blink 快過每秒 3 次就當 flash 計。
- SDR/HDR 視頻行業定義（引 ITU-R BT.1702）：general flash = 亮度變化 ≥ **20 cd/m²** 而較暗影像 < **160 cd/m²**；HDR 暗態 ≥160 cd/m² 時用 Michelson contrast ≥ **1/17**。
- SC 2.3.2 Three Flashes（AAA）係更嚴嘅「完全唔准 flash」版本（同頁 Next SC 連結：https://www.w3.org/WAI/WCAG22/Understanding/three-flashes.html）。

### 移動/自動更新內容（SC 2.2.2 Pause, Stop, Hide, Level A）
來源：https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html

- 自動開始、**持續超過 5 秒**、同其他內容並排出現嘅 moving/blinking/scrolling 資訊，要有 pause/stop/hide 機制（essential 除外）。
- Auto-updating 資訊（無 5 秒例外）要有 pause/stop/hide **或者控制更新頻率**嘅機制。
- 設計判斷：console 上面嘅即時波形/FFT/腦區活動動畫全部屬於「auto-updating + moving」，要有一個全域「freeze UI 動畫」掣（一個掣管晒所有元素，官方 Note 建議 single mechanism）。

### 動畫（SC 2.3.3 Animation from Interactions, Level AAA）
來源：https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html

- 互動觸發嘅 **motion animation** 要可以 disable，除非 animation 係功能/資訊嘅 essential 部分。
- Motion animation 定義：加入中間步驟製造移動錯覺；**唔包括**純 color/opacity 變化（errata 後 blurring 都唔排除）。
- Vestibular disorder 反應可以嚴重到噁心、偏頭痛、要瞓床休息（官方 Intent 原文）。

### 有冇權威 stage/club UI 色彩編碼標準？
研究結果：**冇搵到** ISO/ANSI/SMPTE 級別嘅「舞台/club UI 色彩編碼」標準。實際可借用嘅權威先例係軟件官方文檔自己嘅 color-coding 約定：
- Resolume Interface Layouts：clip/group/column/deck/layer 可以 right-click 揀色，「This can help you to get better organized」（https://resolume.com/support/en/layouts）。
- MadMapper Learn Mode 按 protocol 分色：Keyboard Learn 藍、MIDI Learn 綠、OSC Learn 黃、DMX Learn 紫（https://docs.madmapper.com/madmapper/6/11.-live-performance-and-control/）；Resolume shortcut mode 亦會「The interface will now change color depending on the protocol」（https://resolume.com/support/en/midi-shortcuts）。
- WCAG SC 1.4.1 Use of Color 原則（1.4.11 頁內引述）：唔可以只用 hue 傳達狀態，要配合亮度差/形狀。
- 設計判斷：烏蠅VJ 應該學呢兩家——(a) 每種控制協議一個專屬色（keyboard/midi/osc），進入 mapping 模式成個界面染嗰隻色；(b) 腦區→clip 映射用用家可揀嘅 label color；(c) 狀態唔止用色，一定配 icon/文字（LOW/MID/HIGH 頻段除了顏色仲要有字形或位置差異）。

---

## VJ 工具嘅 flashing 設計矛盾

**矛盾本質**：呢個 app 嘅存在目的係產生/觸發現場閃爍視覺（VJ output），但 WCAG 2.3.1 明文「flashing content can cause migraines, dizziness, nausea, and seizures」而且「cannot be allowed even for a second」。同時 2.3.1 有 Conformance Requirement 5: Non-Interference——唔合格嘅閃爍內容會干擾成個 web page 嘅可用性（https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html）。

**點樣拆（設計判斷，全部標明）**：

1. **分層：console UI ≠ 演出內容。** WCAG 管嘅係「web page content」。烏蠅VJ console 自身嘅 UI（panel、數字、腦 viewport 嘅 highlight 動畫）必須遵守 2.3.1；而佢透過 OSC 命令 Resolume 輸出到大銀幕嘅視覺，性質上等同「video content」——官方 Intent 明文 flash 可以由「a video clip or animated image of a series of strobe flashes」造成，作者對 display/rendering 無控制、但**對 content 有責任**。所以：本 app 唔應該喺 console 內 preview 大面積 >3Hz 閃爍；大銀幕輸出嘅閃爍風險屬演出內容責任，同 Resolume 播 strobe clip 一樣。
2. **Console 內任何閃爍性狀態反饋用 hard limit。** 決策引擎觸發腦區 highlight 時，如果音樂 onset 密度高（例如 150 BPM 16 分音符 = 10 Hz），腦區 highlight 唔可以 1:1 跟 onset 閃。設計判斷：UI 層 highlight 更新 rate-limit 到 **≤3 次/秒**（官方 Note 4：「no tool is necessary to evaluate for this condition if flashing is less than or equal to 3 flashes in any one second. Content automatically passes」），或者用亮度變化 <10% relative luminance 嘅柔和 glow（低於 general flash 定義嘅 10% 門檻）。
3. **如果真係要 preview 閃爍內容**，用面積例外：閃爍区域限制喺 **< 341×256 CSS px**（87,296 CSS px²，10 度視野嘅 25%）以内，官方認為通過。設計判斷：preview monitor 細窗天然符合，但全螢幕 preview 唔符合——所以「全螢幕 preview strobe」呢個功能應該唔做，或者做咗就要有同 PEAT 類工具一樣嘅警告。
4. **Red flash 特別危險**（官方：「People are even more sensitive to red flashing」）。club 視覺最常用嘅正係飽和紅。設計判斷：UI 層嘅 error/alert 狀態避免用高飽和紅做 on-off 閃爍；用常亮紅 + icon，或者用 R/(R+G+B) < 0.8 嘅橙紅。
5. **提供 kill switch**：2.2.2 要求並行嘅 auto-updating/moving 內容有 pause/stop/hide。設計判斷：console 要有一個全域「UI Motion Freeze」toggle（一個掣 freeze 晒所有 UI 動畫：波形滾動、腦區 pulse、transition），演出內容輸出唔受影響。
6. **測試工具**：官方 Related Resources 列咗 Trace Center **PEAT**（Photosensitive Epilepsy Analysis Tool，https://trace.umd.edu/PEAT/）同 Harding FPA（https://www.hardingfpa.com/）做視頻閃爍合規分析。設計判斷：release 前可以用 PEAT 對 console 錄影做一輪檢查。
7. **誠實聲明**：本 app 係專業演出工具，觀眾唔會直接睇 console；但 club 環境有 photosensitive epilepsy 風險嘅係**觀眾對大銀幕**——呢個風險由演出內容 side 承擔（同所有 VJ 軟件一樣，Resolume 官方 manual 自己都寫「If you're not that big on giving your audience motion sickness with your shakes…」及 keyboard shortcuts 頁「If you're not that big on blinding your audience with epileptic strobing」——https://resolume.com/support/en/keyboard-shortcuts）。烏蠅VJ 嘅決策引擎如果要自動觸發 strobe 類 clip，設計判斷：應該有一個「strobe guard」設定（例如自動模式禁止觸發被標記為 strobe 嘅 clip，或者限制自動觸發頻率），因為 AI 自動決策比人手 VJ 更難對閃爍負責。

---

## prefers-reduced-motion 同呢個工具嘅設計矛盾

官方來源：
- MDN `prefers-reduced-motion`：https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion （Baseline widely available，2020 年起；值 `no-preference`/`reduce`；`@media (prefers-reduced-motion)` 等同 `: reduce`；Windows 11 設定路徑 Settings > Accessibility > Visual Effects > Animation Effects）
- W3C 足夠技術 C39（CSS query）同 SCR40（JS query）：https://www.w3.org/WAI/WCAG22/Techniques/css/C39 ・https://www.w3.org/WAI/WCAG22/Techniques/client-side-script/SCR40（經 SC 2.3.3 Understanding 頁引述：https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html）
- SC 2.3.3 官方 example 明言：「A web application provides a feature to author animated sequences. As part of this tool the author needs to preview the animation」＝**essential animation 允許保留**。

**矛盾**：呢個工具嘅核心視覺（3D 腦 + 音樂反應動畫）本身就係 motion。盲從 `prefers-reduced-motion: reduce` 會令產品失去意義。

**處理（設計判斷）**：
1. `reduce` 時殺嘅係 **UI chrome 動畫**：panel transition、hover scale、數值 count-up、自動相機漂移、scroll 動畫。呢啲全部唔係 essential。
2. **保留**essential motion：腦 viewport 嘅決策 pulse、FFT 波形——但改為可選：`reduce` 時預設降低幅度（例如 pulse 由 scale+opacity 動畫變成純 opacity 淡入，MDN 官方 example 正係用 `pulse` → `dissolve` 呢個手法），並喺 Settings 提供「仍要完整動畫」override。
3. 用 JS（`matchMedia('(prefers-reduced-motion: reduce)')`，SCR40）而唔止 CSS，因為 Three.js render loop 唔食 CSS media query；要監聽 change event 動態切換。
4. 呢個同 WCAG 冇衝突：2.3.3 係 AAA 而且 essential animation 除外；我哋仍然提供 in-app toggle（2.3.3 Sufficient Techniques 嘅「Gx: Allowing users to set a preference that prevents animation」）。

---

## 3D 腦 viewport 嘅介面模式

前提（ADR-0002）：腦係映射載體，幾何必須來自真實 mesh/SWC。以下係可借用嘅真實科學視覺化介面模式。

### neu3d / FlyBrainLab（果蠅腦專用，最直接相關）
- **neu3d**（https://github.com/fruitflybrain/neu3d）：「A javascript 3D visualization engine for neural data in SWC format」。官方 README 定義咗三種可 load 嘅資料：**Mesh**（vertices + faces JSON）、**Neuron**（SWC columns：sample/identifier/x/y/z/r/parent；identifier 1 = soma；亦支援 GLTF neuron mesh）、**Synapse**（.syn CSV：pre/post xyz + radius）。`examples/adult.html`（https://github.com/fruitflybrain/neu3d/blob/master/examples/adult.html）顯示最細用法：一個 `div.vis-3d` 撐滿 window，`new Neu3D(parentDiv, undefined, {globalCenter:{x:0,y:-250,z:0}}, options)`，options 內有 `stats` panel 同 **dat.GUI 設定（autoPlace:false、closed:true、hideable:true）**——即係「debug/設定 GUI 預設收起、可隱藏」，正適合表演工具。API 用 `ffbomesh.addJson({ffbo_json, showAfterLoadAll:true})`。
- **FlyBrainLab**（https://github.com/FlyBrainLab/FlyBrainLab，論文 eLife 2021 https://dx.doi.org/10.7554/eLife.62362）：三大能力＝(i) 3D exploration/visualization of fruit fly brain data、(ii) 從 visualized data 直接建立 executable circuits、(iii) interactive exploration of circuit function。UI 係 JupyterLab 上嘅 NeuroNLP + NeuroGFX 窗口，「positions of the windows can be arbitrarily rearranged」。預設 dataset 包括 **Hemibrain**（https://www.janelia.org/project-team/flyem/hemibrain）。
- **可借模式（設計判斷）**：「查詢→highlight→執行」嘅循環——FlyBrainLab 用自然語言查詢揀 neuron set 再喺 3D view highlight；烏蠅VJ 嘅對應物係「決策引擎揀腦區→viewport highlight→OSC 觸發對應 clip」。viewport 要支援程式化 select/highlight 某組 neuron/region（neu3d 嘅 addJson/showAfterLoadAll 係 batch 級，實際 region-level highlight API 要讀 neu3d 源碼確認——未驗證）。

### Neuroglancer（Google，WebGL volumetric viewer）
來源：https://github.com/google/neuroglancer
- **四 pane 佈局**：3 個正交 cross-section view + 1 個獨立方向嘅 3D view，「All four views maintain the same center position」——即 crosshair 同步。
- 3D view 顯示 selected objects 嘅 mesh；支援 line-segment skeletons（正係 SWC 嘅本體）。
- **Keyboard-first**：完整 binding 表喺 `src/ui/default_input_event_bindings.ts`，viewer 內按 `h` 或右上角 `?` 即場顯示 help——「按一個鍵睇晒所有 shortcut」模式值得抄。
- Layer 互動：click layer name toggle visibility、double-click 開 properties、hover segmentation layer 顯示目前 shown objects 列表 + opacity slider。
- 架構：frontend UI thread 負責 render + user action，backend **WebWorker** 負責 queuing/downloading/preprocessing——「重資料處理搬出 main thread」係官方架構文件明言嘅做法，對烏蠅VJ（audio 分析 + SWC 解析 + render 同一部機）直接適用。
- 需要 WebGL 2.0 + `EXT_color_buffer_float`。

### napari
來源：https://napari.org/stable/ ・https://github.com/napari/napari
- 「fast, interactive, multi-dimensional image viewer」：Qt GUI + **vispy（GPU-based rendering）**；六種 layer type（Image/Labels/Points/Vectors/Shapes/Surface），全部 n-dimensional；**viewer 同 Python kernel 雙向通訊**（console 可以程式化控制 viewer 一切功能）——對應烏蠅VJ「決策引擎程式化驱动 viewport」嘅需求。
- 「You can extend napari using custom shortcuts, key bindings, and mouse functions」——shortcut 係 first-class extension point。

### 3D Slicer
來源：https://slicer.readthedocs.io/en/latest/user_guide/user_interface.html
- **View Cross-Reference**：hold Shift 移動任何 view 嘅 crosshair，所有 slice view 同步 scroll 到同一 RAS 位置——「整體＋局部細節」同步嘅標準答案。
- **Mouse Modes**：Transform（rotate/translate/zoom，default）、Window/Level（拖動調亮度對比）、Place（放 object；default 放一次就自動切返 Transform，可勾 Persistent）——mode 化操作避免誤觸。
- **Data Probe**：module panel 底部常駐顯示滑鼠位置嘅座標/voxel 值/segmentation 名——「hover 即睇細節，唔使開 dialog」。
- 3D View controls：center、maximize/restore、viewpoint direction（L/R/A/P/S/I 六方向一鍵）、view link（多 3D view 同步）、ortho/perspective toggle、spin/rock、**Tilt Lock（Ctrl+b，限制只可以 azimuth 旋轉）**——對果蠅腦呢類有固定解剖方向嘅物件，一鍵標準視角 + tilt lock 好有用。
- 完整 keyboard shortcut 表（generic/slice/3D view 分組），例如 `r` reset zoom、`Keypad 1/3/7/9` 一鍵標準方向。

### 應用到烏蠅VJ 腦 viewport（設計判斷，模式全部有上述來源）
1. **整體＋局部**：主 viewport 顯示成個 hemibrain mesh（低 opacity 外殼）+ 已映射腦區；選中腦區時用 Neuroglancer 式「hover/click layer name」邏輯 highlight，另加一個細嘅 detail pane（Slicer Data Probe 模式）顯示該區 neuron count、映射咗邊個 clip、最近觸發時間。唔好用 modal。
2. **Region 選取/highlight**：napari/FlyBrainLab 模式——選取狀態係程式化 API（決策引擎寫入）+ 人手點擊（viewport raycast）雙向；highlight 用 instanceColor 或 per-vertex color，唔好 clone geometry（見 Three.js 節）。
3. **相機控制**：OrbitControls + 六個一鍵標準視角（Slicer L/R/A/P/S/I 模式）+ Shift+F 式 frame-selected（Notch viewport navigation 有「Move focus & pivot point to selected object」＝Shift+F，https://manual.notch.one/2026.2/en/docs/reference/user-interface/keyboard-shortcuts/）。表演中相機應該可以 lock（自動模式下人手 drag 唔會打斷決策可視化，或者反之——用家揀）。
4. **時間同步**：Neuroglancer「all four views maintain the same center position」模式——如果之後加第二個 pane（例如 FFT strip），用同一個 event bus 同步時間軸而唔係各自動畫。
5. **stats/GUI 收起**：neu3d adult.html 嘅 dat.GUI `closed:true, hideable:true` 模式——診斷 GUI 預設收埋。

---

## AI agent 決策可視化與 human-in-the-loop

### Microsoft HAX Guidelines（18 條，CHI 2019 Honorable Mention）
官方頁：https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/ ・Design Library（18 條全文＋patterns）：https://www.microsoft.com/en-us/haxtoolkit/library/ ・論文 PDF：https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf ・論文頁：https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/

18 條官方標題（Design Library 頁原文）：
- G1 Make clear what the system can do.
- G2 Make clear how well the system can do what it can do.
- G3 Time services based on context.
- G4 Show contextually relevant information.
- G5 Match relevant social norms.
- G6 Mitigate social biases.
- G7 Support efficient invocation.
- G8 Support efficient dismissal.
- G9 Support efficient correction.
- G10 Scope services when in doubt.
- G11 Make clear why the system did what it did.
- G12 Remember recent interactions.
- G13 Learn from user behavior.
- G14 Update and adapt cautiously.
- G15 Encourage granular feedback.
- G16 Convey the consequences of user actions.
- G17 Provide global controls.
- G18 Notify users about changes.

官方組織方式：guidelines 按互動階段分「upon initial interaction / during interaction / when the AI system is wrong / over time」（HAX Design Library 頁原文）。

**對烏蠅VJ 最直接相關嘅几条（設計判斷，guideline 編號同標題係官方原文）**：
- **G2**（how well）→ 決策要顯示置信度/能量證據（LOW/MID/HIGH + RMS + onset 邊個推高咗分數）。
- **G8**（efficient dismissal）→ 候選 clip 建議要可以完全無視、零成本 dismiss——表演中唔可以有任何要求確認嘅彈窗。
- **G9**（efficient correction）→ 一鍵 veto/override：撳一下改触发另一個 candidate，唔使開 menu。
- **G11**（why）→ 每次觸發喺 decision log 留一行「因為 LOW energy > threshold + onset detected → 腦區 X → clip Y」。
- **G12**（remember recent）→ 顯示最近 N 次決策歷史（同時避免短時間內重複觸發同一 clip——Resolume Autopilot「Bag」random 模式就係呢個概念：「will try to play every available clip or column once before reshuffling」，https://resolume.com/support/en/autopilot）。
- **G17**（global controls）→ 一個全域 AUTO/MANUAL/HOLD master switch（等同 Resolume Composition Bypass 做 panic button 嘅哲學，https://resolume.com/support/en/keyboard-shortcuts）。
- **G18**（notify changes）→ mapping 表被改、OSC 斷線要喺 status strip 常駐顯示，唔用彈窗。

### Google PAIR People + AI Guidebook
- Guidebook 主頁：https://pair.withgoogle.com/guidebook/
- **Explainability + Trust** chapter：https://pair.withgoogle.com/chapter/explainability-trust/（PDF：https://pair.withgoogle.com/chapter/People%20+%20AI%20Guidebook%20-%20Explainability%20+%20Trust.pdf）
- **Feedback + Control** chapter：https://pair.withgoogle.com/chapter/feedback-controls/

Explainability + Trust 官方要點（原文摘引）：
- 「Because AI-powered systems are based on probability and uncertainty, the right level of explanation is key」；信任光譜由「No trust」到「Too much trust」，目標係 calibrated trust：「the user should know when to trust the system's predictions and when to apply their own judgement」。
- **Partial explanations**：「intentionally leave out parts of the system's function that are unknown, highly complex, or simply not useful」——唔好試解释晒；「The best explanation is likely a partial one」（Key concept 原文）。
- **Tie explanations to user actions**：「People learn faster when they can see a response to their actions right away」——解釋應該喺用戶動作/系統動作當下顯示。
- **Model confidence displays** 四種官方類型：**Categorical**（High/Medium/Low buckets，要「clearly indicate what action a user should take under each category」）、**N-best alternatives**（「Showing multiple options prompts the user to rely on their own judgement」，特別適合 low-confidence 情況）、**Numeric**（「risky because they presume your users have a good baseline understanding of probability」）、**Data visualizations**（error bars 等，「best understood by expert users」）。
- 官方警告：「if it doesn't make an impact on user decision making, consider not showing it. Counterintuitively, showing more granular confidence can be confusing — what should I do when the system is 85.8% certain vs. 87% certain?」
- **Counterfactuals**：「tell the user why the AI did not make a certain decision or prediction」。

Feedback + Control 官方要點（原文摘引）：
- 「Balance control & automation」：「allow users to adapt the output to their needs, edit it, or turn it off」。
- **Manual failsafe**：「your users will definitely need a manual failsafe, especially in the early days」；「provide a way for users to complete their task the regular, non-automated way」。
- 「Progressively increase automation under user guidance … Automate more when trust is high, or risk of error is low」（Explainability 章 Maintain trust 節）。
- **Editability**：「allow for people to erase or update their previous selections, or reset your ML model to the default」。
- 用戶想保留控制嘅情境包括「The stakes of the situation are high」同「Personal preferences are hard to communicate」（creative vision）——兩條都命中 live performance。

**應用到烏蠅VJ 決策 UI（設計判斷）**：
1. 候選顯示用 **N-best**（PAIR 官方類型）：Column 候選列顯示 top 3-5 candidates，最高分嗰個高亮，用家一鍵可以改揀第 2/3 個。呢個啱表演：低置信時「Showing multiple options prompts the user to rely on their own judgement」。
2. 置信度用 **Categorical 3 級**（HIGH/MED/LOW）而唔係 numeric %——PAIR 明文 numeric「risky」；每級對應清楚行動（HIGH=自動觸發、MED=候選列提示、LOW=只入 log 唔觸發）。呢個對應 HAX G2+G16。
3. Explainability 用 **partial + tied-to-action**：每次觸發喺 brain viewport 上該腦區 flash 一下 + decision ticker 一行字「LOW↑ onset → MB → clip 12」。唔好開 explanation panel 除非用家主動撳（progressive disclosure，PAIR 官方 partial explanations 節提及 progressive disclosures 可以同 partial explanations 併用）。
4. **Override/undo**：HAX G9 + Resolume Undo 哲學。注意 Resolume 官方明文：「any changes you make via MIDI, OSC or another form of external input are not undoable」同「triggering a clip is not an undoable action」（https://resolume.com/support/en/undo）——即係話**觸發咗就觸發咗**，undo 嘅正確語義係「停止當前 + 觸發上一個狀態」而唔係時間倒流。烏蠅VJ 嘅 veto 掣應該係「kill 當前自動觸發嘅 clip（發 bypass/stop OSC）＋暫時 hold 自動決策 N 秒」，唔好假裝可以 undo 已出街嘅畫面。
5. **Global controls**（HAX G17）：AUTO / MANUAL / HOLD 三態 master toggle，常駐、大 hit target、可 MIDI map。HOLD = 冻结當前畫面 + 暫停決策引擎（對應 PAIR manual failsafe）。

---

## 映射表編輯 UI（腦區 → clip/column）

要求：用家可以直接改、唔可以寫死喺 code（ADR-0002）。可借嘅真實軟件 mapping UI：

1. **Resolume MIDI/Keyboard Shortcut mode**（官方：https://resolume.com/support/en/midi-shortcuts ・https://resolume.com/support/en/keyboard-shortcuts）：
   - 流程：Shortcuts menu 揀 protocol →「The interface will now change color depending on the protocol」→ 撳想 assign 嘅 control → 撳 controller button/key → done → Esc 離開。
   - 官方建議原文：「We suggest to use a button that's easy to find on your controller. **Ideally you can find it without looking down.**」——呢句就係「唔望鍵盤」設計嘅權威依據。
   - **Shortcut Target 三種語義**：By Position（按排位，reorder 後 shortcut 跟位）／This Clip（跟實嗰個 clip，delete 咗 shortcut 消失）／Selected（跟当前選中嘅）。官方建議新手全部用 By Position。設計判斷：腦區→clip mapping 應該學「This Clip」語義（mapping 跟 clip 實體/ID 而唔係 grid 位置），因為 Resolume composition 內 clip 会被搬動；但 mapping 表 UI 顯示應該穩定（唔會因為 Resolume 內部 reorder 而亂）。
   - **Shortcuts panel 列表**：所有已 assign shortcut 嘅完整列表，可以 sort by value 搵出 double-assigned（「These will be marked in red」），backspace 刪除。設計判斷：映射表要有同款「衝突檢測 + 紅色標記 + 一鍵刪除」。
   - Preset 係 XML 檔，可 drag-drop 載入——映射表都應該係可 export/import 嘅檔案（JSON）。
2. **MadMapper Learn Mode**（官方：https://docs.madmapper.com/madmapper/6/11.-live-performance-and-control/）：
   - Learn 係 toggle：「detection will remain actively listening for incoming signals until you click Learn again」；激活時「all map-able items will highlight with a specific color based on the selected control protocol」（Keyboard 藍/MIDI 綠/OSC 黃/DMX 紫）。
   - Assign 成功後「the specific trigger value (such as the MIDI note or CC number) will be displayed directly over the UI item」。
   - Control List（Ctrl+L）係中央管理面板，按 protocol 分 tab，有 All tab 睇晒。
   - **Copy OSC Address**：right-click 任何 parameter → copy 正確 OSC address 去 clipboard（因為 address 跟用家改嘅 surface/media 名動態變）。設計判斷：烏蠅VJ 映射表每一行應該有「copy OSC address」功能，方便用家喺 Resolume 側核對。
3. **MadMapper Input View vs Stage Preview 雙 view**（官方：https://docs.madmapper.com/madmapper/6/2.-the-interface/interface-overview/）：「source 邊部份入 surface」（邏輯對應）同「surface 點貼合實物」（物理對應）分開兩個 view。設計判斷：腦區→clip 映射編輯都應該分開「映射表（table/list view）」同「腦 viewport（空間 view）」兩個表示，同一個 mapping 兩種視圖，撳表入一行 = viewport highlight 嗰個腦區，反之亦然（Neuroglancer layer list ↔ 3D view 聯動模式，https://github.com/google/neuroglancer）。
4. **VDMX UI Inspector 模式**（官方：https://docs.vidvox.net/vdmx/vdmx_inspectors.html）：contextual inspector——撳邊個 item 就 inspect 邊個，「it will always be presented to you automatically」，唔使搵。設計判斷：撳腦區 → 右側 inspector 顯示該區嘅 mapping 欄位（target clip/column、觸發條件、confidence threshold、color label），唔好開新 window。

**具體 mapping editor 設計（設計判斷）**：
- 常駐一個「MAP」tab（Edit mode 先見到；Perform mode 收埋——TouchDesigner Perform Mode 哲學）。
- 表格式：每行 = 一個腦區（SWC/mesh region ID + 人名），欄 = Resolume target（deck/column/clip 或 OSC address）、觸發 band（LOW/MID/HIGH/energy/onset）、threshold、veto 狀態。
- Pairing mode：撳「Learn」→ 界面染色（學 MadMapper 按 protocol 分色）→ viewport 撳腦區 → 撳右側 clip slot（或者由 Resolume OSC polling「?」讀返 clip 名，官方 OSC 文檔：send "?" to address 會回覆當前值，https://resolume.com/support/en/osc）→ 配對完成，value 直接顯示喺 item 上。
- 衝突/孤兒檢測（學 Resolume shortcuts list sort-by-value 紅字）：一個 clip 被多個腦區 map、腦區 map 咗去唔存在嘅 OSC address，全部紅色標記。
- 映射表存 JSON 檔（可 diff、可 version、可 drag-drop 載入——Resolume preset 模式）。

---

## 鍵盤／MIDI 控制設計

### Web MIDI API 規範狀態（W3C）
- 規範：https://www.w3.org/TR/webmidi/ ——目前係 **W3C Working Draft（2026-10-31 版）**，由 Audio Working Group 出版；官方 Status 明文「Publication as a Working Draft does not imply endorsement by W3C and its Members… It is inappropriate to cite this document as other than a work in progress」。**唔係 Recommendation**。
- API 係 low-level：「designed to expose the mechanics of MIDI input and output interfaces… without identifying what those actions might mean semantically」；明確支援非音樂用途「show control, lighting and special effects control」。
- **權限模型**：powerful feature "midi"，`navigator.requestMIDIAccess()` 應該 prompt 用家；**sysex 要更強權限**（`{name:"midi", sysex:true}` stronger than without）；Permissions Policy default allowlist `'self'`；要 **secure context**（MDN：https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API 標「Secure context: This feature is available only in secure contexts (HTTPS)」，而且標 **Limited availability / not Baseline**：「does not work in some of the most widely-used browsers」——Safari 等唔支援；Chromium 系支援。Tauri 用 WebView2 (Chromium) 理論上可用，但**未實機驗證**）。
- 規範明言 port `id` 應該跨 reboot 穩定（「SHOULD ensure that the id is maintained across instances… when the system is rebooted」），可以用嚟記住用家揀咗邊個 controller——但「Some systems may not support completely unique persistent identifiers」。
- MDN security 節：permission 可以用 `navigator.permissions.query({name:"midi", sysex:true})` 查。
- 設計判斷：烏蠅VJ 應該 (a) MIDI 設定頁列 devices + 用家揀邊個入邊個出（Resolume MIDI Preferences 模式，https://resolume.com/support/en/midi-shortcuts）；(b) 有 MIDI monitor 顯示所有收發訊息（Resolume 官方 Tip：「Fold out the MIDI monitor… Resolume will show you all the MIDI messages」——debug mapping 嘅關鍵工具）；(c) 唔好依賴 sysex。
- Windows 風險註記：Resolume 官方 troubleshooting 有「MIDI Troubles on Windows 11 with MIDI 2.0 update」（2026 年 2 月 Windows update 引發問題，https://resolume.com/support/en/midi-troubles-on-windows-with-midi-2-0-update）——Windows laptop 上 MIDI 唔保證一帆風順，要有 fallback（keyboard）。

### Resolume MIDI learn 細節（官方：https://resolume.com/support/en/midi-shortcuts）
- Mode 完整清單：**Toggle**（on/off 切換）、**Piano/Momentary**（按住先 on，「on for as long as you hold the key… turn off when you release」；可 Invert）、**Value**（一撳跳到指定值，「great for resetting a parameter to a certain value」）、**Range**（button assign 去 slider 時定義 press/release 兩端值）、**Velocity**（MIDI note 力度驱动值）、CC 專用 **Absolute / Button / Relative / Fake Relative**（無限旋鈕用 Relative，Step Size/Steps/Loop/Invert 可調）。
- **Multiple shortcuts per parameter**：同一參數可以 assign 多個 key/button，各自唔同 Range——官方例子：兩個 key 同一 effect 唔同強度。
- **Shortcut Groups**（radio/dropdown 類）：Direct（一 key 一 state）、Next/Previous/Random cycling、CC cycling。
- **Clip trigger 特殊 grid**：「You can find a special Shortcut Group in front of the clip triggers… you can trigger all the clips in that layer with a single control. Assigning a MIDI CC will let you trigger clip 1 through 128 by sending different values on that same CC. Tip! This works on columns too.」——**一個 CC 值掃晒成個 layer/column 嘅 clip**。設計判斷：烏蠅VJ 決策引擎輸出去 Resolume 應該優先用呢種「一 address + value = clip index」模式，OSC 上等價做法係 `/composition/layers/X/clips/N/transport/position` 或 column trigger address。
- **MIDI Out 回控 pad 燈**：「By changing the velocity value you send to the controller, you change the color of the pad」；Resolume 有 controller lookup tables（APC40Mk2 有 preview swatches）；clip trigger 可以設 **5 個 state 各自顏色**。設計判斷：如果烏蠅VJ 想俾用家嘅 APC/Launchpad 顯示「邊個腦區 active」，就要實作 MIDI Out feedback，學 Resolume 5-state 顏色模型。
- 多 device：Resolume 可以分辨同一訊息來自邊個 device（按偵測順序分 first/second，官方警告順序會變）。

### 「唔望鍵盤」佈局嘅權威建議
- Resolume 官方原文（上文）：「use a button that's easy to find… Ideally you can find it without looking down.」
- 3D Slicer 官方 shortcut 表顯示成熟科學軟件嘅做法（https://slicer.readthedocs.io/en/latest/user_guide/user_interface.html）：**按 view 分組**（slice view shortcuts vs 3D view shortcuts 唔同）、單字母功能鍵（`r` reset、`v` toggle visibility、`b`/`f` 上/下一 slice）、keypad 數字 = 標準視角方向、`Ctrl+b` tilt lock、「view 要先 click 激活先食 shortcut」（「To activate a view, click inside the view」）。
- 設計判斷：烏蠅VJ keyboard 佈局應該 (a) 空間分區：左手區 = 全局（AUTO/MANUAL/HOLD、blackout、undo），右手區 = 候選 1-5 揀擇 + 腦區 preset 視角；(b) 單鍵無 modifier 做高頻動作（表演中搵唔到 Ctrl）；(c) 每個可 map 嘅 UI item 顯示自己嘅 key（MadMapper「trigger value displayed directly over the UI item」模式）；(d) 提供 `?` 一鍵 shortcut overlay（Neuroglancer `h`/`?` 模式）。

---

## Three.js 喺 8GB VRAM 爭用下嘅效能做法

背景：RTX 3070 Ti 8GB 要同時俾 Resolume（官方 recommended spec 係 RTX 4070/16GB RAM，minimum 8GB RAM + Nvidia/AMD card，https://resolume.com/support/en/tech-specs）同 MadMapper 用；烏蠅VJ 自己嘅 Three.js viewport 要慳。以下全部引自 Three.js 官方 docs（repo：https://github.com/mrdoob/three.js，docs 站：https://threejs.org/docs/）。

1. **InstancedMesh 減 draw call**（官方：https://threejs.org/docs/#api/en/objects/InstancedMesh，源文：https://github.com/mrdoob/three.js/blob/dev/docs/pages/InstancedMesh.html.md）：
   - 官方原文：「Use this class if you have to render a large number of objects with the same geometry and material(s) but with different world transformations. The usage of 'InstancedMesh' will help you to reduce the number of draw calls and thus improve the overall rendering performance.」
   - 對 SWC neuron 群：幾千條 neurite segment 用一支 InstancedMesh（cylinder/capsule geometry + per-instance matrix）而唔係幾千個 Mesh。
   - **instanceColor**（InstancedBufferAttribute）：「Represents the color of all instances」——per-neuron/per-region 顏色用 setColorAt 改，改完要 set `instanceColor.needsUpdate = true`；matrix 同理 `instanceMatrix.needsUpdate = true`。**呢個就係腦區 highlight 嘅正確實作法：改 instanceColor，唔好 clone geometry/material。**
   - `dispose()`：「Frees the GPU-related resources allocated by this instance. Call this method whenever this instance is no longer used.」
   - bounding box 唔會自動計（「must be called by your app」），raycast/culling 用嘅 bounding sphere 自動計但 instance 移動後要 recompute。
2. **BufferGeometry**（官方：https://threejs.org/docs/#api/en/core/BufferGeometry）：
   - 定義：「Includes vertex positions, face indices, normals, colors, UVs, and custom attributes within buffers, **reducing the cost of passing all this data to the GPU**」。
   - **indexed geometry**：「Allows for vertices to be re-used across multiple triangles」——hemibrain mesh 用 index buffer 慳 VRAM。
   - `dispose()` 釋放 GPU 資源；morph attribute 渲染後唔可以改，要 dispose 再建新 geometry。
   - `setDrawRange(start, count)` 可以只 render 幾何嘅一部份——LOD 式「遠睇少啲 neuron」可以用呢個做 cheap 版本。
3. **DPR 控制**（官方 WebGLRenderer：https://threejs.org/docs/#api/en/renderers/WebGLRenderer）：
   - `setPixelRatio(value)` / `getPixelRatio()`；`setDrawingBufferSize(width, height, pixelRatio)` 一次過設；`setSize` 會 honor pixel ratio。
   - 設計判斷：Windows laptop 螢幕多數 DPR 1.0–1.5，但高 DPI 時 DPR 2+ 會令 fragment cost ×4。console viewport 應該 cap `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))` 之類（cap 值係設計判斷，官方只提供 API，冇建議值）。
4. **監控 GPU 用量**（官方 WebGLRenderer `.info`）：
   - `info.memory.geometries` / `info.memory.textures`（「The number of active geometries/textures」）、`info.render.calls`（draw calls per frame）、`info.render.triangles/points/lines`。
   - 多 pass 時 `info.autoReset = false` + 手動 `reset()`。
   - 設計判斷：呢啲數字應該直接入 console 嘅 renderer 診斷 panel（draft UI 已有「相機同 renderer 診斷」，用官方 info 做資料源）。
5. **Shader 預編譯避免首幀 stutter**（官方 WebGLRenderer）：
   - `compile(scene, camera)` / **`compileAsync()`**：「makes use of the KHR_parallel_shader_compile WebGL extension. Hence, it is recommended to use this version of compile() whenever possible」，回 Promise「resolves when the given scene can be rendered without unnecessary stalling due to shader compilation」。
   - `initTexture(texture)`：「Useful for preloading a texture rather than waiting until first render (which can cause noticeable lags due to decode and GPU upload overhead)」。
   - 設計判斷：load hemibrain mesh 後、表演開始前，行一次 compileAsync——唔好等第一次 highlight 觸發先 compile shader（會喺表演中 hitch）。
6. **其他官方 renderer 選項**：
   - `powerPreference: 'high-performance'`（WebGLRenderer Options，官方 default `'default'`）——但注意呢部機要同 Resolume 爭 GPU，設計判斷：如果 Tauri/瀏覽器可以揀 dGPU 就用 high-performance；實際行為未驗證。
   - `shadowMap.autoUpdate = false`：官方「If you do not require dynamic lighting / shadows, you may set this to false」——腦 viewport 唔需要動態 shadow，直接關 shadow。
   - `debug.checkShaderErrors`：官方建議 production 可以關咗換效能（「It may be useful to disable this check in production for performance gain」）。
   - `sortObjects`：transparent object 排序用；大量半透明 neurite 時可能要手動控制 render order（官方 Note：「it may be necessary to turn off sorting and use other methods to deal with transparency rendering」）。
7. **Dispose/記憶體管理**：官方 manual 有專章「How to dispose of objects」（https://threejs.org/manual/#how-to-dispose-of-objects；本次研究未能直接抓取該頁全文——threejs.org manual 係 SPA redirect，raw markdown 路徑已改——但 API docs 各 class 嘅 `dispose()` 定義已如上直接引證：InstancedMesh、BufferGeometry、WebGLRenderer 都有官方 dispose() 條目）。原則：Three.js 唔會自動釋放 GPU 資源，geometry/material/texture/render target 用完要手動 dispose。
8. **LOD**：官方有 `LOD` class（https://threejs.org/docs/#api/en/objects/LOD，docs 站 Objects 目錄可證存在）。設計判斷：全 hemibrain（數萬 neuron）應該分 LOD——整體 view 只 render mesh 外殼 + region 級代表，zoom 入先 instance-render 該區 neuron 細節。
9. **架構**：Neuroglancer 官方架構（frontend thread render + WebWorker 做 data preprocessing，https://github.com/google/neuroglancer README「Multi-threaded architecture」節）——烏蠅VJ 嘅 SWC parse、audio FFT、決策引擎都應該放 Web Worker，main thread 只做 render + UI。

---

## 五個具體 UI idea（可直接實作）

### Idea 1：「Perform/Edit 雙態 shell」——F1 一鍵切換嘅兩副面孔
- **一句概念**：成個 app 得一個窗口、兩個佈局態：Edit（全部 panel）同 Perform（淨返腦 viewport + 大掣 + status strip），F1/Esc 切換，Perform 態下所有編輯 UI 唔存在（唔係收埋，係唔 render）。
- **Panel 佈局（Perform 態）**：頂部 100%×56px status strip（AUTO/MANUAL/HOLD 大 toggle｜OSC 連線燈｜FPS｜gain 值｜時間）；左 62% 腦 viewport（全高）；右 38% 分三行：候选 Column 列（n-best 5 個 44px+ 大 button）／三頻 + RMS 橫条（每 band 一行，數字 ≥24px）／decision ticker（單行滾動，最近 1 條決策 + 上 3 條細字）。Edit 態：viewport 縮到左 50%，右側 tab 欄（MAP 表｜Audio｜Devices｜Diagnostics｜Settings）。
- **點解適合一人多軟件表演**：表演中零編輯控件 = 零誤觸可能；狀態一眼睇晒唔使低頭；同 Resolume/MadMapper 並排時窗口窄都够用。
- **借咗邊個**：TouchDesigner Perform Mode（F1/Esc、「the network editing window is not open」、start-in-perform-mode 選項，https://docs.derivative.ca/Perform_Mode）；VDMX「inspectors designed to be closed」+ Lock Windows（https://docs.vidvox.net/vdmx/vdmx_inspectors.html）；Resolume layout presets/hide panels（https://resolume.com/support/en/layouts）。
- **需要嘅新技術能力**：兩套 CSS grid 佈局 + 一個 mode store；Three.js viewport resize 要同 mode 切換联动（setSize + camera aspect）；Tauri 全局 shortcut（F1）註冊。

### Idea 2：「Dashboard rail」——可拖拽嘅常用參數一條 rail
- **一句概念**：Edit 態 viewport 頂部一條可自訂 rail，放 6–10 個大 dial/toggle（analysis gain 0.1–32、monitor toggle、play/pause/restart、profile 切換、Kinect start/stop），用家可以 drag 任何參數上 rail，rail 內容存 preset。
- **Panel 佈局**：rail = 100% 寬 × 72px，格仔式 dial（每個 ≥56×56px），dial 下面細字 label；右端一個「+」喺 Edit 態先出現，撳落列出所有可 drag 嘅參數（search 框）。Perform 態 rail 淨返用家 pin 咗嘅 3–4 個。
- **點解**：draft UI 嘅控制項（選檔/TEST PCM/gain/監聽/Kinect/profile）而家係散佈嘅；表演中真正會摸嘅得 gain、monitor、profile 三樣——其餘收去 Edit。官方 Dashboard 哲學原文：「You don't need to know every setting of every effect. Most are set and forget. But you do want to keep track of the important ones… instant access to them and their values, without having to dig down」。
- **借咗邊個**：Resolume Dashboard（drag parameter 上 dial、dial 改名、一個 dial 可以綁多個參數、preset 存 XML，https://resolume.com/support/en/dashboard）；Synesthesia bank-level Lock/Default/Undo 掣（https://app.synesthesia.live/docs/manual/controls.html）。
- **需要嘅新技術能力**：dial component（pointer drag → 值）；參數 registry（每個可控參數有 id/name/range，先可以 drag）；rail layout 持久化 JSON。

### Idea 3：「Learn Mode 映射配對」——染色介面嘅腦區↔clip pairing
- **一句概念**：喺 MAP tab 撳「Learn」，成個界面染綠色（MIDI）/黃色（OSC），然後：viewport 撳一個腦區 → 右側 slot 列表撳一個 Resolume target（deck/column/clip，列表由 OSC polling「?」自動讀返）→ 配對完成，兩邊都即刻顯示對方嘅名；Esc 離開 Learn。
- **Panel 佈局**：MAP tab = 左 55% 腦 viewport（可撳 region）｜右 45% 兩欄：上欄「Resolume targets」可 scroll 列表（每行 ≥44px：clip 名 + OSC address + copy 掣）；下欄「已映射」表格（腦區｜target｜band｜threshold｜衝突紅標）。Learn 激活時所有可配對元素加 2px 染色 outline。
- **點解**：映射表要「用家可以直接改」；dialog-based 編輯喺暗環境慢且會搶 focus；pairing-by-touch 兩下搞掂。衝突檢測防止表演中途發現兩個腦區指住同一個 clip。
- **借咗邊個**：MadMapper Learn Mode（toggle、protocol 染色、「trigger value displayed directly over the UI item」、Copy OSC Address，https://docs.madmapper.com/madmapper/6/11.-live-performance-and-control/）；Resolume Shortcut mode（界面變色、Esc 離開、shortcuts list 衝突紅色標記、OSC「?」polling 讀值，https://resolume.com/support/en/midi-shortcuts ・https://resolume.com/support/en/osc）；Resolume Shortcut Target 語義（映射跟 clip 實體，https://resolume.com/support/en/keyboard-shortcuts）。
- **需要嘅新技術能力**：OSC client（send + 「?」query + 收回覆）；Three.js raycast → region ID（per-instance 或 per-mesh-group 拾取）；映射表 JSON schema + 衝突 validator。

### Idea 4：「Decision cockpit」——n-best 候選 + veto + ticker
- **一句概念**：決策引擎唔彈窗、唔要求確認：佢把候選寫入右側「Column 候選列」（top-5，最高分高亮 + 置信度色条 HIGH/MED/LOW），自動觸發只喺 HIGH 發生；用家一鍵 veto（撳候選列任何其他一格 = 即刻改觸發嗰個 + hold 自動 8 秒），ticker 常駐顯示每次觸發嘅一行理由。
- **Panel 佈局**：候選列 5 格橫排（每格 ≥88×64px：clip 名 + 腦區 icon + 置信度底色条）；下面 ticker 單行（「LOW 0.82 onset → AL → clip 12 @ 21:03:44」，等寬字體，≥18.5px bold）；ticker 撳一下展開最近 20 條（overlay 由下而上，唔遮 viewport 中心，8 秒無操作自動收）。
- **點解**：一人操作時決策可視化必須係「眼角餘光可读 + 零打斷」；N-best 顯示官方理由：「Showing multiple options prompts the user to rely on their own judgement」；veto 語義跟 Resolume 現實：觸發咗嘅 clip 唔可以 undo，只可以 stop/replace。
- **借咗邊個**：PAIR Explainability + Trust（N-best、Categorical confidence、partial explanation tied to action、「consider not showing」granular confidence，https://pair.withgoogle.com/chapter/explainability-trust/）；PAIR Feedback + Control（manual failsafe、balance control & automation，https://pair.withgoogle.com/chapter/feedback-controls/）；HAX G8/G9/G11/G12/G17（https://www.microsoft.com/en-us/haxtoolkit/library/）；Resolume Undo 限制（external input 同 clip trigger 唔 undoable，https://resolume.com/support/en/undo）；Resolume Notes/Clip Time panel 嘅常駐資訊哲學（https://resolume.com/support/en/clip-time-panel）。
- **需要嘅新技術能力**：決策引擎輸出結構化候選（scores + evidence）；OSC 觸發 Resolume column/clip；hold/cooldown 狀態機。

### Idea 5：「Monitor wall」——可 undock 嘅副屏儀表格
- **一句概念**：Edit 態可以開 2–4 個細 monitor pane（FFT 三頻光譜、OSC traffic log、Kinect 相機 feed、renderer info），每個 pane 可以 undock 做獨立 window 掟去第二個 screen；所有 pane 共享同一個時間軸同 crosshair（撳 viewport 一個腦區，相關 pane 同步 highlight）。
- **Panel 佈局**：Edit 態底部 100%×220px monitor deck，橫排 4 格（每格可 cogwheel 揀 source：Spectrum/OSC Log/Camera/Renderer/Notes）；undock 後主界面留返空格位。monitor 背景可以揀「blocked」或者「fully black」（暗環境）。
- **點解**：一人三軟件時，第二個 screen（如果有）應該放「純狀態」，主 screen 放操作；OSC traffic monitor 係排障 Resolume 連線嘅唯一可靠方法（官方都係咁做：OSC Preferences 有「fold out window to see the last 200 OSC messages」）。
- **借咗邊個**：Resolume multiple monitors（right-click > duplicate、cogwheel 揀 monitor 乜、opacity 模式、undock panel 去其他 screen，https://resolume.com/support/en/layouts）；Resolume OSC message monitor（https://resolume.com/support/en/osc）；Resolume MIDI monitor（https://resolume.com/support/en/midi-shortcuts）；Neuroglancer 四 pane 同步 crosshair（「All four views maintain the same center position」，https://github.com/google/neuroglancer）；3D Slicer View Cross-Reference（https://slicer.readthedocs.io/en/latest/user_guide/user_interface.html）。
- **需要嘅新技術能力**：Tauri 多窗口（WebviewWindow）+ 窗口間狀態同步（event bus）；WebGL 第二 context 或者用同一 renderer 多 viewport（`setViewport`/`setScissor`，官方 WebGLRenderer API 有）——設計判斷：同一 renderer 多 viewport 慳 VRAM，undock 窗口先至用第二 context。

---

## 未解決／要問用戶嘅問題

1. **有冇第二個 screen？** Idea 5（Monitor wall）嘅價值完全取決於現場有冇副屏。得一部 laptop 屏嘅話，副屏 monitor 要改為「overlay 模式」。
2. **MIDI controller 型號？** 有冇 APC/Launchpad 類 pad controller 決定咗要不要做 MIDI Out pad-燈 feedback（Resolume 5-state 顏色模型）同 Web MIDI vs Tauri/Rust MIDI（例如 midir）嘅路線選擇。Web MIDI 係 Working Draft + 需要 secure context + 瀏覽器支援唔齊（MDN "Limited availability"），Tauri WebView2 未實測。
3. **自動觸發嘅安全邊界**：決策引擎喺 HIGH confidence 自動發 OSC 觸發 clip——需唔需要「strobe guard」（禁止自動觸發被標記為高閃爍嘅 clip）？呢個係 WCAG 2.3.1 風險嘅產品決策，唔係純技術問題（見 flashing 矛盾節第 7 點）。
4. **Resolume composition 結構邊個話事**：映射表 target 係「column 號」定「clip 名/OSC address」？Resolume Shortcut Target 三種語義（By Position/This/Selected）提示咗 target 可以跟位或者跟實體；OSC address 係跟 composition 結構（`/composition/layers/N/clips/M/...`），Resolume 側改 layout 會令 position-based 映射失效。要問用家佢嘅 Resolume set 會唔會場場改。
5. **neu3d 用唔用？** 直接嵌 neu3d（npm, Three.js-based SWC engine，官方 README 有 ES6/TypeScript import 用法）定係自己寫 SWC/mesh loader + InstancedMesh renderer？neu3d 有现成嘅果蠅腦資料格式支援（mesh JSON/SWC/.syn），但佢嘅 region-level highlight/selection API 有冇符合需求要讀源碼確認（本次未驗證）。
6. **CoGe / Magic Music Visuals / Vuo 文檔未能核實**：三家官方站分別被 403/Cloudflare/406 擋。如果用戶想要呢三家嘅 panel 結構入盤點表，要另行人工查（例如本機裝咗嘅話睇 UI，或者用其他網絡環境抓）。
7. **reduced-motion 嘅產品立場**：跟設計判斷嘅分層方案（殺 UI 動畫、留 essential 腦動畫 + in-app override），定係更激進（`reduce` 時腦 viewport 都靜止、只更新數字）？
8. **字級基準**：本文建議正文 ≥18.5px bold（食 WCAG large-text 3:1 門檻）——用戶部 laptop 屏呎數/观看距離未知，可能要更大。呢個係設計判斷唔係規範要求。

---

## 引用完整性說明

- 本文所有 WCAG 數字引自 W3C 官方 Understanding 文檔（每節帶 URL，抓取日期 2026-11-17，頁面自身標註更新日期見各頁 footer）。
- HAX 18 條 guideline 編號同標題引自 Microsoft HAX Toolkit Design Library 官方頁；原文定義可再查 CHI 2019 論文 PDF（URL 見上）。
- PAIR 引文全部出自官方 chapter 頁原文。
- 軟件功能描述全部出自各軟件官方 support/manual/docs 頁或官方 GitHub README；**冇一項經過實機驗證**。
- Three.js 引文出自官方 docs（threejs.org/docs 對應嘅 GitHub markdown 源文件，dev branch，2026-11-17 抓取）。
- 抓取失敗來源已明確標註：CoGe（imagetasks.com 403）、Magic Music Visuals（403 Cloudflare）、Vuo（406）、FlyBrainLab eLife 論文頁（client challenge）、threejs.org manual「How to dispose of objects」全文（SPA redirect，只引 API docs dispose() 條目）。
