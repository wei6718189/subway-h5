# iOS 地铁线路图 H5（PWA）方案规划

## 一、需求摘要

构建一个**纯前端 H5 地铁线路图应用**，覆盖**深圳、广州、香港、南宁**四城，支持：

1. 查看各城市地铁线路图（线路 + 站点）
2. 站点间**路径规划**（换乘方案）
3. 部署到**腾讯云 COS 对象存储**，无需备案、无需自有域名
4. 在 iOS 上通过\*\*「添加到主屏幕」\*\*作为 PWA 使用，**点开即看**，绕开百度地图的开屏广告与多次跳转

***

## 二、现状分析

### 2.1 工作区现状

* 目标目录 `/Users/weihua/Documents/workSpace` 下仅有 `qishuiAScriptProject`（iOS 自动化脚本，与本需求无关）。

* 本项目为**全新 greenfield 项目**，无历史代码约束。

### 2.2 关键技术调研结论（已联网核实）

#### A. 直接调用百度地图 API 的可行性 → ❌ 不推荐在运行时直连

* **百度 Web 服务 REST API**（`api.map.baidu.com/...`）服务端**未开启 CORS**，前端 `fetch/axios` 直连会被浏览器同源策略拦截，报 CORS 错误。

* **百度地图 JS API** 通过 `<script>` 标签 + JSONP 绕过 CORS，**但 AK 必须绑定 Referer 白名单域名**，且要求已备案 + HTTPS。`file://`、`localhost`、未备案的对象存储默认域名会被拒绝（403 / INVALID\_KEY）。

* 结论：用户「不备案、不用域名」的约束下，**运行时无法稳定直连百度地图 API**。即使能调，也依赖外网 + AK 有效，破坏离线可用性。

#### B. 地铁数据来源 → ✅ 本地化完全可行

* **官方公开文本数据**：深圳市交通运输局（`jtys.sz.gov.cn`）已发布各线路完整站点序列（已抓取样例）。广州、南宁交通局同样有公开线路信息。港铁官网有线路站点表。

* **坐标数据**：存在公开 GeoJSON / OSM 站点坐标数据集；也可在**数据准备阶段**（一次性、本地脚本）用地理编码 API 批量获取站点经纬度，**不受运行时 CORS 限制**。

* **数据量**：4 城合计约 800–1000 站点，JSON 体量约 **几百 KB \~ 1MB**，完全可本地化、随静态资源一起部署。

#### C. 对象存储部署 → ✅ 可行（选对地域即可免备案）

* 腾讯云 COS **2024-01-01 后新建桶**：大陆地域默认域名禁止直接预览，必须绑定**已备案自定义域名**。

* **香港地域 COS 桶**：**无需备案**，可通过默认 HTTPS 域名（`<bucket>.cos.ap-hongkong.myqcloud.com`）直接访问，支持静态网站托管。完全契合「不备案、不用域名」诉求。

* 备选：阿里云 OSS 香港节点同理。本方案以腾讯云 COS 香港为主。

#### D. iOS PWA「添加到主屏幕」→ ✅ 可行

* iOS Safari 支持 `manifest` + `apple-touch-icon` + `meta apple-mobile-web-app-capable`，添加到主屏后**独立全屏启动**，无 Safari 地址栏，无广告跳转。

* 配合 Service Worker（Workbox）可**离线访问**，断网也能查线路图 + 规划路径（因数据全本地）。

***

## 三、技术架构决策（含权衡）

### 决策 1：数据策略 —— 纯本地 JSON，运行时不调用任何第三方 API ✅

* 运行时零网络依赖（除首次加载静态资源），彻底规避 CORS / 备案 / AK 问题。

* 数据在**构建期/数据准备期**一次性生成（本地脚本 + 一次性地理编码），产物为静态 JSON。

### 决策 2：渲染方式 —— 地理投影 SVG（无地图底图）✅

* 站点按**真实经纬度线性投影**到 SVG 坐标，线路用 `<polyline>` 连接，**不加载任何地图瓦片**。

* 效果：类似百度地图「地铁图层」剥离底图的清爽版——线路走向贴近真实地理，但无瓦片噪声、加载极快、可离线。

* 为何不用 Beck 式抽象示意图：4 城 800+ 站点手工排布坐标成本极高，不可维护；地理投影可由坐标数据**自动生成**。

* 为何不加底图（Leaflet+OSM）：瓦片需在线、有 CORS/配额问题、拖慢首屏、违背离线目标。底图可作为 Phase 2 可选在线增强（默认关闭）。

> ⚠️ **关键决策点**：如果你更想要「官方海报式抽象线路图」的观感（非地理精确），请在此处反馈，方案需调整为手工/算法布局，工作量显著上升。默认按地理投影推进。

### 决策 3：路径规划 —— 纯前端 Dijkstra 图算法 ✅

* 本地构建站点图：同一线路相邻站点为边（权重≈站间耗时 2–3min），同站换乘为边（权重≈换乘步行 3–5min）。

* Dijkstra 求最少耗时路径；可扩展 K-shortest paths 给出 2–3 套备选方案。

* 纯 JS 实现，毫秒级，离线可用。无需百度路线规划 API。

### 决策 4：技术栈 —— Vue 3 + Vite + SVG + vite-plugin-pwa ✅

| 关注点 | 选型                         | 理由                                     |
| --- | -------------------------- | -------------------------------------- |
| 框架  | Vue 3（`<script setup>`，单页） | 站点搜索、路径结果、城市切换等状态化 UI，响应式更顺手；构建产物小     |
| 构建  | Vite                       | 极速 HMR，产物纯静态文件，适配对象存储                  |
| 渲染  | 原生 SVG                     | 矢量清晰、可点击交互、CSS 可控、无第三方依赖               |
| PWA | `vite-plugin-pwa`（Workbox） | 自动生成 manifest + Service Worker，支持预缓存离线 |
| 路由  | 无 / hash 路由                | 单页足够，避免 history 模式在对象存储需配置回退           |
| 算法  | 自实现 Dijkstra               | 轻量，无依赖                                 |

### 决策 5：部署 —— 腾讯云 COS 香港地域 + 静态网站托管 ✅

* 新建香港地域 COS 桶，开启静态网站，索引文档 `index.html`。

* 通过默认域名 `https://<bucket>.cos-website.ap-hongkong.myqcloud.com` 访问，**无需备案、无需自有域名**。

* 上传 `dist/` 全部静态产物即可。

* 注意：PWA Service Worker 要求 HTTPS（COS 默认域名已是 HTTPS，满足）。

***

## 四、数据模型设计

每个城市一个 JSON：`data/<city>.json`

```json
{
  "city": "shenzhen",
  "cityName": "深圳",
  "bounds": { "minLng": 113.75, "maxLng": 114.65, "minLat": 22.40, "maxLat": 22.90 },
  "lines": [
    {
      "id": "1",
      "name": "1号线",
      "color": "#00B189",
      "stationIds": ["sz_1_luohu", "sz_1_guomao", "..."]
    }
  ],
  "stations": {
    "sz_1_luohu": {
      "name": "罗湖",
      "lng": 114.2300, "lat": 22.5300,
      "lines": ["1"]
    }
  },
  "transfers": [
    { "from": "sz_1_laojie", "to": "sz_3_laojie", "walkSec": 180 }
  ]
}
```

**图构建（运行时）**：

* 节点 = `<stationId, lineId>` 二元组（同站不同线为不同节点，便于换乘计权）。

* 边：① 同线相邻站点（权重=站间时间，缺省 150s）；② 同站跨线 transfer（权重=`walkSec`，缺省 240s）。

* Dijkstra 在该图上求最短时间路径，再映射回物理站点序列用于高亮绘制。

**坐标投影**：`lng/lat → SVG(x,y)`，采用 bounds 内线性映射 + 适当纵横比修正（纬度方向乘 `1/cos(lat)` 矫正），保证线路走向不变形。

***

## 五、项目结构（拟建）

```
subway-h5/
├── index.html
├── vite.config.ts                # 含 vite-plugin-pwa 配置
├── package.json
├── public/
│   ├── icons/                    # PWA 图标（192/512 + apple-touch-icon）
│   └── manifest.webmanifest      # 由插件生成或手写
├── data/
│   ├── shenzhen.json
│   ├── guangzhou.json
│   ├── hongkong.json
│   └── nanning.json
├── src/
│   ├── main.ts
│   ├── App.vue                   # 单页主界面
│   ├── components/
│   │   ├── SubwayMap.vue         # SVG 线路图渲染 + 缩放/平移
│   │   ├── StationSearch.vue     # 起终点搜索选择
│   │   ├── RouteResult.vue       # 路径方案展示
│   │   └── CitySwitcher.vue      # 城市切换
│   ├── lib/
│   │   ├── projection.ts         # lng/lat → SVG 坐标投影
│   │   ├── graph.ts              # 图构建 + Dijkstra
│   │   └── loadData.ts           # 按需加载城市 JSON
│   └── styles/
└── scripts/
    └── prepare-data/             # 一次性数据准备脚本（离线运行）
        ├── fetch_station_lists.ts   # 抓取/整理官方站点序列
        ├── geocode.ts               # 批量地理编码（Baidu/OSM，本地运行）
        └── build_json.ts            # 生成 data/<city>.json
```

***

## 六、实施步骤

### Phase 0：数据准备（一次性，本地脚本）

1. 整理 4 城线路—站点序列（深圳用 `jtys.sz.gov.cn` 已有数据；广州/南宁/香港从交通局/港铁官网整理）。
2. 本地脚本批量地理编码站点经纬度（可用百度地理编码 API + 个人 AK，在本地 Node 脚本中调用，**不受浏览器 CORS 限制**；或用 OSM Nominatim）。
3. 标注换乘关系（同名站跨线映射 + 换乘步行时间）。
4. 生成 `data/<city>.json`。
5. **先做深圳**作为打通全链路的样本，其余 3 城复用流程。

### Phase 1：项目骨架 + 深圳线路图渲染

1. 初始化 Vite + Vue 3 工程，集成 `vite-plugin-pwa`。
2. 实现 `projection.ts`、`SubwayMap.vue`：加载深圳 JSON，按经纬度投影绘制线路 `<polyline>` + 站点 `<circle>` + 站名 `<text>`。
3. 实现基础交互：双指/滚轮缩放、拖拽平移、点击站点高亮。

### Phase 2：路径规划

1. 实现 `graph.ts`：从 JSON 构建图 + Dijkstra（含换乘权重）。
2. `StationSearch.vue`：起终点选择（站名搜索 + 自动补全）。
3. `RouteResult.vue`：展示方案（经过线路、换乘点、预估耗时、站数），并在地图上高亮路径段 + 标注换乘站。

### Phase 3：多城市 + PWA + 部署

1. `CitySwitcher.vue` + 按需加载城市 JSON。
2. 补全广州/香港/南宁数据并接入。
3. PWA 配置：manifest、图标、Service Worker 预缓存策略（缓存 `index.html` + 所有 `data/*.json` + JS/CSS），支持离线。
4. iOS 适配：`apple-mobile-web-app-capable`、`apple-touch-icon`、状态栏样式、禁止双指缩放冲突。
5. `npm run build` → 上传 `dist/` 至腾讯云 COS 香港桶 → 开启静态网站 → 在 iPhone Safari 打开默认域名 → 「添加到主屏幕」验证。

### Phase 4（可选增强）

* 收藏常用起终点、历史记录（localStorage）。

* 首末班车时间字段与按时刻过滤（若数据具备）。

* 在线底图图层开关（Leaflet + OSM，默认关）。

* 线路图离线包版本号 + 静默更新提示。

***

## 七、验证清单

* [ ] `dist/` 本地 `vite preview` 可正常渲染深圳线路图，缩放/平移流畅。

* [ ] 随机选 3 组起终点，路径规划结果与百度地图地铁方案站数/换乘一致或合理。

* [ ] 断网后刷新页面，仍可查看线路图 + 规划路径（PWA 离线生效）。

* [ ] 上传 COS 香港桶后，默认域名 HTTPS 可直接打开（无下载弹窗、无 403）。

* [ ] iPhone Safari「添加到主屏幕」后，图标启动全屏无地址栏，无任何跳转/广告。

* [ ] 其余 3 城数据切换正常。

***

## 八、假设与风险

1. **假设**：四城官方线路/站点信息可从公开渠道整理获得（深圳已验证；广州/香港/南宁待 Phase 0 落实）。
2. **假设**：站点经纬度可由本地脚本批量地理编码得到，精度满足「走向正确」即可（无需亚米级）。
3. **风险**：COS 香港默认域名若被平台策略调整限制直连，则需改用香港节点自定义域名（仍免备案，但需自有域名）或转阿里云 OSS 香港节点。已确认当前可行。
4. **风险**：iOS PWA 的 Service Worker 缓存更新有延迟（依赖用户重新访问触发更新），需在 manifest/版本号上做好提示。
5. **数据时效**：地铁线路会随新线开通变化，需在数据 JSON 中记录 `updatedAt`，并提供更新流程文档。

***

## 九、待用户确认的关键点

1. **渲染观感**（决策 2）：默认采用「地理投影 SVG、无底图」的清爽线路图。若你期望「官方海报式抽象示意图」，请告知——方案与工作量需调整。
2. **首期范围**：是否同意「先做深圳打通全链路，再补广州/香港/南宁」的推进顺序？
3. **COS 桶归属**：部署时使用你本人的腾讯云账号香港地域桶？是否需要我一并产出部署操作指引？

---

## 十、实施进度（本会话已完成的工作）

> 本方案已进入执行阶段，以下为已落地的实际产物（路径均已在文件系统核实）。

### 已完成 ✅

**环境准备**
- 系统原无 Node.js，已将官方 Node v20.17.0（darwin-x64）解压至 `~/.local/`，并软链 `node/npm/npx` 到 `~/.local/bin`（已在 PATH）。无需 sudo、未改动系统目录。

**项目骨架**（`/Users/weihua/Documents/workSpace/subway-h5/`）
- `package.json`（Vue 3 + Vite 5 + vite-plugin-pwa 0.20 + sharp）
- `vite.config.js`（含 PWA manifest、Workbox 预缓存 `**/*.{js,css,html,svg,png,woff2,json,webmanifest}`、`base:'./'` 适配对象存储子路径）
- `index.html`（iOS PWA meta：`apple-mobile-web-app-capable`、`apple-touch-icon`、`theme-color`、`viewport-fit=cover`）
- `.gitignore`

**核心库**（`src/lib/`，实际用 `.js` 而非计划中的 `.ts`，功能等价）
- [projection.js](file:///Users/weihua/Documents/workSpace/subway-h5/src/lib/projection.js) — 经纬度→SVG 投影（bounds 推导 + 纬度 1/cos 矫正 + y 翻转）
- [graph.js](file:///Users/weihua/Documents/workSpace/subway-h5/src/lib/graph.js) — 图构建（同线相邻边 150s / 同站跨线换乘 240s / 跨站换乘链接）+ 二叉堆 Dijkstra（多源多汇）+ `pathToLegs` + `planRoute`
- [loadData.js](file:///Users/weihua/Documents/workSpace/subway-h5/src/lib/loadData.js) — 按需 fetch `./data/<city>.json` + 内存缓存 + 站名模糊搜索

**Vue 组件**（`src/components/`）
- [SubwayMap.vue](file:///Users/weihua/Documents/workSpace/subway-h5/src/components/SubwayMap.vue) — SVG 线路/站点/标签渲染、滚轮+双指捏合缩放、单指拖拽、点击站点、路径高亮、图例、缩放按钮、`zoomToStations`
- [StationSearch.vue](file:///Users/weihua/Documents/workSpace/subway-h5/src/components/StationSearch.vue) — 起终点搜索 + 自动补全 + 交换 + v-model
- [RouteResult.vue](file:///Users/weihua/Documents/workSpace/subway-h5/src/components/RouteResult.vue) — 耗时/站数/换乘次数 + 分段(leg)展示 + 换乘提示
- [CitySwitcher.vue](file:///Users/weihua/Documents/workSpace/subway-h5/src/components/CitySwitcher.vue) — 城市切换 chips
- [App.vue](file:///Users/weihua/Documents/workSpace/subway-h5/src/App.vue)、[main.js](file:///Users/weihua/Documents/workSpace/subway-h5/src/main.js)、[style.css](file:///Users/weihua/Documents/workSpace/subway-h5/src/style.css)

**数据准备脚本**（从 Overpass 退化为两步查询 + User-Agent + 504 重试）
- [scripts/prepare-data/build_data.mjs](file:///Users/weihua/Documents/workSpace/subway-h5/scripts/prepare-data/build_data.mjs) — Step1 取 subway/light_rail route 关系，Step2 批量取节点坐标，自动生成换乘链接
- 已生成 [public/data/shenzhen.json](file:///Users/weihua/Documents/workSpace/subway-h5/public/data/shenzhen.json)（58KB，17 线路 / 474 站点 / 146 换乘链接，源自 OSM）

**PWA 资源**
- [public/icons/icon.svg](file:///Users/weihua/Documents/workSpace/subway-h5/public/icons/icon.svg) + 由 [scripts/generate-icons.mjs](file:///Users/weihua/Documents/workSpace/subway-h5/scripts/generate-icons.mjs)（sharp）生成的 `icon-192/512/maskable-512/apple-touch-icon.png`

**构建验证**
- `npm run build` 成功；产物 `dist/` 含 assets、data、icons、manifest、sw.js
- PWA 预缓存 **17 entries / 196 KiB**（含 shenzhen.json，离线可用）
- `npm run preview` 已启动，`http://localhost:4173/` 返回 **HTTP 200**

### 剩余工作 ⏳

1. **浏览器实测**：用 browser 自动化打开 `http://localhost:4173/`，截图确认深圳线路图渲染、缩放/拖拽、起终点搜索、路径规划高亮均正常；修任何暴露的运行时 bug。
2. **补全其余 3 城数据**：依次运行 `npm run prepare:data:gz|hk|nn`（Overpass 抓取广州/香港/南宁），核查线路条数与站点量级合理。
3. **重新 build** 纳入 3 城数据后再次构建，确认预缓存条目数上升。
4. **部署指引**：在项目根写 `DEPLOY.md`，给出腾讯云 COS 香港地域建桶→开启静态网站→上传 `dist/`→默认域名访问→iOS「添加到主屏幕」的逐步操作。

### 与原计划的偏差说明
- 源码用 `.js`/`<script setup>`（无 `lang="ts"`）替代计划中的 `.ts`——降低构建期类型检查风险，功能无差异。
- 数据源用 **OSM Overpass API**（含坐标 + 站序 + 换乘，一次成型）替代计划设想的「官方文本 + 地理编码」两步法——更自动、更准、无需 AK。
- Node 安装方式：因 Homebrew `/usr/local` 权限需 sudo，改用官方二进制解压到 `~/.local`（用户可写）。

---

## 十一、本次待用户确认

- 是否同意继续执行「剩余工作」四项（浏览器实测 → 补 3 城数据 → 重新 build → 部署指引）？
- 如暂不需要部署指引或暂不补 3 城，可指定只做其中部分。

