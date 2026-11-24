# 決策引擎：本地兩層、綁結構事件，唔用雲端 Jev、唔追求 20ms

用戶最初要求「Jev 式 0.02s 快速決策」。核實一手來源後：Jev（TypeSafe AI）係**雲端 API-only、冇公開 weights、冇本地推理**，官方 end-to-end 延遲係 70–500ms（唔係 20ms），且 TypeSafe 自己承認 benchmark workflow 有偏。同時用戶其後釐清真正需求：EDM 嘅 build-up→drop 等**結構事件**先係決策觸發點，佢哋「靠聽音樂 judge，唔係 linear bar/phrase」— 即係決策節奏係 per-event（秒級間隔），唔係 per-frame。

決定：**決策引擎全本地，分兩層**。慢層偵測結構事件（build-up／drop／breakdown／transition）並在 Region Mapping 上揀 clip，輸出候選＋置信度，用戶可一鍵 override；快層做連續 effect parameter（per-frame，跟三頻能量）。第一版慢層以現有 DSP（三頻能量、spectral flux、onset density 變化）做 heuristic 近似，ML 結構分段留待研究證據確認 streaming 可行性後先加。唔採用 Jev 雲端 API；如果之後想試，慢層接口預留 plug-in 位。

## Considered Options

- **Jev 雲端 API**：拒絕。現場表演依賴網絡往返係致命單點；收費；官方延遲（70–500ms）對 per-event 決策冇優勢 — 本地方法一樣夠快。
- **20ms per-frame 決策**：拒絕。快過 Resolume 60fps 渲染（16.7ms），決定咗畫面都換唔到；每 20ms 換 clip 只係 strobe 噪音，唔係 VJ。
- **第一版就上 neural structure segmentation**：推遲。學術方法大多數 offline（要成首歌），streaming 可行性同 mic 收音下嘅準確率未有證據，research 進行中。

## Consequences

- 慢層失敗（漏偵 drop）嘅後果係「clip 冇換」，用戶可手動 override — 所以 override UI 係第一版必備，唔係 nice-to-have。
- mic 收音係準確率天花板：AGC／噪音污染無法完全消除，所有偵測閾值要可調、要能喺現場校準。
- 「AI agent」呢個詞之後只可以指慢層嘅自動決策組件，唔可以對外宣稱用咗 Jev 或 LLM。
