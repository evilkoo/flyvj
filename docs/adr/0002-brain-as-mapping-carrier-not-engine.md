# 果蠅腦做映射載體，唔做運算引擎

工具嘅賣點係「果蠅腦做快速決定輸出」，但手上嘅公開資料（14 個 hemibrain ROI mesh、1 份 SWC skeleton、FlyWire FAFB783 6 點／3 邊樣本）係**形態幾何**，唔係可執行嘅神經動態模型；而且各來源嘅共同 units／bodyID／registration 未確認，所以連疊加都唔得。用真實 connectome spiking 模擬去驅動 per-beat 決策，喺一部 8GB VRAM、同時跑 Resolume 同 MadMapper 嘅表演機上冇可行性證據。

決定：**第一版腦嘅職責係決策儀表＋映射載體（Brain Region Mapping）** — 腦區／節點人為對應 Resolume clip／Column／effect，決策引擎喺呢張映射表上面行，UI 用真實 mesh／SWC 幾何顯示「呢個決定發生喺邊」。真正 connectome 動態模擬保留做之後嘅獨立實驗，第一版唔做、唔阻塞交付。

## Considered Options

- **純視覺儀表**（腦只係靚，決策同腦完全無關）：拒絕，因為咁樣腦同決策脫鉤，用戶嘅產品賣點消失。
- **真做運算**（神經動態模型輸出決定）：拒絕作為第一版，因為冇一手可行性證據，而且會令「落地使用」（開一場真 set）無限期延後。

## Consequences

- 對外描述必須分開三件事：幾何真實（有 hash 驗證嘅公開資產）、映射人為（用戶可調嘅 taste）、決策非生物（唔係 firing）。禁止宣稱「真生物 firing」或把樣本點數當神經數量。
- 映射表係第一版最重要嘅可調介面，要有 UI 直接改，唔可以寫死喺 code。
- 之後如果 connectome 模擬證明可行，佢係**換掉決策引擎內部**，映射表同 UI 契約唔變 — 呢個係點解第一版要把決策引擎同映射表分層。
