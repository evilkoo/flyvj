# Resolume Arena 7.x 原生自動化／音訊反應能力 vs 外部自研工具嘅價值缺口

研究日期：2026-11-17（所有官方頁面當日抓取）
研究員：DSH subagent（文檔研究，**冇做任何實機驗證**）
用戶環境：Resolume Arena 7.23、Windows、RTX 3070 Ti 8GB（VRAM）laptop
方法：全部用 resolume.com 官方 support／manual／blog／官方 OSC list 一手來源。每項 claim 帶 URL。冇來源嘅標「未證實」或「判斷」。

---

## 一句結論

Resolume 原生已經做到「**參數層面**嘅音訊反應」（FFT 驅動任何 parameter，可揀低／中／高頻段，有 Gain/Fall 同 envelope 修形）同「**時間／拍子層面**嘅自動選片」（Autopilot：按秒數、beat 數、clip 長度、random／Bag 洗牌自動 trigger 下一個 clip／column），但官方文檔**完全冇**「用音訊內容（能量／onset／genre）決定 trigger 邊個 clip」呢個功能，亦冇「live 音訊自動偵測 BPM」（只有手動 tap、MIDI Clock、Ableton Link、同 Denon／Pioneer DJ 機直連）；所以外部工具嘅真實價值缺口係「**audio-aware 嘅選片決策層**」——聽音樂、分析、解釋點解揀呢個 clip、再經 OSC/WebSocket 落命令——而唔係再做一次參數動畫或者隨機自動播放。

---

## Resolume 原生音訊反應能力

### 1. Parameter Animation（音訊反應嘅核心）

來源：https://resolume.com/support/en/parameter-animation （有 **v 7.23** 版本 tab，即係用戶版本嘅官方文檔）

官方確認嘅事實：

- **Per-parameter audio analysis（FFT）**：任何 parameter 都可以用 cogwheel 選 Audio Analysis 做驅動源。有四種 FFT 來源：
  - **External FFT**：用 Preferences > Audio 指定嘅音訊輸入裝置（DJ mixer feed、樂團、外置 mic）。要先揀 Audio Input device，再揀 channel（官方特別強調呢兩步分開做，好多人漏咗第二步）。
  - **Composition FFT**：composition 入面播放緊嘅所有音訊。
  - **Clip/Layer/Group FFT**：對應層級播放緊嘅音訊。（Group FFT for clip/layer 係 7.28 先加，見 https://resolume.com/blog/34630 ——7.23 用戶冇呢項。）
- **頻段控制**：L／M／H 按鈕揀低中高頻，加上 spectrum 顯示下面嘅 in/out points 可以更細粒度揀頻率範圍。
- **Smoothing／動態**：**Gain**（boost 訊號）同 **Fall**（peak 之後跌落嘅速度）——即係原生已有 attack/decay 式 smoothing。
- **Envelope**：所有 animation（包括 FFT 驅動）都可以加 envelope；envelope 作用喺 parameter 嘅輸入，官方明言「will modify a parameter set to Timeline or BPM Sync, but also FFT and mouse input, even parameters controlled via MIDI or OSC」，有 Quadratic/Sine/Circular/Exponential/Elastic/Back/Bounce/Hold 等 curve，可多 keyframe。來源：https://resolume.com/support/en/envelopes
- **唔止 slider**：Toggle、Event、Dropdown、Color Palette 全部可以 animate；palette 可以用 FFT 驅動加 Color Interpolation（官方原文：「Set the palette to FFT input, enable Color Interpolation … get ready to puke rainbows」）。Effect 嘅 Bypass 按鈕都可以 animated（「turn an effect on and off to the beat」，https://resolume.com/support/en/effects ）。
- **Start Settings**：parameter animation 可以設成 composition load／clip trigger／column trigger 先開始，或者手動開始。BPM Sync animation 可以解除 phase lock。
- **Presets**：parameter animation 設定可以存 preset——呢個係 **7.23 新加**嘅功能（官方 7.23 release blog：https://resolume.com/blog/30807 ）。
- 其他驅動源：Timeline（秒）、BPM Sync（beat）、Clip Position（跟 playhead）、Crossfader Phase、Dashboard。
- 7.29 先有嘅改進（Lin/Log/Mel 三種 FFT filter、Spectral Flux/Centroid/Flatness 等 Wire 節點）：https://resolume.com/blog/34693 ——**7.23 用戶冇呢啲**，佢哋嘅 FFT 係舊版。

**關鍵限制（官方文檔明確顯示）**：FFT/Audio Analysis 只能夠**驅動 parameter 數值**。整份 Parameter Animation 文檔同 OSC list 都冇「audio energy 高就 trigger 某個 clip」呢類功能。Clip triggering 嘅自動化只有 Autopilot（見下）、Shortcut（MIDI/keyboard/OSC/DMX）、Beat Snap（quantize 觸發時機，https://resolume.com/support/en/clips ）同 DJ sync。

### 2. BPM

來源：https://resolume.com/support/en/bpm （v 6 tab）

- 設定 BPM 嘅官方方法：**直接輸入數值**、**Tap**（跟住音樂拍）、**Resync**（喺 phrase 第一個 beat 撳，令所有 BPM Sync 嘢跳返去 first beat of first bar of first phrase）、**Nudge Up/Down**（暫時加速減速追拍）。官方教嘅校準方法係睇藍格仔喺每 16 beat 嘅 outline 提示，逐步微調——即係**人手 beatmatch 流程**。
- 自動來源：**MIDI Clock**（https://resolume.com/support/en/midi-shortcuts #midi-clock；官方警告「MIDI Clock was great in 1996. It's notoriously wavy and not really accurate」）同 **Ableton Link**（https://resolume.com/support/en/link ；自動 join session、BPM 同 bar position 雙向 sync；用 Link 時 Resync/Pause 會被 disabled）。
- **官方 BPM 文檔冇任何「從 live 音訊輸入自動偵測 BPM」嘅功能**（唔識自己聽 mic/line-in 度 BPM）。呢個係「官方文檔明確冇寫」級別嘅結論。
- 補充：clip properties 有「default BPM」（https://resolume.com/support/en/clips #clip-properties），而 7.26 fix list 有「Crash simultaneously **analysing** new audio files」（https://resolume.com/blog/34484 ）——顯示 Resolume 會喺 **import 時**分析檔案嘅 BPM。即係「檔案內容 BPM 會自動分析；live 外部音訊 BPM 唔會自動偵測」。前半句係**推論**（基於以上兩個官方頁面），非官方明言。
- BPM 可以用 OSC 外部設定：`/composition/tempocontroller/tempo`、`tempotap`、`resync`、`tempoinc/tempodec`、`tempomultiplytwo/tempodividetwo`、`tempopush/tempopull`（官方 OSC list：https://resolume.com/download/Manual/OSC/OSC%20list.txt ）。即係外部工具可以自己分析音樂再 push BPM 入 Resolume。

### 3. Autopilot（自動選片嘅原生答案）

來源：https://resolume.com/support/en/autopilot （**v 7.22** tab，適用 7.23）

- 用途：自動序列播放 clip——官方例子係 lighting tech 側邊跑 visual、show 之間播廣告、club night 休息。
- 層級：Composition／Group／Layer／Clip 四級都有 Autopilot tab（View > Show Autopilot 打開）。啟動後 trigger 一個 column，Autopilot 就會逐個 column 播。
- **Direction（揀片邏輯）**：forward／backward／random。Random 有三個模式：
  - **Other**（預設）：跳去另一個 clip/column，唔會 retrigger 當前嗰個。
  - **Any**：可以 retrigger 當前。
  - **Bag**：「will try to play every available clip or column once before reshuffling the "bag"」——即係洗牌袋，播晒全部先重複。**呢個係原生嘅「去重」primitive**。
- **Duration（幾時換片）**：Seconds（自訂秒數）、**Beats**（聽 global BPM，官方講呢個係「super easy way to create some club shows」）、Clip Transport（當前 clip 播完）、Longest/Shortest Clip（睇 column 入面最長／最短 clip）、Top/Bottom Clip。
- **Clip Actions**：per-clip 可以指定 next/previous/random/first/last/specific clip/do nothing。
- **Column Actions**：per-column 指定 next/previous/first/last/random/specific/do nothing，加自訂 duration（只影響 Composition/Group Autopilot；用 Master Layer 時被忽略）。
- **Master Layer**：Group/Composition Autopilot 可以跟隨一個 master layer，用一層驅動成個 show。
- **Priority**：手動 trigger 最大；之後 clip > layer > group > composition。
- 7.27 加咗 **Transition Compensation**（提早 trigger 令 transition 啱啱好喺 clip 結束時完成）：https://resolume.com/blog/34561 ——7.23 冇。
- **官方文檔冇嘅嘢**：Autopilot 嘅 duration/direction 選項完全冇「跟音訊能量／FFT／onset」呢個輸入。即係 Autopilot 係 **time/beat/transport-based + randomness**，唔係 audio-reactive。Randomness 控制有（Other/Any/Bag），但規則化只限於以上枚舉選項，冇可編程規則引擎。

**所以「聽音樂自動揀 clip」原生做到幾多？**：
- 做到：按 BPM beat 數自動換片（Autopilot Beats duration + 外部/Link/MIDI clock/DJ sync 提供 BPM）→ 视觉上係「跟拍轉 clip」。
- 做到：唔重複嘅隨機序列（Bag）、per-clip/per-column 規則、master layer 編排。
- 做到：音訊能量驅動**已播放 clip 嘅參數**（FFT parameter animation），令畫面跟音樂郁。
- **做不到**：分析音訊內容（energy band、onset、genre、track 特徵）而**決定 trigger 邊個 clip/column**；live 音訊自動 BPM；「drop 嚟喇所以換去高能 clip」呢類語義決策。官方 Parameter Animation、Autopilot、BPM 三份文檔均冇呢啲功能（文檔級證據）。

### 4. Wire 嘅 FFT node

來源：https://resolume.com/support/en/wire-fft （v 7.4）

- **Spectrum In** node：攞到 **1024 個 float**，每個對應一個頻率 band；index 越低頻率越低。
- Band 闊度 = (sample rate / 2) / 1024；48kHz 時約 23Hz/band。
- Patch 入面有 spectrum source dropdown：**local**（clip 自己嘅音訊）／**composition**（成個 composition 嘅音訊）／**external**（Preferences 設嘅外部 FFT 輸入）。
- 官方例子：kick 嚟時 10-200Hz spike → 轉動；snare → shake；整體 amplitude → 顏色。
- 意思：Wire patch（=Arena/Avenue 入面嘅 effect/source/mixer plugin）可以做任意自訂 FFT 邏輯**驅動 patch 參數**。但 Wire 係 visual patching 環境，**官方文檔冇講 Wire 可以 trigger Arena clip**（Wire OSC 節點可以再發 OSC 出嚟控制 Arena，見 https://resolume.com/support/en/wire-osc ——「Wire + Arena + OSC? They might as well just give you the launch codes」；所以技術上 Wire→OSC→clip trigger 係可行路線，呢句係**判斷**，官方冇明文教呢個组合做自動選片）。
- 音訊輸入 troubleshooting：Windows 10+ mic 權限（Settings > Privacy > Microphone），官方有專頁 https://resolume.com/support/en/audio-input-no-worky ；External FFT 要先揀 device 再揀 channel（Preferences > Audio），有 master FFT gain（View > Show Audio Gain／OSC `/audiodevicemanager/params/fftinputgain`，見 https://resolume.com/support/en/preferences #audio-preferences 同 OSC list）。

---

## DJ sync 路線 vs 自己分析 mic

### 原生 DJ sync 有三條線

**a) Denon StageLinQ**（Arena only）：https://resolume.com/support/en/sync-to-denon-players
- 支援 X1800 mixer、SC5000(M)、SC6000(M)、Prime 4（6.1.2+）、Prime 2／Prime Go（7.1.1+）；最多同時 4 部 player。
- Toolbar 直接攞到：**track name／artist name／artwork／play-pause-stop 狀態／time remaining／mixer fader opacity**。
- 把 player drag 到 clip 就 link：Resolume sync clip playhead 到 track，track load 咗就自動 trigger；官方原文「You can do whatever you want on the Denon players, and Resolume will follow along. **Scratch, loop or slice, everything will stay sync**」。
- 用 ID3 title 識別 track（冇 ID3 就用 filename）。
- Fader toggle：link 之後 video 跟 mixer fader 出現／消失。Offset：補影音起點差。Player Layer Target：按 player 編號決定 clip 入邊層。
- 限制：Denon playback 只適用於**冇 audio track 嘅 clip**；要事前準備 per-track video（見下「Sync with a DJ」）。

**b) Pioneer Pro DJ Link**（Arena only，v7.12+）：https://resolume.com/support/en/sync-to-pioneer-dj-players
- 支援 CDJ-3000、CDJ-2000NXS2、DJM-V10、DJM-V10-LF、DJM-900NXS2。
- 要額外裝 Pioneer 免費 **Pro DJ Link Bridge** app（或者 ShowKontrol）做轉譯；players+mixer+電腦駁同一個 ethernet hub；Arena Preferences > General > Pioneer DJ Network Interface 揀同一個 network。
- 功能同 Denon 一樣：track metadata、playhead sync、fader link、offset、Player Layer Target、最多 4 players。

**c) Ableton Link**：https://resolume.com/support/en/link
- 只 sync **tempo 同 bar position**（冇 track 資訊、冇 playhead）；同任何 Link-enabled 軟件（Ableton Live 等）組成 peer session，雙向跟隨。
- 官方警告 Link session 係完全平等——你喺 Resolume 撳 x2 BPM，所有其他軟件都會跟住加倍（「your DJ buddy might not be so amused」）。

**總綱頁**：https://resolume.com/support/en/sync-with-dj ——官方明言全 sync show 需要大量事前準備（每條 track 要有對應 video），「By far the easiest is to use Denon or Pioneer players … If you don't have access to Denon or Pioneer gear, you can use SMPTE instead」。

### 邊個準？

- **DJ 機直連（StageLinQ/Pro DJ Link）**：攞到嘅係 player 內部嘅 **transport 級數據**——track 識別、playhead 時間、fader 狀態，官方聲稱 scratch/loop/slice 都保持 sync（上面 URL）。呢個唔係「分析」，係直接讀取 DJ 機狀態，準確度係 protocol 級。
- **Ableton Link / MIDI Clock**：tempo 級 sync；Link 官方定位係比 MIDI Clock 更 tight（MIDI shortcuts 頁原文：MIDI Clock「notoriously wavy and not really accurate. Today, Ableton's Link protocol gives a much tighter sync」）。
- **自己分析 mic 音訊**：Resolume 原生 External FFT 只給你**頻段 amplitude**（1024 band 或 L/M/H），冇 BPM、冇 beat position、冇 track 辨識；而且 mic 收到嘅係現場 PA 出來再入返 mic 嘅訊號，有噪音同延遲（呢句係**判斷**）。外部自研工具自己做 onset/BPM 估計亦只係逼近，而 DJ sync 係 ground truth。
- **結論**：現場如果有 Pioneer（CDJ-3000/2000NXS2 + DJM）或 Denon（SC5000+/Prime + X1800）而 Resolume 部機可以駁入佢哋嘅網絡，**DJ sync 路線壓倒性準確**，而且原生支援、零額外開發。Mic 分析只應該係「冇 DJ 機／DJ 用串流軟件／拿不到 network 接入」時嘅 fallback。另外注意：Pro DJ Link 需要额外 Bridge app 同 dedicated ethernet，現場網絡條件係實際障礙（判斷）。

---

## 四種控制介面契約比較表

| | **OSC** | **WebSocket API** | **REST API & Webserver** | **MCP Servers** |
|---|---|---|---|---|
| 官方文檔 | https://resolume.com/support/en/osc （v7.18/v6） | https://resolume.com/support/en/websocket-api （v7.8） | https://resolume.com/support/en/restapi （v7.8） | https://resolume.com/support/en/mcp-servers （**v7.26.0**） |
| 7.23 可用？ | ✅ | ✅（7.8 起） | ✅（7.8 起；但 7.26 先有嘅新 endpoint 冇，見下） | ❌ **要 7.26.0+**，7.23 冇 |
| Transport | UDP（default port **7000**，可改；Preferences > OSC tab enable） | `ws://address:port/api/v1`，同 REST 共用 port（Arena/Avenue default **8080**，Wire 8081；Preferences > Webserver enable） | HTTP，default port **8080**（Wire 8081），listen address default 0.0.0.0 | 本地 MCP executable（`C:\Program Files\Resolume Arena\mcp\resolume_arena_mcp_server.exe`），底層行 REST API |
| Browser 可直接用？ | ❌（OSC 行 UDP；browser 冇 raw UDP socket——見下面硬事實核實） | ✅ **可以**：官方明言 webserver preference 入面嘅 "working example"「allows you to control Resolume Arena from within your browser」，example 程式碼喺官方 public repo https://gitlab.resolume.com/public-resolume/ | ✅（HTTP/fetch 係 browser 原生；官方 Swagger reference https://resolume.com/docs/restapi/ 本身可以直接對住你嘅 webserver 發命令測試） | ❌（MCP 係俾 AI desktop app 用：Claude Desktop、Codex、Antigravity、Cursor、OpenCode 等，唔係 browser） |
| 認證 | 冇（網絡層面自己控制） | **官方文檔完全冇提任何認證**（未證實有冇；即係開咗 webserver 就係 LAN 內任何人可連——安全靠網絡隔離，呢句係判斷） | 同左，冇提及認證 | N/A（本地 stdio MCP） |
| 協議格式 | OSC type tags（Float/Int/Color/String）、absolute/relative address、`"+"`/`"-"`/`"*"` 相對修改、`"a"` absolute 值、string 名稱（如 blend mode "Alpha"）、bundle 支援、`"?"` polling | 全部 JSON；actions：`subscribe`/`unsubscribe`/`set`/`get`/`reset`/`trigger`（parameter），`post`/`remove`（結構）；param path 用 `/parameter/by-id/<id>` 或 logical path（如 `/composition/columns/1/name`）；連上即收到 composition state + sources + effects；`parameter_update` 推送 | HTTP GET/POST/DELETE，Swagger 文檔 | 自然語言 prompt → LLM → MCP tools |
| 覆蓋範圍 | 「ultimate control over every aspect」——每個 UI item 都有固定地址；clip trigger（`connect`）、column（`/composition/columns/N/connect`）、deck（`/composition/decks/N/select`）、transport（`transport/position`）、BPM（`tempocontroller/*`）、effects、dashboard links、recorder。完整清單：https://resolume.com/download/Manual/OSC/OSC%20list.txt | 參數 get/set/subscribe/trigger + **結構變更**（add/remove layers/columns/groups/effects）；官方定位：「an application that makes changes to Resolume and **reads changes from within** Resolume」（雙向、有推送） | Add/Remove/Clear Columns/Layers/Groups、管理 effects、**攞 clip thumbnails**、list sources/effects、（配合 WebSocket subscribe）。7.26 先加：audio effects 管理、**monitors endpoint（live output snapshot PNG/JPEG）**、set parameter animation（Timeline/BPM/FFT）、swap/reorder/merge clips/columns/layers、load compositions（https://resolume.com/blog/34484 ）——**7.23 冇呢批** | 官方明言「currently limited to what the REST API can do」；排除清單：slices/screens、keyboard/midi/DMX/OSC mapping、**clip cue points**、presets、parameter envelopes、Dashboard dials、record/render；只能存取**當前 deck** 嘅 clips/files（可以切 deck） |
| 狀態反饋 | OSC Output：可 monitor Resolume 一切狀態變化（"Output All OSC Messages" preset，或者 wildcard 逐類開：all layers／all clips，未加嘅 clip 都得）；加 polling（`"?"`） | 原生推送（subscribe → `parameter_update`；結構變化自動重發 composition state）——**呢樣係 OSC output 之外最乾淨嘅狀態訂閱** | 靠 WebSocket 補；REST 本身係 request/response | 靠 LLM 查詢 |
| 延遲量級 | LAN UDP，官方講「if you're not sending 1000s of messages per second, a WIFI network can be fine」；實際 sub-ms～ms 級（**判斷**，官方冇數字） | LAN TCP/WS，ms 級（**判斷**，官方冇數字） | HTTP per-request，結構操作合用；官方冇講延遲；唔適合 frame-rate 控制（**判斷**；7.26 fix list 有「REST-API Overhead on large compositions」#25086，顯示大 composition 有開銷） | LLM round-trip，秒級；官方定位「mostly used for building and modifying your composition, **not so much during live performances**」 |
| 適用場景 | 現場實時控制、clip trigger、參數推桿、外部邏輯引擎嘅輸出通道 | **browser-based 自研 controller/decision UI**：要讀 Resolume 狀態（subscribe）又要落命令（set/trigger），一個 socket 搞掂 | 建 composition、批量結構操作、攞 thumbnail 做 clip browser UI、snapshot（7.26+） | show 準備／build 階段用 AI 幫你砌 composition 同 Wire patch |
| 主要限制 | browser 用唔到（要 bridge）；地址隨 composition 結構變（層/clip 位置）；官方冇完整地址表（OSC list.txt 只係一個 1 layer 1 clip 樣本） | 冇官方講嘅認證；v7.8 文檔，細節要對住 Swagger（https://resolume.com/docs/restapi/ ）同 gitlab example 睇 | 7.23 嘅 API 面比 7.26+ 窄好多 | **7.23 根本冇**；官方明言唔適合 live performance；LLM 決策唔確定 |

### 硬事實核實：browser 可唔可以直接發 OSC？

- OSC 官方定義（Resolume OSC 頁自己 link 嘅一手來源 http://opensoundcontrol.org/introduction-osc ）：OSC 係跑喺 UDP 等 transport 上嘅協議。
- Browser 平台冇 raw UDP socket API：Web 平台只提供 TCP 建基嘅 WebSocket／fetch 等（MDN WebSocket API 文檔 https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API ——browser-side 冇任何 UDP endpoint；呢個係 Web 標準事實）。
- **所以「web 瀏覽器唔可以直接發 OSC 到 Resolume port 7000」成立**（除非經一個 WebSocket↔OSC bridge 進程）。
- 注意：Resolume OSC 頁有一句「There's even javascript libraries to send OSC right from the browser」——呢句要打折睇：主流 JS OSC 庫（如 osc.js）喺 browser 環境實際上要靠 WebSocket bridge 先送得到 UDP OSC（**判斷**；官方冇解釋佢指邊個 library）。呢句同 Web 標準矛盾，以 Web 標準為準。
- **替代**：Resolume Websocket API 就係為 browser 而設嘅官方通道（官方 working example 明言係 browser 控制 Arena），所以自研 web 工具**應該行 WebSocket API 或者起一個本地 bridge（WS/HTTP→OSC）**，唔使假設 browser 直發 OSC。

### MIDI 作為替代路線

來源：https://resolume.com/support/en/midi-shortcuts （v7.18/v7/v6）

- MIDI 要**事先 assign shortcut**（OSC 頁對比：「The addresses are all fixed and set up already … Unlike MIDI and keyboard shortcuts, that require you to first link a control to a specific shortcut」；OSC「much finer control than via MIDI or DMX」）。
- MIDI 值只有 0-127（CC/velocity），OSC 有 float/int/color/string + 相對修改 + polling。
- MIDI 有獨到優勢：controller 回饋（pad 顏色，clip 有 5 個狀態可對應顏色）、Piano/momentary 模式、**multiple devices 分得開**（官方：「Resolume is able to discern which device a MIDI message came from」，同一個 button 喺兩部 APC40 可以 trigger 唔同 clip）。
- **同 MadMapper 撞唔撞**：MIDI 訊息係 per-device broadcast；如果 Resolume 同 MadMapper 同時 enable 同一部 MIDI controller，兩邊都會收到同一個 message，各自嘅 shortcut 都會反應——官方冇講有任何 exclusive lock（未證實）。實際解決：Resolume 同 MadMapper 用**唔同嘅 MIDI device**，或者同一 device 唔同 channel/note 範圍（Resolume shortcut 可以改 Channel/CC/Note 值，官方 MIDI 頁明言「Every MIDI Message allows you to change its Channel and CC or Note values」）。呢個建議係**判斷**。
- Windows 風險：官方 troubleshooting 有「MIDI Troubles on Windows 11 with MIDI 2.0 update — Windows MIDI 2.0 updates from **February 2026** causing issues」（https://resolume.com/support/en/midi-troubles-on-windows-with-midi-2-0-update ；只核實到標題同存在，內容未抓）。Windows 用戶行 MIDI 路線要先睇呢頁。
- MIDI Clock 官方自己話唔準（見上），BPM sync 唔好靠 MIDI Clock。

---

## 舊三個地址核對結果

對照官方 OSC 文檔（https://resolume.com/support/en/osc ）同官方 OSC list（https://resolume.com/download/Manual/OSC/OSC%20list.txt ，一個 1 layer/1 clip/transform-only 樣本 composition 嘅完整地址清單）：

| 舊 draft 地址 | 核對結果 | 證據／正確寫法 |
|---|---|---|
| `/composition/layers/1/clips/1/connect` | ✅ **正確**（地址存在） | OSC list.txt `//CLIP` 段有 `/composition/layers/1/clips/1/connect`（另有 `connected` 狀態地址）。呢個就係 clip trigger。發乜值觸發：OSC list 冇列 type tag／值；按 Resolume 慣例 trigger 類地址通常發 1（**判斷，未證實**）——實機用 OSC Shortcut mode（Shortcuts > Edit OSC）撳個 clip trigger 就會顯示地址同 type tag（官方 OSC 頁教法）。 |
| `/composition/layers/1/video/effects/invert/opacity` | ⚠️ **地址 pattern 正確，但 effect 名 `invert` 高度可疑** | Pattern `/composition/layers/N/video/effects/<effect>/<param>` 係官方確認嘅（OSC 頁 Goo effect 例子 `/composition/layers/1/video/effects/goo/...` 類；OSC list.txt 樣本只有 transform，因為嗰個 composition 只掛咗 transform）。問題喺名：Resolume 官方 MIDI 文檔提到嘅效果叫「**Invert RGB**」（https://resolume.com/support/en/midi-shortcuts ：「set the Opacity of the Invert RGB to 0.10」），所以 OSC 段名好可能係 `invertrgb` 之類而唔係 `invert`。**正確做法**：喺用戶部機入 OSC Shortcut mode 撳實際 effect 攞真名（官方 OSC 頁明言呢個係最可靠方法），或者用 polling `"?"` 試。未證實。 |
| `/composition/layers/2/video/opacity` | ✅ **正確** | 官方 OSC 頁正文例子就係 `/composition/layers/1/video/opacity 0.25`（float 0-1）；OSC list.txt 有 `/composition/layers/1/video/opacity`，layer index 換 2 即用。前提：composition 真的有 layer 2。 |

補充：舊 draft「Energy→Column 1/2/3」需要嘅 column trigger 地址官方確認為 `/composition/columns/1/connect`、`/composition/connectnextcolumn`、`/composition/connectprevcolumn`、`/composition/connectspecificcolumn`（OSC list.txt `//COMPOSITION` 同 `//COLUMNS` 段）。

---

## Column 喺 Resolume 嘅實際含義與 OSC 地址

官方定義（兩處）：

- https://resolume.com/support/en/decks ：「You can also organise your content so that clips that look good when played together are all in the same column. **A column is a vertical row of clip slots.** Then you can play them all at the same time by **triggering the column**, using the column itself as the trigger.」（相對地：「A layer is a horizontal row of clip slots.」）
- https://resolume.com/support/en/clips #column-triggering：「A column is a vertical set of clips. You can trigger multiple clips at the same time by triggering the column. This is a great way to quickly switch looks by triggering a set of clips that work well together.」

即係：**Column = deck grid 入面一直行 clip slots，横跨所有 layer**；trigger 一個 column = 同時 trigger 每個 layer 喺嗰直行嘅 clip（除非 clip/layer 開咗 Ignore Column Trigger，https://resolume.com/support/en/clips #ignore-column-trigger）。Column **唔係** Group（Group = 幾層 layer 打包做 sub-composition，https://resolume.com/support/en/groups ）亦唔係 Deck（Deck = 成個 clip 集合，似 DJ record bag，https://resolume.com/support/en/decks ）。

對照用戶舊 draft「Energy→Column 1/2/3」：呢個概念**直接對應** column trigger——把唔同能量級別嘅 clip set 擺入唔同 column（低能=column 1、中能=column 2、高能=column 3），外部工具分析到能量級別就 trigger 對應 column，一次過換晒所有 layer 嘅 look。呢個設計同 Resolume 原生組織方式完全夾（判斷：官方文檔冇講「energy mapping」，但 column 就係為「一 set 夾嘅 clip 一齊 trigger」而設）。

OSC 地址（全部見 https://resolume.com/download/Manual/OSC/OSC%20list.txt ）：

```
/composition/columns/1/connect          ← trigger column 1（值未證實，推斷發 1）
/composition/columns/1/name             ← column 名（可以改，方便「低能/中能/高能」標籤）
/composition/columns/1/selected
/composition/connectnextcolumn          ← 下一個 column
/composition/connectprevcolumn          ← 上一個 column
/composition/connectspecificcolumn      ← 指定 column（發 index；未證實）
```

WebSocket/REST 側：column 係一等物件——`/composition/columns/{column-index}`，有 `name`(StringParameter)、`colorid`(ChoiceParameter) 等參數，可以用 `post`/`remove` action 加減 column（https://resolume.com/support/en/websocket-api ）。

相關原生功能：layer 有 `/composition/layers/1/ignorecolumntrigger`、`/composition/layers/1/connectnextclip`/`connectprevclip`/`connectspecificclip`、`/composition/layers/1/clear`（OSC list.txt）；Autopilot 嘅 Column Actions 都係以 column 為單位（https://resolume.com/support/en/autopilot #column-actions）。

---

## 3070 Ti 8GB laptop 對比官方 recommended spec 嘅實際含義

官方 Tech Specs（https://resolume.com/support/en/tech-specs ，v7.28.0 tab）：

- Windows minimum：**Windows 10 + Nvidia or AMD graphics card + 8GB RAM**
- Windows recommended：**Windows 11 + i7 6-core 3.7GHz + Nvidia RTX 4070 + M2 SSD + 16GB RAM**

逐項核實同釐清：

1. **「8GB」係 system RAM，唔係 VRAM**——官方 tech specs 寫嘅「8GB RAM」／「16GB Ram」指系統記憶體。用戶部機嘅「8GB」係 **RTX 3070 Ti Laptop 嘅 VRAM**，兩樣唔同嘢（呢個區分係事實陳述）。官方對 VRAM 冇獨立最低要求，只寫「Nvidia or AMD graphics card」。用戶部 laptop 嘅 **system RAM 容量未知**——大部份 3070 Ti 級 gaming laptop 出廠 16GB，如果係咁就達到 recommended RAM；要問用戶確認（列入「要問用戶嘅問題」）。
2. **GPU**：RTX 3070 Ti Laptop 高於 minimum（「Nvidia or AMD graphics card」），低於 recommended（RTX 4070 desktop 級）。實際含義：1080p DXV 內容、正常 layer 數應該應付到；但 recommended spec 係官方對「maximum」嘅定義，即係大 composition（幾十 layer、大量高分辨率內容、多 output）會比 4070 機食力。7.24 blog 提到有用戶跑 40+ layers／900+ columns 嘅 composition（https://resolume.com/blog/32999 ）——呢類規模先係 spec 壓力來源（判斷）。
3. **Laptop 特有陷阱（官方有專頁）**：
   - **NVIDIA Optimus／外接顯示 FPS drop**：https://resolume.com/support/en/optimus-workaround ——laptop 送 output 去外置屏會食 NVIDIA driver 入面 Total War: Arena 嘅 preset（撞 arena.exe 名）。7.0.5+ 官方話會自動放 Resolume profile 解決。**但 7.23 正正移除咗自動安裝 Nvidia profile**：官方 7.23 blog「Nvidia Profile Removed — … There is now an option in the Preferences to enable the Nvidia profile should you need it」（https://resolume.com/blog/30807 ）。即係 **7.23 laptop 用戶如果外接屏 FPS 差，要去 Preferences 手動 enable Nvidia profile**——呢個直接命中用戶 setup。
   - **DMA Textures**：Preferences > Video；官方建議 Force ON，「Only if you are experiencing performance problems on older or lower end GPUs, should you switch to Force OFF」（https://resolume.com/support/en/preferences #dma-textures）。laptop GPU 遇上問題可以試 Force OFF（判斷）。
4. **7.23 版本特定**：7.23 本身主打「Performance Improvements」，官方明言 Windows 上 launch/close/加 clip/group/layer/切 deck 都加快咗（https://resolume.com/blog/30807 ）——對低 spec 機係利好。7.23 冇官方「known issues」頁；已知問題以 fix list 形式記錄喺 release blog（7.23.0/.1/.2 fix list 見同一篇），其後版本修咗嘅 bug（例如 7.24.1 修「BPM Sync in BPM (not Beats) broken for AV clips」#24521，https://resolume.com/blog/32999 ）意味著該 bug 可能存在於 7.23（**推論**，官方冇講 affected versions）。

---

## Resolume 7.23 特定事項（版本文檔對照）

- 官方 changelog = blog 嘅 release posts。7.23 官方 release post：https://resolume.com/blog/30807 （7.23 Release：Parameter Animation Presets、Windows performance、Nvidia Profile Removed、Test Card source、Wire nodes、7.23.0/.1/.2 fix lists）。
- Support 文檔係 **per-article 版本 tab**，唔係全站統一版本：例如 Parameter Animation 有 v7.23 tab（https://resolume.com/support/en/parameter-animation ）、Autopilot v7.22、WebSocket/REST v7.8、OSC v7.18/v6、Tech Specs 有 v7.28.0/7.21.0/7.18.0/7.13.2/7.11/7.6/6 tabs。
- **冇 7.23 全站 snapshot**：`https://resolume.com/support/en/7.23/osc` 會 load 到頁殼但冇 OSC 內容（實測抓取結果），確認 7.23 冇整版 archive。7.23 用戶嘅正確讀法：**揀每篇文章 ≤7.23 嘅最新版本 tab**（例如 Tech Specs 用 v7.21.0 tab 最貼近 7.23；OSC 用 v7.18 tab）。Tech Specs v7.21.0 tab URL：https://resolume.com/support/en/7.21/tech-specs （抓取時內容空白，可能係 JS tab 切換；未證實 7.21 同 7.28 spec 有冇差異——上文引用嘅係預設 v7.28.0 tab 內容）。
- OSC 地址喺 7.x 有冇變：官方 OSC list.txt 冇版本號；OSC 文檔 tab 停留 v7.18/v6。blog 記錄顯示 OSC 相關變動都係 bugfix 級（例：7.23.0「Arena sends OSC colors as float4 not as color」#22652——**即係 7.23 之前 color 輸出有 bug，7.23 已修**；7.25.0「Enabling OSC input and output is not effective if it was disabled on startup」；7.26.1「New OSC preset needs to be re-selected…」#24566；7.28.1「Crash entering non-existing IP in the OSC Outgoing Address」#25954。來源：https://resolume.com/blog/30807 、https://resolume.com/blog/34172 、https://resolume.com/blog/34484 、https://resolume.com/blog/34630 ）。冇證據顯示 7.x 期間 OSC 地址 schema 有 breaking change（判斷，基於以上 changelog absence）。
- 7.23 用戶升級考慮：REST API 大升級（monitors snapshot、audio effects、parameter animation 設定、clip/column merge/reorder）同 MCP 都係 **7.26+**；FFT 大改（Lin/Log/Mel、Spectral Flux 等）係 **7.29**；Autopilot transition compensation 係 **7.27**。如果外部工具想食呢啲，用戶要升級（官方 release posts 同上）。

---

## Resolume 原生做不到嘅嘢（價值缺口清單）

每項標明證據級別：**〔文檔冇〕**= 相關官方文檔通篇冇呢個功能；**〔判斷〕**= 我嘅推斷。

1. **Audio-aware 選片決策**：用音訊特徵（能量 band、onset、節奏密度、genre）決定 trigger 邊個 clip/column。FFT 只驅動 parameter 值〔文檔冇：parameter-animation〕；Autopilot 選項只有 time/beat/transport/random〔文檔冇：autopilot〕。→ 外部工具核心價值。
2. **Live 音訊自動 BPM 偵測**：BPM 只有手動輸入/tap/nudge、MIDI Clock、Link、DJ 機 sync〔文檔冇：bpm、link、midi-shortcuts〕。外部工具可以自己估 BPM 再用 OSC `/composition/tempocontroller/tempo` 寫入（OSC list.txt 確認地址存在）。
3. **Cross-clip 智能去重／冷卻**：原生最接近嘅係 Autopilot「Bag」模式（播晒先 reshuffle）〔autopilot 文檔〕，但冇「最近 N 分鐘用過就降權」、「同 layer 唔連 trigger 相似 clip」呢類可編程歷史邏輯〔判斷〕。
4. **Genre/energy-aware 內容分類**：Resolume clip 只有 name/color/deck 位置/thumbnail；冇 tag 系統、冇 metadata 分類〔文檔冇：clips、decks；REST API 都係得 name/thumbnail〕。外部工具要自己維護 clip→特徵 database（可以用 REST 攞 thumbnails 做 UI，https://resolume.com/support/en/restapi ）。
5. **決策可解釋性（顯示點解揀呢個 clip）**：Resolume UI 冇任何「自動化決策原因」概念〔文檔冇〕；OSC Output 可以話你知「乜變咗」但唔會話你知「點解」〔osc 文檔 + 判斷〕。外部工具嘅 decision log/UI 係純增量價值。
6. **跨軟件編排（同 MadMapper laser sync）**：Resolume 可以出 DMX/Art-Net（Arena，https://resolume.com/support/en/dmx ）同收 DMX shortcuts（https://resolume.com/support/en/dmx-shortcuts ），但「一個中央大腦同時指揮 Resolume visual + MadMapper laser、兩邊決策互相关联」唔喺 Resolume 範圍〔判斷；官方文檔冇跨 app 編排概念〕。
7. **3D「腦」視覺化／自研 decision UI**：Resolume webserver example 只係功能展示；自研嘅 3D 狀態視覺化要自己做〔判斷〕。WebSocket API 提供狀態訂閱原料〔websocket-api〕。
8. **Browser 直連實時控制**：browser 發唔到 OSC（Web 標準）；原生解法係 WebSocket API（v7.8 起，官方 browser example 存在）〔websocket-api〕——所以呢項**唔算完全缺口**，但「browser 內跑自研決策引擎 + 音訊分析（WebAudio）再落命令」嘅整套係外部工具要做嘅〔判斷〕。
9. **Cue points 自動化觸發**：OSC list 有 cuepoint set/jump 地址（`/composition/layers/1/clips/1/transport/cuepoints/...`），MCP 明言唔支援 cue points〔mcp-servers〕；「按音樂段落跳 cue point」嘅自動化邏輯冇原生功能〔判斷〕。
10. **7.23 上冇 MCP**：如果想用官方 AI 路線（自然語言建 composition），必須升級到 7.26+〔mcp-servers〕；而且官方定位係 build-time 唔係 live〔mcp-servers 原文〕——即係「live 現場 AI 決策」官方自己都没做，呢個位係外部工具嘅空間〔判斷〕。

**反向提醒（避免外部工具重複造輪）**：參數級音訊反應（FFT→opacity/scale/effect bypass + envelope smoothing）、beat-quantized trigger（Beat Snap）、BPM-synced 自動換片（Autopilot Beats）、唔重複隨機（Bag）、composition 狀態訂閱（OSC Output / WebSocket subscribe）——呢啲全部原生已有，外部工具應該**用**而唔係**重做**。

---

## 未證實項目清單

1. `connect` 類地址（clip/column trigger）嘅**觸發值**（推斷發 1；OSC list.txt 冇列 type tag/值）——要用 OSC Shortcut mode 或 polling `"?"` 實機確認。
2. `invert` effect 嘅正確 OSC 段名（官方效果叫 Invert RGB；OSC 名可能係 `invertrgb`——未證實）。
3. WebSocket API 有冇任何認證/配對機制（官方文檔完全冇提；推斷冇，安全靠網絡隔離）。
4. 7.23 版 REST API 嘅確切 endpoint 面（官方 Swagger https://resolume.com/docs/restapi/ 係 JS app，抓唔到靜態內容；而且 Swagger 內容跟部機版本——要喺用戶部機 Preferences > Webserver 開 reference 先係 7.23 真實契約）。
5. Tech Specs v7.21.0 tab 內容（URL 存在但抓取時內容空白，疑係 JS tab；未核實同 v7.28.0 有冇差異）。
6. 「import 時自動分析檔案 BPM」係推論（基於 clip properties「default BPM」+ 7.26「analysing new audio files」fix），官方冇明文。
7. 各介面延遲嘅具體數字（全部係判斷，官方冇量測數據）。
8. Windows MIDI 2.0（2026年2月更新）問題嘅具體內容（只核實到官方 troubleshooting 頁標題存在）。
9. 用戶部 laptop 嘅 system RAM 容量（影響「低於 recommended」呢個判斷——VRAM 8GB ≠ RAM 8GB）。
10. MCP server 有冇獨立線上 docs/repo URL（官方只講 bundled `.mcpb`/`.exe` 喺安裝目錄 + support 文章；gitlab.resolume.com/public-resolume/ 係 WebSocket examples 嘅 repo，冇證據佢包含 MCP）。
11. Autopilot 7.22 文檔 vs 7.23 實際行為有冇差異（Autopilot 文章最新 tab 係 v7.22，假設 7.23 沿用——未證實）。

---

## 要問用戶嘅問題

1. **現場有冇 DJ，用咩機？**如果有 CDJ-3000/2000NXS2 + DJM-V10/900NXS2，或者 Denon SC5000+/Prime + X1800，DJ sync 路線（frame-accurate + track metadata）完勝 mic 分析，外部工具應該改為食 DJ 狀態而唔係自己聽音樂。部 Resolume laptop 可唔可以駁入 DJ 嘅 network（Pioneer 仲要額外裝 Pro DJ Link Bridge）？
2. **音訊來源係咩？**DJ mixer 嘅 line-out/booth feed（乾淨）定係真係用 mic 收現場（嘈）？有冇 audio interface？External FFT 要喺 Preferences 揀 device + channel。
3. **會唔會考慮升級 Resolume？**7.26+ 有 MCP + REST 大升級（monitor snapshots、set parameter animation）；7.27 有 Autopilot transition compensation；7.29 有 FFT 大改（Lin/Log/Mel filter）。外部工具嘅設計應該 target 7.23 定係假設會升級？
4. **System RAM 幾多 GB？**（唔係 VRAM）如果真係 8GB system RAM，就只啱啱踩到官方 minimum，跑大型 composition + 外部工具 + browser 會好緊。
5. **Deck 組織方式**：打算幾多 layers、幾多 columns、每 column 係咪一個「能量級別」？有冇用 Groups？外部工具嘅 column mapping 要對住呢個結構寫。
6. **MadMapper 同 Resolume 係咪同一部機？**如果係，GPU/CPU 預算要分；MIDI controller 係咪共用（要規劃 channel/device 分配避免兩邊同時反應）？
7. **外部工具嘅 client 想點跑**：純 browser（→ WebSocket API 直接連，官方已有 browser example）、本地 app（→ OSC 最細粒度）、定係兩者都要（→ 本地 bridge）？
8. **網絡環境**：現場用 WiFi 定 wired？官方提示 WiFi 喺人多時會衰（「when 5000 people start snapchatting」），OSC Output "Output All" preset 流量大，可能要 wildcard 精選。
9. 需唔需要我下一步**用 polling 語法整一份 7.23 實機驗證 checklist**（喺用戶自己部機跑，我唔可以實機驗證）？

---

## 引用來源總表

| 來源 | URL |
|---|---|
| Support 索引 | https://resolume.com/support |
| OSC | https://resolume.com/support/en/osc |
| OSC 地址清單（官方樣本） | https://resolume.com/download/Manual/OSC/OSC%20list.txt |
| Parameter Animation（v7.23） | https://resolume.com/support/en/parameter-animation |
| Envelopes | https://resolume.com/support/en/envelopes |
| BPM | https://resolume.com/support/en/bpm |
| Autopilot（v7.22） | https://resolume.com/support/en/autopilot |
| Clips（Column Triggering、Beat Snap） | https://resolume.com/support/en/clips |
| Decks（column/layer 定義） | https://resolume.com/support/en/decks |
| Groups | https://resolume.com/support/en/groups |
| Effects（bypass animation、Invert RGB 提及） | https://resolume.com/support/en/effects |
| Websocket API | https://resolume.com/support/en/websocket-api |
| REST API & Webserver | https://resolume.com/support/en/restapi |
| REST API Swagger reference | https://resolume.com/docs/restapi/ |
| 官方 public repo（WebSocket examples） | https://gitlab.resolume.com/public-resolume/ |
| MCP Servers（v7.26.0） | https://resolume.com/support/en/mcp-servers |
| MIDI Shortcuts | https://resolume.com/support/en/midi-shortcuts |
| Windows MIDI 2.0 troubleshooting | https://resolume.com/support/en/midi-troubles-on-windows-with-midi-2-0-update |
| Sync with a DJ | https://resolume.com/support/en/sync-with-dj |
| Sync to Denon DJ Players（StageLinQ） | https://resolume.com/support/en/sync-to-denon-players |
| Sync to Pioneer DJ Players（Pro DJ Link） | https://resolume.com/support/en/sync-to-pioneer-dj-players |
| Ableton Link | https://resolume.com/support/en/link |
| Wire FFT | https://resolume.com/support/en/wire-fft |
| Wire OSC | https://resolume.com/support/en/wire-osc |
| Audio input no worky | https://resolume.com/support/en/audio-input-no-worky |
| Preferences（Audio FFT、DMA、Webserver） | https://resolume.com/support/en/preferences |
| Tech Specs | https://resolume.com/support/en/tech-specs |
| NVIDIA Optimus workaround | https://resolume.com/support/en/optimus-workaround |
| Expressions | https://resolume.com/support/en/expressions |
| Basic Vocabulary | https://resolume.com/support/en/vocabulary |
| 7.23 Release blog | https://resolume.com/blog/30807 |
| 7.24 Release blog | https://resolume.com/blog/32999 |
| 7.25 Release blog | https://resolume.com/blog/34172 |
| 7.26 Release blog（MCP + REST 升級） | https://resolume.com/blog/34484 |
| 7.27 Release blog | https://resolume.com/blog/34561 |
| 7.28 Release blog | https://resolume.com/blog/34630 |
| 7.29 Release blog（FFT 改進） | https://resolume.com/blog/34693 |
| OSC 起源（一手定義） | http://opensoundcontrol.org/introduction-osc |
| MDN WebSockets API（browser 冇 UDP） | https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API |
