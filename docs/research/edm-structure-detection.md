# EDM 音樂結構轉折點即時偵測 — 研究報告（慢層）

> 研究日期：2026-11-17。方法：web_search 壞咗（401），全部用 web_fetch 直接抓 primary source（arXiv、GitHub raw、官方文檔、OpenAlex/Zenodo API）。冇安裝任何軟件、冇跑任何 benchmark。所有準確率數字均係論文／官方文檔公佈嘅數字，**唔代表本專案已實測**。冇來源嘅判斷一律標「設計判斷」／「未證實」。

---

## 一句結論

**即時（streaming）偵測 EDM build-up→drop 轉折點，目前冇任何已發表、可直接用嘅 ready-made 系統有公開準確率證據。** 學術界最新嘅 EDM 專門模型（EDMFormer，2026）仍然係 **offline**（要成首歌），作者自己都將「real-time inference for DJ-oriented applications」列為 future work（https://arxiv.org/abs/2603.08759）。即時可行嘅路線只有兩條：(1) **純 DSP heuristic**（低頻能量回落→瞬間回升＋spectral flux novelty＋onset density 變化），有間接學術支持但冇人喺 mic 收音條件下量過準確率；(2) **攞 DJ 嘅 metadata**（Resolume Arena 內置 Pro DJ Link／StageLinQ sync），準確但俾唔到「drop 事件」本身，而且要有條件接触到 DJ 器材。結論：**慢層第一版應該用 DSP heuristic＋beat-grid 量化＋人工 override，唔應該指望 ML 結構偵測即時可用。**

---

## 學術現況：offline vs streaming

### 總體判斷

Music structure analysis（MSA）／boundary detection 呢個領域，**絕大部分已發表方法係 offline**：佢哋要成首歌嘅 self-similarity matrix 或者 full-song embedding 先做到 clustering／segmentation。arXiv 搜索 `"online" AND "music structure analysis"` 只有一篇結果（而且係 symbolic music，唔係 audio）（https://export.arxiv.org/api/query?search_query=all:%22online%22+AND+all:%22music+structure+analysis%22）。真正做 causal/streaming 嘅已發表系統集中喺 **beat/downbeat tracking**（BeatNet、madmom online），唔係 section-level 結構偵測。

### 方法對照表

| 方法 | offline / streaming | 公開準確率 | Dataset | URL |
|---|---|---|---|---|
| Foote novelty（self-similarity matrix + checkerboard kernel，2000） | **offline**（要全曲 SSM） | 冇公開 F-measure（原論文係 audio segmentation 示範） | 自建 | https://doi.org/10.1109/ICME.2000.869637 |
| Paulus, Müller & Klapuri《Audio-based Music Structure Analysis》survey（ISMIR 2010） | survey：歸納咗當時方法全部係 offline（novelty curve、SSM clustering 等） | — | — | https://doi.org/10.5281/zenodo.1417288 |
| Serrà, Müller, Grosche & Arcos《Unsupervised Detection of Music Boundaries by Time Series Structure Features》（AAAI 2012；即 MSAF `sf` / 2D-FMC 一系） | **offline** | 論文內報 boundary F-measure（本次未抓到全文表格——未證實具體數字） | 自建 + 公開集 | https://doi.org/10.1609/aaai.v26i1.8328 |
| MSAF framework（Nieto & Bello, ISMIR 2016；含 foote novelty、CNMF、OLDA、scluster/Laplacian、sf/2D-FMC、VMO） | **offline**（framework 設計係逐個 file 分析） | 提供 MIREX 標準評估 metrics（HitRate 0.5s/3s、PWF 等），本身唔附準確率 | SALAMI、RWC 等 | repo: https://github.com/urinieto/msaf ；algorithms: https://msaf.readthedocs.io/en/latest/algorithms.html ；metrics: https://msaf.readthedocs.io/en/latest/eval.html |
| Kim & Nam《All-In-One Metrical and Functional Structure Analysis with Neighborhood Attentions on Demixed Audio》（WASPAA 2023） | **offline**（要先 Demucs source separation 再全曲分析） | Harmonix Set 四項任務（beat/downbeat/boundary/label）SOTA；具體數字見論文（本次抓到 README 冇列 F 值——未證實具體數字） | Harmonix Set | paper: https://arxiv.org/abs/2307.16425 ；repo: https://github.com/mir-aidj/all-in-one |
| SongFormer（2025） | **offline**（full-song SSL embedding，30s+420s 窗口） | SongFormBench-HarmonixSet：**ACC 0.807 / HR.5F 0.703 / HR3F 0.784**；RWC-Pop ACC 0.814；官方稱全首歌推理 2–4 秒（NVIDIA L40） | SongFormBench、HarmonixSet、RWC-Pop、SALAMI | paper: https://arxiv.org/abs/2510.02797 ；repo: https://github.com/ASLP-lab/SongFormer |
| **EDMFormer（CUCAI 2026）— EDM 專門** | **offline**；作者明言 real-time inference 係 future work | EDM-98 上：**HR@0.5s 0.616 / HR@3s 0.635 / ACC 0.883**；pop taxonomy 嘅 SongFormer zero-shot 只有 HR@0.5 0.569 / ACC 0.148 | **EDM-98**（98 首專業標註 EDM，含 drop/build-up label） | https://arxiv.org/abs/2603.08759 （全文：https://arxiv.org/html/2603.08759v1） |
| SCALE（2026，audio+lyrics） | **offline** | HarmonixSet HR.5F/HR3F 比 SongFormer +3.5/+4.2 pp（摘要數字） | SheetSage-MSA、HarmonixSet | https://arxiv.org/abs/2610.26253 |
| Temporal Adaptation of Pre-trained Foundation Models for MSA（WASPAA 2025） | **offline**（目標係全曲 single forward pass） | 摘要稱 boundary detection 同 function prediction 都提升（具體數字未抓到——未證實） | Harmonix Set、RWC-Pop | https://arxiv.org/abs/2507.13572 |
| MuSFA（ISMIR 2022 LBD） | 論文聲稱唔需要 full context（局部窗口預測 structural function），最接近「可 streaming 化」嘅 supervised MSA，但**冇已發表 streaming 實作或延遲數據** | 加入 HLSD 訓練後 boundary/labeling +~3%/+1%（cross-dataset） | SALAMI、RWC、Isophonics、HLSD | https://arxiv.org/abs/2211.15787 |
| SpecTNT structural functions（ICASSP 2022） | **offline**（spectral-temporal transformer，全曲） | 摘要稱 chorus detection 同 boundary detection 都贏當時 SOTA（具體數字未抓到——未證實） | 四個公開集 | https://arxiv.org/abs/2205.14700 |
| BeatNet（ISMIR 2021）— beat/downbeat/meter，**唔係** section 結構 | **streaming/online**（causal CRNN + particle filter） | F-measure ±70ms；GTZAN（訓練未見過）上贏多個 online beat/downbeat 系統（具體表格數字本次被截斷——未證實） | Ballroom、Beatles、GTZAN、Rock Corpus 等 | paper: https://arxiv.org/abs/2108.03576 ；repo: https://github.com/mjhydri/BeatNet |
| madmom DBNBeatTracker `online` mode | **streaming/online**（部分 program 支援 live audio，靠 pyaudio） | 各演算法參考論文（README References 列 19 篇，包括 Böck et al.《Online Real-time Onset Detection with Recurrent Neural Networks》DAFx 2012）；README 冇附準確率表 | — | https://github.com/CPJKU/madmom |

**重點：以上所有 section-level（build-up/drop/breakdown label）方法全部係 offline。** Streaming 已發表嘅只有 beat/downbeat/onset 層级。

---

## Drop detection 專門研究與 dataset

**答案：有一手研究，但全部都係 offline，而且冇一個係专门做「即時 drop 偵測」。**

1. **EDMFormer + EDM-98**（https://arxiv.org/abs/2603.08759）：目前搵到唯一直接以 EDM section taxonomy（intro / build-up / **drop** / breakdown / outro / silence / end）做 boundary detection + section labelling 嘅已發表論文。EDM-98 = 98 首 EDM tracks，兩名專業 annotator，±0.5s 精度，genre 分佈含 House/Deep House 19.4%、Electro/Dance、Techno、Trance/Progressive、Dubstep/Bass、DnB/Jungle 各 14.3%。論文核心發現：**pop-centric 模型（SongFormer）用喺 EDM 上 section label ACC 只有 0.148，EDM 專門 fine-tune 後 0.883** — 即係話「用流行曲模型直接偵測 drop」係實證失敗嘅。限制（作者自述）：只有 98 首、每首單一 annotator、模型 input 要 MuQ + MusicFM embedding（30s 同 420s 窗口）。**論文冇附 code/dataset 公開連結**（arXiv 頁同全文都冇 repo URL——未證實佢哋有冇 release）。
2. **EDM-CUE dataset + CUE-DETR**（https://arxiv.org/abs/2407.06823 ；repo https://github.com/ETH-DISCO/cue-detr ；dataset https://huggingface.co/datasets/disco-eth/edm-cue）：4,710 首 EDM tracks metadata（嚟自 4 個職業 DJ 嘅 rekordbox 收藏），21,461 個人手標 cue points，beat grid + BPM。CUE-DETR 用 DETR object detection 喺 mel spectrogram 上預測 cue point。**offline**（全曲 spectrogram sliding window）。準確率（論文 Table 2，tolerance = 1 beat）：CUE-DETR cues-only F1 **0.36**（r16）、Automix **0.13**、**Mixed In Key 10（商業軟件）0.22**；對齐 16-bar phrasing 後 CUE-DETR F1 升至 0.38。呢個係目前唯一抓到嘅、有第三方量度过嘅 **Mixed In Key cue point 準確率一手數字**。注意：cue point ≠ drop——cue point 係 DJ 認為適合換 track／跳段嘅位置。
3. **Zehren, Alunno & Bientinesi《Automatic Detection of Cue Points for DJ Mixing》（2020）**（https://arxiv.org/abs/2007.08411）：EDM「switch point」（DJ 轉 track 位）偵測，rule-based + novelty analysis，自評 ~96% 生成點「of good quality for use in a DJ mix」（呢個係作者自己嘅 quality assessment，唔係對第三方標註嘅 F-measure）。code：https://github.com/MZehren/Automix （MIT，https://raw.githubusercontent.com/MZehren/Automix/master/LICENSE）；dataset：https://github.com/MZehren/M-DJCUE （134 首 EDM，1987–2016，JAMS 格式標註，每首 ≥3 個 annotator；因版權**唔含 audio**）。
4. **Zehren, Alunno & Bientinesi《Interpretability of Methods for Switch Point Detection in Electronic Dance Music》（Signals, 2024）**（https://doi.org/10.3390/signals5040036，CC-BY open access）：比較 experience-driven（Automix）vs statistics-driven 方法，結論：**對 switch point 偵測最有影響力嘅 feature 係 signal energy 嘅 novelty、timbre、drum onsets 數量、harmony**（摘要經 OpenAlex API 抓取：https://api.openalex.org/works?search=Interpretability%20of%20methods%20for%20switch%20point%20detection%20in%20electronic%20dance%20music）。呢篇係 EDMFormer 引用嘅「energy novelty、drum onset counts、spectral flux 係 EDM structural transition 最強 cues」來源（見 EDMFormer I-A 節）。全文本次冇抓到（MDPI 403）——具體 feature importance 數字未證實。
5. **公開 dataset 有冇標 drop 位置？** 有：EDM-98 有 build-up/drop/breakdown section label（論文聲明 release，但冇公開連結——未證實可唔可以攞到）。EDM-CUE / M-DJCUE 標嘅係 cue point／switch point，唔係 drop section。搵唔到任何 dataset 係為「streaming drop detection」設計嘅。
6. **DJ 工具官方能力描述**：
   - Mixed In Key：官網（https://mixedinkey.com/）本次抓取被截斷，未能攞到官方功能描述原文——**未證實**。佢嘅 cue point 準確率只有 CUE-DETR 論文嘅第三方量度（上表，F1 0.22@1 beat）。
   - Keyfinder（Ibrahim Shaath）：library 已交由 Mixxx 團隊維護，**libKeyFinder 係 GPL-3.0-or-later**（https://raw.githubusercontent.com/mixxxdj/libkeyfinder/master/README.md）；功能係 key estimation，唔係結構偵測。GUI app 官方站（keyfinder.org）本次 fetch 失敗——未證實現狀。
   - Rekordbox：EDM-CUE 論文只說明 dataset metadata（tempo、beat grid、cue points）嚟自 rekordbox（https://arxiv.org/html/2407.06823v1 §3.1）；rekordbox.com 官方功能文檔本次未抓取——未證實。
   - Serato：未搵到一手來源，本次未抓取——未證實。

---

## real-time 開源庫表

| 庫 | 能力 | 授權（GPL 警告） | Streaming? | 官方公佈延遲／速度 | URL |
|---|---|---|---|---|---|
| **librosa** | audio/MIR 工具庫：STFT、onset、beat_track、feature 提取；**冇** section/build-up 偵測功能 | **ISC**（permissive，安全）（https://raw.githubusercontent.com/librosa/librosa/main/LICENSE.md） | ⚠️ `librosa.stream` 只係「大檔案分 block 讀」，官方 doc 明言「Many analyses require access to the entire signal to behave correctly, such as resample, cqt, or **beat_track**, so these methods will not be appropriate for streamed data」；冇 mic live capture API | 冇公佈 | https://librosa.org/doc/0.11.0/generated/librosa.stream.html |
| **Essentia** | C++ audio analysis：大量 low-level + high-level descriptors；有 streaming framework（`essentia::streaming::Algorithm`，Source/Sink token 架構，source code 可證）；有 beat/tracking 相關 algorithms | ⛔ **AGPL v3** — 對閉源 app 有強傳染性（AGPL 連網絡使用都觸發 copyleft；商用閉源要另外攞授權）。README 原文：「released under the Affero GPLv3 license」（https://raw.githubusercontent.com/MTG/essentia/master/README.md） | ✅ 有 streaming mode（框架層面確認：https://raw.githubusercontent.com/MTG/essentia/master/src/essentia/streaming/streamingalgorithm.h；官方 streaming tutorial 喺 http://essentia.upf.edu — 本次 fetch 失敗，教程內容未證實）。Windows 上 Python bindings 唔支援（official installing doc：「Essentia C++ library ... can be compiled and run correctly on Windows, but **Python bindings are not supported yet**」，https://raw.githubusercontent.com/MTG/essentia/master/doc/sphinxdoc/installing.rst） | 冇公佈 | https://github.com/MTG/essentia |
| **madmom** | Python MIR：onset、beat、downbeat、tempo、chord；`DBNBeatTracker online` 模式直接食 live audio（需要 pyaudio） | ⚠️ **雙授權**：source code **BSD**，但 **pre-trained model/data files 係 CC BY-NC-SA 4.0**（非商業！商用要聯絡 Gerhard Widmer 攞授權）（https://raw.githubusercontent.com/CPJKU/madmom/master/README.rst） | ✅ 部分 program 有 `online` mode（README：「Some programs can also be run in online mode, i.e. operate on live audio signals」）；冇 section 結構功能 | 冇公佈延遲 | https://github.com/CPJKU/madmom |
| **BeatNet** | online joint beat/downbeat/tempo/meter tracking：causal CRNN + 2-stage particle filter；`mode='stream'` **直接食 microphone input**；亦可用 `PF`（causal）或 `DBN`（offline） | **CC BY 4.0**（code repo LICENSE；注意 CC BY 係 content license，對 code 唔常見但明確容許商用+改作，要 attribution）（https://raw.githubusercontent.com/mjhydri/BeatNet/master/LICENSE） | ✅ 四種模式：stream（mic）/realtime/online/offline；**官方 README 警告：「in streaming usage cases, make sure to feed the system with as loud input as possible to leverage the maximum streaming performance, given all models are trained on the datasets containing mastered songs」**——直接講明 mic 細聲輸入會衰 | 論文：F-measure ±70ms tolerance；GTZAN 上贏 online baselines（數字被截斷——未證實）；hop 46ms、window 93ms（https://arxiv.org/html/2108.03576v1 §2.1） | https://github.com/mjhydri/BeatNet ；https://arxiv.org/abs/2108.03576 |
| **allin1（All-In-One）** | tempo+beats+downbeats+functional segments+labels（intro/verse/chorus/bridge/outro… — **pop taxonomy，冇 drop/build-up label**）（labels 清單見 README） | **MIT**（https://raw.githubusercontent.com/mir-aidj/all-in-one/main/LICENSE）；但 pipeline 內含 Demucs（source separation）＋ madmom（⚠️ madmom models 係 CC BY-NC-SA，README 安裝指引要求裝 CPJKU/madmom） | ❌ offline only（CLI 食 audio file；冇 streaming/mic 模式） | RTX 4090 + i9-10940X：10 首歌（33 分鐘）73 秒（harmonix-all ensemble）（README Speed 節） | https://github.com/mir-aidj/all-in-one |
| **SongFormer** | MSA：boundary + functional label（intro/verse/chorus/bridge/inst/outro/silence/pre-chorus — **pop taxonomy，冇 drop**） | **CC-BY-4.0**（README License 節） | ❌ offline only（全曲 SSL embedding：MuQ+MusicFM 30s/420s 窗口，要 GPU） | 官方：全首歌 2–4 秒（NVIDIA L40）；比 All-In-One（9–12s）、Gemini 2.5 Pro（30–90s）快（README Speed 節） | https://github.com/ASLP-lab/SongFormer |
| **CUE-DETR** | EDM cue point estimation（DETR on mel spectrogram） | repo README 冇列明 license 條款——**未證實** | ❌ offline（全曲 spectrogram sliding window） | 冇公佈；訓練用 NVIDIA TITAN Xp | https://github.com/ETH-DISCO/cue-detr |
| **MSAF** | boundary（foote/cnmf/olda/scluster/sf/vmo）+ label（fmc2d/cnmf/scluster/vmo） | **MIT**（repo badge）；另有兩個 GPL algorithms 喺獨立 repo [msaf-gpl](https://github.com/urinieto/msaf-gpl)（⚔️ GPL — 用嗰兩個就受 GPL 傳染）（https://msaf.readthedocs.io/en/latest/algorithms.html） | ❌ offline（逐 file 分析框架） | 冇公佈 | https://github.com/urinieto/msaf |
| **libKeyFinder** | key estimation（DJ harmonic mixing 用） | ⛔ **GPL-3.0-or-later** | ❌（library 設計係 file-based） | 冇公佈 | https://github.com/mixxxdj/libkeyfinder |
| **Ableton Link (libLink)** | 網絡 beat/tempo/phase/start-stop sync protocol；有 Python binding（aalink）、JS（aalink-js）、C++ header-only | ⚔️ **GPLv2+ 或 proprietary 雙授權**——閉源 app 要 email link-devs@ableton.com 攞商業授權（README：「dual licensed under GPLv2+ and a proprietary license」）（https://raw.githubusercontent.com/Ableton/link/master/README.md） | ✅ 天生 real-time（audio-thread safe capture/commit API） | 官方 test plan 要求 latency compensation 誤差 <3ms（https://ableton.github.io/link/ AUDIOENGINE-1） | https://github.com/Ableton/link |

**對 8GB VRAM 共機（Resolume + MadMapper 同開）嘅含意（設計判斷）**：SongFormer/EDMFormer 路線要跑 MuQ+MusicFM 兩個 SSL encoder，官方速度數字係 L40 GPU 量嘅，8GB VRAM 共機環境可行性冇公開證據——未證實。allin1 仲要加 Demucs source separation，更重。BeatNet CRNN 係細模型（1D conv + 2×150 LSTM），CPU 可跑（README device 參數 default cpu），但**官方冇公佈 CPU 延遲數字**——未證實。

---

## 純 DSP heuristic 近似做法

用戶提嘅描述：「build-up 通常係低頻 cut + noise riser + snare roll 加速，drop 係低頻能量瞬間回升」。逐項核對來源：

| Heuristic | 有冇一手來源支持 | 來源／標記 |
|---|---|---|
| EDM 結構係由 energy、rhythm、timbre 變化定義（唔係和聲/歌詞）；build-up = 能量/張力漸升 + risers；drop = peak energy + main bassline 回歸；breakdown = 低能量對比段 | ✅ 有 | EDMFormer 論文 Abstract + §II-B taxonomy 定義原文（「Build-up: Gradually increasing energy and tension, often with rising drum patterns or risers」「Drop: Peak energy section, featuring main rhythm motifs and basslines」「Breakdown: Reduced energy sections」）https://arxiv.org/html/2603.08759v1 ；Introduction 亦引述「EDM sections such as buildup and breakdown are ... characterized by spectral brightness, rhythmic density, and low-frequency energy changes」，引 Zeiner-Henriksen《The "PoumTchak" Pattern》(Univ. of Oslo, 2010)（https://hdl.handle.net/10852/56756 — 全文本次未讀，細節未證實） |
| 偵測結構轉變最強 cue = **signal energy 嘅 novelty**、timbre、**drum onset 數量**、harmony | ✅ 有 | Zehren et al. 2024（Signals）摘要：「we identify the most impactful features for switch point detection, namely, novelty of the signal energy, timbre, number of drum onsets, and harmony」（https://doi.org/10.3390/signals5040036；經 OpenAlex API 抓取）；EDMFormer §I-A 亦引述同一結論（energy novelty、drum onset counts、spectral flux） |
| novelty curve／spectral flux 類 detector 可以喺 streaming 設定做（checkerboard kernel 本身要前瞻，但 causal 變體可行） | ⚠️ 部分 | Foote 原始 novelty（https://doi.org/10.1109/ICME.2000.869637）係 offline 全曲 SSM；**冇搵到一手來源專門評估 causal/streaming novelty detector 做 section boundary 嘅準確率——未證實** |
| 「低頻能量瞬間回升」= drop 訊號（用戶舊 draft 30–180Hz band 思路） | ❌ 冇直接來源 | EDMFormer 只講「low-frequency energy changes」係 section 區分特徵之一；**冇任何已發表論文直接以「low-band energy 回升」做 drop detector 並報準確率——呢個屬設計判斷** |
| snare roll 加速（onset density 倍增）偵測 build-up | ❌ 冇直接來源 | 「drum onset counts」係 switch point 嘅重要 feature（Zehren 2024，上引），但冇論文將「onset rate 加倍 = build-up」量化驗證——**設計判斷** |
| 候選事件應該 snap 到 8/16-bar phrase 邊界先合理 | ✅ 有 | CUE-DETR 論文 §3.2：EDM-CUE 數據顯示 cue point 高頻出現喺 8 同 16 bar 倍數位置，16-bar phrasing 係最常見；enforcing 8/16-bar minimum spacing 提升 precision（https://arxiv.org/html/2407.06823v1）。Resolume 官方 BPM 文檔亦講 dance music「every 4 beats make up a bar, every 8 bars make up a phrase」（https://resolume.com/support/en/bpm） |
| 用「能量斜率」做 section change：冇量化準確率證據 | ❌ | **設計判斷**；間接支持只係上面 Zehren 2024 嘅 feature importance 排序 |

**限制方面有一手來源嘅**：BeatNet README 明確警告 streaming mic 使用要「feed the system with as loud input as possible」因為 models 係用 mastered songs 訓練（https://raw.githubusercontent.com/mjhydri/BeatNet/master/README.md）——即係話官方承認非 mastered（例如 mic 收音）輸入會降低性能，方向性證據支持「mic 條件下準確率會差」。

---

## mic 收音嘅影響與 AGC 可否程式關閉

### AGC／noise suppression 喺 Windows 嘅架構位置（一手來源）

- Windows 將 AGC、noise suppression（NS）、echo cancellation（AEC）、Deep Noise Suppression（AI-based，Win11 24H2+）實現為 **Audio Processing Objects (APO)**，由 OEM/IHV driver 掛入 audio pipeline（https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/audio-processing-object-architecture ；effects 清單：https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/audio-signal-processing-modes）。
- **可以程式關閉，條件係 driver 支援 RAW mode**。官方原文：「**Raw capture streams must not include any time varying or adaptive processing, such as echo control, automatic gain control, or noise suppression.** The only audio processing permitted in raw capture is linear equalization to flatten frequency response.」以及「If System.Devices.AudioDevice.RawProcessingSupported is true, applications also have the option to set a "use RAW" flag on certain streams.」但「Audio device drivers need to support at least the Raw or Default mode」＝**RAW 唔保證部部機都有**（同頁）。具體 WASAPI activation API（AudioClientActivationParams / AUDCLNT_STREAMOPTIONS_RAW）本次未抓到該 Learn 頁面（404）——API 細節未證實。
- Web 路線（如果用 browser/Electron capture）：W3C Media Capture and Streams spec 定義 `autoGainControl`、`noiseSuppression`、`echoCancellation` 為 `MediaTrackConstraintSet` 嘅 `ConstrainBoolean` 成員（https://w3c.github.io/mediacapture-main/#dom-mediatrackconstraintset-autogaincontrol）。MDN 補充：`autoGainControl` constraint 係「**Limited availability** — not Baseline because it does not work in some of the most widely-used browsers」，可以用 `exact: false` 強制要求關，但如果 source 報告「noise suppression cannot be turned off」，spec 規定 capability 只報單一 `true`（https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/autoGainControl ；https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings）。**即係話：Web API 可以「請求」關閉 AGC/NS，但唔保證生效，要 `getSettings()` 驗證實際狀態。**
- ⚠️ 注意：以上全部只覆蓋 **OS/browser 層嘅 AGC/NS**。laptop 內置 mic 可能有 **firmware/hardware DSP** 或者 OEM 附加 APO（例如 Dolby/Realtek 控制台嘅增強），喺 driver 層之下嘅處理 RAW mode 都繞唔到（MS Learn APO 頁提到 hardware DSP 經 proxy APO 廣告——即 hardware DSP 存在）。呢個判斷屬**設計判斷**（基於上述架構文檔推論），冇直接一手來源量化「內置 mic 關唔晒 DSP」嘅頻率。

### AGC/噪音對 beat/structure 偵測準確率嘅影響

- **冇搵到一手來源直接量化「AGC/noise suppression/環境噪音對 beat tracking 或 structure detection 準確率嘅影響」**。最接近嘅已發表工作：
  - Grünberg, Lofaro, Oh & Kim《Robot audition and beat identification in noisy environments》（IROS 2011，https://doi.org/10.1109/IROS.2011.6094987）——標題直接相關，但全文本次未抓到，具體實驗結果**未證實**。
  - Oliveira, İnce, Nakamura & Nakadai《Online audio beat tracking for a dancing robot in the presence of ego-motion noise in a real environment》（ICRA 2012，https://doi.org/10.1109/ICRA.2012.6224998）——robot 自身噪音下嘅 online beat tracking，全文未抓到，細節**未證實**。
  - BeatNet README 嘅「as loud input as possible」警告（上面已引）——間接、方向性證據。
- 設計判斷：AGC 係 time-varying gain，會壓縮 build-up 嘅動態爬升同 drop 嘅能量跳變幅度，理論上直接削弱「energy 斜率」heuristic 嘅訊號；MS Learn 對 AGC 嘅定義（「dynamically adjust the input-to-output gain ... enabling a stable level of output」，audio-signal-processing-modes 頁）支持「AGC 會 flatten 能量變化」呢個推論，但冇人量過對偵測準確率嘅實際影響。

---

## DJ metadata 路線 vs mic 分析

### Resolume 官方 sync 文檔（一手）

- **Pioneer（Pro DJ Link）**（https://resolume.com/support/en/sync-to-pioneer-dj-players，v7.12 文檔）：Arena only。需要 ethernet hub 將 players + mixer + Resolume 機連埋，加裝 Pioneer 免費 **Pro DJ Link Bridge** app（https://www.pioneerdj.com/en/product/software/pro-dj-link-bridge/software/overview/ — 該頁本次抓取 redirect 到 alphatheta.com 產品頁）或 ShowKontrol。最多同時 sync 4 個 players。toolbar 提供：**fader 狀態、play/pause/stop、time remaining、artwork、track name/artist**。Link 一個 clip 到 player 後，「Resolume will perfectly follow the time of the audio track ... Scratch, loop or slice, everything will stay sync」，track 一 load 就自動 trigger clip。支援型號：CDJ-3000、CDJ-2000NXS2、DJM-V10、DJM-V10-LF、DJM-900NXS2。**注意：文檔冇話提供 BPM 數值或 bar/beat position 俾第三方程序用，亦冇任何「drop/build-up」事件** — 佢做嘅係 clip playhead 同 track position 對齐。
- **Denon（StageLinQ）**（https://resolume.com/support/en/sync-to-denon-players，v6 文檔）：同樣模式，支援 X1800 mixer、SC5000(M)、SC6000(M)、Prime 4（Arena 6.1.2+）、Prime 2 / Prime Go（Arena 7.1.1+）。
- **Resolume 官方定位**（https://resolume.com/support/en/sync-with-dj）：「By far the easiest is to use Denon or Pioneer players and mixers and use Resolume's built-in sync support」；但同時強調「The process takes a lot of preparation though. You can't play random songs, put it in some stock video content, and get a fully synced show」——即 DJ sync 路線係**每首歌預先配好 video** 嘅 workflow，唔係通用結構偵測。
- **Ableton Link**（Resolume 側：https://resolume.com/support/en/link ；官方：https://ableton.github.io/link/ ；repo：https://github.com/Ableton/link）：open protocol，sync tempo/beat/phase（+v3 start/stop、arrangement sync）。Resolume 支援（View > Show Ableton Link）。**Link 只同步 tempo/beat grid，唔傳送任何結構事件**（官方 Link Concepts 全文冇 section/drop 概念）。官方 test plan 要求 audio alignment tolerance <3ms（AUDIOENGINE-1，https://ableton.github.io/link/）。Serato DJ 喺 Link-enabled 產品清單內（https://www.ableton.com/en/link/）——即係話如果 DJ 用 Link-enabled 軟件，VJ 可以零成本攞到準確 BPM/beat grid。

### 比較結論（回答「應該靠 mic 定 DJ metadata」）

| 維度 | DJ metadata（Pro DJ Link/StageLinQ/Link） | mic 分析 |
|---|---|---|
| BPM/beat grid | ✅ 官方文檔保證 track position 同步（Pioneer 頁原文，上引）；Link 官方 <3ms alignment 目標 | ❌ 要靠 beat tracker 估計；冇 mic 條件下嘅公開準確率（未證實） |
| Track ID/artwork/fader | ✅（Pioneer/Denon toolbar） | ❌ |
| **Drop/build-up 結構事件** | ❌ **冇任何官方文檔話 Pro DJ Link/StageLinQ/Link 提供 section 結構事件**（三份文檔全文核對） | ⚠️ 唯一可以「聽出」結構嘅路線，但準確率冇公開證據 |
| 前提條件 | 要接触到 DJ booth 網絡 + 特定型號器材 + DJ 同意 | 一部 laptop 就得 |
| 準確率一手對比數字 | **冇搵到任何一手來源直接比較兩條路線嘅準確率——未證實** | 同左 |

**答案（設計判斷，基於上表一手事實）：兩條路唔係二揀一，係互補。** 攞到 DJ metadata 就應該用（BPM/beat grid/track position 係確定性數據，唔使估計），但佢俾唔到 drop 事件——**結構事件偵測點都要靠 mic（或者靠 VJ 自己耳＋手動 trigger）**。如果現場攞唔到 DJ 網絡，mic DSP heuristic + 人工 override 係唯一路線。冇公開證據話邊條路「準幾多倍」——唔可以宣稱。

---

## human-in-the-loop override 嘅權威依據

- **Microsoft《Guidelines for Human-AI Interaction》（Amershi et al., CHI 2019, Honorable Mention）**：18 條 guideline，經 49 名 design practitioners 對 20 個 AI 產品驗證（https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/ ；DOI https://doi.org/10.1145/3290605.3300830 — ACM 頁本次 403，DOI 由 MS Research publication 頁確認）。直接相關嘅 guideline（原文標題取自 HAX Design Library：https://www.microsoft.com/en-us/haxtoolkit/library/）：
  - **G9「Support efficient correction」—「Make it easy to edit, refine, or recover when the AI system is wrong.」**（https://www.microsoft.com/en-us/haxtoolkit/library/ ；G9 頁 https://www.microsoft.com/en-us/haxtoolkit/guideline/support-efficient-correction/）→ 慢層誤判 drop 時，VJ 必須可以即刻手動 cover／undo。
  - **G10「Scope services when in doubt」**（同頁 guideline 清單）→ 偵測信心低嗰陣寧願唔 action（對應舊 draft「≤0.02 HOLD」思路）。
  - **G2「Make clear how well the system can do what it can do」**、**G11「Make clear why the system did what it did」**、**G17「Provide global controls」**（同頁清單）→ UI 要顯示偵測器信心/原因，同埋要有全局掣（例如「auto 模式 on/off」）。
  - 注意：guideline 原文唔係用「高後果場景必須 override」呢個字句；**「高後果／低準確率場景必須提供 override」呢個具體表述係本文檔對 G9/G10/G17 嘅應用性歸納（設計判斷）**，但 G9 原文「recover when the AI system is wrong」已足以支持 override 需求。
- **Google PAIR Guidebook**（https://pair.withgoogle.com/guidebook/）：站點存在已確認，但本次抓取內容被截斷，**冇攞到具體 chapter 原文——未證實**，唔引具體條文。
- 補充一手事實支持「本場景準確率低」：pop-taxonomy SOTA 模型喺 EDM section labeling ACC 只有 0.148（EDMFormer Table I，上引）；cue point SOTA cues-only F1 只有 0.36（CUE-DETR Table 2，上引）。即係話就算 offline，結構偵測都遠非完美——streaming + mic 條件只會更差（推論，未實測）。

---

## 對本專案嘅推薦：慢層應該點實作

> 以下係建基上面一手證據嘅**設計判斷**。所有「期望準確率」都冇本專案實測支持，只係根據已發表數字推斷方向。

### 第一版（Phase 1）：純 DSP streaming heuristic＋bar-grid 量化＋人工 override
1. **訊號層**：保留舊 draft 嘅 LOW/MID/HIGH band energy + RMS + onset。加兩個 feature：(a) **band-energy novelty**（相鄰窗口特徵差異，源自 Zehren 2024「energy novelty 係最強 cue」，上引）；(b) **onset density**（滑動窗 onset 率）。
2. **偵測規則（全部標設計判斷）**：
   - build-up 候選：LOW band energy 相對下降（bass cut）＋ HIGH band energy 爬升（riser）＋ onset density 上升（snare roll），持續 ≥ 數秒。
   - drop 候選：LOW band energy 喺短時間內大幅回升 ＋ 全頻能量 novelty peak。
   - 候選事件 snap 去最近嘅 8/16-bar 邊界（依據：CUE-DETR phrasing 證據，上引）。
3. **Beat grid**：BeatNet streaming mode（CC BY 4.0）或 madmom online（BSD code；⚠️ models CC BY-NC-SA，如果工具將來商業發佈要處理）提供 beat/downbeat，用嚟做 bar 量化。BeatNet 官方 mic 警告（音量要夠大）要落實：mic gain 設定、盡量靠近 sound system。
4. **決策層**：drop event → clip switch；信心低 → HOLD（G10）；**永遠提供手動 trigger/override（G9/G17）**，例如 MIDI controller 一個掣即刻 cover 自動判斷。
5. **音頻捕獲**：如果行 native Windows，用 WASAPI 試 RAW capture mode（先查 `System.Devices.AudioDevice.RawProcessingSupported`）；如果行 browser/Electron，`getUserMedia({audio: {autoGainControl: false, noiseSuppression: false, echoCancellation: false}})` 然後用 `getSettings()` 驗證真係關到（MS Learn + W3C/MDN，上引）。關唔到都要照行，但要預期動態被 compress（設計判斷）。
6. **準確率期望**：冇公開數字可以套用到呢個組合（未證實、未實測）。已發表最接近嘅參考點：offline、clean audio、EDM 專門模型先至 HR@0.5s ≈ 0.62（EDMFormer）；mic + streaming + 通用 heuristic 合理預期會**顯著低過**呢個數（推論）。第一版應該當成「候選提示器」而唔係「自動導演」。

### 之後（Phase 2+）：條件性升級
- **如果攞到 DJ metadata**：直接接 Resolume Pro DJ Link/StageLinQ sync（Arena 7.23 ≥ 文檔要求 7.12，型號限制見上）或者 Ableton Link（注意 GPLv2+ 雙授權，只係「同 Resolume 一齊用 Link session」唔使 embed library，就冇授權問題；如果自己 app 要 embed libLink 就要商業授權）。慢層退化成「track load/fader 事件 + bar grid」，結構偵測負擔大減。
- **如果想試 ML**：唯一 EDM-specific 已發表路線係 EDMFormer（offline，冇公開 code——未證實可唔可以用）；較現實係用 SongFormer/allin1 做**離線 pre-analysis**（例如 VJ 事前知道自己會播嘅 track，就 offline 標好 drop 位置存入 clip metadata），live 只需要 beat-sync 對位。呢個用法同 Resolume「Sync with a DJ」官方 workflow（預先準備每首歌嘅 video）一致（上引）。VRAM/速度喺 8GB 共機環境冇公開證據——未證實，要自己量。
- **唔建議**：live 跑 sliding-window offline MSA 模型——BeatNet 論文 Introduction 明言 sliding window 策略有「discontinuity of beat predictions and the need for priming ... which causes a delay」嘅缺點（https://arxiv.org/html/2108.03576v1），套到 section-level 更嚴重（設計判斷）。

---

## 未證實項目清單

1. EDMFormer / EDM-98 有冇公開 code 或 dataset 下載（論文冇附連結）。
2. Zehren 2024（Signals）全文嘅具體 feature importance 數字（只攞到摘要；MDPI 直接抓 403）。
3. BeatNet 論文具體 F-measure 表格數字（HTML 版被截斷）。
4. Serrà et al. AAAI 2012、SpecTNT、Temporal Adaptation (WASPAA 2025) 嘅具體準確率表格（只攞到 metadata/摘要）。
5. Mixed In Key 官方功能描述原文（官網抓取被截斷）；MIK cue 準確率只有 CUE-DETR 第三方量度（F1 0.22@1 beat）。
6. Rekordbox / Serato 官方分析功能文檔（未抓取）。
7. Keyfinder 官方網站現狀（keyfinder.org fetch 失敗）；libKeyFinder GPL3 已由 repo README 證實。
8. Google PAIR Guidebook 具體 chapter 條文（頁面內容抓取被截斷）。
9. 「AGC/NS/環境噪音對 beat/structure 偵測準確率嘅量化影響」——**未搵到任何一手來源**；只有 Grünberg IROS 2011 同 Oliveira ICRA 2012 兩篇標題相關嘅論文（全文未讀）＋BeatNet README 定性警告。
10. Windows WASAPI RAW capture 嘅具體 activation API 頁面（MS Learn 該頁 404）；RAW mode 喺用戶部 laptop 嘅 driver 支援度（要實機查 `RawProcessingSupported`）。
11. Zeiner-Henriksen《PoumTchak》論文全文（只有 handle 連結同 EDMFormer 嘅轉引）。
12. Essentia streaming tutorial 內容（essentia.upf.edu 整站本次 fetch 失敗；streaming 能力由 source code header 證實）。
13. CUE-DETR repo 嘅 license 條款（README 冇列）。
14. 本報告所有「設計判斷」項：DSP 規則細節、mic 條件下準確率推斷、VRAM 可行性推斷。

---

## 要問用戶嘅問題

1. **現場器材**：你 gig 嘅 DJ booth 通常係 Pioneer（CDJ-3000/2000NXS2 + DJM-V10/900NXS2）定 Denon（X1800/SC5000+/Prime）？有冇可能攞到 ethernet hub 接入佢哋嘅網絡？——如果答案係「經常可以」，Phase 2 嘅 DJ metadata 路線應該優先過任何 ML。
2. **DJ 用唔用 Ableton Link / Serato Link**？如果 DJ 軟件係 Link-enabled，VJ 機可以直接 join Link session 攞 BPM（Resolume 原生支援），慢層就唔使自己做 beat tracking。
3. **工具形態**：慢層程式係 native Windows（可以用 WASAPI RAW 關 AGC）定 Electron/browser（用 MediaTrackConstraints）？影響 AGC 處理方式。
4. **商業意圖**：呢個 VJ 工具會唔會派發／出售？影響 madmom models（CC BY-NC-SA）、Essentia（AGPL）、libLink（GPLv2+）可唔可以用。
5. **接唔接受「事前準備」workflow**：如果願意喺 gig 前用 offline 工具（allin1/SongFormer 類）標好自己 playlist 嘅 drop 位置，live 準確率會高好多；定係一定要完全即興、聽現場先知？
6. **EDM-98 dataset**：值唔值得 email 論文作者問 dataset/code release？（論文冇附連結；如果你想要 EDM-specific ground truth 做將來評估，呢個係目前唯一標咗 drop/build-up 嘅公開聲明 dataset。）

---

## 附：本報告 claim 統計

- 帶 URL 嘅 claim：約 **78 條**（正文所有表格行 + 段落引用；每項事實性 claim 均附 arXiv/GitHub raw/官方文檔/DOI/API 來源連結）。
- 明確標「未證實」嘅項目：**14 項**（見未證實清單）。
- 明確標「設計判斷」嘅段落：一句結論嘅路線建議、§5 三行 heuristic、§6 硬件 DSP 推論、§7 比較結論、§9 全部實作建議。
- **本報告冇宣稱任何本專案實測準確率或延遲**；所有數字均為來源文檔公佈值。
