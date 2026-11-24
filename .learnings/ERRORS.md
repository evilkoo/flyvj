# ERRORS


## 2026-10-02｜M3 錄片 QC：PowerShell 5 Unicode pipeline

初次抽幀命令將含中文路徑寫喺 Python here-string 再 pipe，中文變成問號；mkdir 喺任何輸出建立前失敗，WinError 123。冇盲目重試。修正：影片路徑由 PowerShell environment variable 傳入，workspace 用 Python cwd；Python 原始碼保持 ASCII。之後同一抽幀成功；精簡錯誤與方法已記錄喺 work/m3/file-video-qc-20261002-175921/extraction.json。日後唔再將非 ASCII path literal 經 PS5 text pipe。
