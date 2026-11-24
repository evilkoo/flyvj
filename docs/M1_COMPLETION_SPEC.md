# M1 尾段：真實小樣本與離線來源核對

呢份係本task「直接build至M1尾段並QC」授權下嘅延伸規格；唔覆寫原M1接口-only歷史，亦唔進入M2/M3。

## 完成定義

真實來源用FlyWire／Codex FAFB 783。今次已取得6個真實ID嘅marked annotation points、3條neuropil-specific synapse-count rows。最終JSON 1,873 bytes，沿用嚴格v1 schema。
只係point graph sample：唔代表soma、完整形態、完整induced connectome、全腦3D renderer、即時firing、音樂理解或Resolume連線。

## 已定工程方法

- 原始CSV來源固定GCS object generations，Codex文件固定commit 3477b6cfccaf3bf976e6af0d40513ad221311a36。公開HTTPS、無登入；conn只讀首65,536 bytes compressed range，coordinates完整5,314,546 bytes，合共5,380,082 bytes。
- 保留raw bytes、HTTP range／generation、SHA256、完整coordinates檔供應方CRC32C核對及選定rows。partial connections唔冒充已驗完整archive。
- position採每ID第一個vendor marked coordinate，nm單位由固定Codex source conversion證明；frame係Codex FAFB783 native marked-coordinate frame，不作transform。region係所選edge涉及嘅neuropil，唔宣稱coordinate/soma所在region；weight係該neuropil row syn_count，唔係全neuropil總和。
- verifier只接受一份已curate／可重現嘅known reference fingerprint，並離線檢查baked source hashes及重做raw-row映射；任意自報real或改過JSON仍BLOCKED。冇force/allow-pass旗標，VerifyData唔會network。
- real-data artifact通過後由runner重新按dataset核對，唔採信artifact嘅PASS字樣。做real dataset engine/view反轉order ID binding；保留synthetic回歸／缺檔／篡改／假PASS／timeout安全測試。

## QC／交付

獨立source／code／文字QC；實跑完整unit、M0回歸、M1真sample正例及負例。以新M1 run report嘅實際screen cap做vision QC，唔宣稱之前受file://政策阻擋嘅來源報告已視覺驗收。
Source verification係本項目可重現嘅curation證據，唔係數碼簽署或通用生物來源認證。沿用私人自用；source/license記錄留檔，唔再重問用途。
唔安裝套件、唔執行上游downloaded source文件、唔登入、唔接音源、唔發真OSC、唔git commit/push。