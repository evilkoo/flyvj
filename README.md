# 最新入口：FlyVJ v2 — M4.5 果蠅腦決策 Cockpit（2026-11-18）

**開發交接**：`docs/FLYVJ_HANDOFF.md`（唯一入口）；規格：`docs/SPEC_V2.md`（M1–M4.5 全 PASS）；下一 task：`docs/M5_TICKET.md`。

```powershell
cd C:\Users\evilkoo\Documents\烏蠅VJ\work\v2\m4\webapp
npm run dev            # Vite http://localhost:5200（改過 src/*.ts 要清 node_modules\.vite 先重起）
npm test               # 64 unit tests
node ..\qc-assets\acceptance-m4.mjs        # fake 路四契約（自管單一 evidence Chrome）
# Arena real 路：先起 Arena（已批准）
& "C:\Program Files\Resolume Arena\Arena.exe" "C:\Users\evilkoo\Documents\烏蠅VJ\work\v2\m1\dummy-grid.avc"
node ..\qc-assets\acceptance-m4-real.mjs   # 9 選 1 clip trigger 落地＋fallback 記錄
```

M4.5 內容：mic → 三頻（非對稱 AmbientGate）→ 結構事件（drop／section，16ms groove lock）→ **果蠅腦 Mushroom Body k-WTA＋多巴胺在線學習＋防連撞 Bag** → 九格 9 選 1 clip trigger（WS 直連 Arena）＋ Decision Cockpit（n-best／confidence／ticker／override）。零 sidecar、零雲端模型。QC 只用 Chrome evidence instance（獨立 profile），唔好另外開瀏覽器。以下舊入口全部屬終結路線，保留作歷史。

# 最新入口：M3B大腦示意＋Azure Kinect Mic

雙擊 C:\Users\evilkoo\Documents\烏蠅VJ\啟動大腦視覺.cmd。固定http://127.0.0.1:54654/，Mic預設OFF；檢查裝置→開始Kinect Mic→停止Mic。只有AzureKinect、不開RGB/depth、不錄音上傳或OSC。405自動checks／0skip、Mic實際收音與停止已驗，限定scope及未驗項目見docs/M3B_KINECT_RESULT.md。

示意腦形／分枝唔係真全腦；新iab FILE/TEST PCM播放pending及強音量光流仍未驗。以下舊入口保留歷史。

# 最新入口：M2 小樣本 3D 控制台

直接開 C:\Users\evilkoo\Documents\烏蠅VJ\work\runs\m2-final-03\console.html。重建用 PowerShell scripts/m2-build.ps1。144 tests PASS／0 skip、獨立code／screen-cap QC；完整證據同限制見docs/M2_RESULT.md。
只係真實6點／3edges＋mock activity＋Column dry-run，唔係全腦或已接Resolume。M0/M1舊入口保留。

---

# 烏蠅 VJ · M0 Auto Build

**已落地嘅係安全驗證骨架，唔係無人 VJ 已完成。** 只用 Python standard library，冇依賴安裝或外傳。

## 一個入口

喺 PowerShell 執行：

```powershell
& "C:\Users\evilkoo\Documents\烏蠅VJ\scripts\auto-build.ps1" -Mode Verify
```

入口會定位 project；唔需要先 cd。預設用已安裝嘅 `py -3.11`，冇就停止，唔會自動安裝。

如要明確指定現有 Python：

```powershell
& "C:\Users\evilkoo\Documents\烏蠅VJ\scripts\auto-build.ps1" -Mode Verify -PythonExe "C:\Users\evilkoo\AppData\Local\Programs\Python\Python311\python.exe"
```

每次自動產生新 run ID。終端會印報告路徑，直接打開該 HTML 即可；唔需要 server、登入或網絡。

## 實際做乜

語法檢查 → Unit tests → 4 個 mock 事件 → Column 1/2/3/1 候選 → in-memory OSC spy → JSON/HTML 報告。

- 冇讀 Mic、冇分析真音樂、冇載入真實大腦。
- 冇發 OSC／UDP、冇控制鍵鼠、冇啟動 Resolume。
- OSC address 只係草稿預覽，唔係正式播出接口保證。
- `PASSED` 只表示 M0 自動檢查；code/vision QC 要另睇證據。

## 失敗點處理

Exit 0：M0 自動檢查通過。Exit 1：step BLOCKED，有 state/HTML/log。Exit 2：入口／參數錯誤，例如 Python 未有、run ID 不合法／已存在；唔覆蓋舊 run。

打開失敗 step 嘅 stderr log，確認原因先修復，再執行入口產生新 run。唔會自動 retry、裝套件、reset git 或刪舊檔。

預設每步 30 秒 timeout。可用 `-StepTimeoutSeconds` 設定 1–300 秒。未完成／被強制終止嘅 RUNNING run 唔係 PASS。

## 開發界線

Scope 同 acceptance 喺 `docs/M0_SPEC.md`。生成證據喺 `work/runs`，已 gitignore。真音源、神經資產、依賴安裝及真 Resolume 控制要另行批准。
## M1：資料接口／ID一致性

```powershell
& "C:\Users\evilkoo\Documents\烏蠅VJ\scripts\auto-build.ps1" -Mode VerifyData
```

預期：syntax/unit/synthetic binding通過，interface_status=PASSED；真資料未提供則overall=BLOCKED、exit1、REAL_DATA_NOT_PROVIDED。**呢個係安全閘，唔係接口壞咗；唔好反覆重跑期待變PASS。**

只讀你明確指定嘅單一本機JSON小樣本，唔掃目錄／下載／pickle，亦唔用synthetic資料放行real gate。資料格式同界線喺docs/M1_SPEC.md。

`docs/synthetic_sample.json`係公開格式示例，唔係真實FlyWire資產。用DatasetPath指向呢個示例，real gate應回SYNTHETIC_IS_NOT_REAL。

Source/version/license自報唔等於確認。標示real嘅文件即使結構通過，今次仍會REAL_PROVENANCE_UNVERIFIED；冇自動信任flag。

資料model用完整字串ID，內容fingerprint用嚟核對版本／幾何／連線一致性，唔係來源證明。View order反轉時仍按ID取座標同activity；呢個只係packet test，唔係3D render或LIF已實作。

## M1 尾段：已核對真實point sample

已完成6個真實ID／3條measured neuropil edges嘅curated sample，92 tests PASS／0skip。只係point graph，唔係全腦形態／3D renderer。來源、code／文字及正常viewport QC證據見docs/M1_RESULT.md同work/runs/m1-real-preqc-01。

```powershell
& "C:\Users\evilkoo\Documents\烏蠅VJ\scripts\auto-build.ps1" -Mode VerifyData -DatasetPath "C:\Users\evilkoo\Documents\烏蠅VJ\data\flywire783-m1\sample.json"
```

只接受固定reference fingerprint＋離線raw source／review checksum。任意自報real或改過source仍拒絕；冇DatasetPath仍BLOCKED係預期。每個新run人工QC初始NOT_RUN，唔自動繼承舊截圖。唔讀咪／發真OSC／裝依賴／進入M2。
