# 鼓房预约系统

面向社团成员的一周鼓房预约网页。成员可以在电脑或手机浏览器中查看一周时间表，点击空白时段进行多选，填写姓名后统一提交预约。

当前版本是可继续扩展的基础框架：

- 响应式网页，支持电脑和手机访问
- 按周展示预约表，支持一次选择多个时段
- PostgreSQL 持久化存储
- 数据库唯一约束防止同一时段被重复预约
- 一次提交中的多个时段以单条 SQL 原子写入，不会只成功一部分
- 冲突请求返回 HTTP `409`，前端会提示用户重新选择
- 提供健康检查接口 `/api/health`
- 支持 Windows、macOS 开发，以及 Linux + Docker Compose 部署

> 当前版本尚未实现登录和权限控制。正式公开到互联网前，应继续加入成员身份认证、管理员功能、限流和定期备份。

## 技术架构

- Web：Next.js 16 + React 19 + TypeScript
- 数据库：PostgreSQL 17
- 数据库结构：Drizzle ORM / Drizzle Kit
- 生产运行：Docker Compose
- 公网入口：Caddy，配置域名后自动申请和续期 HTTPS 证书

浏览器只访问 Web 应用，PostgreSQL 不应直接暴露到公网。生产环境中的访问路径为：

```text
电脑 / 手机浏览器 -> Caddy (80/443) -> Next.js (3000) -> PostgreSQL (5432)
```

## 环境要求

本机直接开发需要：

- Node.js `>= 22.13.0`
- pnpm `11.19.0`（可通过 Node 自带的 Corepack 启用）
- Docker Desktop（Windows / macOS），用于运行本地 PostgreSQL

Linux 部署需要：

- 一台带公网 IP 的 Linux 服务器
- Docker Engine
- Docker Compose 插件（命令为 `docker compose`）
- 可选但推荐：一个解析到服务器公网 IP 的域名

## 第一次准备

### Windows（PowerShell）

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
```

打开 `.env`，至少把 `POSTGRES_PASSWORD` 改成自己的密码。密码只保存在本机 `.env` 中，不要提交到 Git。

### macOS / Linux（终端）

```bash
corepack enable
pnpm install
cp .env.example .env
```

打开 `.env`，至少修改 `POSTGRES_PASSWORD`。

## Windows 上开发和测试

1. 启动 Docker Desktop。
2. 在项目根目录启动 PostgreSQL：

```powershell
docker compose up -d db
```

3. 创建或升级数据库结构：

```powershell
pnpm db:migrate
```

4. 启动开发服务器：

```powershell
pnpm dev
```

电脑访问 [http://localhost:3000](http://localhost:3000)。手机与电脑连接同一个局域网时，可访问 `http://电脑的局域网IP:3000`；如果无法连接，请只为可信局域网放行 Windows 防火墙中的 3000 端口。

开发结束后只停止数据库、保留数据：

```powershell
docker compose stop db
```

## macOS 上开发和测试

1. 启动 Docker Desktop。
2. 在项目根目录执行：

```bash
docker compose up -d db
pnpm db:migrate
pnpm dev
```

电脑访问 [http://localhost:3000](http://localhost:3000)。手机测试时，确保手机与 Mac 在同一局域网，然后访问 `http://Mac的局域网IP:3000`。如 macOS 询问是否允许 Node 接收入站连接，应仅在可信网络中允许。

Apple Silicon 和 Intel Mac 都可以使用。不要从 Windows 复制 `node_modules` 到 Mac；在 Mac 上重新执行 `pnpm install`，pnpm 会安装对应平台的原生依赖。

## 不使用 Docker 的本地开发

如果电脑上已经安装 PostgreSQL，也可以不使用 Docker。先创建数据库和用户，再在 `.env` 中设置以下任意一种连接方式。

方式一，使用标准 PostgreSQL 变量：

```dotenv
PGHOST=localhost
PGPORT=5432
PGDATABASE=drum_room
PGUSER=drum_room
PGPASSWORD=你的密码
```

方式二，使用连接字符串：

```dotenv
DATABASE_URL=postgresql://drum_room:你的URL编码密码@localhost:5432/drum_room
```

随后运行：

```bash
pnpm db:migrate
pnpm dev
```

## 本地完整容器测试（Windows / macOS / Linux）

这个流程会使用接近生产环境的四个容器：PostgreSQL、一次性迁移任务、Next.js 应用和 Caddy。

```bash
docker compose up --build -d
docker compose ps
```

默认 `SITE_ADDRESS=:80`，访问 [http://localhost](http://localhost)。检查应用与数据库是否都健康：

```bash
curl http://localhost/api/health
```

正常响应为：

```json
{"status":"ok"}
```

查看日志：

```bash
docker compose logs -f app caddy db
```

停止全部容器但保留数据库数据：

```bash
docker compose down
```

如果确实要清空本地数据库并重新开始，可以执行下面的命令。它会永久删除 Compose 数据卷中的预约数据：

```bash
docker compose down -v
```

## 日常代码检查

提交代码前建议依次运行：

```bash
pnpm lint
pnpm typecheck
pnpm build
```

如果改动涉及容器，再运行：

```bash
docker compose config
docker compose build
docker compose up -d
curl http://localhost/api/health
```

至少用两个浏览器窗口同时选择同一个空白时段进行测试。预期结果是：一个请求成功，另一个请求收到冲突提示，数据库中只有一条该时段的预约。

## 在 Linux 服务器上部署

以下流程适用于常见的 Ubuntu / Debian 等 Linux 服务器。Docker 的具体安装命令以所用发行版的官方文档为准。

### 1. 准备服务器和域名

- 安装 Docker Engine 和 Docker Compose 插件。
- 安全组或防火墙只需对公网开放 SSH、TCP 80、TCP 443 和 UDP 443。
- 不要对公网开放 PostgreSQL 的 5432 端口。
- 将域名的 A 记录（以及使用 IPv6 时的 AAAA 记录）解析到服务器。

### 2. 获取代码并配置环境

```bash
git clone <你的仓库地址> drum-room-booking
cd drum-room-booking
cp .env.example .env
```

编辑 `.env`：

```dotenv
POSTGRES_DB=drum_room
POSTGRES_USER=drum_room
POSTGRES_PASSWORD=替换为足够长的随机密码
POSTGRES_PORT=5432
DB_POOL_MAX=10
SITE_ADDRESS=booking.example.com
```

`SITE_ADDRESS` 改成真实域名后，Caddy 会自动申请 HTTPS 证书。域名必须已正确解析，且服务器的 80/443 端口可从公网访问。

### 3. 构建并启动

```bash
docker compose up --build -d
docker compose ps
curl https://booking.example.com/api/health
```

首次启动顺序是：数据库健康 -> 执行迁移 -> 启动应用 -> 启动 Caddy。应用不会在数据库结构尚未就绪时提前对外提供服务。

### 4. 更新版本

先备份数据库，再拉取代码并重建：

```bash
docker compose exec -T db pg_dump -U drum_room drum_room > backup.sql
git pull --ff-only
docker compose up --build -d
```

每次启动时，`migrate` 服务只会执行尚未应用的迁移。已经执行过的迁移文件如果被改写，启动会失败并提示校验和不一致，避免数据库结构被静默篡改。

### 5. 运维检查

```bash
docker compose ps
docker compose logs --tail=200 app migrate caddy db
curl -f https://booking.example.com/api/health
```

建议另外配置：

- 每日自动备份 PostgreSQL，并定期验证备份能否恢复
- 服务器监控、磁盘空间告警和健康检查告警
- SSH 密钥登录、关闭密码登录、及时安装安全更新
- 在公开使用前加入账号登录、管理员权限和接口限流

## 数据库迁移开发流程

修改 [`db/schema.ts`](./db/schema.ts) 后生成新的迁移文件：

```bash
pnpm db:generate
```

检查新生成的 `drizzle/*.sql`，确认无误后在本地执行：

```bash
pnpm db:migrate
```

迁移文件应随代码一起提交。不要修改已经在任何共享或生产数据库上执行过的迁移；需要变更时，应新建下一条迁移。

## 环境变量

| 变量 | 用途 | 默认/示例 |
| --- | --- | --- |
| `POSTGRES_DB` | Compose 创建的数据库名 | `drum_room` |
| `POSTGRES_USER` | Compose 创建的数据库用户 | `drum_room` |
| `POSTGRES_PASSWORD` | 数据库密码 | 必须在部署前修改 |
| `POSTGRES_PORT` | PostgreSQL 映射到开发机的端口 | `5432` |
| `DB_POOL_MAX` | 每个应用实例的最大数据库连接数 | `10` |
| `SITE_ADDRESS` | Caddy 监听地址或生产域名 | 本机 `:80`；生产填写域名 |
| `DATABASE_URL` | 可选的完整数据库连接字符串 | 云数据库常用 |
| `DB_SSL` | 是否为数据库连接启用 TLS | `false` |
| `DB_SSL_REJECT_UNAUTHORIZED` | 是否校验数据库 TLS 证书 | `true` |

如果以后横向运行多个应用实例，应确保 `应用实例数 × DB_POOL_MAX` 小于 PostgreSQL 的最大连接数，并为管理连接和迁移任务预留余量。

## 并发预约如何保证不重复

`bookings` 表对 `(booking_date, slot_index)` 建立了唯一索引。即使多个用户同时读取到同一个空白格并同时提交，PostgreSQL 最终也只允许一个请求插入成功。一次请求选择的多个时段使用同一条 `INSERT` 完成，因此任何一个时段发生冲突时，整个请求都会失败，不会产生部分预约成功的状态。

应用层连接池用于复用数据库连接，默认每个应用进程最多使用 10 个连接。它能承受社团规模的并发访问；后续如果访问量明显增加，可以增加应用实例、调整连接池，并配合限流和监控进行容量评估。
