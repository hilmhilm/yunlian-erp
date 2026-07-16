#!/bin/sh
set -eu

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "缺少 .env。请先复制 .env.example 为 .env，并替换所有密码和密钥。"
  exit 1
fi

mkdir -p data/postgres
chown -R 70:70 data/postgres
chmod 700 data/postgres
mkdir -p data/product-images
chmod 755 data/product-images

if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
elif docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
else
  echo "找不到 docker-compose。请先在 DSM 套件中心安装 Docker。"
  exit 1
fi

$COMPOSE -f docker-compose.ds1517.yml config >/dev/null
$COMPOSE -f docker-compose.ds1517.yml build --pull
$COMPOSE -f docker-compose.ds1517.yml up -d
$COMPOSE -f docker-compose.ds1517.yml ps

echo "部署完成：http://NAS-IP:${WEB_PORT:-8088}"
