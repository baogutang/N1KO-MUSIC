#!/bin/sh
# 把运行时环境变量写成一份 JSON 供前端读取。
# 静态构建产物不能在构建期知道部署方的服务器地址，因此放到容器启动时注入。
set -eu

CONFIG_PATH=/usr/share/nginx/html/runtime-config.json

cat > "$CONFIG_PATH" <<JSON
{
  "defaultServerUrl": "${DEFAULT_SERVER_URL:-}",
  "defaultServerType": "${DEFAULT_SERVER_TYPE:-navidrome}",
  "lockServerConfig": ${LOCK_SERVER_CONFIG:-false}
}
JSON

echo "[n1ko] runtime config written to $CONFIG_PATH"
