# BabyLog v3 — Cloud Sync + Auth + PWA

React + Vite + Tailwind + Cloudflare Pages + Worker + D1

## 功能
- 餵奶 / 排泄記錄（母乳 vs 配方奶、左/右/兩邊、顏色質地）
- 即時雲端同步（多裝置、多用戶共用同一份資料）
- Admin 專屬建立帳號（無自註冊）
- JWT 登入（7 天有效）
- PWA 可安裝到 iPhone 主畫面
- 醫生報告一鍵生成 + 複製
- 深色主題 + Mobile-first

## 技術棧
- Frontend: React 19 + Vite + TS + Tailwind 4 + vite-plugin-pwa
- Backend: Cloudflare Worker + D1（SQLite）
- Auth: bcryptjs + jose (HS256 JWT)
- Hosting: Cloudflare Pages（前端）+ Worker（API）

## 本地開發

```bash
npm install
npm run dev          # http://localhost:5180
```

## Cloudflare 部署流程（完整）

### 1. 建立 D1 Database
1. 登入 Cloudflare Dashboard
2. Workers & Pages → D1 SQL Database → Create database
3. 名稱填 `babylog`
4. 建立後複製 **Database ID**

### 2. 建立 Worker Secrets
```bash
wrangler secret put JWT_SECRET
# 輸入一串長隨機字串（例如用 openssl rand -base64 32）

wrangler secret put ADMIN_KEY
# 輸入你自訂的管理員金鑰（建立帳號時要用）
```

### 3. 更新 wrangler.toml
把 `database_id` 填上你剛建立的 D1 ID。

### 4. 初始化 D1 表結構
```bash
wrangler d1 execute babylog --file=schema.sql
```

### 5. Deploy Worker（API）
```bash
npm run deploy:worker
```
記下 Worker 的 URL（例如 `https://babylog-api.xxx.workers.dev`）

### 6. 設定前端環境變數
複製 `.env.example` 為 `.env`：
```env
VITE_API_BASE=https://babylog-api.xxx.workers.dev
```

### 7. Deploy Frontend（Pages）
```bash
npm run build
npm run deploy:pages
```

或直接在 Cloudflare Dashboard 連接 Git repo 自動部署。

### 8. 建立第一個 Admin 帳號
用 Postman / curl / 瀏覽器：

```http
POST https://babylog-api.xxx.workers.dev/api/admin/create-user
Content-Type: application/json

{
  "username": "admin",
  "password": "yourpassword",
  "admin_key": "你剛設的 ADMIN_KEY"
}
```

之後其他用戶都由 admin 建立。

## 使用流程
1. 打開 Pages URL
2. 輸入帳號密碼登入
3. 所有用戶看到同一份寶寶記錄
4. 新增/刪除即時同步到雲端

## 注意事項
- 目前所有登入用戶共用同一份資料（適合家庭使用）
- 如需每用戶獨立資料，後續可再擴充
- PWA 安裝：Safari → 分享 → 「加入主畫面」

---

需要你提供的資訊（等上面步驟做到時再告訴我）：
- D1 Database ID
- Worker 實際 URL（deploy 後）
- 你想用的 admin username / password（我可以幫你產生建立指令）
- Pages project 名稱（如要用 Git 部署）

繼續寫前端登入整合？還是先停在這裡等你 Cloudflare 資源？