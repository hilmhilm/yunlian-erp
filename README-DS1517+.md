# DS1517+ / DSM 7.1.1 专用部署说明

你的 DS1517+ 使用 Intel Atom C2538 四核 x86-64 处理器。本项目已固定为 `linux/amd64`，并为 2GB/8GB 内存配置设置了保守的容器内存上限。DSM 7.1.1 的内核不支持 Docker CPU CFS 配额，因此不设置 `cpus` 字段。

DSM 7.1.1 使用套件中心里的 **Docker** 套件；DSM 7.2 才改为 **Container Manager**。因此本机建议通过 SSH 使用 Compose 部署，而不是寻找“项目”页面。

## 一、NAS 准备

1. DSM 套件中心安装并启动 **Docker**。
2. 控制面板 → 终端机和 SNMP → 启用 SSH 服务。
3. File Station 创建 `/volume2/docker/erp-nas`。
4. 将整个项目目录上传到该目录。
5. 建议至少有 4GB 内存；2GB 也能运行，但构建镜像期间应停止不必要的套件。

## 二、配置密码

通过 SSH 进入 NAS 后执行：

```sh
cd /volume2/docker/erp-nas
cp .env.example .env
vi .env
```

必须替换 `POSTGRES_PASSWORD`、`JWT_SECRET` 和 `ADMIN_PASSWORD`。`JWT_SECRET` 必须使用至少 32 个随机字符。使用 Számlázz.hu 开票时，还要把已经生成的 Agent Key 填入 `SZAMLAZZ_AGENT_KEY`；不要把实际 Key 提交到 Git 或发送到聊天中。

## 三、启动

```sh
cd /volume2/docker/erp-nas
chmod +x deploy-ds1517.sh
sudo ./deploy-ds1517.sh
```

首次构建在 Atom C2538 上可能需要 10–30 分钟。完成后访问：

```text
http://NAS局域网IP:8088
```

登录账号来自 `.env` 的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`。

### 已有安装升级

升级前先备份数据库、产品图片和发票 PDF，然后在 File Station 覆盖项目代码（保留 NAS 上原有 `.env`、`data/postgres`、`data/product-images` 和 `data/invoices`），再通过 DSM「任务计划」以 root 重新运行 `deploy-ds1517.sh`。API 容器启动时会自动执行尚未应用的版本化数据库迁移，不需要手工执行 SQL，也不要删除或重建数据目录。部署脚本会自动建立缺少的 `data/invoices` 目录。

## 四、HTTPS 与公网访问

不要直接把 PostgreSQL、API、DSM 管理端口或公网 `8088` 暴露到互联网。推荐使用 Cloudflare Tunnel：在 Cloudflare 创建 Tunnel 后，从 Docker 安装命令中只复制 `--token` 后面的 Token，写入 NAS 的 `.env`：

```env
CLOUDFLARE_TUNNEL_TOKEN=你的Cloudflare-Tunnel-Token
```

`docker-compose.ds1517.yml` 中的 `cloudflared` 会与 `web` 共用 `erp-internal` 网络。连接器变为 Healthy 后，在 Cloudflare 为 Tunnel 添加 Published application，主机名设置为 `erp.你的域名`，Service URL 设置为 `http://web:80`。Token 只保留在 NAS 的 `.env`，禁止提交到 GitHub或发送到聊天中。

## 五、数据与备份

PostgreSQL 数据保存在：

```text
/volume2/docker/erp-nas/data/postgres
```

部署脚本会把该目录设置为 PostgreSQL Alpine 容器用户 `70:70`；请勿在 File Station 中手工改回普通 DSM 用户所有权。

将 `/volume2/docker/erp-nas` 加入 Hyper Backup，其中 `data/product-images` 保存产品与分类图片，`data/invoices` 保存 Számlázz.hu 返回的发票 PDF。数据库正在写入时，仅复制文件不等于一致性备份；正式上线后还应增加定时 `pg_dump` 任务。

## 六、常用维护命令

```sh
cd /volume2/docker/erp-nas
sudo docker-compose -f docker-compose.ds1517.yml ps
sudo docker-compose -f docker-compose.ds1517.yml logs --tail=100
sudo docker-compose -f docker-compose.ds1517.yml restart
sudo docker-compose -f docker-compose.ds1517.yml down
```

`down` 不会删除 `data/postgres`。不要使用 `down -v`，也不要手工清空数据库目录。

分类图片与产品图片共用 `data/product-images` 持久化目录。迁移 `013_product_categories.sql` 会在 API 重建启动时自动建立两级分类表，并把现有产品分类导入为主分类，无需手工执行 SQL。
