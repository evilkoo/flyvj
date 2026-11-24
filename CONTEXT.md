# 烏蠅 VJ / FlyVJ

一個喺表演機上獨立運行嘅 VJ 決策工具：聽現場音樂，決定播邊個影像，經 OSC 控制 Resolume Arena，並用果蠅腦形態做決策儀表。呢份檔只係 glossary，唔係 spec。

## Language

### 產品與驗收

**落地使用（Shippable）**:
完成嘅唯一標準：一場真實 VJ set 入面，音樂輸入 → 腦視覺反應 → OSC 實際令 Resolume 換 clip，全程冇人手 fallback。外形達標只係其中一個條件，唔係目標本身。
_Avoid_: 完成、M3 complete、goal complete

**表演機（Performance Machine）**:
跑晒成個 set 嘅單一 Windows 11 laptop（RTX 3070 Ti，8GB VRAM；system RAM 待確認）。同一部機同時跑 Resolume Arena 7.23（影像輸出）、GarageCube MadMapper＋MadLaser（laser 輸出）同呢個工具，三個都食 GPU。Laser DAC 係 USB/Ethernet 類（非 AVB/Dante，已確認冇 ASIO 衝突）。用戶表演中要親手操作前兩者。已知：Resolume 7.23 喺 Optimus laptop 要手動 enable Nvidia profile，否則 FPS drop。
_Avoid_: 本機、localhost（指網絡位置時先用 localhost）

**開發機（Dev Machine）**:
RTX 4090 desktop／128GB RAM／Windows 10 Pro，開發、tagging、build 都喺呢度做。**已裝 Resolume Arena 7.23.2（同表演機同版）＋Resolume Alley**，所以 WebSocket bridge 驗證可以直接喺呢度做。佢嘅效能唔代表表演機；任何 FPS／VRAM 結論必須喺表演機另行驗證。
_Avoid_: 4090 機、本機

**共存約束（Coexistence Constraint）**:
呢個 app 唔可以搶 focus、唔可以獨佔 input／GPU／audio 裝置、唔可以阻塞或延遲用戶操作 Resolume 與 MadMapper。呢個係硬性界線，唔係效能優化目標。已核實嘅具體禁令見「禁用 API 清單」。
_Avoid_: 輕量、後台運行

**禁用 API 清單（Forbidden APIs）**:
已從 Microsoft Learn 官方核實、呢個 app 永遠唔可以用嘅 Windows API：`SetWindowsHookEx(WH_KEYBOARD_LL)`、`SetForegroundWindow`、`RegisterRawInputDevices` 配 `RIDEV_INPUTSINK`／`RIDEV_CAPTUREMOUSE`、WASAPI `AUDCLNT_SHAREMODE_EXCLUSIVE`、DXGI `SetFullscreenState(TRUE)`、舊 WinMM `midiInOpen`／`midiOutOpen`（一台 MIDI device 一個 client，會撞 MadMapper／Resolume）。音訊只可以用 WASAPI shared mode（即 browser getUserMedia 預設行為）。
_Avoid_: 全域 hotkey、exclusive audio、fullscreen exclusive

**VRAM 預算（VRAM Budget）**:
8GB VRAM 由四個 consumer 瓜分：DWM ~0.5–1GB、Resolume ~1.5–3GB、MadMapper ~0.5–1.5GB、本工具 **~0.3–1GB（上限）**。超出會 spill 去 system RAM（WDDM 2.0 GPU virtual memory，係性能懸崖而唔係 crash）。實作約束：WebGL canvas ≤1280×720、嚴格控 texture 用量、Three.js 資源必須 dispose。呢啲係推算，必須喺表演機實測。
_Avoid_: 全螢幕 canvas、無上限 texture

### 決策

**決策引擎（Decision Engine）**:
由音訊特徵產出「落一個 clip 決定」嘅元件。職責係喺 Region Mapping 上面行，輸出候選＋置信度俾用戶 override。唔係 20ms 級：per-beat 已有 25 倍時間餘裕，而結構事件本身間隔以秒計。
_Avoid_: AI agent（除非明確指 LLM agent）、大腦模型、Jev（Jev 係雲端 API，未採用）

**果蠅 VJ 角色（Fly VJ Avatar）**:
第一版 3D viewport 嘅主角：一名做 VJ 嘅 3D 果蠅角色。音樂輸入驅動佢嘅可見反應，佢嘅決定經 Column trigger 反映到 Resolume。「見到音樂令呢名 VJ 有反應輸出」係核心驗收畫面。模型科學真實度要求未定（見 ADR 0006）。
_Avoid_: 大腦儀表（已降級為可選）、brain viewport

**果蠅腦模型（Fly Brain Model）**:
真實公開形態資料：hemibrain ROI mesh 與 SWC skeleton。第一版**已降級為可選次要視圖**（ADR 0006），唔再係必經畫面。若使用：職責係決策儀表＋映射載體，幾何真但決策數學唔由神經動態做。真正 connectome 動態模擬保留做之後實驗。
_Avoid_: 全腦、connectome 模擬、真 firing（第一版）

**腦區映射（Region Mapping）**:
把腦區／神經節點人為對應到 Resolume clip／Column／effect 嘅對映表。係用戶可調嘅 taste，唔係科學結論；亦係第一版決策引擎實際行喺上面嘅結構。
_Avoid_: 解剖配準、neuropil mapping、registration

**結構事件（Structure Event）**:
EDM／House／Techno 入面嘅音樂結構轉折點：build-up、drop、breakdown、歌與歌之間嘅交接。呢啲先係決策嘅真正觸發器 — 佢哋唔跟固定時間格，要靠聽音樂 judge。clip 切換綁喺呢度，唔綁喺 bar。
_Avoid_: bar/phrase 計時、linear timing、固定小節策略

**結構偵測法（Structure Detection Method）**:
已核實：冇任何 ready-made streaming drop detector 有公開準確率證據（EDMFormer 等 EDM 專門模型全部 offline，作者自己列 real-time 為 future work；用流行曲模型偵 drop 實證失敗，zero-shot ACC 僅 0.148）。第一版慢層因此係**純 DSP streaming heuristic**：LOW 能量瞬間回升＋energy novelty peak＝drop、bass cut＋riser＋onset density 加速＝build-up，加 coarse tempo 估算（TS 內 onset envelope autocorrelation）snap 到 8/16-bar grid（一手證據：EDM cue 天然對齐 phrasing）；信心低就 HOLD，永遠有手動 override。唔引入 Python 模型（ADR 0007；BeatNet README 自己警告 mic 收音要夠 loud，同 laptop mic 現實衝突）。
_Avoid_: 宣稱已驗證準確率、offline 模型硬改 streaming、流行曲結構模型

**AGC 對策（AGC Handling）**:
程式可以**請求**關閉 mic 嘅自動增益／降噪（getUserMedia `autoGainControl:false` 等 constraints，W3C＋MDN 證實，limited availability），但**唔保證生效**；每次啟動要 call `getSettings()` 將實際狀態顯示喺 UI。laptop 內置 mic 可能有 firmware DSP 繞唔到。呢個係三頻能量可信度嘅已知天花板，唔係 bug。
_Avoid_: 假設 AGC 已關閉

**兩層決策（Two-Layer Decision）**:
慢層＝偵測結構事件，決定換邊個 clip（節奏係 per-event，唔係 per-frame）。快層＝連續跟音樂嘅 effect parameter（opacity／scale／blur，per-frame）。兩層延遲預算同失敗後果完全唔同，唔可以混為一談。
_Avoid_: 統一 tick、单一決策頻率

**Column 規則（Column Rule）**:
Energy 閾值映射到 Resolume Column 候選嘅人為規則（≤0.02 HOLD、<0.4 Column1、<0.75 Column2、其餘 Column3）。保留自舊 draft，屬可調 taste，唔係科學結論。
_Avoid_: 分類、genre mapping

**三頻分組（Three-Band Split）**:
LOW 30–180Hz、MID 180–2500Hz、HIGH 2500–min(8000, Nyquist)Hz。人為映射，唔等於音樂類型或解剖分區。
_Avoid_: 頻段分類、neuropil mapping

**三頻身體映射（Band-Body Mapping）**:
第一版已收嘅 avatar 反應默認值：LOW（30–180Hz）→ 身體／腳（kick 一下 tap 一下）；MID（180–2500Hz）→ 觸鬚／頭；HIGH（2500–8000Hz）→ 翅（hi-hat 震翅）；結構事件（drop）→ 全身大動作＋UI 顯示佢「撳咗」邊個 Column。屬可調 taste，之後全部可喺映射表改，唔係科學結論。
_Avoid_: 生物反射、真 firing

**單屏佈局（Single-Screen Layout）**:
第一版驗收形態：表演機得 laptop 一個屏（Q28-A），Resolume output 去投影／LED，app UI 睇 laptop 屏。佈局以 3D avatar viewport 為主＋側邊 decision cockpit。副屏「monitor wall 可 undock」係之後選項，第一版唔做。
_Avoid_: 雙屏驗收、undock 副屏

**Bridge 驗證 Grid（Dummy Grid）**:
里程碑 1 喺開發機（已裝 Resolume Arena 7.23.2，同表演機同版；已批准啟動）用 Resolume Alley 官方 free footage 排 3 layer × 3 column dummy composition 做 WebSocket trigger 驗證。用戶嗰 9 條真 clip 之後先入，正式 clip 庫路徑仍待補（Q21）。
_Avoid_: 真素材驗證（第一輪）
LOW 30–180Hz、MID 180–2500Hz、HIGH 2500–min(8000, Nyquist)Hz。人為映射，唔等於音樂類型或解剖分區。
_Avoid_: 頻段分類、neuropil mapping

### 輸入與素材

**音訊輸入（Audio Input）**:
表演時主要靠 laptop 內置 mic 收音（無 external audio interface、無 line input）。已知風險：Windows mic AGC／noise suppression 會污染三頻能量，環境噪音差。Azure Kinect 只係屋企收音裝置，唔係表演標準配置，降級為家用測試工具。
_Avoid_: Kinect mic（表演语境）、line input

**Clip 庫（Clip Library）**:
用戶手上嘅大量影像 clip，未 tag、未分類、未排入 Resolume composition。**呢個係落地嘅 critical path**，優先級高於決策引擎：冇排好嘅庫，Region Mapping 無嘢可映、OSC 冇地址可發。已定分類軸見「九格分類」。
_Avoid_: 素材庫（未定稿前）

**九格分類（Nine-Cell Grid）**:
已定嘅 clip 分類軸：**3 個能量級（LOW-dominant／MID-dominant／HIGH-dominant）× 3 個運動級（靜／中／動）**，合共 9 格，每格目標 5–15 個 clip。呢個大細係一個人現場掃得完、同時自動 tagging 建議得郁嘅規模。沿用既有三頻語言，唔另立新分類體系。
_Avoid_: 幾十個 tag、genre-based 分類

**Resolume Composition（3 Layer × Column Grid）**:
第一版固定 3 個 layer（LOW／MID／HIGH），clip 排成 3 layer × N column 嘅 grid。**觸發契約已定（Q20-B）：Column 全換** — trigger 一欄 = 三 layer 嗰格 clip 一齊觸發（Resolume 官方語義，`/composition/columns/N/connect`）。14 個腦區 ROI 唔綁 layer。第一輪測試用 9 條 clip。
_Avoid_: per-layer 觸發（已否決）、14 layer

**自動 Tagging 工序（Tagging Pipeline）**:
全本地腳本抽每個 clip 嘅視覺特徵（光暗、運動量、色相）→ 自動建議九格位置 → 用戶只做覆核。唔上傳素材、唔用雲端視覺 API。
_Avoid_: 手動 tag、AI 雲端分類

**Laser 同步（Laser Sync）**:
明確唔做：laser 由用戶親手控 MadMapper，呢個 app 唔同步 laser、唔發指令俾 MadMapper。
_Avoid_: 統一 clock、laser 联动

### 資料與來源

**形態資產（Morphology Assets）**:
已下載並 hash 驗證嘅 18 份公開檔：14 hemibrain ROI mesh、1 SWC skeleton、2 README、1 LICENSE。保留。**授權注意**：底層 hemibrain 數據係 CC-BY 4.0，但 neu3d repo 嘅 GitHub license 欄係 null — mesh 檔本身嘅散布授權未確認（2026-11-17 research 核實）。私人自用冇影響；如果之後商業發布要先核實。
_Avoid_: 腦資料、神經資料

**FlyWire 樣本（FlyWire Sample）**:
FAFB783 公開匯出嘅 6 個 marked points／3 條 measured edges。保留。樣本點數唔等於神經數量。**授權已核實：FlyWire FAFB783 公開 release 係 CC-BY-NC 4.0（非商業）**（flywire.ai/guidelines 官方）。本項目定位私人自用所以冇影響；任何商業用途（包括收費表演中散布／展示呢啲資產）都係授權風險，到時要換來源或取得授權。
_Avoid_: 全腦資料、真實 connectome

**昆蟲腦啟發架構（Insect-Brain-Inspired Architecture）**:
慢層決策嘅未來升級路徑（第一版唔做）：mushroom body 式 sparse coding（random projection → sparse winner-take-all）＋ central complex 式 ring attractor action selection。有一手理論來源（Science 2017 果蠅嗅覺迴路=LSH 變體、PNAS 2018、Neuron 2017）＋開源實作；純 CPU 推算 <1ms/step，8GB VRAM 機可行。同「真 connectome 模擬」唔同 — 後者已核實冇 ≥30Hz consumer hardware 公開證據（最好嘅 peer-reviewed 全腦模型慢 ~300 倍）。
_Avoid_: connectome 模擬、真 firing

**配準未確認（Registration Unverified）**:
形態資產之間嘅共同 units／bodyID／release／registration 未證實。因此模型 view 必須分開顯示，唔可以疊加。
_Avoid_: 已對齊、可合併

### 捨棄

**舊 code 骨架（Legacy Scaffold）**:
M0–M3C 嘅 runner／test scaffolding、手寫 Python server、現有 UI（`app.js`／`index.html`）。已決定捨棄，唔再修復，包括 M3C 那個 context-loss FAIL test。
_Avoid_: 現有實作、M3C 進度

**舊 QC 儀式（Legacy QC Ritual）**:
每個 milestone 產生 immutable run ID、manifest hash、大量 screen-cap 證據檔嘅流程。已決定捨棄，改為快速迭代。
_Avoid_: 驗收流程
