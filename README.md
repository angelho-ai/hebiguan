# 何必館｜一頁式物件資訊網站

台北市內湖區內湖路二段 428 號・16.25 坪精品套房。
純靜態網站（單一 `index.html`），不需任何 build，push 上 GitHub 後由 Vercel 直接部署。

## 資料夾結構

```
hebiguan/
├─ index.html        ← 網站本體（所有文案、設定都在這個檔）
├─ media/            ← 照片影片丟這裡（見 media/README.md）
└─ apps-script/      ← Google Sheet 表單後端（見 apps-script/SETUP.md）
```

## 本機預覽與檢查

- `npm start`：在 `http://localhost:3000/` 預覽，無需 build。
- `npm test`：執行 Node.js 內建測試，檢查資訊計算、圖片路徑及預約表單／後端相容性。測試使用模擬資料，不會寫入正式 Google Sheet 或寄信。
- 新增照片或更新 `CONFIG.MEDIA` 後，可在安裝開發套件（`npm install`）後執行 `npm run images`，產生 `media/optimized/` 的 WebP 衍生圖與清單；原始照片保留，相簿放大仍使用原圖。衍生圖需一併提交。網站執行和 Vercel 部署不需執行圖片處理或 build。

## 部署到 Vercel（約 5 分鐘）

1. 在 GitHub 建新 repo（例如 `hebiguan`），把這個資料夾的內容 push 上去：

   ```bash
   cd hebiguan
   git init && git add -A && git commit -m "何必館一頁式廣告 v1"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/hebiguan.git
   git push -u origin main
   ```

2. 到 <https://vercel.com> 用 GitHub 登入 → **Add New → Project** → 選這個 repo。
3. Framework Preset 選 **Other**，其他都不用改，按 **Deploy**。
4. 完成後會拿到 `https://hebiguan.vercel.app` 之類的網址；之後每次 push，Vercel 自動更新。

## 上線前 checklist（在 `index.html` 搜尋 `const CONFIG`）

- [ ] `SCRIPT_URL`：完成 `apps-script/SETUP.md` 後把 Apps Script 網址貼入（表單才會寫進 Google Sheet）
- [ ] `PRICE_WAN`：本戶開價（萬）；`MARKET_RENT`：目前月租行情參考 36,000 元。年租金與毛投報率依行情試算，不代表已成交租金或保證收益；異動時也要同步靜態文案、比較表單價與頁首分享資訊
- [ ] `MEDIA`：照片影片放進 `media/` 後把檔名加進清單（第一張＝頁首大圖）
- [ ] `DATES`：2026/9/6、9/12 14:00–17:00，及 9/11 12:00–13:00；每場一小時、一組。日期的 `iso` 與 `label`、起迄時間需同步 Apps Script 的 `BOOKING_DATES`；容量需與後端 `SLOT_CAPACITY` 一致。頁面場次說明自動生成，已開始場次自動排除

## 表單欄位

姓名（必填）、稱謂（先生／小姐，選填、不預選）、聯絡電話（必填）、LINE ID（選填）、看屋日期、時段、個資同意（必須勾選）。選擇「其他時間」才顯示選填的「希望看屋時間」。不再收集買方電子信箱。
送出後寫入 Google Sheet「預約」工作表，並嘗試寄通知信至指定信箱。畫面顯示收件確認與所選場次，仍須後續人工聯繫確認看屋。
試算表既有的「稱謂」與「Email」欄位及歷史資料保留；選填的稱謂會寫入原稱謂欄，並帶入屋主通知信，新預約的 Email 欄仍留空，本名儲存在「姓名」欄。姓名欄為使用者自行填寫，並非身分驗證。恢復稱謂使用既有 v3 後端已支援的欄位，不需另行更新 Apps Script。不要刪除或移動原欄位；不使用的 Email 欄可在試算表中隱藏。

本次相容性版本為 **v3**，需要完整替換並部署 `apps-script/Code.gs`（詳見 `apps-script/SETUP.md`），不是只修改版本數字。有效預約首次寫入時會在既有欄位後補齊「LINE ID、個資同意、希望看屋時間、通知狀態、預約識別碼」，不移動舊日期／時段欄位，也不覆寫既有資料或自訂欄位。
新版前端送出前會確認後端版本；若 Apps Script 尚未更新，只顯示「預約表單更新中」，不會送出。前後端檢查電話格式與開放場次，後端以台北時間拒絕已開始的場次。通知信失敗不影響已存入的預約，會嘗試記錄失敗狀態，沒有自動重寄；請定期查看試算表。相同頁面的未知結果重試使用相同識別碼，不重複占位。重整／關閉分頁會失去該識別碼。

## 資訊層級

室內空間維持在區位機能之前。成交案例參考直接顯示；本戶樓層、權狀面積、用途、交屋時間及管理費直接顯示，其餘完整本戶與建築資訊收在可展開區塊。
手機成交比較改為直向卡片，桌機維持比較表；手機導覽可跳到各章節。相簿提供放大／縮小、適合畫面與原圖連結，支援圖片拖曳與雙指縮放，原圖不受縮圖壓縮影響。
