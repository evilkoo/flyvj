# 主角由「腦」改為「做 VJ 嘅 3D 果蠅角色」；觸發粒度用 Column 全換

用戶喺 Q22 重新定義咗 app 嘅核心畫面：「做好一個 APP 介面，睇到音樂輸入令 app 嘅決策——VJ 做出決定，用 3D model visualize。不一定係腦部，或者一個 3D FLY model 係一名 VJ 都可以，只要見到音樂輸入令到呢名 VJ 有反應輸出。」同時 Q20 揀咗 B：觸發粒度用 **Column 全換**（trigger 一欄 = 所有 layer 嗰格 clip 一齊觸發，Resolume 官方語義已核實）。

決定：
1. **第一版 3D viewport 嘅主角係一名「果蠅 VJ」角色**（avatar），音樂輸入驅動佢嘅可見反應（例如觸鬚／腳／翅跟三頻能量），佢嘅「決定」經 Column trigger 反映到 Resolume 輸出。hemibrain ROI mesh 降級為可選嘅次要儀表（或者第一版完全唔用），唔再係必經之路 — 呢點部分取代 ADR 0002 嘅「腦係第一版必做儀表」。
2. **觸發契約固定用 Column**：`/composition/columns/N/connect`（或 WebSocket trigger 等價物），三 layer 一齊換。呢個同 Q18 定嘅 3-layer composition 兼容：3 layer × N columns 嘅 grid，一次決策換一欄。舊 draft「Energy→Column 1/2/3」規則直接沿用。
3. Avatar 模型候選以 NeuroMechFly v2（Apache-2.0 code，micro-CT 真實果蠅，見 docs/research/fly-avatar-model-options.md）為科學路線首選；**採用前必須先核實佢 mesh assets 嘅獨立授權同 MJCF→渲染嘅轉換成本**。如果用戶接受非科學資料嘅角色，輕量卡通果蠅模型係更快嘅 fallback。
4. 驅動方式：音訊特徵 → 關節／形態參數直接 playback（kinematic），**唔喺 app 入面跑物理模擬**。NeuroMechFly 官方嘅 brain（decision）／VNC（motor）層級語言同 ADR 0004 嘅兩層決策同構，作為 domain 語言借用。

## Considered Options

- **腦做主角（舊路線，ADR 0002）**：用戶話「不一定係腦部」，角色化嘅 VJ 先係佢想見到嘅嘢。腦 mesh 保留做之後嘅可選視圖，唔删。
- **Per-layer 獨立觸發（Q20-A）**：粒度細但決策邏輯要三線獨立行，第一版複雜度高；用戶揀咗簡單直接嘅全換。
- **喺 app 跑 MuJoCo 物理**：拒絕。~2x real-time 係完整物理嘅官方 CPU 數字，喺要同 Resolume＋MadMapper 爭資源嘅 8GB VRAM 表演機上冇必要，kinematic playback 平幾個數量級。

## Consequences

- 「落地使用」嘅驗收畫面更新：音樂入 → **avatar 有可見反應＋做出決定** → Column trigger → Resolume 換 clip。9 條測試 clip 排 3 layer × 3 column grid 做第一輪（用戶 Q21：clip 庫路徑後補，先用 9 條片入 Resolume 測試）。
- CONTEXT.md 嘅「果蠅腦模型」定義要加 avatar 條目；腦嘅 _Avoid_ 話術清單不變（仍然唔可以宣稱真 firing）。
- Avatar 科學真實度係咪硬要求 → 未答，係下一輪 frontier（決定 NeuroMechFly 定輕量模型，工時差約 3 倍）。
