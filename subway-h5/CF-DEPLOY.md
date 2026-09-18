# 部署指引：Cloudflare Pages

> 当前主托管平台。仓库已绑定 GitHub，推送生产分支后 Cloudflare Pages 自动构建并部署。
> 适用场景：纯前端 PWA（深圳/广州/香港/南宁 地铁图），iOS「添加到主屏幕」离线可用。

## 一、首次接入（一次性）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages → Create → Pages → 连接 Git 仓库**。
2. 选择 `subway-h5` 仓库，构建配置：
   - **Framework preset**：`Vite`（或选 `无` 并手动填）
   - **Build command**：`npm run build`
   - **Build output directory**：`dist`
3. **构建环境**（可选但建议）：在 Settings → Build & deployments → Environment variables 添加
   - `NODE_VERSION` = `22`（避免 CF 默认 Node 过旧导致 Vite 5 构建失败）
4. 保存，触发首次部署。默认域名形如 `subway-h5.pages.dev`。

## 二、缓存与响应头（已配好）

- `public/_headers` 会被 Vite 自动复制到 `dist/_headers`，由 Cloudflare Pages 直接生效：
  - `/*`、`/index.html`：5 分钟短缓存（保证更新及时）
  - `/assets/*`：1 年 + `immutable`（文件名带 hash，可长期缓存）
  - `/data-amap/*`、`/data-baidu/*`、`/data-baidu-schematic/*`：1 小时（地铁 JSON 数据）
  - `/icons/*`：7 天
- 安全头：`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy` 已加在 `/*`。

## 三、SPA 回退（按需）

本项目为 PWA，若使用 history 模式路由（非 hash），需在 `public/_redirects` 增加一行让未匹配路径回退到 `index.html`：

```
/* /index.html 200
```

（文件放在 `public/` 会被一同复制到 `dist/`。若当前用 hash 路由则无需此文件。）

## 四、日常更新

```bash
# 本地预览
npm run build && npm run preview      # 默认 http://localhost:4173

# 发布：提交到 dev → 合并回 main → 推送 main，CF 自动重新部署
git checkout dev
# ... 改动 ...
git commit -m "..."
git checkout main
git merge --no-ff dev
git push origin main
git checkout dev
```

> 推送 `main` 即触发生产部署；其它分支/PR 会自动生成预览部署（preview）。

## 五、后端（已实现）：Pages Functions + D1

留言后台已落地，与前端同仓库、同源部署：

- **Functions 目录**：`functions/api/*` 自动映射为线上 `/api/*`。
  - `functions/api/messages.js` —— `GET /api/messages`（列表）/ `POST /api/messages`（提交，自动建表）
  - `functions/api/messages/[id].js` —— `DELETE /api/messages/:id`（`client_id` 删自己 或 `admin_password` 删任意）
  - `functions/api/admin/verify.js` —— `POST /api/admin/verify`（密码校验）
  - `functions/api/admin/messages/[id]/status.js` —— `POST /api/admin/messages/:id/status`（审批/拒绝）
- **存储**：`subway-h5-db`（D1 / SQLite），绑定名 `DB`（见 `wrangler.toml`）。
- **前端入口**：地铁 App「更多」面板 →「留言」；或独立页 `public/guestbook.html`（微博风格，含「返回地铁」）。

### ⚠️ 线上环境变量（必看）
Cloudflare Pages 的 **Git 部署不会读取 `wrangler.toml` 的 `[vars]`**。线上 `env.ADMIN_PASSWORD` 默认空，会导致 `/api/admin/*` 永远 401。
**必须**在 Cloudflare 后台配置：
> Pages → subway-h5 → Settings → Environment variables → 新增 `ADMIN_PASSWORD`（值如 `123456`，勾选 Production）→ 保存并触发一次重新部署。

（本地 `wrangler pages dev` 会读取 `wrangler.toml` 的 `[vars]`，故本地无需此步骤。）

## 六、本地全栈开发

`npm run dev`（Vite）**只启动前端**，不会带起 Functions/D1。后端需 `wrangler` 单独跑。已封装两条脚本：

```bash
# 方式 A：单命令全栈测试（先 build 再用 wrangler 跑，端口 8788）
npm run pages:dev
# 打开 http://localhost:8788/guestbook.html

# 方式 B：前端热更新 + 后端（开两个终端）
npm run dev                       # 终端1：Vite 热更新，端口 4173
npm run pages:dev:hmr             # 终端2：wrangler 代理到 4173，端口 8788
# 打开 http://localhost:8788
```

> **手机/局域网访问**：脚本已带 `--ip 0.0.0.0`，wrangler 会监听所有网卡。手机与电脑同一 Wi-Fi 时，用电脑局域网 IP 访问，例如 `http://192.168.1.16:8788/guestbook.html`（IP 以你本机 `npm run dev` 输出的为准）。仅 `npm run dev`（Vite）默认就绑 0.0.0.0，但那只有前端、无后端，测留言必须走 8788。

注意：
- `wrangler pages dev` 需要本机已 `wrangler login`（首次创建 D1 时已登录）。
- 本地 D1 为独立 SQLite（`.wrangler/state/`），与线上库**隔离**；本地测试数据不进线上。`ensureSchema` 会在首次调用时自动建表。
- 若启动报 “Database subway-h5-db does not exist locally”，先跑一次 `npx wrangler d1 create subway-h5-db --local`。
- 本地管理员密码走 `wrangler.toml` 的 `[vars]`，直接可用 `123456` 解锁。

## 七、说明

- 已移除旧的 Vercel（`vercel.json` / `.vercel/`）与腾讯云 COS（`deploy.sh` / `DEPLOY.md`）配置，不再使用。
- 自定义域名可选，在 Pages → Custom domains 中绑定并自动签发 SSL。
