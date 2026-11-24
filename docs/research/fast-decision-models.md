# 快速決策模型研究：sub-50ms（理想 20ms）音訊→clip/Column 選擇

- 日期：2026-11-17
- 研究員：DSH research subagent（web_search 壞咗 401，全部用 web_fetch 直接抓 primary source）
- 場景約束（主管已核實，直接採用）：Windows laptop、RTX 3070 Ti **8GB VRAM**、同一部機同時跑 Resolume Arena 7.23 ＋ GarageCube MadMapper，本地 ML 預算極細。已有特徵：LOW/MID/HIGH 三頻能量、RMS、Energy（attack 50ms／release 220ms）、onset（BPM 唔可靠）。Energy→Column 規則：≤0.02 HOLD、<0.4 Column1、<0.75 Column2、其餘 Column3。
- 本檔所有延遲數字：**冇一個係本機實測**。有官方來源嘅標 URL；冇來源嘅明確標「推算」並寫推算方法。

---

## 一句答案

**有。** 「每 20–50ms 用即時音訊特徵揀 clip／Column 並附置信度」呢個需求，用**純 CPU 嘅細模型**（scikit-learn logistic regression / MLP、XGBoost／LightGBM、Vowpal Wabbit contextual bandit，或者 ONNX Runtime 跑同一啲模型）加**probability calibration**就做到，全部係 permissive license（BSD-3／Apache-2.0／MIT），單次決策運算量係微秒到低毫秒級（**推算**，官方冇公佈單樣本延遲數字；見 §3）。配合項目 ADR-0003 嘅 Tauri＋TypeScript 約束，最乾淨嘅落地路線係「**Python 離線訓練 → 導出 ONNX/weights → TypeScript（ONNX Runtime Web WASM，純 CPU）推理**」，完全唔使 sidecar、唔爭 GPU（§7）。如果要多一個「跟 beat」嘅中層，**BeatNet**（CC-BY-4.0，CRNN＋particle filter，官方定位 real-time，CPU 預設）係最啱嘅開源選擇——但佢係 Python 棧，要 sidecar 裁決（§7 對齊衝突）。Jev 嗰種「state + typed question → calibrated distribution」介面**可以本地複製**：sklearn `CalibratedClassifierCV`（sigmoid/isotonic/temperature）就是官方現成工具，confidence 公式本身係十行算術（§5）。**20ms 呢個目標本身係多餘嘅**（§8）：你自己嘅 Energy envelope attack 已經係 50ms，MIR 研究標準 beat 容差係 ±70ms，人類「即時感」界限係 ~100ms。

---

## 速度需求換算

全部係算術，唔需要來源：

| 目標 | 決策頻率 | 120 BPM（500ms/beat） | 140 BPM（≈429ms/beat） |
|---|---|---|---|
| 20ms | 50 次/秒 | 每 beat 决策 25 次 | 每 beat ≈21 次 |
| 50ms | 20 次/秒 | 每 beat 10 次 | 每 beat ≈8.6 次 |
| 每 beat 一次 | 2 次/秒 | 500ms 預算 | ≈429ms 預算 |
| 60fps 幀同步 | 60 次/秒 | 16.7ms/幀 | 16.7ms/幀 |

關鍵換算事實（有來源）：

1. **你自己嘅特徵更新率已經係 50ms**：Energy attack 50ms／release 220ms（主管提供嘅已知事實）。決策快過 50ms 只係用同一組特徵重複算，冇新資訊。
2. **MIR 學術界公認嘅 beat 同步容差係 ±70ms**：BeatNet 論文用 `Tw=±70ms` tolerance window 做 F-measure，並講明係 "following standard evaluation practices"（https://arxiv.org/html/2108.03576v1 §3.1）。即係話，clip 切換誤差 70ms 以內，學術上當作「啱 beat」。
3. **人類感知「即時」嘅界限係 0.1 秒**：Jakob Nielsen 三個經典界限 0.1s／1s／10s，0.1s 之內用戶覺得系統係即時反應（https://www.nngroup.com/articles/response-times-3-important-limits/）。
4. **BeatNet 神經特徵 hop size 係 46ms**（STFT 93ms window／46ms hop，https://arxiv.org/html/2108.03576v1 §2.1）——即 21.7 幀/秒。呢個係「音樂語義」層面嘅自然決策粒度。
5. Resolume 官方頁講明 Arena/Avenue 內置 **FFT audio analysis**：「use FFT to make your clips and effects bounce to the incoming sound source」（https://resolume.com/software/avenue-arena）。即係**每幀參數調變（bounce/跳動）Resolume 自己已經做緊**，你嘅外部決策層唔需要搶呢個工。

結論预算：**「揀 clip／Column」呢種离散决策，50ms 級已經好充裕；20ms 只有喺你想做 per-frame 參數調變先有意義，而嗰樣嘢 Resolume 內置 FFT 已覆蓋。**

---

## 逐類方法延遲表

「官方公佈延遲」欄只寫我喺官方 repo／docs／論文原文實際搵到嘅數字。**老實講：今次抓到嘅官方來源，絕大多數冇公佈單樣本絕對延遲（ms）**，佢哋公佈嘅係相對加速比或者定性 claim。冇數字嘅一律標「冇公開數字，屬推算」。

| 方法 | 官方公佈延遲／速度 | 有冇來源 | 授權 | 8GB VRAM＋雙 VJ 軟件同機可行？ | URL |
|---|---|---|---|---|---|
| **規則引擎**（你而家嘅 Energy→Column） | 冇官方數字；每決策只有幾次浮點比較，**推算** <0.01ms（CPU cache 內幾個 branch） | 推算 | 自己寫 | ✅ 零成本 | —（你已有） |
| **scikit-learn**（LogisticRegression／小 MLP `MLPClassifier`） | 官方 docs 冇單樣本 predict 延遲數字。docs 只有 computational performance 章節（https://scikit-learn.org/stable/computing.html）。**推算**：7–20 個特徵、單樣本，native code 矩陣乘係 µs 級；經 Python 呼叫大約 0.1–1ms（Python overhead 主導）。推算方法：模型係一次 `n_features × n_classes` 矩陣乘（幾百次 FLOP），對比任何官方 benchmark 模型都細幾個數量級 | 冇公開絕對數字→推算 | **BSD-3-Clause**（https://api.github.com/repos/scikit-learn/scikit-learn，license 欄） | ✅ 純 CPU，唔掂 GPU | https://github.com/scikit-learn/scikit-learn |
| **XGBoost** | 官方冇單樣本延遲。**推算**：幾百棵樹、深度 6，單行 predict 係樹遍歷，µs–低 ms 級（C++ core） | 推算 | **Apache-2.0**（https://api.github.com/repos/dmlc/xgboost） | ✅ 純 CPU 模式 | https://github.com/dmlc/xgboost |
| **LightGBM** | 官方 repo 描述自己 "A fast, distributed, high performance gradient boosting"（定性，冇單樣本數字）。**推算**：同上，µs–低 ms | 推算 | **MIT**（https://api.github.com/repos/lightgbm-org/LightGBM；repo 已由 microsoft 轉到 lightgbm-org） | ✅ 純 CPU | https://github.com/lightgbm-org/LightGBM |
| **ONNX Runtime**（CPU EP 跑上面任何模型） | 官方 performance docs 只有 tuning 指引（profiling、threading、I/O binding），**冇通用絕對延遲表**（https://onnxruntime.ai/docs/performance/、https://onnxruntime.ai/docs/performance/tune-performance/）。官方明確支援 **ONNX-ML：scikit-learn／LightGBM／XGBoost／LibSVM 模型可以直接轉 ONNX 跑**（https://onnxruntime.ai/docs/tutorials/traditional-ml.html）。**推算**：tiny MLP on CPU EP ≈ 低 ms 內（session overhead 主導） | 官方有支援聲明、冇絕對數字→推算 | **MIT**（https://api.github.com/repos/microsoft/onnxruntime） | ✅ CPU EP 零 VRAM；CUDA EP 有 `gpu_mem_limit` 可以 cap VRAM arena（官方 option，https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html#gpu_mem_limit） | https://onnxruntime.ai/docs/ |
| **ONNX Runtime Web**（browser/WASM/WebGPU） | 官方支援矩陣：WebAssembly (CPU) 全瀏覽器 ✅；WebGPU 需要 Chromium v113+（Windows）、Float16 需 Chrome 121+；WebGL 已入 maintenance mode（https://onnxruntime.ai/docs/get-started/with-javascript/web.html#supported-versions）。冇絕對延遲數字 | 官方有矩陣、冇延遲數字 | MIT（同上） | ⚠️ WASM backend 可行（純 CPU）；WebGPU backend 會搶同一塊 GPU（見 §6） | https://onnxruntime.ai/docs/get-started/with-javascript/web.html |
| **LiteRT（前 TensorFlow Lite）** | 官方 README：on-device runtime，CPU=XNNPACK、GPU=ML Drift、Windows 平台 ✅（CPU ✅／GPU WebGPU ✅）；有 benchmark 工具但**官方頁冇抓到絕對延遲數字**（https://github.com/google-ai-edge/LiteRT README platform table）。另外官方 AI Coding Directives 講明 TensorFlow Lite `Interpreter` API 已入 maintenance mode，新 code 要用 Compiled Model API | 冇公開數字→推算（tiny model on XNNPACK CPU ≈ 低 ms） | **Apache-2.0**（README License 節） | ✅ CPU delegate 零 VRAM | https://github.com/google-ai-edge/LiteRT |
| **MediaPipe** | 官方有 **Audio Classifier** task（https://developers.google.com/edge/mediapipe/solutions/audio/audio_classifier）同新嘅 **Decision Maker** task（https://developers.google.com/edge/mediapipe/solutions/decision/decision_maker）。今次抓取只確認到呢兩個 task 存在於官方 docs 導覽；**延遲數字同 Decision Maker 內部細節未能核實**。官方 README：全部 on-device 處理，input 資料唔會上傳（但會傳 usage metrics 畀 Google） | 存在性有來源；延遲冇 | **Apache-2.0**（https://api.github.com/repos/google-ai-edge/mediapipe） | ✅（CPU pipeline；GPU 可選） | https://github.com/google-ai-edge/mediapipe |
| **DistilBERT**（細 transformer encoder 參考點） | 官方論文 abstract：**比 BERT-base 細 40%、快 60%、保留 97% 能力**；有 on-device proof-of-concept（https://arxiv.org/abs/1910.01108）。**冇絕對 ms 數字**。推算：consumer CPU 上一條短 sequence 係幾十 ms 級——所以佢入唔到 20ms 快層，只可以做慢層 | 相對數字有、絕對冇→推算 | 論文/HF 模型多數 Apache-2.0（逐個 model card 確認） | ⚠️ 慢層先夠 | https://arxiv.org/abs/1910.01108 |
| **TinyBERT** | 官方論文 abstract：4 層 TinyBERT **7.5x 細、9.4x 快過 BERT-base inference**，推理時間約係同級 baseline 嘅 31%（https://arxiv.org/abs/1909.10351）。同樣冇絕對 ms | 相對數字有→絕對推算 | 官方 repo：https://github.com/huawei-noah/Pretrained-Language-Model/tree/master/TinyBERT（paper comments 欄） | ⚠️ 慢層 | https://arxiv.org/abs/1909.10351 |
| **MiniLM** | 論文：**50% 參數／計算量保留 >99% 準確率**（SQuAD 2.0 等）（https://arxiv.org/abs/2002.10957）。HF 上 `microsoft/MiniLM-L12-H384-uncased` model card 標 **License: mit**（https://huggingface.co/microsoft/MiniLM-L12-H384-uncased）。冇絕對延遲 | 相對有→絕對推算 | MIT（HF model card） | ⚠️ 慢層 | https://arxiv.org/abs/2002.10957 |
| **LAION-CLAP**（音訊 embedding） | 論文：633,526 audio-text pairs、feature fusion 處理**可變長度音訊**（https://arxiv.org/abs/2211.06687）。**官方 repo／論文冇公佈延遲或 real-time claim**。推算：HTSAT audio encoder + text encoder 係百 M 參數級 transformer，8GB VRAM 上同 Resolume 爭用唔划算；CPU 上单次 embedding 推算係幾百 ms 級 → 只可做「每幾秒一次」嘅慢層 | 冇公開數字→推算 | repo code **CC0-1.0**（https://api.github.com/repos/LAION-AI/CLAP）；HF weights `laion/clap-htsat-unfused` **apache-2.0**（https://huggingface.co/laion/clap-htsat-unfused） | ⚠️ 慢層、低頻率先可 | https://github.com/LAION-AI/CLAP |
| **MERT**（音樂 SSL embedding） | 論文：95M–330M 參數、14 個 music understanding tasks SOTA（https://arxiv.org/abs/2306.00107，ICLR 2024）。**冇延遲數字、冇 real-time claim**。推算：95M 參數 HuBERT-style encoder，短窗口 GPU 推理幾十 ms、CPU 幾百 ms 以上 → 慢層 | 冇公開數字→推算 | ⚠️ code Apache-2.0（https://api.github.com/repos/yizhilll/MERT）但 **HF weights `m-a-p/MERT-v1-95M` 係 cc-by-nc-4.0（非商業！）**（https://huggingface.co/m-a-p/MERT-v1-95M model card License 欄） | ⚠️ 慢層；商業用途要另搵 weights 授權 | https://github.com/yizhilll/MERT |
| **MusicFM** | 官方 README：25Hz frame rate、24kHz input、示範 code 用 `.cuda()`＋建議 mixed precision/Flash attention 解決 **memory issues**（即係暗示 VRAM 食緊）；作者自己講 beat tracking 建議用 float32（https://github.com/minzwon/musicfm README）。**冇延遲數字、冇 real-time claim**。推算：30s clip 係設計單位，唔係 20ms streaming 場景 | 冇公開數字→推算 | code **MIT＋Apache-2.0 dual**（https://raw.githubusercontent.com/minzwon/musicfm/master/LICENSE）；checkpoint 喺 HF `minzwon/MusicFM`（README 提供 wget link；HF 側 license 未核實） | ❌ 唔適合快層；慢層都要 GPU | https://github.com/minzwon/musicfm |
| **Essentia-TensorFlow** | 獨立 repo `MTG/essentia-tensorflow` 已 404（https://api.github.com/repos/MTG/essentia-tensorflow 回 Not Found）；`essentia-tensorflow` 仍係 PyPI package（Essentia README badge：https://github.com/MTG/essentia）。延遲冇公開數字 | repo 狀態有來源；延遲冇 | **AGPL-3.0**（見 §4） | ⚠️ 授權風險 | https://github.com/MTG/essentia |
| **Vowpal Wabbit（contextual bandit）** | 官方 README 定性 claim："**Speed.** The learning algorithm is fast"、memory footprint bounded（https://github.com/VowpalWabbit/vowpal_wabbit README）。官方 CB tutorial 展示 `vw.predict()` 直接返回 **pmf（probability mass function）over actions**（https://vowpalwabbit.org/docs/vowpal_wabbit/python/latest/tutorials/python_Simulating_a_news_personalization_scenario_using_Contextual_Bandits.html）。**官方冇公佈單次 predict 延遲數字**；推算：`--cb_explore_adf` 底下係 sparse linear scoring + epsilon/softmax exploration，每決策 µs–低 ms 級（feature 數少時），Python binding overhead 另計 | 定性有、絕對冇→推算 | **BSD-3-Clause**（https://raw.githubusercontent.com/VowpalWabbit/vowpal_wabbit/master/LICENSE 全文核實） | ✅ 純 CPU | https://github.com/VowpalWabbit/vowpal_wabbit |
| **LinUCB／Thompson sampling（手寫）** | LinUCB 原始論文：Yahoo! Front Page 33M events、演算法 "computationally efficient"、+12.5% click lift（https://arxiv.org/abs/1003.0146）。**冇延遲數字**；推算：LinUCB 每決策係一次 d×d 矩陣更新＋d 維內積，d≈10 時係幾百次 FLOP → **µs 級**，呢個係全部方法入面最快 | 論文有、延遲推算 | 演算法本身係論文，實作隨庫（VW BSD-3；自己寫就自己授權） | ✅ 零成本 | https://arxiv.org/abs/1003.0146 |
| **BeatNet（neural beat tracker）** | 官方 repo description："state-of-the-art **(Real-Time)** and Offline joint music beat, downbeat, tempo, and meter tracking"（https://api.github.com/repos/mjhydri/BeatNet）。論文 abstract：information gate "significantly decrease the computational cost of particle filtering... **making the system much faster than previous sampling-based methods**"、"suitable for many real-time applications"（https://arxiv.org/html/2108.03576v1）。README：`mode='stream'` 直接食 mic、`device` 參數 "**Cuda or cpu (by default)**"、建議唔好 plot 以 "secure realtime results"。**冇絕對 ms 數字**。推算：CRNN 極細（1D conv 2 filters＋150-neuron FC＋2×150 LSTM，論文 §2.2），每 46ms hop 一次 forward，CPU 都應付到——但呢個係推算，官方只給定性 real-time claim | 定性 real-time claim 有、絕對冇→推算 | **CC-BY-4.0**（https://raw.githubusercontent.com/mjhydri/BeatNet/main/LICENSE 全文核實；商用 OK，要署名） | ✅ CPU 預設；模型細 | https://github.com/mjhydri/BeatNet |
| **Jev（TypeSafe，對照組）** | 官方 claim：**end-to-end 70–500ms**、40–200x 快過 frontier LLM；TypeSafe 自己承認 workflow 由其 model-capabilities team 製作、"may be biased compared to real-world tasks"（Wikipedia raw wikitext Performance 節，引 https://typesafe.ai/blog/introducing-system-one-models-and-jev 同 https://docs.typesafe.ai）。**冇 20ms 嘅一手來源**（本次亦冇搵到）。另外官方 docs 講明：Jev **唔原生接受 audio**——"It does not natively accept audio or video (yet)"（https://docs.typesafe.ai/models），即係你要自己把音訊特徵序列化成 text/JSON 先入到 Jev。API-only、冇 weights、冇 paper、冇本地路線（Wikipedia Architecture 節） | 官方 claim 有（70–500ms） | **Proprietary**（Wikipedia infobox） | ❌ 本地不可行；70–500ms 亦超出 sub-50ms 目標 | https://en.wikipedia.org/wiki/Jev_(AI_model)、https://docs.typesafe.ai/models |

---

## real-time 音樂分析庫表

| 庫 | 能力 | 授權（含 GPL/NC 警告） | streaming? | URL |
|---|---|---|---|---|
| **librosa** | 特徵抽取全家桶（STFT、mel、onset、beat_track、tempo） | **ISC**（permissive，https://api.github.com/repos/librosa/librosa license 欄） | ⚠️ **半 streaming**：`librosa.stream` 官方 docs 講明係「Stream audio in fixed-length buffers... primarily useful for processing **large files**」，係 file block generator，**唔係 live mic capture**；官方亦警告 `beat_track`、`cqt`、`resample` 等全域分析 "will not be appropriate for streamed data"。live input 要自己配 sounddevice/pyaudio 餵 buffer（https://librosa.org/doc/0.11.0/generated/librosa.stream.html） | https://github.com/librosa/librosa |
| **Essentia** | C++ 音訊分析庫＋Python bindings；大量 spectral/temporal/tonal descriptors；**真正嘅 streaming architecture**（Source/Sink dataflow、FrameCutter、內部 scheduler，官方 design doc 全文核實） | 🔴 **AGPL-3.0**（GitHub license 欄＋README 明言 "released under the Affero GPLv3 license"）。官方 licensing doc：AGPLv3 只給 non-commercial；**商業用要向 MTG/UPF 買 commercial license**；pre-trained models 係 **CC BY-NC-SA 4.0**；dependencies 有 **GPL（FFTW、NNLS Chroma）＋LGPL（ffmpeg、taglib、chromaprint）**。AGPL 對閉源 app 有傳染性（連網絡服務都觸發），**呢個係本表最大授權風險** | ✅ 官方 streaming mode（https://github.com/MTG/essentia/blob/master/doc/sphinxdoc/streaming_architecture.rst） | https://github.com/MTG/essentia |
| **madmom** | MIR 參考實作：beat/downbeat/onset/tempo/chords/notes；`DBNBeatTracker` 等 CLI | 🟡 **source code 係 BSD-style**，但官方 LICENSE 講明 **所有 model/data files（.npy/.npz/.h5/.pkl 等，包括 pickled Processors）係 CC BY-NC-SA 4.0——非商業**；商業包含要聯絡 Gerhard Widmer（JKU）（https://raw.githubusercontent.com/CPJKU/madmom/main/LICENSE 全文核實） | ✅ 官方 docs：「Some programs can also be run in `online` mode, i.e. operate on live audio signals. This requires pyaudio」（https://madmom.readthedocs.io/en/latest/usage.html） | https://github.com/CPJKU/madmom |
| **BeatNet** | joint beat＋downbeat＋tempo＋meter tracking；CRNN＋兩級 particle filter；4 個 mode：stream（mic）／realtime／online／offline | 🟢 **CC-BY-4.0**（署名即可、可商用；用 CC 授權 software 係非典型但有效）。注意：offline DBN mode 內部用 madmom 嘅 inference（README Acknowledgements＋「we added madmom's DBN beat/downbeat inference model for the offline usages」）→ **行 offline mode 會撞正 madmom models 嘅 CC BY-NC-SA 限制**；stream/realtime/online（PF mode）唔經 madmom models | ✅ `mode='stream'` 直接 capture mic（README usage example 1；pyaudio 需要） | https://github.com/mjhydri/BeatNet |
| 其他 neural beat tracker | BeatNet 論文比較表列出嘅 online 方法：Aubio、Böck ACF/FF、DLB、IBT（https://arxiv.org/html/2108.03576v1 §3.3）——BeatNet 喺 GTZAN beats F=75.44 贏 Aubio 57.09、IBT 68.99 | 逐個 repo 核實 | 上表方法多為 causal/online | 同 BeatNet 論文 |
| **MediaPipe（Audio Classifier）** | 官方 audio classification task，cross-platform（Android/iOS/Web/Python） | Apache-2.0 | 官方框架叫 "live and streaming media"（repo description）；audio classifier 支援 audio stream（細節頁未抓到全文→**未證實**） | https://developers.google.com/edge/mediapipe/solutions/audio/audio_classifier |
| **Vowpal Wabbit** | contextual bandit／online learning；唔係音訊庫，但係「揀 clip」嘅決策層 | BSD-3 | ✅ 天生 online（逐 example 學習） | https://github.com/VowpalWabbit/vowpal_wabbit |

補充（同你嘅已知事實直接相關）：

- **madmom 維護狀態**：GitHub API 顯示最後 push 2026-03-20，open issues 83。BeatNet README 官方記載 madmom 0.16.1 同 **Python ≥3.10／NumPy ≥1.24 有兼容性問題**（`MutableSequence` import error、`np.float` removed），要 Python 3.9 或者手動 patch（https://github.com/mjhydri/BeatNet README "Note on madmom compatibility"）。如果你個 toolchain 係新 Python，呢個係實際風險。
- Essentia docs 網站（essentia.upf.edu）本次多次 fetch 失敗（TypeError），所以 streaming 證據改用 repo 內嘅 `.rst` 原文（同一內容嘅 source of truth）。

---

## Jev 模式嘅本地等價物

Jev 介面＝「state ＋ typed question（noul/choice/score）→ probability distribution ＋ calibrated confidence」。逐件拆：

### 1. Probability distribution 本身
任何輸出 softmax/sigmoid 嘅分類器都俾到你 distribution：
- sklearn `predict_proba`（BSD-3）。
- VW contextual bandit 嘅 `predict()` **直接返回 pmf over actions**——官方 tutorial 原文：「When we call VW we get a *pmf*, probability mass function, as the output... a list of probabilities over the set of actions」（https://vowpalwabbit.org/docs/vowpal_wabbit/python/latest/tutorials/python_Simulating_a_news_personalization_scenario_using_Contextual_Bandits.html）。呢個同 Jev `choice` primitive 嘅輸出形狀一樣。

### 2. Calibration（令 probability 可信）
- **scikit-learn 官方 calibration 模組**（https://scikit-learn.org/stable/modules/calibration.html）：
  - `CalibratedClassifierCV`，`method="sigmoid"`（＝**Platt scaling**，Platt 1999，官方 refs [4]）；
  - `method="isotonic"`（**isotonic regression**，官方講明 >~1000 samples 先至好過 sigmoid，官方 refs [3][6]）；
  - `method="temperature"`（**temperature scaling**，Guo et al. ICML 2017，官方 refs [9]；官方文檔：「temperature scaling naturally supports multiclass predictions... with just one free parameter」，而且 **T 唔改變 argmax**——即係唔影響你揀邊個 clip，只影響置信度數值）。
  - 官方定義 well-calibrated：「among the samples to which it gave a predict_proba value close to, say, 0.8, approximately 80% actually belong to the positive class」。
- **Temperature scaling 論文**：Guo et al., "On Calibration of Modern Neural Networks"（https://arxiv.org/abs/1706.04599）——abstract 原文：「modern neural networks... are poorly calibrated... temperature scaling — a single-parameter variant of Platt Scaling — is surprisingly effective」。
- 呢啲全部係**推理時零成本**嘅 post-hoc 變換（一次 sigmoid/查表/除法），對 20ms 預算冇影響（推算：單樣本 calibration 係 <0.01ms 級運算）。

### 3. Jev 嗰條 confidence 公式
Jev 對 choice/noul 用 `confidence = (p_max − 1/n)/(1 − 1/n)`，對 score 用 MAD-based 公式（Wikipedia raw wikitext Output 節，https://en.wikipedia.org/w/index.php?title=Jev_(AI_model)&action=raw；docs.typesafe.ai/confidence 亦講明 confidence 係「a statistic computed from the probability distribution」，1＝全集中、0＝均勻）。**呢兩條公式本身就係十行以內嘅純算術**——任何本地模型輸出 distribution 之後，用同一條公式就得到同 Jev 語義相同嘅 confidence。TypeSafe 官方都承認呢啲 derived value 係「computed by simple programs, not by Jev」（wikitext Output 節引 docs）。

### 4. 有冇開源庫直接提供「typed question → calibrated distribution」API？
- **冇搵到一對一等價物**（本次搜索範圍內）。最接近嘅組合係：
  - `MediaPipe Decision Maker` task——官方 docs 導覽確實有「Decision → Decision Maker」（https://developers.google.com/edge/mediapipe/solutions/decision/decision_maker），**但佢嘅具體 API 形狀／是否 bandit／延遲，本次未能抓到正文核實→未證實**；
  - VW `--cb_explore_adf`：context（你嘅 state JSON）＋actions（clip 清單）→ pmf＋在線學習，官方 tutorial 完整示範（上文 URL）。要「typed question」抽象就要自己包一層。
- 結論：**Jev 嘅介面可以本地複製，但係用「細分類器＋calibration＋confidence 公式」自己砌**，唔係裝一個現成 package。工程量：幾十行 Python/Rust。

### 5. Jev 做唔到而你本地做到嘅嘢
Jev 官方 docs 講明佢「does not natively accept audio or video (yet)」（https://docs.typesafe.ai/models）——所以你嘅音訊特徵本來就要自己抽好再序列化先入到 Jev。既然特徵抽取一定喺本地做，決策模型放本地仲省埋 70–500ms round-trip（Jev 官方 claim 嘅 end-to-end 範圍，wikitext Performance 節）。

---

## 瀏覽器內推理 vs GPU 爭用衝突

事實鏈（全部有來源）：

1. **WebGPU 瀏覽器狀態**：MDN 標記 WebGPU API 係 "**Limited availability** — This feature is not Baseline because it does not work in some of the most widely-used browsers"（https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API）。Chrome 官方 blog：WebGPU 由 **Chrome 113 起喺 Windows/macOS/ChromeOS 可用**（https://developer.chrome.com/blog/webgpu-io2023）。ONNX Runtime Web 官方矩陣：WebGPU 只支援 Chrome/Edge（Windows 需 Chromium 113+），Safari/Firefox ❌；WebGL 已入 maintenance mode（https://onnxruntime.ai/docs/get-started/with-javascript/web.html#supported-versions）。transformers.js 官方 README 警告：「The WebGPU API is still experimental in many browsers」（https://github.com/huggingface/transformers.js）。
2. **WebGPU 用嘅係同一塊物理 GPU**：ORT WebGPU EP 官方文檔——native 版經 **Dawn**，「which in turn dispatches to **D3D12**, Vulkan, or Metal」（https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html）。即係瀏覽器內 WebGPU 推理＝喺你塊 RTX 3070 Ti 上面同 **Resolume Arena（GPU 合成／輸出）＋ MadMapper（官方 claim 支援到 8K 輸出，https://www.garagecube.com/madmapper/）** 排隊爭 SM 同嗰 **8GB VRAM**（VRAM 數字來自主管核實嘅硬件事實）。
3. **衝突後果**：冇官方來源量化「Resolume＋MadMapper＋WebGPU 三者同機」嘅影響——**未證實**，但機制清楚：D3D12 上多個 process 共用 GPU 係 time-sliced，推理 kernel 會同 render pipeline 搶 queue，最容易觀察到嘅係 Resolume 輸出幀抖動。呢個係**推算**，唔係實測。
4. **唔爭 GPU 嘅瀏覽器路線**：ONNX Runtime Web 嘅 **WebAssembly (CPU) backend 全瀏覽器支援**（官方矩陣 ✅✅✅，同上 URL）。tiny MLP／GBDT 轉 ONNX 之後喺 WASM 跑，完全唔掂 GPU。transformers.js 官方都講明：「By default, when running in the browser, the model will be run on your CPU (via WASM)」，q8 係 WASM 預設 dtype（https://huggingface.co/docs/transformers.js/index）。
5. **你個 app 係 Tauri**（項目 ADR：[0003-tauri-plus-typescript-stack.md](../adr/0003-tauri-plus-typescript-stack.md)）：Windows 上 Tauri 用 WebView2（Chromium 系）。**WebView2 入面 WebGPU 可唔可用，本次冇官方來源核實→未證實**。就算可用，都撞返第 2 點嘅爭用問題。

**結論**：瀏覽器內推理只應該行 **WASM/CPU backend**（tiny 模型，延遲推算低 ms 級）。**WebGPU backend 喺你部機同 Resolume＋MadMapper 直接衝突，應該避開**；真係要 GPU，寧可用 native ONNX Runtime CUDA EP 加官方 `gpu_mem_limit` 把 VRAM arena cap 死（例如 ≤1GB）＋低優先級 stream——呢個 option 係官方文檔記載嘅（https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html#gpu_mem_limit）。

---

## 推薦架構：快層／慢層點分

延遲預算按「決策粒度」分層，全部 CPU-first：

```
音訊輸入（你已有嘅特徵管線，hop ≈20–50ms）
   │
   ├─【快層】每 20–50ms 一次｜預算 ≤5ms｜純 CPU、零 VRAM
   │    規則引擎（現有 Energy→Column，µs 級）
   │    ＋ calibrated 細模型：sklearn LogisticRegression/MLP 或 LightGBM
   │      （7–20 維特徵 → 4 個 Column/clip 類別）
   │    ＋ temperature scaling（sklearn CalibratedClassifierCV）
   │    ＋ Jev 同款 confidence 公式 (p_max−1/n)/(1−1/n)
   │    輸出：{clip/column, probabilities, confidence}
   │    進階（可選）：VW --cb_explore_adf 做 contextual bandit，
   │      reward＝VJ 冇 override／clip 存活時間 → 在線學習
   │
   ├─【中層】每 46ms hop／beat event 驅動｜預算 ≤20ms/幀｜CPU 預設
   │    BeatNet（mode='stream'/'realtime', inference_model='PF', device='cpu'）
   │    → beat/downbeat/meter events，修正你「onset 唔可靠 BPM」嘅問題
   │    downbeat event → 切換 Column／clip bank（每 bar 一次決策）
   │    授權注意：只用 PF modes，避開 offline DBN（madmom NC models）
   │
   └─【慢層】每 2–10 秒一次（可選）｜預算 100–500ms｜CPU 或 capped GPU
        CLAP（HF weights apache-2.0）或 MERT（⚠️ weights CC-BY-NC）
        → 曲風／情緒 embedding → 揀 clip bank／palette
        如果要用 GPU：ONNX Runtime CUDA EP + gpu_mem_limit ≤1GB
        （同 Resolume/MadMapper 爭用風險自負，建議 CPU）
   │
   ▼
輸出通道：OSC/MIDI → Resolume Arena
（Resolume 官方頁：MIDI/OSC mapping tools＋「use the Resolume API to control
 Resolume over a network」＋DMX，https://resolume.com/software/avenue-arena）
MadMapper 嘅外部控制通道（OSC?）→ 本次未核實，見 §9
```

預算分配理由：
- 快層 ≤5ms：留 15–45ms 頭寸俾 feature 計算同 IPC，總 pipeline 穩定 <50ms。細模型單樣本推理係 µs–低 ms（**推算**，§3）。
- 中層跟 BeatNet 46ms hop（論文 §2.1 官方數字）：beat 決策本來就唔需要快過特徵幀率。
- 慢層 100–500ms：同 Jev 官方 70–500ms 同量級——即係話**你本地慢層做到 Jev 嘅事，仲要免 API**。
- Resolume 內置 FFT 負責 per-frame 視覺 bounce（官方頁），外部層只負責**离散选择**（clip/Column/bank），唔好重複造輪。

### 同 ADR-0003（Tauri 2 ＋ TypeScript）嘅對齊衝突

項目已有決定：[docs/adr/0003-tauri-plus-typescript-stack.md](../adr/0003-tauri-plus-typescript-stack.md)（本次讀過，只讀唔改）。佢有四個硬約束直接影響上面呢個分層：

1. **「禁止把業務邏輯（映射表、決策規則）寫入 Rust」**——Rust 只限 bridge 層（UDP/OSC、必要時原生音訊）。所以**決策模型唔可以放 Rust 側**，要放 TypeScript（WebView2）或者一個外部 process。
2. **舊 draft 嘅 sidecar 被拒絕過**，理由係「兩個 process 要各自管理、sidecar 會 idle 死，正正係舊 draft 嘅病」。而 sklearn／LightGBM／BeatNet／VW-python **全部係 Python 棧** → 用佢哋就等於重新引入 sidecar，要配 lease/heartbeat 機制（ADR 講舊嘅 owned child process＋Job object＋lease/heartbeat 設計原則保留作參考）。**呢個係本次研究同現有 ADR 嘅正面張力，要用戶裁決。**
3. **「Web 瀏覽器唔可以直接發 OSC」**（OSC 行 UDP，browser 冇 raw socket）→ 決策結果一定要經 Rust bridge 先出到 Resolume。即係快層放 TS 嘅話，每決策多一次 TS→Rust IPC（推算 <1ms，未證實）。ADR 亦記低例外選項：Resolume WebSocket API 可能俾瀏覽器層直連，「呢條正在研究中，未定」。
4. 唔走 sidecar 嘅路線（同 ADR 完全一致）：**快層用純 TypeScript**——logistic regression／細 MLP 嘅 inference 就係一次矩陣乘，幾十行 TS 搞掂；或者用 **ONNX Runtime Web 嘅 WASM backend**（MIT，官方全瀏覽器支援矩陣 ✅，純 CPU 唔爭 GPU，https://onnxruntime.ai/docs/get-started/with-javascript/web.html#supported-versions）。訓練可以離線用 Python（sklearn 訓練→導出 ONNX／導出 weights JSON），**推理喺 TS**。呢個組合可以完全避開 sidecar，同時保留 calibration（temperature scaling 只係一個除法＋softmax，TS 可實作）。
   - 代價：**中層 BeatNet（Python/PyTorch）喺呢條路線下就用唔到**，除非接受 sidecar。純 TS 嘅替代係自己寫 beat tracking（例如用你已有嘅 onset＋一個 comb filter／agent-based tempo estimator）——本次冇核實到開源 TS beat tracker，屬**未證實**。
- 中層跟 BeatNet 46ms hop（論文 §2.1 官方數字）：beat 決策本來就唔需要快過特徵幀率。
- 慢層 100–500ms：同 Jev 官方 70–500ms 同量級——即係話**你本地慢層做到 Jev 嘅事，仲要免 API**。
- Resolume 內置 FFT 負責 per-frame 視覺 bounce（官方頁），外部層只負責**离散选择**（clip/Column/bank），唔好重複造輪。

---

## 「20ms」呢個要求嘅可行性判斷

直接逐類答（「能」＝有官方依據或穩健推算支持；冇公開數字嘅已標明）：

| 方法類 | 20ms 內出決策？ | 依據 |
|---|---|---|
| 規則引擎 | ✅ 能（µs 級） | 推算：幾次浮點比較；冇官方數字因為冇官方 |
| sklearn LR/MLP、LightGBM、XGBoost（細模型、單樣本） | ✅ 能（推算 0.1–2ms，Python 呼叫 overhead 主導） | 官方冇單樣本延遲數字→**推算**（§3 寫明推算方法） |
| ONNX Runtime CPU（tiny model） | ✅ 能（推算低 ms） | 官方只有 tuning docs，冇絕對數字→推算 |
| 手寫 LinUCB／Thompson sampling | ✅ 能（µs 級） | 論文只講 computationally efficient（https://arxiv.org/abs/1003.0146）→推算 |
| VW contextual bandit | ✅ 大概率能（推算 µs–低 ms；Python binding overhead 要留意） | 官方定性 "fast"，冇絕對數字→推算 |
| BeatNet beat/downbeat | ✅ 官方定位 real-time、CPU 預設；每 46ms hop 出一次 activation（推算 CPU 可維持） | 定性 claim 有來源；絕對 ms 冇→推算 |
| DistilBERT/TinyBERT/MiniLM 級 encoder | ⚠️ 勉強／唔得：consumer CPU 推算幾十 ms，GPU 都可能 >20ms（冇官方絕對數字） | 只有相對加速比（9.4x 等）→推算 |
| CLAP／MERT／MusicFM embedding | ❌ 唔得（百 M 參數 transformer；官方冇 real-time claim；MusicFM README 反而警告 memory issues） | 推算 |
| Jev API | ❌ 唔得：官方 claim 本身就係 **70–500ms end-to-end**，而且冇 20ms 一手來源；API-only 無本地路線；**亦唔原生食 audio** | https://en.wikipedia.org/wiki/Jev_(AI_model)（wikitext Performance 節）、https://docs.typesafe.ai/models |
| 瀏覽器 WebGPU 推理 | ❌ 唔應該：同 Resolume＋MadMapper 爭同一塊 8GB GPU（機制見 §6；量級未證實） | ORT WebGPU EP docs（Dawn→D3D12） |
| 瀏覽器 WASM 推理（tiny model） | ✅ 能（推算；官方全瀏覽器支援矩陣） | https://onnxruntime.ai/docs/get-started/with-javascript/web.html |

**但係最重要嘅判斷係：20ms 呢個要求本身用唔著。**理由（全部有來源或算術）：

1. 你嘅 Energy 特徵 attack window 係 **50ms**（已知事實）——決策快過特徵更新率係做無用功。
2. MIR 標準 beat 容差 **±70ms**（BeatNet 論文 §3.1）。
3. 人類「即時感」上限 **100ms**（Nielsen）。
4. 60fps 一幀 **16.7ms**；per-frame 視覺調變 Resolume 內置 FFT 已經做緊（官方頁）。clip **選擇**係离散事件，每 beat（500ms@120BPM）甚至每 bar 先至有音樂意義。
5. 所以合理 spec 係：**快層 50ms 級（已極保守），beat 層跟 46ms hop，慢層秒級**。20ms 預算留返俾 audio callback 同 IPC jitter，唔係俾模型。

---

## 未證實項目清單

以下各項本次**冇**核實到一手來源，使用時要再查或者實測：

1. **所有單樣本絕對延遲數字**（sklearn/XGBoost/LightGBM/ORT/VW/BeatNet/WASM）：官方冇公佈，本檔全部屬**推算**；上線前要用你部機實測（本次任務禁止跑 benchmark）。
2. **BeatNet 喺 Windows＋Python 3.10+ 嘅實際可用性**：README 記載咗 madmom 兼容性 patch 方法，但 stream mode 喺 Windows 需要 pyaudio wheel（README 指向第三方 wheel 站）——未證實目前仍有效。
3. **MediaPipe Decision Maker task 嘅 API／延遲／是否 bandit**：只核實到官方 docs 導覽存在呢個 task。
4. **MediaPipe Audio Classifier 嘅 streaming 細節同延遲**：頁面正文抓取被截斷。
5. **Tauri WebView2 係咪支援 WebGPU**：冇官方來源核實。
6. **Resolume Arena 7.x 官方 system requirements／VRAM 佔用**：resolume.com 相關 support 頁 404；只核實到行銷頁功能（FFT、OSC/MIDI/DMX、API）。當前最新版係 7.29.0（2026-11-12，https://resolume.com/download/）；你部 7.23 係 2025 年 7–9 月版本。
7. **MadMapper 嘅外部控制通道（OSC?）同 VRAM 需求**：garagecube 產品頁冇講；madmapper.com 未抓。
8. **CLAP/MERT/MusicFM checkpoint 實際大細同 8GB VRAM 共存表現**：冇官方數字。
9. **MusicFM HF checkpoint（minzwon/MusicFM）嘅 weights license**：code 係 MIT/Apache，但 HF 側 license 欄未核實。
10. **Essentia 官網 docs（essentia.upf.edu）**：本次多次連線失敗；streaming 證據用咗 GitHub repo 內 `.rst` 原文代替。
11. **LiteRT 官方絕對延遲 benchmark 數字**：README 只有工具同平台表。
12. **Jev 有冇 20ms 場景一手來源**：確認**冇**（同主管核實一致）；官方可見 claim 只有 70–500ms。
13. **madmom models 商業授權實際條款**：LICENSE 話要聯絡 Gerhard Widmer，但未查商業授權實價／可行性。
14. **TS→Rust（Tauri invoke）每次 IPC 延遲**：推算 <1ms，冇官方數字，要實測。
15. **有冇可用嘅開源 TypeScript beat tracker**（避開 Python sidecar 嘅 BeatNet 替代）：本次未核實到，屬未證實。
16. **Resolume WebSocket API 可否俾 WebView2 直連**（ADR-0003 自己標「研究中，未定」）：本次未查 Resolume API docs。

---

## 要問用戶嘅問題

1. **呢個 VJ 工具會唔會商業發佈／賣錢？**決定 AGPL（Essentia）同 CC-BY-NC-SA（madmom models、MERT weights）可唔可以用。個人自用基本上全部可用；一賣錢，Essentia 要買 commercial license、madmom 預訓練模型同 MERT weights 直接出局。
2. **決策粒度到底要乜？**离散 clip/Column 選擇（50ms 級夠）定 per-frame 參數調變（Resolume 內置 FFT 已做）？如果只係前者，20ms 目標可以正式放棄。
3. **接受 Python sidecar process 嗎？**（ADR-0003 之前拒絕過 sidecar，理由係 idle 死＋管理成本；亦禁止決策邏輯入 Rust。） sklearn/BeatNet/VW-python 都係 Python 生態；唔要 sidecar 嘅話，快層就要行「Python 離線訓練→導出 ONNX/weights→TypeScript＋ONNX Runtime Web WASM 推理」路線（§7），代價係 BeatNet 用唔到，要自己寫 TS beat tracking。呢個係本次研究最大嘅架構裁決點。
4. **VRAM 實際剩幾多？**Resolume＋MadMapper 開住嗰陣用 Task Manager/nvidia-smi 睇下 8GB 用咗幾多，先決定慢層可唔可以掂 GPU（或者完全 CPU）。
5. **要唔要在線學習？**即係「VJ 手動 override 咗個 clip＝負獎勵，clip 存活＝正獎勵」呢種 feedback loop。要嘅話 VW contextual bandit（BSD-3）係現成路；唔要嘅話 calibrated 監督模型簡單得多，但需要你標一批 training data（邊種特徵組合→邊個 Column 係「啱」）。
6. **MadMapper 嗰邊想點被控制？**如果 MadMapper 只係做 mapping output、由 Resolume 餵訊號，咁決策層只需要對 Resolume 講嘢；如果要獨立控制 MadMapper，要先核實佢嘅 OSC/DMX 支援（未證實項 #7）。
7. **BPM 唔可靠呢個問題想唔想根治？**BeatNet（CC-BY-4.0、CPU、real-time claim）可以直接補上 beat/downbeat/meter；但佢係 PyTorch＋pyaudio 棧，同你現有管線點接要設計。

---

### 引用統計

本檔帶 URL 嘅 claim：**約 60 條**（每個表格行、每節事實點均附一手來源；推算項已逐項標明「推算」同推算方法）。所有一手來源類型：官方 GitHub repo/API（license 欄）、官方 LICENSE 原文、官方 docs（ONNX Runtime、scikit-learn、librosa、madmom、TypeSafe、Google AI Edge、Chrome/MDN）、論文原文（arXiv abs/HTML）、官方 model card（Hugging Face）、官方產品頁（Resolume、garageCube、NN/g）。
