# 鼓房预约系统

面向社团成员的一周鼓房预约网页。通过审核的成员可以在电脑或手机浏览器中查看一周时间表，并使用自己的账号预约和取消时段。

当前版本是可继续扩展的基础框架：

- 响应式网页，支持电脑和手机访问
- 学号/工号注册，姓名、电话号码、微信号登记，登录与服务器端会话
- 注册申请由系统管理员或鼓房管理员审核
- 系统管理员、鼓房管理员、普通社员三级权限
- 每人每个自然周（周一至周日）最多预约 2 个时段
- 用户可取消自己尚未开始的预约
- 鼓房管理员可预先登记保留的社团活动时段，同时也能进行个人预约
- 系统管理员可设置或撤销鼓房管理员身份，并拥有全部时段管理权限
- 管理员可按完整周设置学期起止日期，系统会自动切换学期与假期时段表
- 周日 13:00 开放下一周周一至周四，周四 13:00 开放本周周五至周日的个人预约
- 学期第三至第六节为公用时段，不开放个人预约或活动登记
- 自动删除超过 4 周的历史预约和活动记录
- 按周展示预约表，支持一次选择多个时段
- PostgreSQL 持久化存储
- 数据库唯一约束防止同一时段被重复预约
- 一次提交中的多个时段以单条 SQL 原子写入，不会只成功一部分
- 冲突请求返回 HTTP `409`，前端会提示用户重新选择
- 提供健康检查接口 `/api/health`
- 支持 Windows、macOS 开发，以及 Linux + Docker Compose 部署

系统管理员由 `.env` 中的专用账号和密码自动创建，数据库同时限制最多只能存在一个系统管理员账号。

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

- Node.js `>= 26.8.1 < 27`（支持后续 Node.js 26.x；当前推荐基线为 `26.8.1`）
- pnpm `>= 11.19.0 < 12`（支持后续 pnpm 11.x；Node.js 26 不再内置 Corepack，使用 npm 单独安装）
- Docker Desktop（Windows / macOS），用于运行本地 PostgreSQL

Linux 部署需要：

- 一台带公网 IP 的 Linux 服务器
- Docker Engine
- Docker Compose 插件（命令为 `docker compose`）
- 可选但推荐：一个解析到服务器公网 IP 的域名

## 第一次准备

### Windows（PowerShell）

```powershell
npm install --global pnpm@11
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

打开 `.env`，至少修改 `POSTGRES_PASSWORD`、`SYSTEM_ADMIN_ACCOUNT` 和 `SYSTEM_ADMIN_PASSWORD`。两个密码都应使用独立的长随机值，只保存在本机 `.env` 中，不要提交到 Git。

### macOS / Linux（终端）

```bash
npm install --global pnpm@11
pnpm install --frozen-lockfile
cp .env.example .env
```

打开 `.env`，至少修改 `POSTGRES_PASSWORD`、`SYSTEM_ADMIN_ACCOUNT` 和 `SYSTEM_ADMIN_PASSWORD`。

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

电脑访问 [http://localhost:3000](http://localhost:3000)。手机测试时，确保手机与 Mac 在同一局域网，然后访问 `http://Mac的局域网IP:3000`。同时在 `.env` 的 `NEXT_ALLOWED_DEV_ORIGINS` 中加入该 IP，例如 `NEXT_ALLOWED_DEV_ORIGINS=127.0.0.1,192.168.31.57`；这里只写主机名/IP，不写协议或端口。更换网络后如果 Mac 的 IP 发生变化，需要同步更新这个变量并重启开发服务器。如 macOS 询问是否允许 Node 接收入站连接，应仅在可信网络中允许。

Apple Silicon 和 Intel Mac 都可以使用。不要从 Windows 复制 `node_modules` 到 Mac；在 Mac 上重新执行 `pnpm install`，pnpm 会安装对应平台的原生依赖。

仓库根目录的 `.nvmrc` 固定的是团队验证过的推荐基线，并非禁止使用更新的 Node.js 26.x。如果使用 nvm，可在项目目录运行 `nvm install` 和 `nvm use` 自动切换到该版本。Node.js 发布新的 26.x 后可以直接用于开发；确认 `pnpm lint`、`pnpm typecheck` 和 `pnpm build` 均通过后，再同步更新 `.nvmrc` 和 `Dockerfile` 中的固定版本。升级到 Node.js 27 等新主版本时，应先完成同样的兼容性验证，再调整 `package.json` 中的版本范围。

## 账号与权限

首次迁移数据库后，使用 `.env` 中的 `SYSTEM_ADMIN_ACCOUNT` 和 `SYSTEM_ADMIN_PASSWORD` 登录。系统会在首次登录时自动创建唯一的系统管理员；以后修改这两个环境变量并再次登录，也会同步更新该管理员的账号和密码。

正常使用流程如下：

1. 社员使用学号/工号、密码、姓名、电话号码和微信号提交注册申请。
2. 系统管理员或鼓房管理员在“账号审核”中批准申请。
3. 审核通过后，社员才能登录并预约；默认身份始终是普通社员。
4. 只有系统管理员可以把已通过的社员设为鼓房管理员，或撤销该身份。
5. 鼓房管理员仍可进行个人预约，也可切换到“登记活动”，预先占用社团活动时段。

系统管理员和鼓房管理员都可以从“管理设置”中修改本学期的开始和结束日期（起止日均包含）。开始日期必须是周一，结束日期必须是周日，因此每个自然周只会使用一种时段表。学期完整周使用 13 节时段表，其中第三至第六节为公用时段；其他完整周使用 11 节假期表。`INITIAL_SEMESTER_START` 和 `INITIAL_SEMESTER_END` 只负责数据库中尚无设置时的初始值，网页中保存后以数据库设置为准。

预约限制按北京时间计算。每周日 13:00 开放下一周周一至周四的预约，每周四 13:00 开放本周周五至周日的预约；开放之前所有身份都不能进行个人预约。管理员登记社团活动不受开放日限制，因此可以提前保留时段，但仍不能占用学期公用时段或已经开始的时段。每个账号在每个自然周（周一至周日）最多预约 2 个时段；社团活动不计入个人配额。预约表格显示预约者姓名；点击其他同学的预约会显示其电话号码和微信号，点击自己的未来预约则进入取消确认。普通用户只能取消自己的、尚未到开始时间的预约；鼓房管理员可以移除尚未开始的活动；系统管理员拥有全部时段的覆盖管理权限。

服务器会在每周一北京时间 00:00 清理超过四周的历史记录，包括个人预约和社团活动。服务启动时会检查本周是否已经清理，以便电脑关机或服务中断时在恢复后补做；同一周不会重复执行清理。未来预约不会被清理。

用户密码使用 `scrypt` 加盐存储，浏览器会话使用随机令牌和 `HttpOnly` Cookie。权限、预约配额和取消条件都由服务器再次检查，不能只靠修改浏览器页面绕过。

会话默认采用滑动过期策略：连续 7 天没有访问则失效；当剩余有效期不足 24 小时时，再次打开或回到网站会延长闲置有效期并轮换会话令牌。无论如何续期，一次登录最多持续 30 天，届时必须重新输入密码。三个时间值分别由 `SESSION_IDLE_TTL_DAYS`、`SESSION_RENEW_BEFORE_HOURS` 和 `SESSION_ABSOLUTE_TTL_DAYS` 配置。浏览器打开预约页面期间每小时检查一次会话，但只有进入续期窗口时才会写数据库。

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
{ "status": "ok" }
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
SYSTEM_ADMIN_ACCOUNT=system-admin
SYSTEM_ADMIN_PASSWORD=替换为独立的长随机密码
SYSTEM_ADMIN_NAME=系统管理员
SYSTEM_ADMIN_CONTACT=系统维护
SYSTEM_ADMIN_PHONE=仅限系统维护
SYSTEM_ADMIN_WECHAT=仅限系统维护
INITIAL_SEMESTER_START=2026-09-07
INITIAL_SEMESTER_END=2027-01-10
SESSION_COOKIE_SECURE=true
SESSION_IDLE_TTL_DAYS=7
SESSION_ABSOLUTE_TTL_DAYS=30
SESSION_RENEW_BEFORE_HOURS=24
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
- 为登录和注册接口配置反向代理限流，并定期检查异常登录日志

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

| 变量                         | 用途                                           | 默认/示例                              |
| ---------------------------- | ---------------------------------------------- | -------------------------------------- |
| `POSTGRES_DB`                | Compose 创建的数据库名                         | `drum_room`                            |
| `POSTGRES_USER`              | Compose 创建的数据库用户                       | `drum_room`                            |
| `POSTGRES_PASSWORD`          | 数据库密码                                     | 必须在部署前修改                       |
| `POSTGRES_PORT`              | PostgreSQL 映射到开发机的端口                  | `5432`                                 |
| `DB_POOL_MAX`                | 每个应用实例的最大数据库连接数                 | `10`                                   |
| `SYSTEM_ADMIN_ACCOUNT`       | 唯一系统管理员登录账号                         | `system-admin`                         |
| `SYSTEM_ADMIN_PASSWORD`      | 唯一系统管理员密码                             | 必须使用长随机值                       |
| `SYSTEM_ADMIN_NAME`          | 系统管理员显示名称                             | `系统管理员`                           |
| `SYSTEM_ADMIN_CONTACT`       | 系统管理员联系方式/说明                        | `系统维护`                             |
| `SYSTEM_ADMIN_PHONE`         | 系统管理员对外显示的电话号码/说明              | 默认沿用 `SYSTEM_ADMIN_CONTACT`        |
| `SYSTEM_ADMIN_WECHAT`        | 系统管理员对外显示的微信号/说明                | 默认沿用 `SYSTEM_ADMIN_CONTACT`        |
| `INITIAL_SEMESTER_START`     | 首次创建预约设置时的学期开始日期               | `2026-09-07`                           |
| `INITIAL_SEMESTER_END`       | 首次创建预约设置时的学期结束日期（必须是周日） | `2027-01-10`                           |
| `SESSION_COOKIE_SECURE`      | 是否强制会话 Cookie 只通过 HTTPS 发送          | 生产 `true`；本机 HTTP `false` 或留空  |
| `SESSION_IDLE_TTL_DAYS`      | 会话连续闲置多少天后失效                       | `7`，允许 `1–30`                       |
| `SESSION_ABSOLUTE_TTL_DAYS`  | 一次登录无论续期最多持续多少天                 | `30`，允许 `1–365`，且不能短于闲置期限 |
| `SESSION_RENEW_BEFORE_HOURS` | 剩余多少小时以内才执行续期和令牌轮换           | `24`，必须短于闲置期限                 |
| `NEXT_ALLOWED_DEV_ORIGINS`   | 开发模式允许加载 Next.js 资源的局域网主机/IP   | 逗号分隔，不含端口                     |
| `SITE_ADDRESS`               | Caddy 监听地址或生产域名                       | 本机 `:80`；生产填写域名               |
| `DATABASE_URL`               | 可选的完整数据库连接字符串                     | 云数据库常用                           |
| `DB_SSL`                     | 是否为数据库连接启用 TLS                       | `false`                                |
| `DB_SSL_REJECT_UNAUTHORIZED` | 是否校验数据库 TLS 证书                        | `true`                                 |

如果以后横向运行多个应用实例，应确保 `应用实例数 × DB_POOL_MAX` 小于 PostgreSQL 的最大连接数，并为管理连接和迁移任务预留余量。

## 并发预约如何保证不重复

`bookings` 表对 `(booking_date, slot_index)` 建立了唯一索引。即使多个用户同时读取到同一个空白格并同时提交，PostgreSQL 最终也只允许一个请求插入成功。一次请求选择的多个时段使用同一条 `INSERT` 完成，因此任何一个时段发生冲突时，整个请求都会失败，不会产生部分预约成功的状态。

个人预约还会在同一数据库事务中锁定当前用户记录并检查周配额。这样即使同一账号从两台设备同时提交，也不能越过每周 2 个时段的限制。

应用层连接池用于复用数据库连接，默认每个应用进程最多使用 10 个连接。它能承受社团规模的并发访问；后续如果访问量明显增加，可以增加应用实例、调整连接池，并配合限流和监控进行容量评估。
