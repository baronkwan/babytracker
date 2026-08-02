# BabyTracker — 嬰兒記錄 App / Baby Tracking App

A family baby tracker with real-time cloud sync — feeds, excretes, and weight in one place.
家庭共用嘅嬰兒記錄 App：餵奶、排泄、體重，一頁搞掂，多裝置即時同步。

**Stack:** React 19 + Vite + TypeScript + Tailwind 4 · Cloudflare Pages + Worker + D1 · JWT auth · PWA · Bun

---

## Features / 功能

- **Combined record form** — feed + excrete in one page, saved together (same timestamp) / **合併記錄表單** — 餵奶同排泄一頁搞掂，一次過儲存
- **Split milk volumes** — breast + formula entered separately, default 0 each / **母乳 + 配方奶分開計**，唔填就係 0
- **Excrete options** — pee-only / poo-only / both, with size (少/多) / **淨尿 / 淨便 / 尿+便**，可選尿量便量
- **Weight tracking** — log weight, see trend chart / **體重記錄** + 趨勢圖
- **Backdating** — record can be back-dated with native date/time picker / 記錄可以**補番日期時間**
- **Real-time cloud sync** — multi-device, multi-user share the same data / 多裝置、多用戶**即時雲端同步**
- **JWT auth** — login (7-day token), admin creates accounts (no self-signup) / JWT 登入，admin 先可以建立帳號
- **Doctor report** — one-tap summary, copy to clipboard / **醫生報告**一鍵生成 + 複製
- **Charts** — 7d / 1m / 3m, responsive (no horizontal scroll) / 圖表三個時段，響應式設計
- **PWA** — installable to home screen / 可安裝到主畫面
- **Dark mode** + mobile-first / 深色主題 + 手機優先

## Tech Stack / 技術棧

| Layer | Tech |
|-------|------|
| Frontend | React 19 + Vite + TypeScript + Tailwind 4 (vite-plugin-pwa) |
| Backend | Cloudflare Worker + D1 (SQLite) |
| Auth | bcryptjs + jose (HS256 JWT) |
| Hosting | Cloudflare Pages (frontend) + Worker (API) |
| Package manager | Bun (npm works too) |

## Project Structure / 目錄結構

```
├── src/               # Frontend (React)
│   ├── lib/           # types, storage (localStorage), utils, api client
│   └── App.tsx        # Main app (tabs, forms, charts, modals)
├── worker/            # Cloudflare Worker API (auth + D1 CRUD)
├── schema.sql         # D1 schema (fresh installs)
├── public/_headers    # Cache policy (HTML no-cache, assets immutable)
├── wrangler.toml      # Worker + D1 binding config
└── .env.example       # Frontend env template
```

## Database / 資料庫

Tables: `users`, `baby` (singleton), `feeds`, `excretes`, `weights`.

- Logs reference `users(id)` via `user_id` (FK, added by auto-migration)
- **Self-healing schema**: the worker checks table columns on each request and migrates automatically (rebuilds in an atomic D1 batch) — no manual migration steps
- `schema.sql` is only needed for a fresh database

## Local Development / 本地開發

```bash
bun install

# 1. API (Cloudflare Worker, local D1)
bunx wrangler dev -c wrangler.toml --local --var JWT_SECRET:devsecret --var ADMIN_KEY:devkey
# → http://localhost:8787

# 2. Frontend (point to local API)
VITE_API_BASE=http://localhost:8787 bun run dev
# → http://localhost:5173
```

## Live URLs / 現有部署

| What | URL |
|------|-----|
| App (Cloudflare Pages) | https://babylog-1pe.pages.dev (old project url) |
| API (Worker) | https://babytracker-api.<CLOUDFLARE_ACCOUNTNAME>.workers.dev |
| GitHub | https://github.com/baronkwan/babytracker |

> ℹ️ The Pages project is named `babytracker` (renamed from `babylog`), but its
> pages.dev subdomain (`babylog-1pe`) is immutable — it stays as-is. `deploy:pages`
> pins `--project-name babytracker`.

## Deployment / 部署

### 1. D1 database
Create a D1 database in the Cloudflare dashboard, then put its ID in `wrangler.toml` → `database_id`.

### 2. Worker secrets
```bash
bunx wrangler secret put JWT_SECRET   # e.g. openssl rand -base64 32
bunx wrangler secret put ADMIN_KEY    # your admin key (needed to create accounts)
```

### 3. Init schema (fresh database only)
```bash
bunx wrangler d1 execute babylog --remote --file=schema.sql
```

### 4. Deploy Worker (API)
```bash
bun run deploy:worker
```

### 5. Deploy Frontend (Pages)
```bash
cp .env.example .env   # VITE_API_BASE=https://babytracker-api.<CLOUDFLARE_ACCOUNTNAME>.workers.dev
bun run build
bun run deploy:pages   # deploys to the production branch ('production')
```

> ⚠️ **Production branch quirk**: this Pages project's production branch is `production`, not the git default. `deploy:pages` already passes `--branch production` — don't remove it.

### 6. Create the first admin account
```http
POST https://babytracker-api.<CLOUDFLARE_ACCOUNTNAME>.workers.dev/api/admin/create-user
Content-Type: application/json

{
  "username": "admin",
  "password": "yourpassword",
  "admin_key": "<your ADMIN_KEY>"
}
```
Other users are created by the admin from the login screen.

## Usage / 使用流程

1. Open the Pages URL / 打開 Pages URL
2. Log in with username + password / 輸入帳號密碼登入
3. Everyone sees the same shared baby records (family model) / 所有用戶睇到同一份記錄（家庭共用）
4. Add/delete syncs to the cloud instantly / 新增刪除即時同步

## Notes / 注意事項

- All users share one dataset — suitable for family use / 目前所有用戶共用同一份資料，適合家庭使用
- PWA install: Safari → Share → "Add to Home Screen" / PWA 安裝：Safari → 分享 → 加入主畫面
- Cache: `index.html` is served `no-cache` so new releases appear immediately; hashed assets are immutable / `index.html` 唔會 cache，出新版即刻見；assets 用 hash 長 cache

---

Built for Ayla 🎀
