# N1KO MUSIC —— Web 客户端镜像
#
# 纯静态站点：构建产物交给 nginx。运行时可用环境变量注入默认服务器，
# 免去每台设备手动填地址。
#
#   docker run -p 8080:80 \
#     -e DEFAULT_SERVER_URL=https://music.example.com \
#     -e DEFAULT_SERVER_TYPE=navidrome \
#     ghcr.io/baogutang/n1ko-music-web

# Node 版本与三个 workflow 保持一致
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime

# SPA 路由：任何未命中的路径都回落到 index.html
RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location / { try_files $uri $uri/ /index.html; }' \
  '  location ~* \.(?:woff2|js|css|png|svg)$ { expires 30d; add_header Cache-Control "public, immutable"; }' \
  '  location = /sw.js { add_header Cache-Control "no-cache"; }' \
  '  location = /index.html { add_header Cache-Control "no-cache"; }' \
  '}' > /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.d/40-n1ko-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-n1ko-runtime-config.sh

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

EXPOSE 80
