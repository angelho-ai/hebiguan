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

## 上線前 checklist（都在 `index.html` 最上方的 CONFIG 設定區）

- [ ] `SCRIPT_URL`：完成 `apps-script/SETUP.md` 後把 Apps Script 網址貼入（表單才會寫進 Google Sheet）
- [ ] `PRICE_WAN`：填開價（萬），頁面會自動顯示開價並計算投報率
- [ ] `MEDIA`：照片影片放進 `media/` 後把檔名加進清單（第一張＝頁首大圖）
- [ ] `DATES`：目前開放 2026/8/29（六）14:00–18:00，每 30 分鐘一場；之後加開日期直接在清單加一行

## 表單欄位

姓名、稱謂（先生/小姐）、聯絡電話、電子信箱、看屋日期、時段、個資同意。
送出後寫入 Google Sheet「預約」工作表，並寄通知信至指定信箱。
