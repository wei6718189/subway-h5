# 部署指引：腾讯云 COS 香港地域（免备案、免域名）

> 适用场景：个人使用、iOS「添加到主屏幕」作为 PWA 独立全屏运行，绕开百度地图开屏广告与多次跳转。

## 一、前置条件

- 已完成 `npm run build`，产物在 `dist/` 目录下
- 拥有腾讯云账号（个人实名即可，无需企业资质）
- 无需备案、无需自有域名、无需购买 SSL 证书

## 二、创建 COS 存储桶

1. 登录 [腾讯云对象存储控制台](https://console.cloud.tencent.com/cos)
2. 点击左侧 **存储桶列表 → 创建存储桶**
3. 关键配置：
   - **所属地域**：选择 **中国香港**（关键！此地域免备案，默认域名可直接访问）
   - **存储桶名称**：自定义全局唯一名称，如 `subway-map-hk` + 随机后缀（系统会校验唯一性）
   - **访问权限**：选择 **公有读、私有写**（保证静态资源可被浏览器公开读取）
   - **多 AZ 特性**：关闭（个人用不上，省成本）
   - 其他保持默认
4. 点击 **创建存储桶**

## 三、开启静态网站托管

1. 进入刚创建的存储桶详情页
2. 左侧菜单 **基础配置 → 静态网站**
3. 点击 **开启**，配置：
   - 默认首页：`index.html`
   - 默认 404 页：`index.html`（SPA 单页应用的兜底路由）
   - 强制 HTTPS：**开启**（PWA Service Worker 要求 HTTPS）
4. 保存后，系统会生成**默认访问节点**（HTTPS 域名），格式：
   ```
   https://<桶名>-<AppID>.cos-website.ap-hongkong.myqcloud.com
   ```
   **请记下此域名**，后面要在 iOS 上用它打开 PWA。

## 四、上传构建产物

```bash
# 方式一：命令行（推荐，本地自动化）
# 安装 COSCLI 或 COS Browser 上传工具
# 在项目根目录执行：
npx cos-cli --bucket <桶名> --region ap-hongkong upload dist/ / --recursive
```

或使用控制台：
1. 存储桶详情页 → **文件列表 → 上传文件**
2. 将 `dist/` 目录下所有文件（含 `assets/`、`data/`、`icons/` 及 `index.html`、`manifest.webmanifest`、`sw.js`、`registerSW.js`、`workbox-*.js`）全部上传至桶根目录
3. 确保 `index.html`、`manifest.webmanifest`、`sw.js` 位于根路径

## 五、验证部署

1. 在电脑浏览器打开上一步记下的默认域名：
   ```
   https://<桶名>-<AppID>.cos-website.ap-hongkong.myqcloud.com/
   ```
2. 应直接看到「地铁线路图」首页，而不是下载文件（若出现下载说明 MIME 类型问题，见下方排错）
3. 选择深圳 → 搜索「罗湖」→ 选择「深圳北站」→ 点击「规划」→ 应出现换乘方案

## 六、iOS 添加到主屏幕

1. 在 iPhone 上用 Safari 打开部署好的 HTTPS 域名
2. 等待页面完全加载（首次加载会缓存所有资源到 Service Worker，下次打开秒开）
3. 点击 Safari 底部的 **分享按钮**（方框+向上箭头）
4. 选择 **「添加到主屏幕」**
5. 确认图标和名称 → 点击 **「添加」**
6. 回到主屏，你会看到「地铁图」图标
7. 点击图标：**独立全屏启动**，无 Safari 地址栏、无开屏广告、无跳转

## 七、离线使用

- 首次加载后，Service Worker 会预缓存所有静态资源（JS/CSS/图标/manifest + 三城地铁数据 JSON）
- 断网后仍可查看线路图、切换城市、搜索站点、规划路径
- 如需强制刷新缓存：iOS 设置 → Safari → 高级 → 网站数据 → 删除对应域名数据；或在 PWA 内长按图标删除 App

## 八、数据更新

当 OSM 数据更新（新线路开通等）：

```bash
cd subway-h5
npm run prepare:data          # 重新抓取所有城市
npm run build                  # 重新构建
# 将 dist/ 重新上传到 COS 桶（覆盖旧文件）
```

iOS 端需删除旧缓存（见上），或通过 PWA 自动更新机制（需关闭并重新打开 PWA 一次）。

## 九、常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| 访问域名时下载 index.html 而非显示页面 | MIME 类型未正确识别 | 在 COS 控制台 → 文件列表 → 选中 `index.html` → 操作 → 自定义 headers → 设置 `Content-Type: text/html; charset=utf-8` → 覆盖旧文件 |
| PWA 安装后离线打不开 | Service Worker 未成功注册 | 确保桶开启 **强制 HTTPS**；`apple-touch-icon.png` 必须位于桶根目录 |
| 页面空白 / 控制台 `InvalidVersion` | COS 未开启静态网站 | 需在桶配置中显式开启「静态网站」功能 |
| 跨域报错 | 桶访问权限不是「公有读」 | 在桶权限管理中将权限改为「公有读、私有写」 |
| 想用自定义域名但不想备案 | 腾讯云香港地域可绑定香港注册的域名 | 可用 Cloudflare Pages + 香港域名作为替代 |

## 十、备选方案：阿里云 OSS 香港

如腾讯云 COS 不可用，可改用阿里云 OSS 香港节点，流程类似：

1. 新建 **香港地域** Bucket
2. 基础设置 → 静态页面 → 开启（默认首页/404 均设为 `index.html`）
3. 权限设置为 **公共读**
4. 默认访问域名（HTTPS）直接可用，无需备案
