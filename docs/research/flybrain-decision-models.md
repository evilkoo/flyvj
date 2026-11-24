# 果蠅腦可唔可以做即時決策引擎 — 研究報告

日期：2026-11-17（Asia/Shanghai）
研究方法：web_search 壞咗（401），全部用 web_fetch 直接抓 primary source（官方 repo README、官方 docs、EuropePMC／PMC 全文、bioRxiv API、Crossref、dataset 發佈頁）。所有 claim 帶 URL；推算／未證實嘅嘢有標明。

---

## 一句結論

**用真實 connectome 做「即時決策引擎」冇公開可行性證據**：唯一經同行評審嘅全腦 spiking 模型（Shiu et al. 2024, Nature）官方報告 **1 秒生物時間要約 5 分鐘單一 CPU thread**（≈0.0033× real-time），而「昆蟲腦啟發」嘅稀疏架構（random projection → sparse competitive layer → winner-take-all）有一手理論來源（Dasgupta et al. 2017, Science：果蠅嗅覺迴路 ≈ locality-sensitive hashing 變體）同多個開源參考實作，喺 8GB VRAM 機上跑 ≥30Hz 決策 loop 綽綽有餘（推算）——所以 B 路線升級有科學根據，C 路線（真做 connectome 運算）保留做離線實驗合理。

---

## FlyBrainLab / NeuroArch / FlyBrainLabWeb 實際能力與授權

### FlyBrainLab 官方定位

- 官方 repo：https://github.com/FlyBrainLab/FlyBrainLab ；官網：https://flybrainlab.github.io/FlyBrainLabWeb/
- 官方 README 原文定位：「an interactive computing platform for studying the function of **executable circuits** constructed from fruit fly brain data」，三大能力：(i) 3D exploration/visualization、(ii) creation of executable circuits directly from the explored fly brain data、(iii) interactive exploration of the functional logic（https://github.com/FlyBrainLab/FlyBrainLab README，已抓取原文）。
- 對應論文：Lazar, Liu, Turkcan & Zhou, eLife 2021,「Accelerating with FlyBrainLab the discovery of the functional logic of the Drosophila brain in the connectomic era」 https://doi.org/10.7554/eLife.62362 — abstract 講明佢係「integrates 3D exploration and visualization of diverse datasets with interactive exploration of the functional logic of **modeled executable brain circuits**」。即係話：「executable」指**研究者自己組嘅 circuit model 可以執行**，唔係「整個 connectome 自動變身可執行大腦」。
- Programmable ontology 論文（官方描述 NeuroNLP++／circuit libraries 點樣「執行」）：Lazar, Turkcan & Zhou, Frontiers in Neuroinformatics 2022, https://doi.org/10.3389/fninf.2022.853098 — 演示嘅 executable 例子係 **antennal lobe 嗅覺 feedback loops**，唔係全腦。

### 實際模擬能力同運行環境

- **GPU 執行神經迴路要 local full installation**：官方 README 明言「the public backend servers **do not provide capabilities for executing neural circuits on GPUs** using Neurokernel」（https://github.com/FlyBrainLab/FlyBrainLab README §1.1）。
- Full installation 官方系統需求：**Ubuntu 16.04+、CUDA enabled GPU、最少 30GB disk、建議 32GB RAM**（同上 README §1.2）。即係話官方 GPU 執行路線**唔支援 Windows 原生**。
- 模擬引擎係 Neurokernel：「a Python framework for developing models of the fruit fly brain and executing them on **multiple NVIDIA GPUs**」，prerequisites 寫明 **Linux（其他 OS 未測試）+ CUDA 5.0+ + OpenMPI 1.8.4+**，而且官方註明「OpenMPI 1.8 **cannot run on Windows**」（https://github.com/neurokernel/neurokernel/blob/master/README.rst）。
- Neurokernel 論文：Givon & Lazar, PLOS ONE 2016, https://doi.org/10.1371/journal.pone.0146581 — 展示嘅整合例子係 retina+lamina 兩個 LPU，benchmark 係**模組間通訊 throughput**，論文冇任何「connectome-scale 全腦 real-time」宣稱。
- Neuroballad（FlyBrainLab 嘅高層 circuit simulation API，建喺 Neurokernel 上）官方 README 自己講：「Neuroballad is **in its early stages of development** at this time and therefore **its use in most circumstances is not recommended**」（https://github.com/FlyBrainLab/Neuroballad/blob/master/README.md）。
- User-side only install（Windows 得）：conda + Python 3.9，官方說明呢個模式「If you only need to **visualize and explore** the biological data, this will be the fastest way」（README §1.1）— 即係 Windows 上官方支援嘅係查詢／視覺化，唔係 GPU 模擬。

### NeuroArch / datasets / NeuroNLP++

- NeuroArch：「A graph database for fruit fly brain circuits」（官方 repo description，https://github.com/fruitflybrain/neuroarch）。係 **graph database（形態＋突觸連接）**，唔係動態模型。
- 官方 datasets repo（https://github.com/FlyBrainLab/datasets）列明每個 dataset 嘅**原始授權**：
  - Hemibrain：**CC-BY 4.0**（https://creativecommons.org/licenses/by/4.0/）
  - FlyWire（FAFB783 喺呢度）：**CC-BY-NC 4.0**（非商業）
  - L1EM larva：CC-BY-SA 4.0；MANC：CC-BY；FIB19／Optic Lobe：CC-BY；Medulla：BSD-3 + ODC-BY
- NeuroNLP++（browser 路線實際係咩）：官方 live demo https://hemibrain.neuronlp.fruitflybrain.org/ — 佢自己描述係「a **query interface** for navigating fruit fly brain datasets… 3D visualization」，用 WebGL 喺瀏覽器查詢 neuron／synapse／neuropil 同做 connectivity graph view。**冇任何執行模擬嘅功能**。引用文獻同 credit 都喺該頁列明（Hemibrain CC-BY, Scheffer et al. eLife 2020 https://doi.org/10.7554/eLife.57443）。
- **FlyBrainLabWeb 真相**：https://flybrainlab.github.io/FlyBrainLabWeb/ 係 FlyBrainLab 嘅**介紹網站**（overview／install／tutorials／datasets links），唔係 browser-only 模擬平台。佢額外介紹兩個新工具：NeuroCircuitDesk（https://github.com/bybsolo/neurocircuitdesk-public，MIT license，「composing, executing, and visualizing neural circuits from connectomic graph abstractions」，scalar NumPy engine 或 MLX batched engine — 執行嘅係**人為組合嘅 microcircuit templates**，唔係全 connectome）同 NeuroGraphBench（https://github.com/ShashShukla/NeuroGraphBench，sub-neuronal 幾何分析工具）。
- FFBO 原始論文（NeuroNLP 前身）：Ukani et al.,「The Fruit Fly Brain Observatory: From Structure to Function」, bioRxiv 2019, https://doi.org/10.1101/580290（由 NeuroNLP++ 官方 overview 頁引用）。

### 授權小結（FlyBrainLab 生態）

- FlyBrainLab code：**BSD 3-Clause**（https://github.com/FlyBrainLab/FlyBrainLab/blob/master/LICENSE）。
- Neurokernel：BSD（README.rst License 節）；GitHub API 顯示 license key "other"（https://api.github.com/repos/neurokernel/neurokernel）。
- NeuroArch：GitHub API 顯示 license "other"（https://api.github.com/repos/fruitflybrain/neuroarch）— 商用前要逐 repo 核對。
- **數據授權先係大鑊嘅**：FlyWire 公開 release（FAFB783）係 **CC-BY-NC 4.0**（官方 citation guidelines：https://flywire.ai/guidelines；datasets repo 同樣標 CC-BY-NC）。**NC = 非商業**。Hemibrain 係 CC-BY 4.0（Janelia 官方頁：https://www.janelia.org/project-team/flyem/hemibrain）。如果呢個 VJ 工具將來商業使用，FAFB783 來源嘅資產有授權風險；hemibrain 來源冇呢個問題。
- 用戶手上 neu3d repo（https://github.com/fruitflybrain/neu3d，官方 description：「A javascript 3D visualization engine for neural data in SWC format」）**GitHub API 顯示 license: null**（https://api.github.com/repos/fruitflybrain/neu3d）— mesh 資產嘅散布授權未確認（底層 hemibrain 數據係 CC-BY，但 repo 本身冇 license file）。ffbo.lib 係 BSD-3-Clause（https://api.github.com/repos/fruitflybrain/ffbo.lib）。

**小結**：FlyBrainLab 生態提供嘅「executable」係「研究者喺 Jupyter 環境用人為設定嘅參數組 small-to-medium circuit models 再執行」，官方自己嘅 GPU 執行路線要 Linux+CUDA+32GB RAM 建議配置，Windows 部署機上官方支援嘅只有查詢／3D 視覺化。**冇任何官方文檔宣稱佢可以做即時決策引擎。**

---

## connectome 模擬已發表工作

| 工作 | 規模 | real-time factor | 輸入類型 | URL |
|---|---|---|---|---|
| **Shiu et al. 2024, Nature**「A Drosophila computational brain model reveals sensorimotor processing」（同行評審；LIF；Brian2） | **127,400 neurons**（FlyWire v630 全部 proofread neurons）、50M+ synapses | **官方 Methods 數字：≈5 min wall time per 1,000 ms simulated trial per CPU thread ≈ 0.0033× real-time（約 300 倍慢）** | 味覺 GRN（sugar/water/bitter/Ir94e）Poisson 10–220 Hz current injection；機械感受 JONs；抽象 activation/silencing screen | 論文 https://doi.org/10.1038/s41586-024-07763-9 ；全文 https://pmc.ncbi.nlm.nih.gov/articles/PMC11446845/ ；preprint https://doi.org/10.1101/2023.05.02.539144 ；model results data https://edmond.mpdl.mpg.de/dataset.xhtml?persistentId=doi:10.17617/3.CZODIW |
| **Lappalainen et al. 2024, Nature (flyvis)**「Connectome-constrained networks predict neural activity across the fly visual system」（同行評審；connectome-constrained deep mechanistic network，rate-based，PyTorch） | 視覚系統 **64 cell types**（optic lobe motion pathways），唔係全腦 spiking | 訓練用 deep learning；推理速度論文冇報 real-time factor。第三方 browser port（Lulzx/fly-brain docs）量到 flyvis = 45,669 nodes／1.5M synapses，20ms steps，**≈53 ms per simulated second（≈19× real-time，WebGPU 環境，第三方自報）** | optic flow task（視覺） | 論文 https://doi.org/10.1038/s41586-024-07939-3 ；官方 repo https://github.com/TuragaLab/flyvis （MIT，官方 readme：「A connectome-constrained deep mechanistic network (DMN) model of the fruit fly visual system in PyTorch」）；docs https://turagalab.github.io/flyvis/ ；第三方性能數字 https://github.com/Lulzx/fly-brain/blob/main/docs/27-webgpu.md （自報，未證實） |
| **Pugliese et al. 2026, Nature**「Connectome simulations identify a central pattern generator for fly walking」（同行評審） | **Drosophila ventral nerve cord (VNC) connectomes**（4 個 dataset；MANC ~23,665 neurons 級別），dynamic simulations | 論文 abstract／EuropePMC 記錄冇公開 real-time factor 數字（**未證實**） | descending neuron activation screen（抽象 current injection）；output = leg motor neuron rhythm | 論文 https://doi.org/10.1038/s41586-026-11195-y ；preprint https://doi.org/10.1101/2025.09.12.675944 |
| **Pospisil et al. 2024, Nature (effectome)**「The fly connectome reveals a path to the effectome」 | 全腦 connectome，但係**線性動力學模型**（linear dynamical model + connectome prior），唔係 spiking | 線性模型估計，冇 real-time loop 宣稱 | stochastic optogenetic perturbation data（實驗數據 fitting） | https://doi.org/10.1038/s41586-024-07982-0 ；OA 全文 https://europepmc.org/articles/PMC11446844 |
| **Givon & Lazar 2016, PLOS ONE (Neurokernel)** | 平台論文；demo = retina+lamina LPU 整合（千級 neurons） | benchmark 係通訊 throughput，冇全腦 real-time 宣稱 | 抽象 spike/graded potential ports | https://doi.org/10.1371/journal.pone.0146581 ；repo https://github.com/neurokernel/neurokernel ；benchmark source https://github.com/neurokernel/neurokernel/tree/master/benchmarks/timing_connectome |
| **Lulzx/fly-brain（非同行評審 hobby project）** | **165,122 neurons**（MaleCNS v1.0，10.5M connections），conductance-based LIF，browser WASM/WebGPU | **repo 自報：≈0.2× real-time per fly with vision（recent laptop）；5 flies on 12-core machine；WASM kernel ≈5.6k steps/s（0.5ms step ≈ 2.8× real-time brain-only）；WebGPU 1.8k steps/s（software adapter）** — 全部係 repo 自己嘅測量，硬件未指明，未證實 | MuJoCo body + flyvis 視覺 + 味覺/嗅覺/觸覺 Poisson spike trains | https://github.com/Lulzx/fly-brain ；性能頁 https://github.com/Lulzx/fly-brain/blob/main/docs/18-performance.md ；run 說明 https://github.com/Lulzx/fly-brain/blob/main/docs/guide/run.md ；腦模型細節 https://github.com/Lulzx/fly-brain/blob/main/docs/05-brain-model.md |

重點解讀：

1. **唯一 peer-reviewed 全腦 spiking 數字係 0.0033× real-time（Shiu 2024）**，而且佢 Methods 寫明每個實驗跑「30 simulations of 1,000 ms」— 即係學術界自己都用佢做**離線 hypothesis 生成工具**，唔係即時引擎。
2. Shiu 模型只有一個自由參數 W_syn = 0.275 mV，baseline firing 全部 0 Hz，作者自己承認「absolute firing rate predictions are unlikely to be accurate」同「neuromodulation is not accounted for」（全文 https://pmc.ncbi.nlm.nih.gov/articles/PMC11446845/）。
3. Lulzx/fly-brain 係最接近「consumer hardware 上跑 >100k neuron」嘅公開例子，但佢係 **2026 年 9 月先出現嘅個人專案（GitHub API：36 stars、created 2026-09-10）**，冇 peer review，自報 0.2× real-time **已經係 slow motion**，仲要係 browser WASM 環境。就算全信佢，都未達到「即時」（1×）更遑論 30Hz 決策 loop 由真模擬驅動。
4. FlyBrain-HalfLife（https://github.com/Yusuftmle/FlyBrain-HalfLife，用戶已放低）：README 自報 12,260 neurons／428k synapses subgraph、「760+ steps/s CPU、1,250+ GPU、end-to-end ~2.5–3.2 ms」— 全部係 **repo 自報 benchmark，冇 peer review**，而且 12,260 neurons 只係 MaleCNS 嘅 ~7% subgraph，唔係 connectome-scale。佢嘅「決策」大量依賴 hand-written FSM（reflexes、motor decoder），唔係由 connectome 自己浮現。一句帶過：呢類 project 嘅賣點同我哋底線（唔用未經證實數字）衝突，放棄合理。

---

## 昆蟲腦決策架構（mushroom body / central complex）工程實作

### Mushroom body（sparse coding / random projection / winner-take-all）

**理論一手來源（呢啲正正係「random projection → competitive layer → WTA」同 ML sparse coding／LSH 嘅關係）：**

- **Dasgupta, Stevens & Navlakha 2017, Science**「A neural algorithm for a fundamental computing problem」：果蠅嗅覺迴路（ORN→PN→KC）係 **locality-sensitive hashing (LSH) 嘅生物變體**——相似 odor 產生相似 sparse KC pattern；三個同傳統 LSH 唔同嘅 computational ingredients 可以移植去改善 similarity search。https://doi.org/10.1126/science.aam9868 （preprint: https://doi.org/10.1101/180471）
- **Dasgupta, Sheehan, Stevens & Navlakha 2018, PNAS**「A neural data structure for novelty detection」：果蠅 novelty detection = **Bloom filter 變體**（distance- and time-sensitive），並翻譯成演算法 outperform 傳統 filters。https://doi.org/10.1073/pnas.1814448115 ；OA https://europepmc.org/articles/PMC6304992
- **Litwin-Kumar, Harris, Axel, Sompolinsky & Abbott 2017, Neuron**「Optimal Degrees of Synaptic Connectivity」：理論證明 **Kenyon cell 嘅 sparse connectivity degree 正正係最大化 representation dimension 嘅最佳值**（sparse 有時優於 dense）。https://doi.org/10.1016/j.neuron.2017.01.030 ；OA https://europepmc.org/articles/PMC5379477
- **Stevens 2015, PNAS**「What the fly's nose tells the fly's brain」：三層 encoder–decoder–user（Marr motif）；~2,000 KC 做 sparse tag、強 inhibition 做 winner-take-all。https://doi.org/10.1073/pnas.1510103112 ；OA https://europepmc.org/articles/PMC4522789
- **Shen, Dasgupta & Navlakha 2020, PNAS**「Habituation as a neural algorithm for online odor discrimination」：由果蠅迴路機制導出 habituation 演算法（filter 冗餘、增強 discrimination）。https://doi.org/10.1073/pnas.1915252117
- Pattern separation 綜述（MB vs cerebellum vs dentate gyrus）：Cayco-Gajic & Silver 2019, Neuron, https://doi.org/10.1016/j.neuron.2019.01.044

**開源實作：**

- **annkennedy/mushroomBody**（MATLAB）：「Code for simulating and analyzing a **spiking mushroom body model**」— ORN/PN/LN/KC/APL 全 pipeline，110 odors（Hallem & Carlson dataset），rate model + learning scripts；對應 bioRxiv paper https://www.biorxiv.org/content/10.1101/783191v1。https://github.com/annkennedy/mushroomBody （README 官方，已抓取）
- **BrainsOnBoard/paper_RPEs_in_drosophila_mb**（MATLAB，GPL-3.0）：Bennett, Philippides & Nowotny 2021, Nat Commun「Learning with reinforcement prediction errors in a model of the Drosophila mushroom body」官方 code — MBON 用 dopamine RPE plasticity 學 reinforcement prediction，**呢個正正係「用 MB 架構做 decision value 學習」嘅同行評審例子**。論文 https://doi.org/10.1038/s41467-021-22592-4 ；repo https://github.com/BrainsOnBoard/paper_RPEs_in_drosophila_mb
- **aclinlab/CompensatoryVariability**（MATLAB，GPL-3.0）：Abdelrahman, Vasilaki & Lin「Compensatory variability in network parameters enhances memory performance in the Drosophila mushroom body」官方 code。https://github.com/aclinlab/CompensatoryVariability

### Central complex（EB/PB/FB、ring attractor、action selection、heading）

**理論／模型一手來源：**

- **Heinze, Narendra & Cheung 2018, Current Biology（review）**「Principles of Insect Path Integration」：CX 內有 **ring-attractor network 編碼 head direction**，optic flow 匯入同一迴路；path integration 嘅神經底物。https://doi.org/10.1016/j.cub.2018.04.058
- **Cope et al. 2017, PLOS ONE**「A computational model of the integration of landmarks and motion in the insect central complex」：重現果蠅/蟑螂 neural compass 數據，用 **ring attractor + rotational motion detection**；官方提出可做 autonomous robotic agents。https://doi.org/10.1371/journal.pone.0172325
- **Sun, Yue & Mangan 2021, eLife**「How the insect central complex could coordinate multimodal navigation」：三個 building blocks（**copy-and-shift、ring attractor、steering circuits**）跨 sensory domain 做导航協調。https://doi.org/10.7554/elife.73077
- **Goulard, Buehlmann, Niven, Graham & Webb 2021, PLoS Comput Biol**「A unified mechanism for innate and learned visual landmark guidance in the insect central complex」：CX + MB 聯合模型，simulated agent 做 landmark steering。https://doi.org/10.1371/journal.pcbi.1009383
- **Stentiford, Knight, Nowotny, Philippides & Graham 2024, PLoS Comput Biol**「Estimating orientation in natural scenes: A spiking neural network model of the insect central complex」：**基於已發表 Drosophila connectome 嘅 CX spiking network**，喺自然場景 video 上 track heading。https://doi.org/10.1371/journal.pcbi.1011913
- **Noorman, Hulse, Jayaraman, Romani & Hermundstad 2024, Nature Neuroscience**「Maintaining and updating accurate internal representations of continuous variables with a handful of neurons」：**極少量 neuron 嘅 ring attractor 都可以維持連續 heading representation**（分析 + two-photon 數據）。https://doi.org/10.1038/s41593-024-01766-5
- Mitchell & Webb 2026, PLoS Comput Biol「A framework for constructing insect steering circuits」：由果蠅 steering circuit 解剖歸納五條一般規則去構造同功能 steering circuits。https://doi.org/10.1371/journal.pcbi.1014009

**開源實作：**

- **XuelongSun/insectNavigationCX**（Python/Jupyter）：Sun et al. 2021 eLife 官方 code —「Use three parsimonious building blocks (i.e., 'copy-and-shift'; ring attractor; steering circuits) to model the highly complex insect navigation across sensory domains」。https://github.com/XuelongSun/insectNavigationCX
- **stenti/stentiford_cx_ra**（Python）：Stentiford et al. 2024 官方 code（connectome-based CX spiking model）。https://github.com/stenti/stentiford_cx_ra
- **HermundstadLab/DiscreteRingAttractor**（MATLAB，MIT）：Noorman et al. 2024 官方 code。https://github.com/HermundstadLab/DiscreteRingAttractor
- **adityasinha379/FlyBrainProject**：Cope et al. 2017 模型嘅重現（非原作者）。https://github.com/adityasinha379/FlyBrainProject
- Robot/agent 應用例子：BioNav-SLAM（CX model 做 robot navigation/SLAM simulation，Python）https://github.com/ATHARVA316-DEV/BioNav-SLAM-A-Bio-Inspired-Robotic-Navigation-and-SLAM-Simulation ；egocentric→allocentric 座標轉換模型（Sensors 2025，https://doi.org/10.3390/s25113540）。

**同機器學習嘅關係（一手來源）**：Dasgupta 2017 Science（LSH）同 Dasgupta 2018 PNAS（Bloom filter）就係最直接嘅一手來源——佢哋唔係「好似」，而係**將果蠅迴路演算法直接翻譯成 CS data structure 並 benchmark**。Litwin-Kumar 2017 就係 sparse random projection 嘅 dimensionality 理論。所以「random projection → competitive layer → WTA」呢種架構本身有 Science/PNAS/Neuron 級別嘅一手支持，**唔係借啲意嘅 marketing**。

---

## ≥30Hz connectome-scale 有冇公開證據

**直接答：冇。**

- 定義：connectome-scale = >10 萬 neuron；證據標準 = peer-reviewed 論文或可覆核嘅官方 benchmark；條件 = consumer hardware 上 ≥30Hz 決策 loop（即由 sensory input 到 action output ≤33ms，由真實神經動態驅動）。
- 最好嘅 peer-reviewed 數字：**Shiu et al. 2024（Nature）= 0.0033× real-time（1 秒生物時間 ≈5 分鐘 CPU thread，127,400 neurons，Brian2）**（https://pmc.ncbi.nlm.nih.gov/articles/PMC11446845/ Methods：「Simulation of sugar neuron activation takes approximately 5 min per 1,000 ms trial per central processing unit thread」）。差 4 個數量級以上。
- 最接近嘅非同行評審例子：Lulzx/fly-brain 自報 browser WASM brain-only ≈2.8× real-time（5.6k steps/s × 0.5ms step）、full pipeline ≈0.2× real-time（https://github.com/Lulzx/fly-brain/blob/main/docs/18-performance.md）— **自報、未證實、硬件未指明**；就算當真，end-to-end 都係 slow motion，唔係 30Hz 即時決策。
- FlyBrain-HalfLife 自報 end-to-end ~2.5ms，但佢只係 **12,260 neuron subgraph（<10 萬門檻）**，benchmark 未經第三方驗證（https://github.com/Yusuftmle/FlyBrain-HalfLife README）。**唔構成 connectome-scale 證據。**
- Neurokernel 論文 benchmark 係 multi-GPU 通訊 throughput，冇全腦 real-time 宣稱（https://doi.org/10.1371/journal.pone.0146581）。
- 要注意嘅區分：就算模拟本身慢過 real-time，工程上可以「30Hz 讀舊 state 出決定」— 但嗰個就唔係「connectome 即時決策」，係儀表化咗嘅慢模擬。呢個區分要寫入对外話術。

結論：**「connectome-scale（>10 萬 neuron）spiking 模型喺 consumer hardware 做到 ≥30Hz 決策 loop」喺公開文獻／官方 benchmark 層面冇證據。** 冇搵到反面證據亦冇搵到支持證據；呢個答案基於 EuropePMC／PMC／GitHub／bioRxiv API 搜索範圍（2026-11-17），屬「冇搵到」而非「證明不存在」。

---

## 8GB VRAM 上嘅預算推算

### 官方數字（有 URL）

| 項目 | 官方數字 | 來源 |
|---|---|---|
| Resolume Arena 7 minimum（Windows） | Windows 10、Nvidia/AMD GPU、8GB RAM | https://resolume.com/support/en/tech-specs |
| Resolume Arena 7 recommended（Windows） | Windows 11、i7 6-core 3.7GHz、**Nvidia RTX 4070**、M2 SSD、16GB RAM | 同上 |
| FlyBrainLab full install | Ubuntu、CUDA GPU、**30GB disk、32GB RAM 建議** | https://github.com/FlyBrainLab/FlyBrainLab README §1.2 |
| Neurokernel | Linux only、CUDA 5.0+、OpenMPI（Windows 唔得） | https://github.com/neurokernel/neurokernel/blob/master/README.rst |
| Shiu 2024 全腦 LIF | 127,400 neurons；**≈5 min per 1,000 ms per CPU thread** | https://pmc.ncbi.nlm.nih.gov/articles/PMC11446845/ |
| fly-brain（自報，未證實） | 165,122 neurons；GPU graph pack **84MB**；browser 載入 27MB；WASM ≈5.6k steps/s；**≈0.2× real-time per fly with vision（recent laptop）** | https://github.com/Lulzx/fly-brain/blob/main/docs/27-webgpu.md 、https://github.com/Lulzx/fly-brain/blob/main/docs/18-performance.md |
| FlyBrain-HalfLife（自報，未證實） | 12,260 neurons subgraph；CPU 760+ steps/s；GPU 1,250+ steps/s | https://github.com/Yusuftmle/FlyBrain-HalfLife |

### 推算（全部標「推算」，冇實測過，唔可以當已驗證）

部署機：RTX 3070 Ti **Laptop 8GB VRAM**，同機跑 Resolume Arena 7.23 + MadMapper。

1. **VRAM headroom**：Resolume 官方 recommended 係 desktop RTX 4070（12GB）；8GB laptop GPU 已經低於 recommended（官方數字，上表）。Arena composition + DXV decode + MadMapper output 嘅實際 VRAM 用量官方冇公開數字；**推算**：表演期間剩返俾第三方 engine 嘅 VRAM headroom 大概 1–2GB（未證實，要 nvidia-smi 實測）。任何要吃 >1GB VRAM 嘅神經 engine 都同 VJ 輸出搶資源。
2. **C 路線（真 connectome LIF）喺呢部機嘅推算**：
   - 照 Shiu 2024 官方數字外推：1 秒生物時間 ≈5 分鐘 CPU thread → **每次決策延遲以分鐘計，差 ≥4 個數量級先夠 33ms（30Hz）**。就算有多核並行（例如 8 threads 完美 scaling，推算），都仲係 ~37 秒/秒生物時間。
   - 就算用 fly-brain 自報最好情況（brain-only WASM 2.8× real-time、full pipeline 0.2×）：**0.2× = 慢過 real-time 5 倍**，唔可以同步跟音樂；而且呢啲數字未喺我哋硬件驗證過（未證實）。
   - GPU 路線：84MB graph pack 本身塞得入 8GB（fly-brain 自報數字），但 WebGPU/WASM kernel 係 browser 環境，同 Resolume 搶 GPU；**推算**：喺剩 1–2GB headroom 嘅情況下跑 >100k neuron kernel，風險係 Arena frame drop。結論：**C 路線喺表演機上即時運行 = 不可行（基於官方 5min/1s 數字推算）**；做離線研究可以。
3. **B 路線（昆蟲腦啟發稀疏架構）推算成本**：
   - 典型規模（照 Dasgupta 2017 / Litwin-Kumar 2017 生物參數）：input 3–30 維（三頻能量＋特徵）→ random projection 去 **2,048 個 KC-like units**（果蠅 ~2,000，Stevens 2015）→ sparse **k-WTA（top ~5% ≈ 100 active）** → **34 個 MBON-like readout**（果蠅 MBON compartment 數量級）→ CX-like **16–32 unit ring attractor / WTA action selection** → clip/Column 決定。
   - **推算**：每 step 計算量 ≤ ~50 萬 FLOPs（projection 30×2048 ≈ 6 萬 MAC 佔大頭）、memory ≤ 10MB；現代 CPU 單核每秒做 10^9–10^10 FLOPs 級別，所以 **1kHz step rate 都用唔到單核 1%**，30Hz 決策 loop 延遲 **<1ms（推算）**；**完全唔使 GPU、唔使 VRAM**。參考實作（MATLAB/Python）都係呢個數量級：Kennedy repo、Bennett repo、insectNavigationCX 全部都係 notebook-scale。
   - 呢個推算冇實測，**上線前要喺部署機 benchmark**；但即使悲觀 100 倍誤差，都仲有 ≥30Hz 餘量（推算）。
4. **A 路線（純視覺展示）**：用戶已有 14 ROI mesh 18,898 vertices／36,948 triangles + 36,044-node SWC — 對 8GB GPU 嚟講係零頭（推算：<50MB VRAM），同 Resolume 共存冇壓力。

---

## 三條路線比較

| | **C：真 connectome 模擬** | **B：昆蟲腦啟發架構** | **A：純視覺展示＋映射表（已定第一版）** |
|---|---|---|---|
| 科學誠實度 | 最高潛在誠實度（真用 connectome wiring），但**現階段無法喺部署機即時跑**；Shiu 2024 官方 0.0033× real-time | 高：架構有一手 Science/PNAS/Neuron 理論來源（LSH、optimal sparsity、ring attractor），只要**講明係「bio-inspired 演算法，唔係生物模擬」** | 高（只要話術準確）：真實 mesh 幾何 + 人為映射，**ADR-0002 已定**（docs/adr/0002-brain-as-mapping-carrier-not-engine.md） |
| 延遲 | 分鐘級（Shiu 官方數字）；最好自報 case 都係 0.2× real-time（未證實） | **<1ms/step 推算**，30Hz+ 冇問題 | ~0（查表） |
| 開發成本 | 極高：要 Linux/CUDA（Neurokernel）或自寫 GPU kernel；FlyBrainLab full install 要 32GB RAM 級機器；同 Resolume 搶 GPU | 中：幾百行 core（projection+WTA+ring）；有 MATLAB/Python 參考實作可借（見上節） | 低：已定架構，映射表 UI 為主 |
| 風險 | 表演機 frame drop、授權（FlyWire CC-BY-NC 非商業）、模型預測力有限（Shiu 自己承認 absolute rates 唔準）、開發期無限期 | 賣點話術風險：要防止被理解成「真果蠅腦」；架構參數要自己 tune（冇现成 audio→clip ground truth） | 賣點弱：如果 mapping 純人為，「果蠅腦做決策」變成純包裝 — **B 正正係補強呢一點** |

**判斷**：A 做第一版骨架（已定），**B 係 A 嘅升級路徑**（決策引擎喺映射表上行，但內部用 MB/CX 啟發嘅 sparse coding + WTA，令「腦區→clip」唔只係查表而有真實 competitive dynamics）；C 保留做離線實驗／第二階段展示素材（例如預先 render 嘅 Shiu-style activation propagation）。

---

## 對已定架構（映射載體）嘅補強建議

已定架構：腦區／節點人為對應 clip／Column，決策引擎喺映射表上面行（ADR-0002）。「腦區→功能」嘅人為映射**有一手 dataset 文檔支持**，唔係創作：

| 用戶已有 mesh | 官方功能註釋 | 一手來源 |
|---|---|---|
| AL_L_/AL_R_（antennal lobe） | 嗅覺第一站 | NeuroNLP++ Hemibrain 官方查詢文檔（AL 查詢示例）https://hemibrain.neuronlp.fruitflybrain.org/ ；嗅覺 connectome 分析 Schlegel et al. 2021 eLife https://doi.org/10.7554/eLife.66018 |
| MB_L_/MB_R_（mushroom body） | 「mushroom body … circuits critical for **associative learning**」（Janelia 官方原文） | https://www.janelia.org/project-team/flyem/hemibrain ；Schlegel et al. 2024 Nature（MB 最常見 cell type「required for learning and memory」）https://doi.org/10.1038/s41586-024-07686-5 |
| EB/FB/PB（central complex） | 「central complex circuits critical for … **fly navigation**」（Janelia 官方原文）；ring attractor head direction | https://www.janelia.org/project-team/flyem/hemibrain ；Heinze et al. 2018 https://doi.org/10.1016/j.cub.2018.04.058 ；Janelia 同頁：「The circuitry shown here is from the fly's central complex, a region that **controls navigation**」 |
| LH_R_（lateral horn） | innate olfactory behavior 整合中心 | Das Chakraborty & Sachse 2021 review https://doi.org/10.1007/s00441-020-03392-6 |
| GNG（含 SEZ） | taste/feeding 中樞（SEZ = 「primary taste centre」）、motor output | Shiu et al. 2024 https://doi.org/10.1038/s41586-024-07763-9 ；Shiu et al. 2022 eLife taste circuit https://doi.org/10.7554/eLife.79887 |
| LO_R_/LOP_R_/ME_R_（optic lobe） | 視覺 motion processing | flyvis Nature 2024（optic lobe motion pathways）https://doi.org/10.1038/s41586-024-07939-3 ；Nern et al. 2025 Nature（complete visual system inventory）https://doi.org/10.1038/s41586-025-08746-0 ；Janelia hemibrain 頁：「most optic lobe neurons entering the central brain … downstream **visual processing**」 |
| LAL_L_/LAL_R_（lateral accessory lobe） | steering／motor command 整合 | Mitchell & Webb 2026（steering circuits）https://doi.org/10.1371/journal.pcbi.1014009 ；Freas & Wystrach 2025（CX steering + LAL oscillators）https://doi.org/10.1101/2025.10.13.682010 |

補強建議（配合 B 路線）：

1. **映射表保留人為，但決策引擎內部用 MB/CX 啟發 dynamics**：三頻能量 → random projection（LSH-style，Dasgupta 2017）→ sparse WTA → 每個 active KC-like unit  vote 去佢映射嘅 clip/Column → CX-style ring/WTA 揀最終 winner。咁樣「AL=感覺輸入、MB=特徵競爭、CX=action selection」嘅**分工同生物功能註釋一致**（上表來源），但每個決定仍然係可解釋、可調嘅映射表輸出 — 完全符合 ADR-0002「決策引擎喺映射表上面行」。
2. 參考實作直接可借：insectNavigationCX（copy-and-shift + ring attractor + steering）、Bennett RPE MB model、Kennedy spiking MB。全部係 notebook-scale，移植去 TypeScript/C++ 決策 loop 成本低（推算）。
3. UI 顯示「呢個決定發生喺邊」：用 mesh ROI 做 activation heat（邊個腦區嘅 mapped units 贏咗），幾何係真實資產、activation 係引擎輸出 — 兩樣都唔係造假，但要標明 activation 係**演算法狀態**唔係生物記錄。

---

## 唔可以宣稱嘅嘢（禁止話術清單）

每條都附「點解唔可以」嘅一手來源：

1. ❌「真果蠅腦喺度 firing／做決定」— FlyWire 官方描述佢嘅數據係「**AI-segmented, expert-proofread** neurons」嘅 wiring diagram（https://flywire.ai/）；wiring ≠ dynamics。Shiu 2024 嘅模型都只係「a **simple** leaky integrate-and-fire model」，作者自己寫 baseline firing 0 Hz、absolute firing rate 預測唔準、冇 neuromodulation（https://pmc.ncbi.nlm.nih.gov/articles/PMC11446845/）。
2. ❌「科學驗證嘅神經決策引擎」— Shiu 2024 嘅實驗驗證範圍係 **feeding initiation 同 antennal grooming 兩個 sensorimotor circuit**（optogenetics 對照 >90% 準確），唔係一般「決策」，更加唔係音訊→clip 選擇。冇任何論文驗證過果蠅 connectome 模型做 VJ 式決策（搜索範圍內冇，見上節）。
3. ❌ 把 mesh 樣本點數／vertex 數當 neuron 數宣稱（用戶底線）— 官方 neuron 數只可以引 dataset 發佈方：FAFB783 = **139,255 neurons**（FlyWire Codex 官方 https://codex.flywire.ai/ ；Dorkenwald et al. 2024 Nature https://doi.org/10.1038/s41586-024-07558-y）；hemibrain = **~25,000 neurons**（Janelia 官方 https://www.janelia.org/project-team/flyem/hemibrain）。我哋手上嘅 18,898 vertices 係 ROI mesh 幾何，同 neuron 數冇關係。
4. ❌「即時（real-time）全腦模擬」— 唯一 peer-reviewed 全腦數字係 0.0033× real-time（Shiu 2024 Methods，同上 URL）；任何 real-time 宣稱都要標明係 subgraph（<10 萬 neuron）+ 自報 + 未證實（FlyBrain-HalfLife 類）。
5. ❌ 用 FAFB783 資產做商業宣傳而唔理授權 — FlyWire public release = **CC-BY-NC 4.0**（https://flywire.ai/guidelines），NC 禁止商業用途；如果工具會賣／商業演出使用，FAFB783 來源資產要換做 CC-BY 嘅 hemibrain（https://www.janelia.org/project-team/flyem/hemibrain）或者取得授權。
6. ❌「FlyBrainLab 提供大腦模擬服務」— 官方 README 明言 public backend **不提供** GPU circuit execution（https://github.com/FlyBrainLab/FlyBrainLab README §1.1）；Neuroballad 官方自己話「use in most circumstances is **not recommended**」（https://github.com/FlyBrainLab/Neuroballad/blob/master/README.md）。
7. ❌「呢個係果蠅嘅 X 腦區活動」— 我哋嘅 activation display 係演算法狀態映射到 ROI 幾何，必須用「inspired by／mapped to」呢類措辭；FlyBrainLab 官方對佢自己嘅 execution 都只講「exploration of the functional logic of the **devised** executable circuits」（https://github.com/FlyBrainLab/FlyBrainLab README）— devised = 人為設計。

可以用嘅誠實話術（對照）：

- ✅「決策架構參考果蠅 mushroom body 嘅 sparse coding 同 central complex 嘅 action selection 原理（Science 2017／Neuron 2017／eLife 2021 一手研究）」
- ✅「3D 腦結構用公開 connectome dataset 嘅真實 ROI 幾何（hemibrain CC-BY／FlyWire CC-BY-NC，標明來源）」
- ✅「腦區→clip 映射係人為設計、用戶可調」

---

## 未解決／要問用戶嘅問題

1. **商業用途？** FlyWire FAFB783 = CC-BY-NC（https://flywire.ai/guidelines）。如果呢個 VJ 工具會用於收費演出／銷售，而家手上嘅 FAFB783 樣本資產同任何 FAFB783 來源 mesh 都有授權風險；hemibrain（CC-BY）先係安全嘅宣傳基礎。要用戶決定。
2. **neu3d repo 冇 LICENSE file**（https://api.github.com/repos/fruitflybrain/neu3d）— 用戶手上 14 個 ROI mesh 如果係從 neu3d 抽出，散布授權未確認；底層 hemibrain 數據 CC-BY 唔等於 mesh 檔案授權清楚。要唔要向 FFBO 查詢／改用自行從 CC-BY 數據生成嘅 mesh？
3. **B 路線升級嘅範圍**：第一版係咪淨係映射表（A），定係直接落 MB-style sparse projection + WTA（B-lite）？B-lite 推算成本極低（<1ms/step），但要多寫 ~200–500 行 core 同 tuning；影響交付時間。
4. **決策延遲預算**：30Hz（33ms）係硬指標定 nice-to-have？mic→FFT→engine→OSC→Arena 全鏈路延遲未實測過（未證實）；Arena OSC 回應延遲官方冇公開數字。
5. **離線 C 路線實驗嘅定位**：如果將來做 Shiu-style 全腦模擬展示，接受佢係**預先 render／離線跑**（0.0033× real-time），唔可以 live？
6. **FlyWire 各來源 units/registration**：原有問題未變 — FAFB783 樣本、neu3d mesh、hemibrain SWC 三者嘅共同座標系未確認，未確認前唔可以疊加（本報告冇新證據解決呢點）。
7. **FlyBrainLab 官方 Windows 模擬路線缺失**：如果用戶堅持想試「官方 executable circuits」，只有 WSL2 + Docker（CUDA on WSL）一途（官方 README §1.3），要 30GB disk + 建議 32GB RAM — 部署機係咪有呢啲資源？

---

### 附：本報告引用密度自查

- 帶 URL 嘅 claim：**60+**（每個章節嘅每項事實性陳述都掛咗 repo／DOI／官方頁 URL）。
- 標「推算」嘅段落：VRAM headroom、B 路線 FLOPs/延遲、多核 scaling、A 路線 VRAM 佔用。
- 標「未證實」嘅數字：fly-brain 全部自報性能、FlyBrain-HalfLife 全部自報 benchmark、Pugliese 2026 real-time factor、部署機全鏈路延遲。
- 搜索限制：web_search 401 壞咗，只用 web_fetch（GitHub API 中途 rate limit 403 過一次，改用 EuropePMC/PMC/bioRxiv API 完成）；GitHub API rate limit 令 NeuroMynerva repo metadata 未核（不影響結論）。
