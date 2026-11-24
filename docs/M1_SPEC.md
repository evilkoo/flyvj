# 烏蠅 VJ · M1 本機資料接口規格

## 今次授權範圍

只建立本機接口、ID一致性測試及報告；唔下載、登入、安裝、讀咪或接Resolume。真實資產未提供，real-data gate必須BLOCKED。

## 資料格式 v1

嚴格UTF-8 JSON，小樣本上限2 MiB。root只包含schema_version、provenance、coordinates、neurons、connections。

- provenance：kind=synthetic/real、name、version、source、license，全部明確；source係文字標記，唔會自動開網址。
- coordinates：units及frame；只記錄及核對，唔推測／轉換單位。
- neurons：id必須係字串，避免大整數ID精度損失；position係3個有限數字，region係明確標籤。
- connections：pre_id、post_id及有限weight；endpoint必須存在，唔生成隱藏神經、唔重複同一對weighted edge。
- duplicate IDs／JSON keys、NaN、bool當數字、錯schema／unknown fields皆拒絕。冇pickle、NPZ自動載入或目錄掃描。

## 同一份資料

不可變dataset以內容fingerprint辨認來源／版本／座標／幾何／連線。fingerprint對nodes/edges陣列排列無關；engine保留自身index order，frame帶明確neuron IDs。view用ID查同一份幾何，唔靠兩個array同位置當同一條神經。

Mock整合用3個明確synthetic neuron，故意反轉view order。驗證每個ID嘅position、activity、engine index/view index同dataset token。

## 真資料關卡

冇DatasetPath：REAL_DATA_NOT_PROVIDED。提供synthetic：SYNTHETIC_IS_NOT_REAL。標示real但只係自報metadata：REAL_PROVENANCE_UNVERIFIED；唔當成生物真實性或license已確認。今次冇自動信任／放行flag。

## 驗收

PowerShell新增VerifyData，M0 Verify保留。syntax/unit/binding三步通過後，interface_status=PASSED，但真資料gate仍BLOCKED、exit1（预期安全閘，唔係接口壞咗）。任何前置錯誤立即停。每個run獨立，唔覆蓋舊證據。

HTML清楚分開接口結果／真資料關卡，顯示ID對照；唔聲稱已做3D渲染、LIF、音樂分析或GPU測試。Code/vision QC另行附實際證據。
## 最終路徑／decoder修正

先拒絕raw URI／ADS／UNC，才做lexical normalization，再檢查normalized；root-first必要metadata檢查拒network/reparse路徑。深JSON及lone surrogate轉為DataValidationError／INVALID_DATASET，不fallback或未受控crash。只係本機小樣本接口，唔係general security sandbox。
