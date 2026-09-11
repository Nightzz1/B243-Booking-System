# 鼓房预约系统

面向社团成员的一周鼓房预约网页。通过审核的成员可以在电脑或手机浏览器中查看一周时间表，并使用自己的账号预约和取消时段。

当前版本是可继续扩展的基础框架：

- 响应式网页，支持电脑和手机访问
- 学号/工号注册，姓名、电话号码、微信号登记，登录与服务器端会话
- 注册申请由系统管理员或鼓房管理员审核
- 登录按账号失败次数和来源 IP 限流，注册使用独立的 IP 配额，超限后短暂冷却
- 系统管理员、鼓房管理员、普通社员三级权限
- 每人每个自然周（周一至周日）最多预约 2 个时段
- 用户可取消自己尚未开始的预约
- 首页“我的预约”独立展示本周和下周个人预约、下次预约和每周剩余次数，可直接确认取消
- 社员和鼓房管理员可在“账号管理”修改电话、微信和密码；修改密码后所有设备需重新登录
- 鼓房管理员可预先登记保留的社团活动时段，同时也能进行个人预约
- 系统管理员和鼓房管理员可登记多门每周固定占用连续两个节次的鼓课
- 固定鼓课支持单周停课、恢复上课和选择最后一次上课日期结课
- 系统管理员可设置或撤销鼓房管理员身份，并管理全部尚未开始的时段
- 管理员可按完整周设置学期起止日期，系统会自动切换学期与假期时段表
- 周日 13:00 开放下一周周一至周四，周四 13:00 开放本周周五至周日的个人预约
- 学期内周一至周五的第三至第六节为公用时段，周末正常开放
- 普通社员可查看本周和下一周；管理员可查看前三周至未来 16 周
- 自动删除前三周第一周之前的历史预约、活动和鼓课占用记录
- 按周展示预约表，支持一次选择多个时段
- PostgreSQL 持久化存储
- 共同练习支持多人加入，独自练习保持独占，数据库约束防止冲突和重复加入
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

首次迁移数据库后，使用 `.env` 中的 `SYSTEM_ADMIN_ACCOUNT` 和 `SYSTEM_ADMIN_PASSWORD` 登录。系统会在每个应用进程首次处理有效登录尝试时同步唯一的系统管理员，后续请求复用初始化结果，不再重复校验管理员密码和更新资料。修改管理员环境变量后需要重启应用；初始化失败可在后续请求重试。

正常使用流程如下：

1. 社员使用学号/工号、密码、姓名、电话号码和微信号提交注册申请。
2. 系统管理员或鼓房管理员在“账号审核”中批准申请。
3. 审核通过后，社员才能登录并预约；默认身份始终是普通社员。
4. 只有系统管理员可以把已通过的社员设为鼓房管理员，或撤销该身份。
5. 鼓房管理员仍可进行个人预约，也可切换到“管理活动”，预先占用或移除社团活动时段；个人预约模式不能修改活动。

系统管理员和鼓房管理员都可以从“管理设置”中修改本学期的开始和结束日期（起止日均包含）。开始日期必须是周一，结束日期必须是周日，因此每个自然周只会使用一种时段表。学期完整周使用 13 节时段表，其中周一至周五的第三至第六节为公用时段，周六和周日不设公用时段；其他完整周使用 11 节假期表。`INITIAL_SEMESTER_START` 和 `INITIAL_SEMESTER_END` 只负责数据库中尚无设置时的初始值，网页中保存后以数据库设置为准。

预约限制按北京时间计算。每周日 13:00 开放下一周周一至周四的预约，每周四 13:00 开放本周周五至周日的预约；开放之前所有身份都不能进行个人预约。管理员登记社团活动不受开放日限制，因此可以提前保留时段，但仍不能占用学期公用时段或已经开始的时段。每个账号在每个自然周（周一至周日）最多预约 2 个时段；社团活动不计入个人配额。预约表格用绿色标识共同练习，并显示人数和是否已加入；用粉色标识独自练习，并显示预约者姓名；点击其他同学的预约会显示其电话号码和微信号，点击自己的未来预约则进入取消确认。普通用户只能取消自己的、尚未到开始时间的预约；鼓房管理员可以移除尚未开始的活动；系统管理员可以管理尚未开始的全部时段。任何身份都不能修改已经开始或过去的时段。

新预约默认选择“共同练习”，确认时可为每个空白时段额外选择“独自练习”。共同练习允许其他社员点击时段查看参与者并加入，每位参与者分别占用一次个人周配额，同一人不能重复加入。独自练习不允许其他人加入。退出共同练习只取消自己的预约，最后一人退出后才恢复为空白；已有参与者时不能改成独自练习。社团活动和固定鼓课继续独占时段。

升级时执行 `pnpm db:migrate` 应用 `0007_shared_practice.sql`；已有预约保留为独自练习，新建个人预约默认共同练习。迁移会启用 PostgreSQL 的 `btree_gist` 扩展，数据库环境需支持该扩展并允许迁移账号创建它。

普通社员的预约表只能查看本周和下一周，这已经覆盖现行开放规则下所有当前可预约的日期。系统管理员和鼓房管理员可以查看本周之前三周，并可继续查看到当前周之后第 16 周，方便追溯近期安排、提前登记社团活动和检查课程；扩展查看范围不会提前开放个人预约。过去的空白时段继续显示为空白，已有预约或活动继续显示原信息，但都只能查看，不能再新增、取消或删除。

管理员可以在“管理设置”的“固定鼓课”区域登记多门课程。每门课程需要填写班型名称、开始周、每周上课日和起始节次，系统会从起始节次开始连续占用两个格子，并默认每周持续到本学期结束。开始周可以早于当前周，但系统不会补写已经开始或过去的课程记录。鼓课只能安排在学期内的非公用时段。

老师确定结课时间后，管理员选择该课程最后一次实际上课的日期；该日期仍保留鼓课，后续所有固定占用会被释放。尚未开始过的误登记课程可以直接删除，已经上过课的课程必须通过结课保留历史。单周停课不需要填写说明，设置后当周两个格子直接恢复为空白，并在正常预约开放时间到达后供社员预约；恢复上课时如果已有个人预约，管理员必须先查看联系方式完成沟通，再通过二次确认取消预约。系统会保存取消记录、操作者和原因。与社团活动冲突时不会自动删除活动，管理员需要先手动处理。

服务器会在每周一北京时间 00:00 清理前三周第一周之前的历史记录，只保留本周和此前三周的个人预约、社团活动、鼓课占用、停课例外与鼓课冲突取消审计。服务启动时也会补做清理；即使本周已按旧规则清理过，也会再次检查是否存在超出保留范围的记录。未来记录不会被清理，固定鼓课规则保留到课程删除或学期切换。

用户密码使用 `scrypt` 加盐存储，浏览器会话使用随机令牌和 `HttpOnly` Cookie。权限、预约配额和取消条件都由服务器再次检查，不能只靠修改浏览器页面绕过。

会话默认采用滑动过期策略：连续 7 天没有访问则失效；当剩余有效期不足 24 小时时，再次打开或回到网站会延长闲置有效期并轮换会话令牌。无论如何续期，一次登录最多持续 30 天，届时必须重新输入密码。三个时间值分别由 `SESSION_IDLE_TTL_DAYS`、`SESSION_RENEW_BEFORE_HOURS` 和 `SESSION_ABSOLUTE_TTL_DAYS` 配置。浏览器打开预约页面期间每小时检查一次会话，但只有进入续期窗口时才会写数据库。

## 登录与注册限流

默认限制如下，账号与 IP 采用独立配额：

| 范围 | 配额 | 超限后的冷却时间 |
| --- | --- | --- |
| 同一账号（忽略首尾空格和字母大小写） | 10 分钟内 8 次密码校验失败 | 120 秒 |
| 同一来源 IP 的登录请求 | 1 分钟内 120 次 | 60 秒 |
| 同一来源 IP 的注册请求 | 10 分钟内 30 次 | 120 秒 |

账号失败次数跨 IP 累计；密码验证成功（包括待审核账号）不计入失败次数，但仍计入 IP 请求量。并发密码校验会先占用账号配额，验证成功或服务端异常后释放该请求的占用，避免并发请求绕过限制。冷却期间重试不会延长冷却；冷却结束或统计窗口到期后自动恢复，不需要管理员解锁。账号限制不影响同一校园网出口下的其他账号；IP 配额较宽松，但达到 IP 总配额后仍会暂时影响该出口的用户，可按社团实际规模调整。

接口超限返回 HTTP `429`，包含 `Retry-After` 响应头和中文等待时间提示。计数使用 PostgreSQL 原子更新，重启和多实例部署共享限制；账号/IP 以哈希键保存，过期记录按批清理。登录和注册在读取请求体、密码计算前检查 IP 配额，请求体限制为 8 KiB。限流依赖不可用时拒绝继续认证，不绕过保护。

`.env.example` 中的 `AUTH_LOGIN_ACCOUNT_LIMIT`、`AUTH_LOGIN_IP_LIMIT`、`AUTH_REGISTER_IP_LIMIT` 和各自的 `*_COOLDOWN_SECONDS` 可调整配额与冷却秒数（正整数，最大 86400），修改后重启应用；统计窗口分别固定为 10 分钟、1 分钟和 10 分钟。

Compose 已设置 `AUTH_TRUST_PROXY=true`，Caddy 使用实际连接来源覆盖 `X-Booking-Client-IP`。应用端口不得直接暴露到公网，应用不读取客户端提供的 `X-Forwarded-For` / `X-Real-IP`。IPv6 地址按 /64 网段合并配额，IPv4 映射地址归一为 IPv4。若在 Caddy 前新增 CDN 或负载均衡，须另行配置并验证可信代理来源，否则会按上游代理 IP 合并计数；不要直接信任任意转发头。

直接使用 `pnpm dev` 时默认 `AUTH_TRUST_PROXY=false`，由于 Route Handler 无法获取可靠的连接来源，所有本地请求共享一个开发 IP 配额，账号限流仍独立生效。公网部署应使用上述代理配置。此功能用于降低暴力尝试和接口滥用，不能替代上游抗 DDoS 服务。

本次更新需先执行 `pnpm db:migrate` 创建限流表；Compose 启动时会自动迁移。`pnpm test:member` 同时覆盖限流、共享 IP、冷却、并发配额和代理头伪造测试。

## 我的预约与账号管理

登录后，首页顶部的“我的预约”会显示本周、下周的个人预约和各周剩余次数，不受下方周表翻页影响，也不包含社团活动或固定鼓课。未开始的预约可在这里确认取消；已经开始的预约继续计入该周配额。列表在预约操作后、回到窗口时及页面可见期间每分钟更新，也可手动刷新。所有时间均按北京时间计算。

右上角“账号管理”支持普通社员和鼓房管理员修改电话、微信，以及验证旧密码后设置新密码。联系方式保存后，其他已审核社员可通过预约查看更新后的信息。学号/工号、姓名和身份不在此处修改。改密成功会撤销包括当前设备在内的全部会话，需使用新密码重新登录。系统管理员仍通过服务器环境变量维护资料和密码，网页会显示对应说明。

可运行 `pnpm test:member` 验证共同练习并发加入、独占冲突、单人退出、鼓课覆盖参与者确认，以及账号资料修改、请求来源校验、个人预约隔离、取消配额恢复及改密与登录/续期并发时的会话撤销。该命令读取 `.env` 连接 PostgreSQL，要求数据库账号有创建数据库的权限；它会创建随机命名的临时测试数据库，执行迁移和测试后删除，不修改配置中的应用数据库。

忘记密码时，请联系系统管理员。系统管理员在“管理设置”的已审核账号卡片点击“重置密码”，确认后生成随机新密码，可复制并私下交给本人。旧密码和该账号的所有旧登录会话立即失效。新密码可直接正常登录，没有额外有效期、一次性限制或强制修改要求；社员可以之后在“账号管理”自行修改。重置结果关闭后不能再次查看，可重新生成。鼓房管理员不能重置他人密码，系统管理员自身密码仍由服务器配置维护。

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

至少用两个浏览器窗口同时选择同一个空白时段进行测试。使用不同账号选择共同练习时，两人均可成功；选择独自练习或同时提交共同与独自练习时，只允许一种互不冲突的占用成功。同一账号不能重复加入。

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
- 根据实际流量调整登录与注册限流，并在反向代理或上游配置额外流量防护

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

`bookings` 表通过部分唯一索引和 GiST 排斥约束保证：同一时段可以有多条共同练习记录，但不能与独自练习、社团活动或固定鼓课混用；独占时段只能有一条记录。同一账号在同一时段最多有一条个人预约。约束在数据库中执行，覆盖并发请求和管理员操作。一次请求选择的多个时段在同一事务中插入，任何冲突都会使整个请求回滚。

个人预约还会在同一数据库事务中锁定当前用户记录并检查周配额。这样即使同一账号从两台设备同时提交，也不能越过每周 2 个时段的限制。

应用层连接池用于复用数据库连接，默认每个应用进程最多使用 10 个连接。它能承受社团规模的并发访问；后续如果访问量明显增加，可以增加应用实例、调整连接池，并配合限流和监控进行容量评估。


## 管理操作记录

执行 `pnpm db:migrate` 应用 `0008_admin_audit.sql` 后，系统管理员可在管理设置中点击“管理操作记录”，分页查看成功的账号审核、身份修改、密码重置、学期设置、鼓课、活动及代他人取消预约操作。记录与业务修改在同一事务中提交，失败或回滚的业务不会产生成功记录。现有鼓课冲突审计仍保留逐人取消详情。记录不包含密码、密码哈希或会话令牌。

记录从功能启用后开始，不能补回历史操作。此表不参与预约历史的每周清理，默认长期保留且随数据库备份；部署者应按实际隐私和存储需求制定保留期限。它用于追溯，不是防数据库管理员篡改的外部审计系统。仅系统管理员能读取，网页不提供修改或删除入口。

## 自动备份与恢复验证

完整执行 `docker compose up -d --build` 会启动 `backup` 和 `backup-verify`。备份服务启动即运行一次，随后默认每 86400 秒运行；这不是固定北京时间的定时任务。使用 PostgreSQL 17 的 `pg_dump` 自定义格式导出，不在网页提供生产库覆盖恢复操作。

- `BACKUP_DIRECTORY`：宿主机备份目录，默认 `./backups`，已从 Git 和镜像构建上下文排除。
- `BACKUP_RETENTION_DAYS`：默认 14，范围 1–3650。仅在新备份恢复验证成功后清理超过保留期限的旧文件。
- `BACKUP_INTERVAL_SECONDS`：默认 86400，范围 3600–604800。
- `.dump` 是完整导出，`.sha256` 是校验文件，`.verified` 表示已成功恢复验证；没有 `.verified` 的文件不可视为已验证备份。

每份备份会校验 SHA-256，在单独的 `backup-verify` PostgreSQL 容器中新建临时数据库，完整恢复后检查核心表、预约排斥约束并读取记录数量，最后删除临时库。验证数据库只使用内存文件系统，不暴露宿主机端口；生产库仅被读取。大数据库需要为验证容器预留足够内存。验证覆盖可恢复性与基础结构，不替代完整的灾难恢复演练。

手动运行一轮（数据库和验证容器需启动）：

```bash
docker compose run --rm --no-deps --entrypoint sh backup /scripts/run.sh
```

重新验证已有文件，传入实际文件名：

```bash
docker compose run --rm --no-deps --entrypoint sh backup /scripts/verify.sh booking-YYYYMMDDTHHMMSSZ.dump
```

查看结果：

```bash
docker compose logs --tail=100 backup
docker compose ps backup
```

失败时脚本返回非零状态、输出错误并保留既有备份；后台调度会在下一个周期重试。超过一个备份周期加两小时没有成功备份时容器健康检查失败。Docker 本身不会发送通知，需要部署监控接入该健康状态；本次未配置短信或邮件告警。

备份含账号、联系方式和密码哈希，应限制备份目录权限。当前实现落地到指定宿主机目录；如服务器磁盘损坏，同机备份也可能丢失。正式上线应将 `BACKUP_DIRECTORY` 指向受控的异地备份挂载，或通过现有加密备份系统同步到异地。本仓库不假定任何云存储账号，也没有自动配置异地上传。

实际灾难恢复时，先停止应用写入，将选定备份恢复到新数据库，核对数据后再切换应用连接。不要直接对正在服务的数据库使用 `pg_restore --clean`。建议定期在隔离部署中验证登录、预约及管理员操作；恢复旧备份后还应撤销旧会话，再执行待应用迁移后开放服务。

## 数据库故障后的手动恢复

自动恢复验证只证明备份可以恢复，不会自动替换生产数据库。实际恢复由管理员执行。以下命令适用于仓库自带的 Docker Compose / PostgreSQL 17 部署，在项目目录使用同一个终端依次执行；任何一步报错都应停止，不要继续启动网站。外部托管数据库需要按对应服务的连接及恢复方式处理。

恢复只能回到所选备份的时间点，之后的预约、账号修改和操作记录不会自动找回。默认每天备份一次，在任务持续正常运行的情况下，可能丢失最近约一天的数据；应以最后一份成功备份的实际时间为准。

### 情况一：PostgreSQL 能启动，应用数据库需要恢复

**1. 停止网站写入和自动备份。**

```bash
docker compose stop app backup
docker compose up -d db backup-verify
docker compose ps db backup-verify
```

等待两个数据库服务均显示 `healthy`。如有其他应用实例或本机开发服务连接同一数据库，也应停止。先另存 `.env` 和选定备份，不删除原数据库或数据卷，尤其不要执行 `docker compose down -v`。

**2. 选择备份并重新验证。**

在 `BACKUP_DIRECTORY` 指定的目录（默认 `./backups`）中选择目标时间点的备份，确认 `.dump`、`.dump.sha256`、`.dump.verified` 三个文件齐全。文件名时间为 UTC，北京时间加 8 小时。误操作恢复应选择误操作发生之前的备份，而非简单选择最新文件。

将下面的示例文件名替换为实际文件名：

```bash
RESTORE_FILE=booking-20260911T015637Z.dump
RESTORE_DIRECTORY=./backups

docker compose run --rm --no-deps --entrypoint sh \
  backup /scripts/verify.sh "$RESTORE_FILE"
```

此命令在独立验证容器中恢复，验证完成会清理临时数据库；它不会恢复网站使用的数据库。只有命令成功退出且重新生成 `.verified` 标记后才能继续。

**3. 将备份恢复到一个全新的数据库。**

以下统一使用 `drum_room_recovered`。如果这个名字已经存在，请换一个尚未使用的名字，并同步替换后续命令和 `.env` 中的名称。不要为了重试而删除原业务数据库。

```bash
docker compose exec -T db sh -c \
  'createdb -U "$POSTGRES_USER" --template=template0 drum_room_recovered'

docker compose exec -T db sh -c \
  'pg_restore -U "$POSTGRES_USER" --dbname=drum_room_recovered \
    --no-owner --no-acl --exit-on-error --single-transaction' \
  < "$RESTORE_DIRECTORY/$RESTORE_FILE"
```

第二条命令从挂载的备份目录读取文件，在生产 PostgreSQL 实例中的新数据库恢复。单事务模式在发生错误时回滚本次导入；原数据库不被覆盖。若失败，排查后使用另一个新的数据库名重试。

**4. 撤销旧会话并检查基础数据。**

```bash
docker compose exec -T db sh \
  -c 'psql -U "$POSTGRES_USER" -X -v ON_ERROR_STOP=1 -d drum_room_recovered \
    -c "DELETE FROM sessions;" \
    -c "SELECT count(*) AS users FROM users;" \
    -c "SELECT count(*) AS bookings FROM bookings;" \
    -c "SELECT count(*) AS audit_records FROM admin_audit_logs;"'
```

人数及预约数量应符合所选备份的预期。清除会话后所有人需要重新登录；社员密码、审核状态及管理员身份也会回到备份时的状态，开放网站前需要核对近期权限调整。系统管理员账号仍由部署环境变量同步。

**5. 切换连接并执行迁移。**

在 `.env` 中只修改数据库名，保持现有数据库用户名及密码不变：

```dotenv
POSTGRES_DB=drum_room_recovered
```

已有数据卷不会因为修改这个变量而自动创建数据库，因此必须先完成上面的建库和导入步骤。使用与当前代码匹配的迁移镜像：

```bash
docker compose build migrate app
docker compose run --rm --no-deps migrate
```

迁移成功后启动网站和代理，更新数据库服务的健康检查配置：

```bash
docker compose up -d db app caddy
```

**6. 验收并恢复自动备份。**

检查登录、社员名单、预约表、共同练习人数、个人额度、固定鼓课和管理操作记录。确认使用的是恢复后的数据，处理备份时间点之后需要重新登记的变更，再启动备份：

```bash
docker compose up -d backup
docker compose logs --tail=100 backup
```

确认日志出现 `backup and restore verification succeeded`，并且新备份文件生成。备份服务此后使用新的 `POSTGRES_DB`。原数据库先保留，待人工确认恢复稳定后再按运维保留策略处理。

### 情况二：PostgreSQL 无法启动，或服务器／数据卷损坏

不要反复删除或初始化原数据卷。先保留故障卷或磁盘快照，使用独立的新服务器部署；若需要在同机使用新卷，应先由运维确认 Compose 项目名、卷和端口完全隔离。

在新服务器上：

1. 准备本仓库代码、Docker Compose 和部署 `.env`，配置新的数据库凭据和正确的域名。此时不要启动完整服务栈。
2. 从异地副本取回选定备份及对应 `.sha256` 文件，已有 `.verified` 文件也一并复制到 `BACKUP_DIRECTORY`，保留原文件名并限制目录权限。容器内路径仍为 `/backups`，校验文件中的路径无需手动修改。
3. 仅运行 `docker compose up -d db backup-verify`，等待健康状态正常，先不运行迁移或应用。
4. 按“情况一”的第 2–6 步完成重新验证、恢复到新库、撤销会话、迁移及验收。
5. 验收通过后再将域名流量切换到新服务器，确认 HTTPS 和自动备份正常。

如果原服务器磁盘和同机备份一并丢失，且没有异地副本，就无法依靠本功能找回数据。代码仓库不包含数据库备份或部署密钥，正式上线前应单独保管这两类资料。

## 数据库最小权限与请求保护

Compose 的 `app` 使用 `booking_app`，只获得业务表必要的读写权限，不能建表、删表或管理数据库角色。`admin_audit_logs` 只允许追加和读取，不允许更新、删除或清空；迁移账本 `_app_migrations` 不对网站开放。网站账号设置查询超时 30 秒、锁等待 5 秒及空闲事务超时 30 秒。普通业务数据仍可被该账号修改，因此权限隔离不能替代接口鉴权和备份。

`migrate` 继续使用部署维护账号 `POSTGRES_USER`，高权限凭据不会注入网站容器。每次迁移成功后执行 `scripts/database-roles.mjs`，为现有数据库幂等配置角色和授权，无需重建数据卷。业务表由维护账号拥有，不要将表所有权转给网站账号。脚本会移除这两个专用角色已有的角色成员资格，请勿将它们用作其他应用的共享账号。

生产备份使用只读账号 `booking_backup`。独立验证实例使用 `backup_verifier` 及独立密码，允许在该实例建立和删除临时恢复数据库。生产恢复必须使用维护账号；上面的手动恢复命令已改为通过 `db` 服务执行，不能再用只读 `backup` 账号建库。请将恢复步骤的 `RESTORE_DIRECTORY` 设置为实际 `BACKUP_DIRECTORY` 路径，导入通过宿主机标准输入传递备份文件。备份不包含数据库角色密码和授权，恢复后必须执行迁移重新授权。

升级现有部署时：

1. 在 `.env` 设置不同的 `APP_DB_PASSWORD`、`BACKUP_DB_PASSWORD`、`VERIFY_DB_PASSWORD`，每个使用至少 24 字符的随机密码，不得复用 `POSTGRES_PASSWORD`。可分别运行 `openssl rand -hex 32` 生成并妥善保存，不提交到 Git。
2. 设置 `APP_ORIGINS` 为实际网站完整来源，例如 `https://booking.example.com`，不带路径或末尾斜杠，多个来源用逗号分隔。本机示例为 `http://localhost,http://127.0.0.1,http://localhost:3000,http://127.0.0.1:3000`，局域网访问须额外添加实际来源。生产不要保留不使用的来源。
3. 停止旧应用和备份，运行 `docker compose build migrate app`，再执行 `docker compose run --rm --no-deps migrate`（数据库需运行）。成功后执行 `docker compose up -d` 重建服务，使新账号和代理配置生效。
4. 检查登录、预约、管理日志及备份恢复验证。轮换专用账号密码也按上述顺序执行，重启应用以关闭旧连接。

本机 `pnpm dev` 在未显式设置 `PGUSER` / `PGPASSWORD` 或 `DATABASE_URL` 时，会优先使用 `APP_DB_PASSWORD` 对应的 `booking_app`。迁移命令仍从维护账号配置连接。外部数据库或显式连接字符串应自行配置为相应用途的账号。没有两项专用密码的旧本机配置仍可迁移，但不会配置权限隔离；Compose 部署强制要求填写。集成测试使用有建库权限的维护账号创建临时数据库。

请求保护规则：

- 所有 JSON 写接口使用流式大小检查：普通表单最多 8 KiB，鼓课接口最多 64 KiB；无论是否提供正确的 `Content-Length` 都执行限制。数组、`null` 和非法 JSON 返回 400，超大请求返回 413。
- 除既有登录／注册限流外，业务写操作按账号每分钟 60 次；账号资料／改密和管理员重置密码共用账号每 10 分钟 10 次配额。`WRITE_ACCOUNT_LIMIT`、`WRITE_CREDENTIAL_LIMIT` 可调整，达到上限冷却 60 秒。读取列表和页面自动刷新不计入写配额。
- 可信代理模式下所有业务写入再共用较宽松的 IP 配额，默认每分钟 600 次，`WRITE_IP_LIMIT` 可调整，适合校园网共享出口。返回 429 和 `Retry-After`；限流存储不可用时写接口返回 503，不绕过保护。
- 生产来源校验使用 `APP_ORIGINS` 精确匹配协议、主机及端口，不使用客户端传来的 `X-Forwarded-Host`。可信代理模式未配置来源时拒绝写入；非代理本地模式未配置来源时匹配请求 URL 的完整来源。应用端口不可直接暴露公网，Caddy 必须覆盖 `X-Booking-Client-IP`。
- Caddy 对请求体统一限制 64 KiB，请求头读取超时 10 秒、请求体读取超时 30 秒。Next 响应添加禁止嵌入、禁止类型猜测、来源信息策略，以及 `frame-ancestors`、`object-src`、`base-uri` 限制；尚未启用可能影响 Next 内联脚本的严格 `script-src` 策略。

这些措施缓解应用层资源滥用，不能抵御超过服务器带宽的大流量攻击，上游防护需要单独部署。
