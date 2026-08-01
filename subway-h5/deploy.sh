#!/bin/bash
# ============================================================
# 一键部署脚本：地铁线路图 → 腾讯云 COS 香港地域
# 使用方法：编辑本脚本填入密钥，然后运行 ./deploy.sh
# ============================================================

set -e

# ==================== 必填配置 ====================
# 腾讯云 API 密钥：https://console.cloud.tencent.com/cam/capi
SECRET_ID="REDACTED_SECRET_ID"
SECRET_KEY="REDACTED_SECRET_KEY"

# 存储桶信息
APP_ID="1322572851"
BUCKET_NAME="mysubway"
REGION="ap-hongkong"
ENDPOINT="cos.ap-hongkong.myqcloud.com"
# =================================================

FULL_BUCKET="${BUCKET_NAME}-${APP_ID}"
COS_CONFIG="$HOME/.cos.yaml"

echo "========================================="
echo " 地铁线路图 → COS $REGION 一键部署"
echo "========================================="
echo ""

# 1. 检查密钥
if [ "$SECRET_ID" = "你的SecretId" ] || [ -z "$SECRET_ID" ]; then
    echo "❌ 请先在脚本中填入 SECRET_ID 和 SECRET_KEY"
    echo "   获取地址：https://console.cloud.tencent.com/cam/capi"
    exit 1
fi

# 2. 确保 dist 存在
if [ ! -d "dist" ]; then
    echo "📦 构建项目..."
    npm run build
fi

# 3. 配置 coscli（直接写 YAML，完全非交互）
echo "📝 配置 coscli..."
export PATH="$HOME/bin:$PATH"

if [ -f "$COS_CONFIG" ]; then
    cp "$COS_CONFIG" "${COS_CONFIG}.bak"
fi

cat > "$COS_CONFIG" << EOF
cos:
  base:
    secretid: $SECRET_ID
    secretkey: $SECRET_KEY
    sessiontoken: ""
    protocol: https
  buckets:
  - name: $FULL_BUCKET
    alias: $BUCKET_NAME
    region: $REGION
    endpoint: $ENDPOINT
    ofs: false
EOF

coscli config show > /dev/null 2>&1 || {
    echo "❌ 配置验证失败，检查密钥是否正确"
    exit 1
}
echo "✅ 配置完成"

# 4. 上传文件（先整体上传，再单独修复 MIME）
echo ""
echo "📤 上传 dist/ 到 COS..."
coscli cp dist/ cos://${BUCKET_NAME}/ -r
echo "✅ 上传完成"

# 5. 修复所有文件的 MIME + Content-Disposition + Cache-Control
#    COS 默认会设置 Content-Disposition: attachment，导致浏览器下载
#    必须重新上传每个关键文件，指定正确的 MIME 和 inline 显示
echo ""
echo "🔧 设置 MIME + Content-Disposition + Cache-Control..."

# HTML: 5分钟缓存
coscli cp dist/index.html cos://${BUCKET_NAME}/index.html \
    --meta "Content-Type:text/html#Content-Disposition:inline#Cache-Control:max-age=300" 2>&1 | tail -1

# JS/CSS (assets/): 1年缓存（带 hash，immutable）
for jsfile in dist/assets/*.js; do
    name=$(basename "$jsfile")
    coscli cp "$jsfile" "cos://${BUCKET_NAME}/assets/$name" \
        --meta "Content-Type:application/javascript#Content-Disposition:inline#Cache-Control:max-age=31536000,immutable" 2>&1 | tail -1
done

for cssfile in dist/assets/*.css; do
    name=$(basename "$cssfile")
    coscli cp "$cssfile" "cos://${BUCKET_NAME}/assets/$name" \
        --meta "Content-Type:text/css#Content-Disposition:inline#Cache-Control:max-age=31536000,immutable" 2>&1 | tail -1
done

# 图标: 7天缓存
for icon in dist/icons/*; do
    name=$(basename "$icon")
    coscli cp "$icon" "cos://${BUCKET_NAME}/icons/$name" \
        --meta "Content-Type:image/png#Content-Disposition:inline#Cache-Control:max-age=604800" 2>&1 | tail -1
done

# 数据 JSON: 1小时缓存
for data in dist/data/*; do
    name=$(basename "$data")
    coscli cp "$data" "cos://${BUCKET_NAME}/data/$name" \
        --meta "Content-Type:application/json#Content-Disposition:inline#Cache-Control:max-age=3600" 2>&1 | tail -1
done

echo "✅ 缓存策略已设置"

# 6. 验证
echo ""
echo "🔍 验证响应头..."
curl -s -I "https://${FULL_BUCKET}.cos-website.${REGION}.myqcloud.com/" 2>&1 | grep -E "Content-Type|Content-Disposition"

# 完成
echo ""
echo "========================================="
echo " ✅ 部署完成！"
echo "========================================="
echo ""
echo " 🌐 访问地址:"
echo "   https://${FULL_BUCKET}.cos-website.${REGION}.myqcloud.com"
echo ""
echo " 💡 如果页面还是下载，请在控制台检查:"
echo "   → 权限管理 → 存储桶访问权限 → 公有读私有写"
echo "   → 基础配置 → 静态网站 → 开启"
echo "   → 强制 HTTPS → 开启"
echo ""
echo " ⚠️  部署完成后请立即删除旧密钥！"
echo "   https://console.cloud.tencent.com/cam/capi"
echo ""
