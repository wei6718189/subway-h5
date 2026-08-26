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

## 五、后期后端（规划中）

- 同仓库加 **Pages Functions**：根目录 `functions/api/*.js` 自动映射为 `/api/*`，与前端同源、无跨域。
- 存储可用 **D1**（SQLite）或 **KV**（简单键值/广告位）。
- 绑定需在 CF Dashboard → Pages → Settings → Functions → D1/KV bindings 中配置。

## 六、说明

- 已移除旧的 Vercel（`vercel.json` / `.vercel/`）与腾讯云 COS（`deploy.sh` / `DEPLOY.md`）配置，不再使用。
- 自定义域名可选，在 Pages → Custom domains 中绑定并自动签发 SSL。
