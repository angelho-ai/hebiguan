# 照片與影片放這裡

1. 把實拍照片（jpg / png / webp）和影片（mp4 / webm）直接丟進這個 `media/` 資料夾。
   - 檔名建議用英文或數字，例如 `01-living.jpg`、`02-bedroom.jpg`、`tour.mp4`。
   - 照片建議先壓縮到 500KB 以下（可用 https://squoosh.app），網頁才會快。
2. 打開 `index.html`，在最上方 `CONFIG` 設定區的 `MEDIA` 清單加上檔名：

   ```js
   MEDIA: [
     "01-living.jpg",
     "02-bedroom.jpg",
     "tour.mp4",
   ],
   ```

   - 清單順序＝相簿顯示順序。
   - **清單裡第一張照片會自動成為頁首的背景大圖**，記得把最美的放第一張。
3. 存檔、push 到 GitHub，Vercel 會自動重新部署。
