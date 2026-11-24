# MadMapper 一手資料 ＋ Resolume Arena 7.23 / MadMapper / WebGL 工具三 app 同機共存約束

研究日期：2026-11-17（所有 URL 当日直接抓取核實；web_search 服務壞咗（HTTP 401），全部用 web_fetch 直接抓官方頁面）。
目標機器：Windows laptop、RTX 3070 Ti、8GB VRAM（用戶提供，屬已知事實，本研究未能喺抓低嘅 NVIDIA 官方頁面文字確認 VRAM 數字 — NVIDIA 產品頁抓取時被截斷，見「未證實項目清單」）。

標記約定：
- 【官方】＝有一手來源 URL
- 【推算】＝由官方數字推出嘅估算，計算過程列明
- 【未證實】＝搵唔到一手來源，或者抓取失敗

---

## 一句結論

MadMapper（用戶講嘅 laser 部分實為官方付費 extension「MadLaser」，唔係獨立產品）同 Resolume 一樣係 OpenGL-based、windowed/composited 輸出，官方文檔冇任何「獨佔 GPU／audio／input」嘅要求，OSC input 預設 port 8010／feedback 9000，唔會撞 Resolume 7000；真正嘅硬約束係 8GB VRAM 預算（推算三 app 加 DWM 之後剩 ~0.5–2GB 頭room，必須限制新工具 WebGL viewport 解像度同 texture 用量）、audio 一定要行 WASAPI shared mode、以及新工具絕對唔好用 SetWindowsHookEx(WH_KEYBOARD_LL)／SetForegroundWindow 搶 focus／exclusive-mode audio／DirectInput exclusive acquire；部署形态推薦 **Tauri 2（Rust 原生層發 OSC/UDP ＋ WebView2 UI）**，Electron 做後備（佢預設 autoplayPolicy 係 `no-user-gesture-required`，autoplay 問題最細，但記憶體開銷較大【推算】）。

---

## MadMapper 一手資料

### 1. 官方網站／文檔／版本

| 項目 | 內容 | 來源 |
|---|---|---|
| 公司 | GarageCube（Geneva/Paris/Brussels），MadMapper 係同 1024 architecture 嘅合作項目 | 【官方】https://www.garagecube.com/madmapper/ |
| 產品站 | https://madmapper.com/madmapper/software | 【官方】同左 |
| 官方文檔（manual） | https://docs.madmapper.com/ （MadMapper 6 全文檔，15 章） | 【官方】同左 |
| 官方 forum | https://forum.garagecube.com/ | 【官方】https://madmapper.com/madmapper/software 頁尾 |
| 最新版本 | 官方 Release Notes History 最新列到 **MadMapper 6.1.1**；forum 用戶 2026-05 帖文提及「current version 6.1.2」 | 【官方】https://docs.madmapper.com/madmapper/6/15.-troubleshooting/madmapper-release-notes-history ；6.1.2 屬【未證實】（只有 forum 用户帖 https://forum.garagecube.com/viewtopic.php?f=29&t=36426 ） |
| 定價/授權 | MadMapper perpetual 由 399€（不含稅）起、rental 39€/月起；MadLaser perpetual 由 199€ 起；demo 版有 watermark＋DMX 每 30 秒 blackout＋laser 每 120 秒 blackout | 【官方】https://madmapper.com/madmapper/software 、https://madmapper.com/extensions/madlaser |

### 2. Laser 輸出介面（MadLaser）

MadLaser 官方硬件支援清單【官方】https://madmapper.com/extensions/madlaser ：
- **LaserCube**（官方稱 "the best option for MadMapper"）
- **EtherDream**（network DAC，16-bit X/Y）
- **ShowNET**（內置 ShowNET mainboard 嘅 laser，LAN 線直駁）
- **Helios USB**（USB DAC）
- **FB3/FB4（Pangolin）— Windows only，需要 Pangolin Beyond license**
- **AVB / Dante**（用 audio network 傳 laser 數據）
- **IDN（ILDA Digital Network）**
- ILDA file import/export；最高 100 kpps scanner

Laser output 設定细节（PPS、ILDA FPS = PPS / Point Count、blanking、safety zone、masking）【官方】https://docs.madmapper.com/madmapper/6/7.-laser-madlaser/getting-started-with-madlaser 同 https://docs.madmapper.com/madmapper/6/6.-outputs 。

**AVB/Dante laser 對 audio 子系統嘅影響（關鍵）**：MadLaser 用 AVB/Dante 時，laser 數據係當成 audio stream 送入 AVB audio card；「On Windows, enabling AVB will force MadMapper to switch the audio driver type to ASIO and will require an application restart」【官方】https://docs.madmapper.com/madmapper/6/2.-the-interface/madmapper-preferences 。即係話如果用戶嘅 laser DAC 行 AVB/Dante，MadMapper 會獨佔式咁用 ASIO 音訊卡 — 呢個係新工具 audio 分析最大嘅潛在衝突點（ASIO 驅動普遍唔容許多 client【未證實，ASIO 官方 spec 未抓】）。如果用 EtherDream/ShowNET/Helios/LaserCube 呢啲非 audio-network DAC，就唔涉 ASIO。

DMX/LED 輸出（MadMapper 本體，非 laser）：
- Art-Net 4（broadcast/unicast，universe 0–32767，軟件上限 16384 universes）、sACN（multicast only）【官方】https://madmapper.com/madmapper/faq
- USB DMX 官方支援：garageCube usb-to-dmx、Enttec Open USB DMX、Enttec DMX USB Pro MKII、ShowJockey、DMX King eDMX2 Pro（Enttec Pro compatible）【官方】https://madmapper.com/madmapper/faq 同 https://docs.madmapper.com/madmapper/6/2.-the-interface/madmapper-preferences

### 3. 官方 System Requirements

【官方】https://docs.madmapper.com/madmapper/6/13.-setup-and-installation/requirements ：

| 項目 | 數字 |
|---|---|
| OS | macOS 11+／**Windows 10+**（64-bit；官方 FAQ 明言唔支援 virtual machine） |
| 最低 | 300 MB disk、**2 GB RAM**、**任何 OpenGL 3.3 compatible GPU** |
| 建議 | 2–4 core CPU、**8 GB RAM**（Windows 章節：16GB+ highly recommended）、SSD、dedicated GPU（NVIDIA/AMD 都得） |
| **VRAM** | **官方冇列任何 VRAM 數字** |
| Driver | Windows 強烈建議 **NVIDIA Studio Driver**（唔好用 Game Ready） |
| 穩定性警告 | 「最常見 hardware-related crash 係 GPU 滿載時插拔 display」— 開 MadMapper 之前先駁好所有屏幕 |

GPU 架構注意：「MadMapper 6 is still OpenGL based (we'll soon be native Direct3D/Metal). With OpenGL it's very hard to choose the GPU. Same with other OpenGL apps (ie Resolume etc.). It will start on the GPU the main display is attached to.」— GarageCube team member (mad-matt) 喺官方 forum【官方】https://forum.garagecube.com/viewtopic.php?f=20&t=36471 。單 GPU laptop 唔受呢個影響，但確認咗 MadMapper 同 Resolume 都係 OpenGL app、會共用同一粒 GPU。

舊 FAQ（MadMapper 5 時代）recommended config：「6-8 cores CPU, Nvidia 1080 up to 20xx GPU」【官方】https://madmapper.com/madmapper/faq — RTX 3070 Ti 已超出呢個 recommended 範圍。

### 4. MadMapper 嘅 Audio Input（佢自己識聽音）

**係，MadMapper 內建 audio input＋beat detection**【官方】https://docs.madmapper.com/madmapper/6/9.-master-settings/audio-input-and-beat-detection ：
- Preferences > Audio 揀 audio interface ＋ 指定 "Audio Analysis Channels"
- Global BPM 來源：audio beat detection／Ableton Link／MIDI clock／manual tap
- 任何參數可以 right-click > Add Control > Audio 綁到 `amplitude`、`bass`、`medium`、`treble`、`bpm`、`beatCount`、`4_beats` 等變數 — 即係佢自己就做到 audio-reactive laser/mapping
- Windows multi-channel output 要用 ASIO driver type【官方】https://madmapper.com/madmapper/faq （"Multi audio channel (Windows)"）
- MadMapper 6.0.0 release notes：「Added Windows Audio Session as audio driver type option in preferences (WASAPI)」【官方】https://docs.madmapper.com/madmapper/6/15.-troubleshooting/madmapper-release-notes-history — 即係 MadMapper 可以行 WASAPI（shared）或者 ASIO／DirectShow

**對新工具嘅含義**：如果 MadMapper 開咗 audio input 做 beat detection，佢會用 audio capture device。Windows shared-mode capture 容許多個 client 同時讀同一個 mic（見「WASAPI」節【官方】），所以新工具用 getUserMedia 讀同一個 mic 理論上共存 — 前提係兩邊都係 shared mode，冇人開 exclusive。

### 5. OSC／MIDI input 同預設 port

【官方】https://docs.madmapper.com/madmapper/6/2.-the-interface/madmapper-preferences （Project Tab > OSC）：
- **OSC Input Port 預設 8010**
- **OSC Feedback Port 預設 9000**
- 支援 Bonjour/ZeroConf discovery；OSC Outputs 可以定義多個目標（Name/IP/Port）
- 支援 **OSCQuery** protocol（TouchDesigner、Vezér、Chataigne 可以自動發現成棵參數樹）【官方】https://docs.madmapper.com/madmapper/6/11.-live-performance-and-control/osc-commands-and-channels-list
- MadMapper 5.4.0 起「Osc Query now supports websocket & LISTEN / PATH ADDED / PATH CHANGED / PATH REMOVED」【官方】release notes history 同上面 URL — **即係 MadMapper 嘅 OSCQuery 有可能經 WebSocket 俾 browser 直連**（plain OSC message 係咪都經同一條 WebSocket 行，官方文檔未明講 — 【未證實】）
- 完整 OSC address list（/application、/master、/media、/outputs/Laser-Output-[1-X]/...、/timelines/...）【官方】https://docs.madmapper.com/madmapper/6/11.-live-performance-and-control/osc-commands-and-channels-list
- 注意：OSC Commands 頁有一句寫「typically Port 8000 for incoming OSC data」，同 Preferences 頁嘅「default 8010」有出入 — 以 Preferences 文檔（8010）為準，但部署時應喺用戶部機實測确认【官方兩處矛盾，已標明】
- MIDI：自動偵測 class-compliant USB MIDI；Preferences > Project > MIDI 揀 input/feedback device；支援 Note/CC/Pitch Bend learn【官方】https://docs.madmapper.com/madmapper/6/11.-live-performance-and-control
- 另有 Keyboard、Gamepad（PS3/4/5、Xbox）、DMX input、Ableton Link control 類別【官方】同左

**Port 撞車結論**：MadMapper OSC 8010/9000 ≠ Resolume OSC 7000（Resolume 官方 https://resolume.com/support/en/osc ，主管已核實）。兩者預設唔撞。新工具如果自己做 OSC sender，只需 bind 自己嘅 outbound socket，唔需要聽任何 port；如果要聽 OSC feedback，用第三個 port（例如 9001+）並避開 7000/8010/9000。

### 6. Fullscreen 行為

- MadMapper video output 係揀一個 display 做 fullscreen 投影；UI 可以留喺另一個屏幕。官方 FAQ（macOS 條）教「唔好 maximize UI window」先做到 UI/輸出分離【官方】https://madmapper.com/madmapper/faq （"Fullscreen output (macOS)"）— Windows 版本官方冇專屬 fullscreen exclusive 說明【未證實】
- OSC address 有 `/application/view/fullscreen (BOOL)` — fullscreen 係一個 view 狀態，可以用 OSC 切【官方】OSC Channels List（上面 URL）
- Project preferences 有「forcing the project into Fullscreen video mode upon opening」【官方】https://docs.madmapper.com/madmapper/6/2.-the-interface/madmapper-preferences
- MadMapper 6.0.0（Windows）：「prevent multiple instances of same MadMapper executable」【官方】release notes history
- 冇任何官方文檔話 MadMapper 用 fullscreen exclusive（DXGI SetFullscreenState）模式；由「OpenGL-based＋windowed outputs＋DWM 環境下多屏幕操作」嘅描述推算，佢係 borderless/windowed fullscreen 行經 DWM composition【推算，建基上面官方描述；官方未明講】
- 官方故障排除明確警告：顯示器喺 GPU 負載中插拔係 Windows crash 主因【官方】requirements 頁

### 7. Forum：Resolume＋MadMapper 同機同時運行

搵到一手 forum 來源：
1. **實際巡演同機使用報告**：「I just finished on a tour where I used Madmapper alongside Resolume to run a lot of timecoded songs (the whole show basically). The comb[o] worked really well」— 用戶 TomHethro【官方 forum】https://forum.garagecube.com/viewtopic.php?f=29&t=36426 （佢係用 timecode/LTC 同步，唔係講資源衝突）
2. **GarageCube team 確認兩者同為 OpenGL app 共用 GPU**：mad-matt：「MadMapper 6 is still OpenGL based... Same with other OpenGL apps (ie Resolume etc.). It will start on the GPU the main display is attached to.」【官方 forum】https://forum.garagecube.com/viewtopic.php?f=20&t=36471
3. **Resolume→MadMapper texture sharing 係官方支援 workflow**：MadMapper 文檔教用 Spout（Windows）接收 Resolume 輸出，並直接 link 去 Resolume 官方 Syphon/Spout 文檔【官方】https://docs.madmapper.com/madmapper/6/11.-live-performance-and-control （"Tutorial for sending from Resolume (Texture Sharing): https://resolume.com/support/en/syphonspout"）；Resolume 官方都明言「send your Resolume output to another application like MadMapper」【官方】https://resolume.com/support/en/syphonspout ；Spout 官方站亦列 Resolume/MadMapper 為支援 app【官方】https://spout.zeal.co/
4. 未搵到官方 forum 有專門討論「8GB VRAM 機同時跑 Resolume＋MadMapper」嘅 thread —【未證實／未搵到一手來源】（forum 搜尋 "resolume" 有 304 個結果，首頁最相關嘅已列上面；其餘 20 頁未逐頁翻）

---

## 「MadLaser」名詞核實

**核實結果：「MadLaser」係 GarageCube 官方產品名 — MadMapper 嘅付費 laser extension，唔係另一個獨立軟件，亦唔係用戶自創詞。**

- 官方產品頁：https://madmapper.com/extensions/madlaser —「MadLaser — The laser extension for MadMapper」「Requires MadMapper 5 or above to run」【官方】
- 官方文檔有專屬章節 "7. Laser MadLaser"【官方】https://docs.madmapper.com/
- 官方 forum 有 madLaser 專屬分版（viewforum.php?f=52）【官方】https://forum.garagecube.com/search.php?keywords=resolume 頁尾 forum 列表
- 授權模式：獨立於 MadMapper 主授權，perpetual 199€ 起／rental 19€/月起；demo 版 laser output 每 120 秒 blackout【官方】https://madmapper.com/extensions/madlaser
- MadMapper 本體（冇 MadLaser）官方明言：「Beams of light are not supported with MadMapper 5!」但「Video and LED and even Lasers can work together in the same application」（指裝咗 MadLaser）【官方】https://www.garagecube.com/madmapper/
- 歧義排查：搵唔到任何叫「MadLaser」嘅第三家產品；用戶講嘅「laser 部分」＝MadMapper＋MadLaser extension 同一個 process（MadLaser 係 in-app extension，唔係獨立 exe）【官方，建基上面來源】

對共存分析嘅含義：**得兩個 GPU process（Resolume、MadMapper[含 MadLaser]），唔係三個**；第三個係我哋嘅 WebGL 工具。

---

## 三 app 同機 VRAM 預算推算

### 官方數字（硬事實）

| 事實 | 來源 |
|---|---|
| 用戶機：RTX 3070 Ti、8GB VRAM | 用戶提供（已知事實）；NVIDIA 官方產品頁 https://www.nvidia.com/en-us/geforce/graphics-cards/30-series/rtx-3070-3070ti/ 存在但抓取內容被截斷，未能喺抓低嘅文字確認 8GB —【未證實（官方頁面文字）】 |
| Resolume Windows minimum：Win10＋Nvidia/AMD＋8GB RAM；recommended：Win11＋i7 6core＋**Nvidia RTX 4070**＋M2 SSD＋16GB RAM | 【官方】https://resolume.com/support/en/tech-specs （主管已核實；本次抓取再次確認原文） |
| Resolume 官方**冇**列 VRAM 數字（minimum/recommended 都冇） | 【官方】同左 |
| RTX 4070 = 12GB GDDR6X | 【未證實】— NVIDIA 4070 家族頁抓取被截斷，冇抓到 spec 表；12GB 係坊間常識數字，本研究未能從官方抓取文字確認 |
| MadMapper minimum：2GB RAM＋OpenGL 3.3 GPU；recommended：8GB RAM（16GB+ better）＋dedicated GPU；**冇 VRAM 數字** | 【官方】https://docs.madmapper.com/madmapper/6/13.-setup-and-installation/requirements |
| Chrome/Edge 單一 tab GPU 記憶體上限官方數字 | **未搵到**。Chromium 官方 design doc 只解釋 GPU process/tile 記憶體機制（「GPU memory is then allocated to tiles based on their priority... fill the available memory budget」），冇公開 per-tab 硬數字【官方（機制）】https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/ ；具體上限【未證實】 |

### 推算過程【全部推算，非官方】

前提假設：1080p 或 1440p composition、Resolume 出 1–2 個 screen、MadMapper 出 1 個 projector/laser preview、新工具係一個細 WebGL viewport（果蠅腦 3D）。

| 項目 | 估算 VRAM | 點計 |
|---|---|---|
| Windows DWM＋desktop composition | ~0.5–1.0GB | DWM 每個 window 有 off-screen redirection surface【官方機制：https://learn.microsoft.com/en-us/windows/win32/dwm/dwm-overview 】；laptop 內置屏＋UI 表面合計【推算】 |
| Resolume Arena 7.23 | ~1.5–3.0GB | DXV/HAP clip decode surfaces＋composition render targets＋Advanced Output slices；官方冇數字，按同類 OpenGL/D3D VJ software 一般開銷【推算】 |
| MadMapper＋MadLaser | ~0.5–1.5GB | OpenGL 3.3 context＋media textures＋output surfaces＋laser vectorization（OpenCV GPU）【官方功能列表：requirements/MadLaser 頁；用量推算】 |
| 新工具（WebView2/Chromium WebGL tab） | ~0.3–1.0GB | Chromium GPU process 共享 context＋WebGL canvas backbuffer＋3D scene textures【官方機制：chromium.org design doc；用量推算】 |
| **合計** | **~2.8–6.5GB** | |
| **8GB 之後剩餘 headroom** | **~1.5–5.2GB（樂觀）／可能負數（悲觀）** | WDDM 2.0+ 有 GPU virtual memory＋driver residency，超出實體 VRAM 會 spill 去 system RAM，係性能懸崖而唔係即刻 crash【官方機制：https://learn.microsoft.com/en-us/windows-hardware/drivers/display/gpu-virtual-memory-in-wddm-2-0 】 |

**結論【推算】**：名義上 8GB 裝得落三個 app，但 headroom 好取決於 Resolume composition 複雜度（clip 數量、解像度、Advanced Output slices）同 MadMapper surface/media 數量。安全預算：**新工具應該假設自己只有 ~500MB–1GB VRAM 可用**，即係：
- WebGL canvas 唔好大過 ~1280×720 顯示解像度（render target 可以 2x 但唔好 4x）
- 果蠅腦 3D mesh/texture 總量控制喺幾百 MB 內
- 避免喺工具入面 cache 大量 video texture
- Resolume 官方 recommended GPU 係 RTX 4070（比用戶機高一班），用戶機已低於 recommended — 新工具任何 VRAM 浪費都直接侵蝕表演軟件嘅 headroom【官方（recommended spec）＋推算（影響）】

VRAM 耗盡時嘅官方行為：WDDM virtual memory management 會將 allocation 搬去 system memory（性能跌），TDR（timeout detection and recovery）會 reset 掛死嘅 GPU【官方】https://learn.microsoft.com/en-us/windows-hardware/drivers/display/windows-vista-display-driver-model-design-guide 。即係最壞情況唔係乾淨嘅 OOM error，而係全機 GPU stall／driver reset — 表演中呢個係災難，所以預算要保守。

---

## Windows GPU／DWM／fullscreen 共享規則

全部【官方】Microsoft Learn／DirectX Dev Blog：

1. **WDDM（Windows Display Driver Model）**：GPU 係 preemptively multitasked 嘅共享資源 —「GPU scheduling: Preemptive scheduling allows for better management of GPU resources because multiple applications can share the GPU more efficiently」；有 virtual memory management（VRAM 唔夠可以 spill 去 system memory）、per-process GPU virtual address space（WDDM 2.0+）、TDR 容錯。
   https://learn.microsoft.com/en-us/windows-hardware/drivers/display/windows-vista-display-driver-model-design-guide
   https://learn.microsoft.com/en-us/windows-hardware/drivers/display/gpu-virtual-memory-in-wddm-2-0
2. **DWM（Desktop Window Manager）**：desktop composition 之下「individual windows no longer draw directly to the screen... their drawing is redirected to off-screen surfaces in video memory, which are then rendered into a desktop image」。即係所有 windowed app（包括 Resolume/MadMapper/我哋工具）都經 DWM 合成，各自食 VRAM 做 off-screen surface。
   https://learn.microsoft.com/en-us/windows/win32/dwm/dwm-overview
3. **Fullscreen Exclusive (FSE) vs Borderless/Windowed**：
   - FSE「gives your game complete ownership of the display and allocation of resources of your graphics card」；windowed/borderless 之下「The Desktop Window Manager (DWM) has control of the display, while the graphics resources are shared among all applications」。Windows 10 起 Fullscreen Optimizations 會將 FSE game 自動轉行「highly optimized borderless windowed」，官方數據話性能幾乎同 FSE 一樣，同時保留 alt-tab/多屏幕/overlay 好處。
     https://devblogs.microsoft.com/directx/demystifying-full-screen-optimizations/
   - **DXGI SetFullscreenState 官方列明會失敗嘅情況**：「The output window is occluded」「The output window does not have keyboard focus」「**Another application is already in full-screen mode**」→ 回 `DXGI_ERROR_NOT_CURRENTLY_AVAILABLE`。即係一個 app 食咗 exclusive fullscreen，其他 app 就攞唔到 — 呢個係「新工具絕對唔可以入 exclusive fullscreen」嘅官方依據。
     https://learn.microsoft.com/en-us/windows/win32/api/dxgi/nf-dxgi-idxgiswapchain-setfullscreenstate
   - Flip presentation model：back buffer 直接 share 俾 DWM 合成，減少 copy — modern windowed app（包括 Chromium/WebView2）行呢條路，同其他 app 和平共處。
     https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/dxgi-flip-model
4. **對三 app 嘅含義【推算，建基上面官方規則】**：只要三個 app 都係 windowed/borderless（Resolume 同 MadMapper 嘅 output window 都係 DWM-composited；MadMapper 係 OpenGL app【官方 forum 來源見上】），Windows 會 time-slice GPU 同合成所有 surface。新工具唔使亦唔應該尝试任何 exclusive 模式；佢要做嘅只係：細 window、低 fps 上限（例如 30fps）、唔好 constantly 搶 GPU queue 優先。

---

## 必須避免嘅 Windows API 清單

全部【官方】Microsoft Learn：

| API | 官方副作用 | 點解要避免 | 來源 |
|---|---|---|---|
| `SetWindowsHookEx(WH_KEYBOARD_LL)` 全域鍵盤 hook | hook 喺安裝佢嘅 thread context 行；**處理超過 LowLevelHooksTimeout（Win10 1709+ 上限 1000ms）會被系統靜默移除**；global hook 係 shared resource，「installing one affects all applications in the same desktop」；32-bit hook 令 hooking app 唔 pump message 時「might block the normal functioning of the 64-bit processes」 | 表演中我哋工具一旦卡頓，全系統鍵盤輸入（包括用戶操作 Resolume/MadMapper 嘅快捷鍵）都會被拖慢或者吞走 | https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowshookexw ＋ https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc |
| `LowLevelKeyboardProc` 官方替代建議 | 官方明文：「In most cases where the application needs to use low level hooks, it should monitor **raw input** instead」 | 連 MS 自己都叫唔好用 LL hook | 同 lowlevelkeyboardproc URL |
| `SetForegroundWindow` | 系統限制邊個 process 可以 set foreground：calling process 要係 foreground process／被 foreground process 啟動／收到 last input event 等等先得；**「An application cannot force a window to the foreground while the user is working with another window. Instead, Windows flashes the taskbar button」**；仲有可能「denied the right... even if it meets these conditions」 | 用戶表演中 foreground 一定係 Resolume 或 MadMapper — 我哋工具叫 SetForegroundWindow 只會 taskbar 閃（最好情況）或者干擾 focus 狀態；正確做法係**永遠唔主動搶 focus**，只喺用戶自己 click 我哋 window 時先有 focus | https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow |
| `RegisterRawInputDevices` ＋ `RIDEV_NOLEGACY` / `RIDEV_INPUTSINK` / `RIDEV_CAPTUREMOUSE` flags | `RIDEV_NOLEGACY`：「prevents any devices... from generating legacy messages」（吞走 WM_KEYDOWN 等）；`RIDEV_INPUTSINK`：「enables the caller to receive the input even when the caller is not in the foreground」；`RIDEV_CAPTUREMOUSE`：「the mouse button click does not activate the other window」；另外「Only one window per raw input device class may be registered... within a process」 | NOLEGACY/INPUTSINK/CAPTUREMOUSE 等於背景監聽＋吞輸入 — 直接違反「唔獨佔 input」硬界線。Raw Input 只可以用**零 flags（default：跟隨 window focus）＋只喺自己 window focused 時收事件** | https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerrawinputdevices ＋ https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-rawinputdevice |
| WASAPI exclusive mode（`AUDCLNT_SHAREMODE_EXCLUSIVE`） | 「Exclusive-mode streams **seize the audio endpoint—all system sounds, notifications, and audio from other applications are silenced**」；官方 tip 叫 developer「Evaluate shared-mode low-period streams before committing to exclusive mode」；預設 exclusive 請求仲會 preempt 緊行嘅 shared streams | MadMapper 可能同時要 audio input（beat detection）；Resolume 都要 audio；新工具獨佔 mic/speaker = 直接窒斷表演 | https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams |
| `IAudioClient::Initialize` 失敗模式 | shared-mode 請求喺裝置已被 exclusive 使用時會失敗；exclusive 請求喺裝置被用時回 `AUDCLNT_E_DEVICE_IN_USE` | 證明 audio 裝置狀態係零和嘅 — 一定要全程 shared | https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-initialize |
| DXGI `SetFullscreenState(TRUE)` | 見上節：另一個 app 已 fullscreen 會回 `DXGI_ERROR_NOT_CURRENTLY_AVAILABLE`；成功嘅話就攞到 display complete ownership | 新工具（或者佢嘅 WebView）永遠唔好請求 exclusive fullscreen | https://learn.microsoft.com/en-us/windows/win32/api/dxgi/nf-dxgi-idxgiswapchain-setfullscreenstate |
| DirectInput exclusive acquire（`DISCL_EXCLUSIVE`） | 【未證實】— 本次未能抓到 `IDirectInputDevice8::SetCooperativeLevel` 官方頁面全文（只抓到同系列 DirectInput8Create/SetEventNotification 頁：https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee416756(v=vs.85) ）；DirectInput 本身已被 Microsoft 標記為 legacy/deprecated 路線 | 結論不变：新工具唔應該用 DirectInput，更唔應該 exclusive acquire；用 browser/Gamepad API 或者乜都唔用 | 上面 URL（部分）＋【未證實】 |
| 裝置 exclusive access（一般原則） | Windows audio 官方：exclusive 會 preempt shared【官方，見上】；MIDI 舊 WinMM API 一台裝置一個 client（`MMSYSERR_ALLOCATED`）【官方，見下節】 | 任何「獨佔裝置」模式都違反硬界線 | 各節來源 |

---

## MIDI 多 app 共用與 Windows 11 MIDI 2.0 問題

### 舊 stack（WinMM/MME）：一個 MIDI port 一次只俾一個 app 開

【官方】Microsoft Learn：
- `midiInOpen` 回傳錯誤表包括 **`MMSYSERR_ALLOCATED` — "The specified resource is already allocated."**
  https://learn.microsoft.com/en-us/windows/win32/api/mmeapi/nf-mmeapi-midiinopen
- `midiOutOpen` 同樣有 `MMSYSERR_ALLOCATED`
  https://learn.microsoft.com/en-us/windows/win32/api/mmeapi/nf-mmeapi-midioutopen

即係用傳統 WinMM API 嘅 app（Resolume 同 MadMapper 嘅 MIDI 支援大概率係呢類【未證實：兩家官方都冇公開佢哋用邊個 MIDI API】），同一個 MIDI controller **唔可以**同時被兩個 app 開 — 第二個 app 會攞到 MMSYSERR_ALLOCATED。

### 新 stack（Windows MIDI Services，2026-02 起 Windows 11 rollout）：官方 multi-client

【官方】Windows Experience Blog（2026-02-17）：
- 「The No. 1 request for MIDI in Windows has been to allow multiple apps to use the same MIDI port/device at the same time... **Now, every MIDI 1.0 port and MIDI 2.0 endpoint is multi-client, regardless of the driver or API used.**」
- 內置 loopback endpoints（app-to-app MIDI），連 WebMIDI browser page 都用到
- https://blogs.windows.com/windowsexperience/2026/02/17/making-music-with-midi-just-got-a-real-boost-in-windows-11/

### Windows 11 MIDI 2.0 update 已知問題（Resolume 官方文章＋MS 官方 blog）

【官方】Resolume：「MIDI Troubles on Windows 11 with MIDI 2.0 update」（v7）
https://resolume.com/support/en/midi-troubles-on-windows-with-midi-2-0-update
- Windows 11 2026-02 update 推嘅新 MIDI 2.0 implementation 令 Resolume MIDI controller 出問題
- 檢查工具：Microsoft enablement checker https://microsoft.github.io/MIDI/
- Resolume 官方修法：Device Manager > Sound, video and game controllers > MIDI controller > Update Driver > Browse my computer > Let me pick > **揀 `USBMidi2-ACX` driver** > 插拔 controller > 重開 Resolume

【官方】Microsoft（Windows MIDI Services rollout known issues，2026-02-04 發布、2026-04-30 更新）：
https://devblogs.microsoft.com/windows-music-dev/windows-midi-services-rollout-known-issues-and-workarounds/
- 只影響 Windows 11 retail 24H2/25H2/26H1 嘅 phased rollout
- 已知問題：inMusic 系 driver lock up MIDI Service；loopMIDI/loopBE/rtpMIDI 等 dynamic ports 間中唔見；WinRT MIDI 1.0 timestamp bug；多部同名 device 會連錯部；舊 Hercules DirectMusic driver 唔支援（by design）
- **官方警告：唔好 uninstall Windows update 去「修復」** —「Uninstalling those updates generally results in uninstalling the bug fixes and resulting in a worse or completely broken MIDI experience」；用 vive tool 等 CFR-disabling 工具喺 4 月尾之後會失效

### 對用戶 set 嘅含義【推算，建基上面官方事實】

1. 如果 Resolume 同 MadMapper 要**同時用同一個 MIDI controller**：舊 MIDI stack 下一部攞到、另一部攞 MMSYSERR_ALLOCATED；新 Windows MIDI Services 下官方 multi-client 理論上解決 — 但用戶部機啱啱經歷緊呢個 rollout 嘅 bug 潮（Resolume 官方已出 troubleshooting 文章），**表演前必須實測**。
2. 新工具**唔應該開任何 MIDI 裝置**（連 read-only 都唔好），咁就完全避開呢個戰場；要控制就用 OSC/WebSocket。
3. 用戶部機係 Win10 定 Win11【未知，要問】— Windows MIDI Services 只喺 Win11 rollout；Win10 就一定係舊 single-client 行為。

---

## WASAPI／audio 共享約束

【官方】Microsoft Learn Core Audio：

1. **Shared vs exclusive 定義**：「if an application opens a stream in exclusive mode, the application has exclusive use of the audio endpoint device... In contrast, **several applications can share an audio endpoint device by opening shared-mode streams**」；capture 都一樣：「In shared mode, several clients can share the captured stream from an audio hardware device. In exclusive mode, one client has exclusive access」
   https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams
   https://learn.microsoft.com/en-us/windows/win32/coreaudio/user-mode-audio-components
2. **Exclusive 嘅官方警告**：seize endpoint、靜音所有系統聲同其他 app；preemption 預設開啟（exclusive 請求會搶走 shared streams）；用戶可以喺 Sound settings per-device 禁 exclusive
   https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams
3. **官方建議**：「Always provide a user-visible option to fall back to shared mode, and release the device promptly when your application loses focus」；Win10 起 `IAudioClient3` shared-mode low-period streams 已經有接近 exclusive 嘅 latency —「Evaluate shared-mode low-period streams before committing to exclusive mode」
   同上的 URL
4. **結論：新工具只可以用 shared mode** — 因為 MadMapper 可能同時開住 audio input（官方功能，見上），Resolume 都有 audio（官方 "Audio input no worky" support 文章存在：https://resolume.com/support/en/audio-input-no-worky ），exclusive 會即刻窒斷佢哋。呢個唔係偏好，係硬規則。

### Browser（getUserMedia/Web Audio）行咩 mode？

- Web Audio API 標準（W3C）本身冇規定底層 OS audio mode —【官方（spec 冇此內容）】https://www.w3.org/TR/webaudio-1.1/
- Chromium 官方文檔指 audio I/O 抽象層喺 `media/audio`（「OS audio input/output abstractions」）—【官方】https://www.chromium.org/audio-video/ ；Chromium 喺 Windows 用 WASAPI shared mode 係社群共識但本次未能抓到 Chromium 官方聲明文字 —【未證實】。實務上 browser 從不請求 exclusive mode（冇呢個 API surface），所以 **getUserMedia 分析 mic ＝ shared-mode capture，同 MadMapper/Resolume 共存安全**【推算，建基上面官方架構描述】。
- 注意：getUserMedia 只俾你讀 mic input。如果要分析「系統播放緊嘅音樂」（例如 Resolume 出緊嘅 audio），browser 冇 loopback capture API — 需要 mic 拾聲、或者 user 手動 route（例如 virtual audio cable）【推算；WASAPI loopback 係 native-only flag：https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-initialize （AUDCLNT_STREAMFLAGS_LOOPBACK）】。

---

## Chrome autoplay／getUserMedia／secure context 規則

全部【官方】：

1. **Chrome autoplay policy**（舊 draft 撞嘅 NotAllowedError 就係呢個）：
   https://developer.chrome.com/blog/autoplay
   - Muted autoplay 永遠允許
   - 有聲 autoplay 要：用戶同個 domain 有過互動（click/tap）、或者 desktop MEI（Media Engagement Index）夠高、或者裝咗 PWA
   - 「When the permissions policy for autoplay is disabled, calls to `play()` without a user gesture will reject the promise with a **`NotAllowedError` DOMException**」
   - **Web Audio 由 Chrome 71 起納入 autoplay policy**：「If an `AudioContext` is created before the document receives a user gesture, it will be created in the "suspended" state, and you will need to call `resume()` after the user gesture」
   - 官方逃生門：command-line flag `chrome.exe --autoplay-policy=no-user-gesture-required`；enterprise policy `AutoplayAllowed`／`AutoplayAllowlist`（kiosk/unattended 用途）
   - 官方 best practice：「Don't ever assume a video will play」— 要 handle promise rejection 同埋俾一個 Play 按鈕
2. **getUserMedia permission**：
   https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
   - 「**Secure context:** This feature is available only in secure contexts (HTTPS), in some or all supporting browsers」
   - 用戶拒絕／policy 唔允許 → `NotAllowedError`；insecure context 下 `navigator.mediaDevices` 直接係 `undefined`（`TypeError`）
3. **Secure context：localhost 得，唔使 HTTPS**：
   https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts
   - 「Documents are secure contexts when their resources are delivered over an HTTPS connection, **or are delivered from a loopback (local) address**」
   - potentially trustworthy origins 包括 `http://localhost`、`127.0.0.0/8`、`::1`、`file:` 
   - 所以舊 draft 嘅 `http://localhost:54654` 形式**本身係 secure context**，getUserMedia 可用；佢死因唔係 secure context，而係 autoplay gesture 要求＋server idle 死＋tab 管理【推算，建基官方規則＋舊 draft 病徵】
4. **Web 標準層面**：W3C Secure Contexts spec 係 canonical 定義（MDN 頁引用 https://w3c.github.io/webappsec-secure-contexts/ ）；Web Audio spec 冇 autoplay 條款（autoplay 係 browser policy，唔係 web 標準）【官方】https://www.w3.org/TR/webaudio-1.1/

**對新工具嘅設計規則**：
- AudioContext 一定要喺第一次用戶 click（例如「開始监听」按鈕）之後先 create 或者 resume — 呢個係 unavoidable，除非用 Electron（見下節，佢有官方 autoplayPolicy setting）
- 唔好假設任何 media 會自動播；所有 audio 分析路徑都要有 suspended-state fallback（分析暫停但 UI 唔死）
- localhost/127.0.0.1 服務就夠 secure context，唔使自己搞 HTTPS cert

---

## 四種部署形态比較表＋推薦

先講同場事實：**browser 唔可以直接發 OSC/UDP** — OSC packet 通常行 UDP datagram【官方 spec：「An OSC packet can be naturally represented by a datagram by a network protocol such as UDP」 https://opensoundcontrol.stanford.edu/spec-1_0.html 】，而 web platform 冇 raw UDP socket API：WebTransport 係 HTTP/3 over QUIC（要對方有 HTTP/3 server）【官方】https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API ；WebRTC datachannel 要 peer 同 signaling【未證實：本次冇抓 WebRTC spec，屬常識級事實】。**但**：
- Resolume 有官方 **WebSocket API**（`ws://address:port/api/v1`，JSON，subscribe/set/get/trigger，官方仲有 browser 控制 Arena 嘅 working example）【官方】https://resolume.com/support/en/websocket-api ＋ REST API【官方】https://resolume.com/support/en/restapi — browser 可以直連，唔使 bridge
- MadMapper OSCQuery 自 5.4.0 起「supports websocket」【官方 release notes】https://docs.madmapper.com/madmapper/6/15.-troubleshooting/madmapper-release-notes-history — browser 直連 MadMapper **有可能**，但 plain OSC message 係咪經同一 WebSocket transport、地址格式點，官方文檔未明講【未證實】

所以「仲使唔使原生 bridge」嘅答案：**控 Resolume 可以唔使（WebSocket 直連）；控 MadMapper 穩陣做法仍係原生層發 UDP OSC 去 8010**（除非 OSCQuery-over-WebSocket 路線被實測證實）。

### 比較表

評分：✅ 好 / ⚠️ 有條件 / ❌ 差。所有「官方」欄位帶 URL；冇來源嘅一律標【推算】。

| 準則 | (a) Tauri 2（Rust＋WebView2） | (b) Electron（Node dgram） | (c) 靜態 web UI＋原生 sidecar | (d) Browser 開 localhost（舊 draft） |
|---|---|---|---|---|
| 雙擊就開 | ✅ 單一 exe/MSI bundle【官方】https://v2.tauri.app/distribute/windows-installer/ | ✅ 單一 installer | ⚠️ 兩個 component，要 sidecar 同 UI 都起得嚟【推算】 | ⚠️ 要先起 server 再開 browser；server 死就「website 開唔到」（舊 draft 實證） |
| 唔會 idle 自己死 | ✅ 原生 process，冇 browser tab lifecycle【推算】 | ✅ 同左 | ⚠️ sidecar 存活要自己顧（watchdog）【推算】 | ❌ tab 會被 memory saver/discarding 機制處理；舊 draft 已實證 port 54654 idle 2 小時死。（Chrome tab discarding 官方政策文檔本次未抓到 —【未證實】） |
| 唔搶 focus | ✅ 正常 windowed app；Windows 本身禁止 SetForegroundWindow 搶 focus（官方限制反而係保障）【官方】https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow | ✅ 同左 | ✅ UI 係 browser tab，focus 跟用戶 | ⚠️ 同 (c)，但通知/dialog 會經 browser |
| Autoplay／permission | ⚠️ WebView2 係 Chromium-based；localhost asset 係 secure context【官方 MDN secure contexts】；AudioContext 仍要一次 user gesture 先 resume【推算自 Chrome policy；WebView2 有冇 `--autoplay-policy` equivalent flag 未證實】 | ✅ **官方 `webPreferences.autoplayPolicy` 預設 `no-user-gesture-required`** — autoplay 問題直接消失【官方】https://www.electronjs.org/docs/latest/api/structures/web-preferences | ⚠️ 視乎 UI 喺邊度開；browser tab 就要 gesture | ❌ 完整 Chrome autoplay policy 適用，NotAllowedError 風險最高【官方】https://developer.chrome.com/blog/autoplay |
| getUserMedia/mic | ✅ WebView2 secure context（localhost/自訂 protocol）【推算；WebView2 permission 模型官方頁未抓，未證實細節】 | ✅ 官方有 `MediaAccessPermissionRequest`／session permission handler【官方】https://www.electronjs.org/docs/latest/api/structures/media-access-permission-request | ✅ browser 側同 (d) | ✅ localhost = secure context【官方 MDN】 |
| 記憶體負擔 | ✅ 用系統 WebView2 runtime（Evergreen，Windows 10/11 普遍已裝）【官方】https://learn.microsoft.com/en-us/microsoft-edge/webview2/ ；binary 細（官方 App Size 指南）【官方】https://v2.tauri.app/concept/size/ ；實際 RAM/VRAM 數字冇官方 —【推算：比 Electron 細】 | ❌ 自帶成個 Chromium；multi-process（main＋renderer＋GPU process）【官方架構】https://www.electronjs.org/docs/latest/tutorial/process-model ；實際開銷冇官方數字 —【推算：幾百 MB RAM 起】 | ⚠️ browser（成個 Chrome process tree）＋sidecar | ⚠️ 用戶日常 browser，唔額外裝嘢但 tab 額外食 GPU process 資源【推算】 |
| Single instance | ✅ 官方 Single Instance plugin（Windows 支援）【官方】https://v2.tauri.app/plugin/single-instance/ | ✅ 官方 `app.requestSingleInstanceLock()`＋`second-instance` event【官方】https://www.electronjs.org/docs/latest/api/app | ❌ 自己砌 | ❌ 不適用 |
| Autostart | ✅ 官方 Autostart plugin（Windows 支援）【官方】https://v2.tauri.app/plugin/autostart/ | ⚠️ `app.setLoginItemSettings` 喺官方 app API 頁（本次抓取被截斷，未能直接核實方法名 —【未證實】） | ❌ 自己砌（Task Scheduler 等） | ❌ 冇 |
| 背景穩定運行 | ✅ Rust process；官方有 logging plugin【官方】https://v2.tauri.app/plugin/logging/ | ✅ utility process 可以隔離 crash-prone component【官方】https://www.electronjs.org/docs/latest/tutorial/process-model | ⚠️ 兩 process 互相依賴 | ❌ browser 更新／tab discard／用戶手誤閂 tab 都係風險【推算】 |
| 原生發 OSC/UDP | ✅ Rust std UdpSocket（語言能力，唔係 Tauri feature —【推算】）；官方另有 sidecar binary 機制【官方】https://v2.tauri.app/develop/sidecar/ | ✅ Node `dgram`（語言能力）；官方有 WebSocketOptions 結構【官方】https://www.electronjs.org/docs/latest/api/structures/web-socket-options | ✅ sidecar 本身就係為呢個而設 | ❌ 做唔到（browser 冇 UDP；見本節開頭） |

### 推薦

**首選：(a) Tauri 2**，理由（全部對應上面來源）：
1. 表演機 VRAM/RAM 已經低於 Resolume recommended spec — Tauri 用系統 WebView2＋細 binary，係四個方案入面額外記憶體負擔最細嘅【官方 size/WebView2 文檔＋推算】。
2. 官方 Single Instance＋Autostart plugin 直接解決舊 draft 嘅「雙擊就開、唔會開兩份、開機自動起」需求【官方 plugin 文檔】。
3. Rust 原生層可以 bind UDP socket 發 OSC 去 MadMapper 8010 同（如需）Resolume 7000，同時 browser-side WebSocket 直連 Resolume WS API — 兩條路都唔使額外 process【官方 Resolume WS API＋推算】。
4. 佢係一個普通 windowed app：唔會 exclusive fullscreen、唔會搶 focus（SetForegroundWindow 官方限制對所有 app 一視同仁，我哋只要唔去 call 佢就得）。
5. 代價：AudioContext 要一次 user gesture 先 resume（Chrome/Chromium autoplay policy 對 WebView2 嘅適用細節未證實，保守當作適用）— 現場流程上即係「開 app 後撳一下『Start audio』」，可接受；WebView2 係 Edge/Chromium runtime，Windows 10/11 官配【官方 MS WebView2 文檔】。

**後備：(b) Electron** — 如果實測發現 WebView2 嘅 autoplay/gesture 行為搞唔掂，Electron 官方 `autoplayPolicy: no-user-gesture-required`（而且係預設值）係唯一有官方文書保證「零 gesture 都做到 audio 分析」嘅方案【官方 WebPreferences】；代價係記憶體同 bundle 大【推算】。

**唔推薦：(c) sidecar** — 多一個 process 就多一個「idle 死咗冇人知」嘅 failure point，正正係舊 draft 教訓；除非 Tauri/Electron 都撞板先考慮。
**唔推薦：(d) browser localhost** — 舊 draft 已實證三条死法（autoplay NotAllowedError、server idle 死、開唔到），而且 browser tab 嘅生命周期（discarding、用戶手誤）喺表演中不可控。

---

## 未證實項目清單

1. RTX 3070 Ti（laptop）8GB VRAM 嘅 NVIDIA 官方 spec 數字 — 官方頁存在但抓取被截斷，未能確認文字。用戶提供值當已知事實用。
2. RTX 4070 = 12GB — 官方家族頁抓取被截斷；此數字未從一手來源確認。
3. Chrome/Edge 單一 tab 嘅 GPU 記憶體硬上限 — 搵唔到官方數字；Chromium design doc 只講 tile priority＋memory budget 機制。
4. MadMapper OSC input port「8000」vs「8010」— 官方兩頁有出入（OSC Commands 頁寫 typically 8000；Preferences 頁寫 default 8010）。要在用戶部機 Preferences > OSC/MIDI 實測。
5. MadMapper OSCQuery-over-WebSocket 可唔可以承載 plain OSC message（即 browser 直連 MadMapper 可唔可行）— release notes 只寫「supports websocket & LISTEN/PATH ADDED...」，冇完整 protocol 文檔。
6. Resolume／MadMapper 內部用邊個 Windows MIDI API（WinMM 定 WinRT）— 兩家官方都冇公開；MMSYSERR_ALLOCATED 分析建基於「如果用 WinMM 就會撞」。
7. Chromium/WebView2 喺 Windows 上用 WASAPI shared mode 嘅官方明文 — `media/audio` 抽象層有官方文檔指認，但「shared mode」字樣未從官方文字抓到。
8. Electron `app.setLoginItemSettings`（autostart）— 方法喺官方 app API 頁，但本次抓取被截斷未能核實原文。
9. WebView2 有冇 `--autoplay-policy` equivalent（AdditionalBrowserArguments）— 未搵到官方明文。
10. MadMapper Windows 版 fullscreen 係 exclusive 定 borderless — 官方冇明講；推算係 windowed/borderless（OpenGL＋DWM 多屏操作描述）。
11. ASIO driver 係咪一定唔容许多 client — 行業常識，但本次冇抓 ASIO 官方 spec。
12. Chrome tab discarding/memory saver 對 localhost tab 嘅確切政策 — 未抓到官方 policy 文檔（舊 draft 病徵同佢一致，但只能標推算）。
13. GarageCube forum 其餘 20 頁 "resolume" 搜尋結果 — 未逐頁翻；「8GB VRAM 同機跑 Resolume＋MadMapper」嘅專門討論未搵到。

---

## 要問用戶嘅問題

1. **Windows 10 定 11？邊個 build（24H2/25H2）？** — 決定 MIDI stack 係舊 single-client 定新 Windows MIDI Services multi-client（後者有已知 rollout bugs，Resolume 官方已出 troubleshooting 文章）。
2. **Laser DAC 係咩型號／咩介面？**（LaserCube、EtherDream、ShowNET、Helios USB、FB3/FB4、定 AVB/Dante？）— 如果係 AVB/Dante，MadMapper 會強制 ASIO＋restart【官方】，audio 共存策略要整個改（新工具可能要避開同一張 audio card）。
3. **MadMapper 有冇買 MadLaser license？版本係 5 定 6？** — demo 版 laser output 每 120 秒 blackout【官方】，表演中唔可以用。
4. **新工具嘅音訊分析來源係 mic 定 line-in 定「Resolume 播出緊嘅聲」？** — browser/WebView 只能 capture mic（getUserMedia）；要攞系統 mix 就要 loopback（native-only）或者 hardware/virtual cable route。
5. **Resolume 同 MadMapper 會唔會同時要同一個 MIDI controller？** — 舊 stack 下會撞 MMSYSERR_ALLOCATED；新 stack 要先實測。
6. **表演機係咪得一個屏幕（laptop 屏）＋外接投影？** — MadMapper/Resolume 官方都要求 extended displays（唔好 mirror）【官方 FAQ】；新工具 window 放邊度要規劃。
7. **接受唔接受「開 app 後撳一下 Start audio」呢個手勢？** — 接受嘅話 Tauri 方案零障礙；唔接受就要 Electron（官方 autoplayPolicy bypass）。
8. **Resolume WebSocket API（Preferences > Webserver）喺用戶部機開咗未？port 係乜？** — 決定新工具控 Resolume 行 WS 直連定 OSC 7000。（另一 agent 正在查 WS API 細節，呢度只列部署依賴。）
