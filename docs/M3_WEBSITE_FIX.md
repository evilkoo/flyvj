# M3 網站開唔到：本機服務修復（2026-10-02）

已觀察舊PID不存在、health連線失敗、receipt約93分鐘前建立，stderr空。舊設定idle1800秒，正常idleexpiry係最可能原因，但冇exit-reason log，唔冒認已證明唯一原因。

修正：固定127.0.0.1:54654、idle7200秒（2小時）；根目錄啟動M3.cmd雙擊開服務+browser。只重用精確executable/GUIDreceipt/run/bundlehash/同idle設定嘅ownedruntime；不符idle明確拒絕，唔殺unknownportowner。

Actualhealth200、same-ownedduplicate啟動正確重用；wrongIdle10拒絕後health仍200。Repair02自動225/0skip、PSAST；既有UI/audio未改，私人歌曲/fileChooserQC仍pending。

現時畫面自動檢查被Browser URLpolicy拒絕，已停、唔試另一surface/rawCDP/繞過、亦唔標visionPASS。只聲稱backendreachable；人類F5原頁確認可見。保持M3INCOMPLETE。

最新session／PID／URL見work/m3/CONTINUE.json，冇broaderChromepermission變更。閒置2小時仍會自動退出，唔係永久對外網站；再雙擊啟動M3.cmd即可。
