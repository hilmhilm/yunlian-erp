# 云链进销存（群晖 NAS 版）

一套前后端分离、可私有部署的进销存系统。核心容器为 React Web、Node API 和 PostgreSQL，适合安装了 Container Manager 的群晖 NAS。

## 已实现

- 多用户登录入口与会话 API
- 商品、条码、分类、采购入库和实时库存
- 客户资料、销售单、扫码销售与事务化扣减库存
- 首页经营概览、库存预警与基础报表入口
- PostgreSQL 持久化、容器健康检查、内部隔离网络
- 桌面和手机浏览器响应式界面
- 多语言框架与语言持久化：简体中文、English、Magyar
- 商品名称/描述的数据库级多语言扩展表与 API
- 前端登录、商品、客户、采购、销售、首页汇总和报表汇总已接入真实 API
- 采购入库与扫码销售会事务化更新库存并写入库存流水

## 增加新语言

1. 在 `web/src/i18n.jsx` 的 `locales` 中登记语言代码。
2. 在同一文件的 `messages` 中增加翻译词典；未翻译的键会安全回退到简体中文。
3. 在数据库 `supported_locales` 中登记语言；商品内容翻译保存到 `product_translations`，无需修改商品主表。
4. 所有新界面文案必须通过 `t("key")` 使用语言键，规则已经记录在前端 `AGENTS.md`。

## 群晖部署

DS1517+ 与 DSM 7.1.1 用户请优先阅读 [`README-DS1517+.md`](README-DS1517+.md)，并使用 `docker-compose.ds1517.yml`。

1. 将整个 `erp-nas` 目录上传到 NAS，例如 `/volume1/docker/erp-nas`。
2. 将 `.env.example` 复制为 `.env`，替换其中所有密码和密钥。
3. 在 Container Manager 新建“项目”，来源选择此目录中的 `docker-compose.yml`。
4. 构建并启动后访问 `http://NAS-IP:8088`。
5. 使用 `.env` 中的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。

如需公网访问，建议使用群晖反向代理绑定域名并启用 Let's Encrypt HTTPS；数据库和 API 不应直接暴露公网端口。

## 数据备份

定期备份 Docker 卷 `postgres_data`。升级前建议额外执行 PostgreSQL 逻辑备份；业务附件可在后续版本增加独立对象存储卷。

## 本地前端预览

前端目录为 `web`。本地开发需要同时运行 API 与 PostgreSQL；Vite 会把 `/api` 代理到本机 `3000` 端口。登录账号由本地或 Docker 环境变量中的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 控制，不再提供前端演示登录。
