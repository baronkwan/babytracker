# 寶寶奶排記錄 • BabyLog

新生兒餵奶與排泄追蹤 Web App，專為父母與醫生設計。清晰記錄、數據洞察、醫生報告，一鍵生成。

## 功能亮點

- **即時記錄**：餵奶（母乳/配方奶、份量、時長、邊別）＋ 排泄（濕尿布/大便、顏色、質地）
- **智能儀表板**：今日餵奶次數/總量、排泄次數（濕/便分開）、最近活動卡片
- **完整歷史**：搜尋、篩選（全部/餵奶/排泄）、時間排序
- **數據洞察**：最近7天餵奶量趨勢線圖 + 排泄頻率柱狀圖（Chart.js）
- **醫生報告**：一鍵生成專業摘要（基本資料、統計、最近趨勢），支援複製 / 列印
- **設定**：寶寶姓名、出生日期、性別、出生體重、單位（ml/oz）、清除資料
- **極致手機體驗**：底部導航 + FAB 快速記錄、深色模式、觸控友好、大按鈕

## 技術

- 單檔 HTML5 + Tailwind CSS (CDN) + Chart.js (CDN) + Font Awesome
- 完全離線運作，localStorage 持久化
- 無後端，資料只存在你的裝置
- 響應式設計，完美支援 iPhone（含 Safe Area）

## 使用方法

1. 直接用瀏覽器打開 `index.html`
2. 首次使用會自動帶範例資料（可清除）
3. 點擊底部導航切換頁面，或按 + 快速記錄
4. 設定頁面可自訂寶寶資訊
5. 點擊「醫生報告」生成可分享給醫生的摘要

## 部署到 Cloudflare Pages（推薦）

1. 登入 Cloudflare Dashboard → Pages → Create a project
2. 選擇 "Upload assets" 或連接 Git
3. 上傳整個 `baby-tracker` 資料夾（或只上傳 `index.html`）
4. 部署完成即獲得公開網址，可分享給家人/醫生

或用 Wrangler CLI：
```bash
npm install -g wrangler
wrangler pages deploy . --project-name=babylog
```

## 隱私與安全

- 所有資料只存在本地瀏覽器
- 不上傳任何雲端
- 可隨時「清除所有資料」重置

## 未來擴展建議（非必要）

- PWA 支援（加 manifest + service worker）
- 匯出 CSV / PDF
- 多寶寶切換
- 提醒通知（餵奶時間）
- 照片上傳（大便顏色參考）

---

**給父母與醫生**：清楚的數據能幫助及早發現問題（餵奶不足、排泄異常等）。記錄越完整，診治越準確。

Made with care for the little one. 👶

---

**檔案位置**：`~/projects/baby-tracker/index.html`  
**版本**：2026-07-24（首次發布）