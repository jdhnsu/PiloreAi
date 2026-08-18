# Adapters 与 HTTP API

Adapter 是 PiLore 的产品边界。它负责把外部输入转为 Pack Session 调用、把 `SessionEvent` 转为终端或网络协议、选择存储实现并建立宿主身份；它不应包含 Pack 的教学逻辑或直接深层导入内部模块（唯一例外：Web 的 faux demo 模式引用 `mock/exec-server.ts` 作为进程内模拟执行后端）。

## CLI Adapter

入口为 `src/adapters/cli/index.ts`，运行：

```bash
npm run chat
npm run chat:english
npm run chat:math
npm run chat:physics
npm run chat:history
```

CLI 在 `PACKS` 注册表中维护 Pack id、显示名、Profile 帮助和会话工厂。默认 Pack 是 `code`；也可用 `npm run chat -- --pack math` 或 `--pack=math` 选择。`--list` 和 `--help` 输出可用 Pack。

交互命令：

| 命令 | 行为 |
| --- | --- |
| `/help` | 显示可用 Profile 与 CLI 命令 |
| `/abort` | 中止当前 Agent 运行 |
| `/quit` | 关闭终端会话 |
| `@profile 问题` | 在本次输入前选择 Profile |
| `@pilore 问题` | 切回自动 Profile 路由 |

CLI 是无持久化入口：进程退出后 Session 状态不会保存。需要会话列表、恢复和并发控制时使用 Web Adapter 的存储模式，或自行嵌入 `SessionStore`。

## Web Adapter

入口为 `src/adapters/web/index.ts`，运行：

```bash
npm run web        # 真实模型；模型配置来自环境
npm run web:demo   # fauxProvider + 进程内 mock；无需 API key
```

它提供静态 Web UI、HTTP API 和 SSE 对话流。启动时：

1. 注册 Code、English、Math、Physics、History Pack；
2. 在真实模式下，若数据库与加密配置完整则初始化 PostgreSQL，否则回退进程内存储；
3. 在演示模式下总是使用内存存储，且按 Pack 注入无网络的脚本化 faux 模型；
4. 默认尝试端口 9600 起的 20 个端口；显式设置 `WEB_PORT` 时只使用该端口。

## 内测登录与会话隔离

真实模式（非 `FAUX_DEMO=1`）要求先用一次性邀请码注册，再用邮箱密码登录；`FAUX_DEMO` 演示模式保持免登录：

- 注册表：`BETA_USERS_FILE`（默认 `data/beta-users.json`，已 gitignore）。用 `npm run gen:beta-codes [count] [prefix]` 生成：明文邀请码只打印一次，文件里只存 SHA-256 哈希。邀请码只用于首次注册，成功后写入 `pilore.invite_codes`，不能再次使用。
- 注册：`POST /api/register { code, email, password, name? }`；密码要求 8-128 个字符，服务端使用 Node `scrypt` 加盐哈希，注册成功后自动登录。
- 登录：`POST /api/login { email, password }`；邮箱统一转小写，服务端只保存邮箱和密码哈希，不保存明文密码。
- 吊销：删除 `beta-users.json` 中尚未使用的邀请码；已经注册的用户需要后续增加账户禁用机制，不能通过删除注册表行撤销邮箱密码登录。
- Cookie 密钥：`AUTH_SECRET`（≥32 字符）。未设置时随机生成并在日志告警（重启后所有用户需重新登录）。
- Cookie：`pilore_auth`，HMAC-SHA256 签名、`HttpOnly`、`SameSite=Lax`、30 天有效；请求经 `x-forwarded-proto: https`、TLS 直连或显式 `WEB_COOKIE_SECURE=1` 时附加 `Secure`。生产部署在 HTTPS 反代后应显式设置 `WEB_COOKIE_SECURE=1`。
- 限流：同一来源（反代后取 `X-Forwarded-For` 首跳）每分钟最多 5 次失败登录，超出返回 429。
- 门禁：未认证访问 `/api/*` 返回 401，访问页面 302 到 `/login.html`（登录页自包含，不依赖其他静态资源）。

会话身份映射为 `{ tenantId: "web", userId: <登录用户>, courseId: packId }`（演示模式固定 `userId: "local"`）。所有按 sessionId 访问的端点都会校验会话属主，跨用户访问一律按 404 处理（不泄露会话存在性）；`GET /api/sessions` 天然只列出自己的会话。

用户首次登录可自填昵称，存入 `pilore.users` 表（见[持久化](persistence.md)）。管理员归因查询示例：

```sql
-- 每个内测用户的会话数与最近活跃
SELECT s.user_id, u.display_name, COUNT(*) AS sessions, MAX(s.updated_at) AS last_active
FROM pilore.sessions s LEFT JOIN pilore.users u ON u.user_id = s.user_id
GROUP BY s.user_id, u.display_name ORDER BY last_active DESC;

-- 某个用户的每轮对话审计（run 按会话关联）
SELECT r.started_at, r.provider_id, r.model_id, r.status
FROM pilore.runs r JOIN pilore.sessions s ON s.id = r.session_id
WHERE s.user_id = 'beta-01' ORDER BY r.started_at DESC;
```

单会话的运行轨迹也可用 `GET /api/trajectory?id=<sessionId>` 逐会话查看。

## HTTP API

### Pack 与会话

| 方法与路径 | 请求 | 响应/行为 |
| --- | --- | --- |
| `POST /api/register` | `{ "code", "email", "password", "name?" }` | 核销一次性邀请码并创建账号，成功设置登录 Cookie；邀请码已使用 409，邮箱已注册 409 |
| `POST /api/login` | `{ "email", "password" }` | 校验邮箱密码并设置登录 Cookie；错误码 401，限流 429 |
| `POST /api/logout` | — | 清除登录 Cookie |
| `GET /api/me` | — | 当前登录用户 `{ userId, displayName }`；未登录 401 |
| `GET /api/packs` | — | Pack id、名称、提示语、侧栏标题、推荐问题、Profile 目录 |
| `GET /api/sessions?pack=<id>` | — | 某 Pack 的会话摘要与存储类型 |
| `POST /api/sessions` | `{ "pack": "math" }` | 创建空会话；默认 `code` |
| `DELETE /api/sessions?id=<id>` | — | 删除会话；运行中返回 409 |
| `GET /api/sessions/history?id=<id>` | — | 用于 UI 的 user / assistant 纯文本历史 |
| `GET /api/state?id=<id>` | — | busy、Pack、Profile、模型、demo、存储与 Profile 列表 |
| `GET /api/panel?id=<id>` | — | Pack 侧栏投影 |
| `GET /api/trajectory?id=<id>` | — | 按轮次组织的运行轨迹（`{ sessionId, pack, runs }`，详见 [轨迹](trajectory.md)）；会话不存在 404 |

侧栏投影：Code 返回 `{ kind: "files", files }`；English 返回 `{ kind: "vocabulary", words }`；大学学科 Pack 返回 `{ kind: "study_cards", cards }`。

### 控制与对话

| 方法与路径 | 请求 | 响应/行为 |
| --- | --- | --- |
| `POST /api/profile` | `{ "sessionId", "profile": "key" \| null }` | 选择 Profile 或自动路由；不存在 Profile 返回 400 |
| `POST /api/abort` | `{ "sessionId" }` | 中止已加载会话的当前 Agent 运行 |
| `POST /api/chat` | `{ "sessionId", "message" }` | `text/event-stream`；整个回合由 SessionStore 审计和持久化 |

`/api/chat` 的每条 SSE 消息格式为：

```text
data: {"type":"text_delta","delta":"..."}

```

客户端需要按 SSE 标准逐条解析 JSON。可能事件见 [Core](core.md) 的 `SessionEvent`。HTTP 层的输入限制：请求 body 最多 1 MB，`message` 不能为空；会话不存在为 404，运行冲突或 revision 冲突为 409。

## 静态文件边界

Web Adapter 只从仓库 `web/` 目录服务静态资源。请求路径先经 `path.resolve()` 规范化，再检查其仍位于 `WEB_ROOT` 内，阻止 `../` 路径穿越。当前 MIME 映射覆盖 `.html`、`.js`、`.css` 和 `.svg`。

## 增加一个 Adapter

新 Adapter 应：

1. 仅从 `src/index.ts` 导入公共 API；
2. 选择或接收 Pack 工厂，创建每用户 / 每会话独立的 Session；
3. 把 `SessionEvent` 无损映射到自己的协议；
4. 在运行前后按 [持久化与 PostgreSQL](persistence.md) 的 `beginRun` / `completeRun` / `failRun` 语义管理持久化；
5. 对身份、输入长度、存储错误和客户端断开制定明确策略；
6. 不把领域工具、Prompt、Profile 或领域 Snapshot 解析复制到 Adapter 中。

Web Adapter 是参考实现，尤其展示了 SSE、客户端断开时 `abort()`、revision 缓存和 Pack 侧栏投影。
