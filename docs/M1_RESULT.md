# M1 RESULT（舊 M0–M3C 路線）— RECONSTRUCTED 2026-11-17

> ⚠️ **重建聲明**：本檔原文喺 2026-11-17 被 v2 Milestone 1（WebSocket bridge）嘅結果檔誤覆蓋（git repo 無 commit，無歷史可還原）。呢份係由仲存在嘅證據檔＋`README.md`／`docs/AGENT_SUMMARY_2026-11-16.md` 交叉引用重建嘅摘要版，**唔係原文逐字**。原文細節以 `data/flywire783-m1/` 同 `work/runs/m1-real-preqc-01/` 嘅證據為準。v2 路線嘅 M1 結果見 `docs/M1_RESULT_V2.md`。

## 舊 M1 目標（M0–M3C 路線）

真實 FlyWire 小樣本與來源一致性驗證：FAFB 783 公開匯出嘅 **6 個 marked points／3 條 measured neuropil edges** 做 curated point graph（**唔係全腦形態、唔係 3D renderer**）。

## 結果（據交叉引用）

- **92 tests PASS／0 skip**（run ID：`m1-real-preqc-01`，證據喺 `work/runs/m1-real-preqc-01/`）。
- 獨立 source review：`source_status=PASSED`、`overall_scope=CURATED_POINT_GRAPH_ONLY`、17 項 checks 全部 PASS（hash 鏈、gzip 完整性、crc32c、loader URL template、schema fingerprint 等），見 `data/flywire783-m1/source_review.json`。
- Dataset fingerprint：`ad9a6aa448921039529ca106d35bee265a53265786c5b3243ef2cb0f1a21e1ae`；source commit `3477b6cfccaf3bf976e6af0d40513ad221311a36`。
- 樣本內容：6 neurons（LAL_R×2、AL_L×2、AVLP_R×2，nm 座標，Codex FAFB 783 native frame 無 transform）＋3 connections（syn weight 7／15／32），見 `data/flywire783-m1/sample.json`。
- 授權：**CC BY-NC 4.0**（FlyWire public-release guidelines；私人自用 prototype OK，商業發布要換源）。
- 範圍限制（原文強調）：只係 point graph；`actual_model_identity=UNCONFIRMED`；樣本點數唔等於神經數量。

## 證據檔

- `data/flywire783-m1/sample.json`、`source_proof.json`、`source_review.json`
- `data/flywire783-m1/source/`（acquisition_receipt、source_commit、codex-*.py.txt、coordinates.csv.gz、connections.prefix-65536.bin）
- `work/runs/m1-real-preqc-01/`（test run 證據）
- 規格：`docs/M1_COMPLETION_SPEC.md`、`docs/M1_SPEC.md`

— 重建於 2026-11-17（Asia/Shanghai）。
