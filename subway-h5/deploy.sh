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

# 3. 配置 coscli（覆盖旧配置）
echo "📝 配置 coscli..."
export PATH="$HOME/bin:$PATH"

# 如果有旧配置，先备份
if [ -f "$COS_CONFIG" ]; then
    cp "$COS_CONFIG" "${COS_CONFIG}.bak"
fi

# 用 config add 非交互式配置
coscli config add \
    -b "$FULL_BUCKET" \
    -e "$ENDPOINT" \
    -a "$BUCKET_NAME" \
    -r "$REGION" \
    -i "$SECRET_ID" \
    -k "$SECRET_KEY" \
    -p https

echo "✅ 配置完成"

# 4. 上传文件
echo ""
echo "📤 上传 dist/ 到 COS..."
coscli cp dist/ cos://${BUCKET_NAME}/ -r
echo "✅ 上传完成"

# 5. 配置静态网站托管
echo ""
echo "🌐 开启静态网站托管..."
coscli website set --bucket "$BUCKET_NAME" \
    --index-document index.html \
    --error-document index.html
echo "✅ 静态网站已开启"

# 6. 设置缓存
echo ""
echo "⚙️  设置缓存策略..."
coscli cache set --bucket "$BUCKET_NAME" --rule "rule_html" \
    --time 300 --type file --value "index.html"
coscli cache set --bucket "$BUCKET_NAME" --rule "rule_assets" \
    --time 31536000 --type prefix --value "assets/"
coscli cache set --bucket "$BUCKET_NAME" --rule "rule_data" \
    --time 3600 --type prefix --value "data/"
echo "✅ 缓存策略已设置"

# 7. 设置 MIME
echo ""
echo "🔧  设置 MIME 类型..."
coscli mime set --bucket "$BUCKET_NAME" \
    --mime ".json=application/json" \
    --mime ".webmanifest=application/manifest+json" \
    --mime ".svg=image/svg+xml"
echo "✅ MIME 已设置"

# 完成
echo ""
echo "========================================="
echo " ✅ 部署完成！"
echo "========================================="
echo ""
echo " 🌐 访问地址:"
echo "   https://${FULL_BUCKET}.${ENDPOINT}"
echo ""
echo " 📱 手机测试:"
echo "   在手机浏览器打开上面的地址"
echo ""
echo " ⚠️  重要提醒:"
echo "   请立即到 https://console.cloud.tencent.com/cam/capi"
echo "   删除旧密钥，重新创建一对新密钥！"
echo ""
