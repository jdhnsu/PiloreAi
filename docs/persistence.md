# 持久化与 PostgreSQL

PiLore 将 Agent Session 的可恢复状态表示为 `SessionSnapshotV1`，将持久化策略抽象为 `SessionStore`。Core 不依赖数据库；Web Adapter 在配置完整时选择 PostgreSQL 加密存储，否则回退到进程内内存存储。

## SessionStore 契约

```ts
interface SessionStore {
  create(input: CreateStoredSession): Promise<StoredSession>;
  load(sessionId: string): Promise<StoredSession | undefined>;
  list(identity: SessionIdentity): Promise<SessionSummary[]>;
  beginRun(input: BeginRunInput): Promise<StoredRun>;
  completeRun(input: CompleteRunInput): Promise<StoredSession>;
  failRun(input: FailRunInput): Promise<void>;
  delete(sessionId: string): Promise<void>;
  // 登录用户显示名（内测归因）；displayName 为 null 时保留原值
  upsertUser(userId: string, displayName: string | null): Promise<void>;
  getUserDisplayName(userId: string): Promise<string | null>;
}
```

身份由 `{ tenantId, userId, courseId? }` 构成。Web Adapter 将登录用户映射为 `{ tenantId: "web", userId: <登录用户>, courseId: packId }`（演示模式固定 `userId: "local"`），使不同用户、不同 Pack 的会话列表天然隔离。生产宿主应映射为自己的多租户与用户身份，避免把未校验的客户端标识直接写入存储。

## 运行与 revision 语义

`revision` 是乐观并发控制版本，初始为 0。`activeRunId` 是单会话互斥锁。标准流程：

```text
create(snapshot revision=0)
        │
beginRun(sessionId, expectedRevision=N)
        │  锁定会话；记录 running run；写入 activeRunId
        ▼
Session.prompt(...)
   ├─ 正常：completeRun(... expectedRevision=N, snapshot)
   │        原子保存 revision=N+1 的 snapshot、完成 run、清空 activeRunId
   └─ 失败：failRun(...)
            标记 failed、记录错误、清空 activeRunId；snapshot 与 revision 不变
```

`beginRun()` 在以下情况拒绝请求：会话不存在、`expectedRevision` 不等于当前 revision、会话已有活动运行。`completeRun()` 还要求传入的 `runId` 必须就是当前 `activeRunId`。因此，调用方必须缓存每个已加载会话的 revision，并在完成后用返回的 `StoredSession.revision` 更新缓存。

Web Adapter 体现了这个流程：它在发送 SSE 前占用会话，把可显示的输入/输出/工具结果作为审计数据，随后根据 `SessionEvent.done` 选择完成或失败路径。

## 内存实现

`InMemorySessionStore` 用于演示、测试和未配置数据库时的回退：

- 与 PostgreSQL 实现保持相同的 revision、互斥、标题派生和删除语义；
- 对 Snapshot 做深拷贝，防止调用方通过对象引用修改已存数据；
- 进程退出后所有会话与运行记录都会丢失；
- `list()` 最多返回 100 条，按 `updatedAt` 倒序。

创建方式：

```ts
import { createInMemorySessionStore } from "./src/index.js";

const store = createInMemorySessionStore();
```

## PostgreSQL 实现

`PostgresSessionStore` 保存加密后的 Snapshot 与运行审计数据。构造时必须提供 `pg.Pool` 和 `CryptoProvider`：

```ts
import { Pool } from "pg";
import {
  applyPostgresMigrations,
  createAes256GcmCryptoProvider,
  createPostgresSessionStore,
} from "./src/index.js";

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: false, // 按部署平台替换为正确 TLS 配置
});

await applyPostgresMigrations(pool);

const store = createPostgresSessionStore({
  pool,
  crypto: createAes256GcmCryptoProvider({
    primaryKeyId: "primary-2026",
    keys: { "primary-2026": keyBytes }, // 必须是 32 字节
  }),
});
```

`applyPostgresMigrations()` 默认使用 `pilore` schema，也可传 `{ schema: "my_schema" }` 做测试隔离或同库多 Runtime 部署。schema 名只接受字母、数字和下划线，避免标识符注入。

### 表结构

迁移定义以 `POSTGRES_MIGRATION_001/002/003` 常量随代码发布（`migrations/001_session_persistence.sql` 是 001 的参考副本），由 `applyPostgresMigrations()` 按版本顺序应用。当前包含：

| 表 | 作用 |
| --- | --- |
| `pilore.schema_migrations` | 已执行迁移版本 |
| `pilore.sessions` | 身份、标题、revision、加密 Snapshot、活动运行、时间戳 |
| `pilore.runs` | 每轮 provider/model/Profile、加密审计、指标、失败码和时间戳 |
| `pilore.trajectory_runs` | 每轮运行轨迹（加密），级联删除 |
| `pilore.users` | 登录用户显示名与首末次登录时间（内测归因，migration 003） |

`sessions_identity_idx (tenant_id, user_id, course_id)` 支持按身份列会话；`runs_session_started_idx (session_id, started_at DESC)` 支持会话运行历史。

数据库中的 `persona_key` 是历史字段名，对应公开 API 的 `profileKey`。新代码应使用 `profileKey` 这一术语。

## 加密与密钥轮换

内置 `createAes256GcmCryptoProvider()` 使用 AES-256-GCM：

- 每次加密生成 12 字节随机 nonce；
- 密文末尾含 GCM 认证标签；
- AAD 绑定 `tenantId`、`sessionId`、`revision`、Snapshot schema 版本与用途（`snapshot` 或 `run`）；
- 数据被替换、跨会话复制、revision 不匹配、密钥不匹配或密文被篡改时，解密会失败；
- `keyId` 随密文保存，因此提供旧 key 即可读取旧数据，同时把 `primaryKeyId` 切换到新 key 完成渐进式轮换。

Web Adapter 仅在设置 `DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME` 且 `SESSION_ENCRYPTION_KEY` 为 64 位十六进制（32 字节）时启用 PostgreSQL。否则它明确回退内存存储。生产部署建议以 KMS / Vault 实现自己的 `CryptoProvider`，不要把长期密钥硬编码或提交到仓库。

## 审计与指标

`RunAuditPayload` 当前可保存输入、输出和工具结果摘要；Web Adapter 会限制输出至 8,000 字符、每个工具结果至 2,000 字符。`RunMetrics` 是可扩展的 JSON 指标对象，可存耗时、token 用量或应用指标。

审计内容可能包含学习者数据。宿主应在接入前定义保留期、访问控制、删除流程、日志脱敏和合规边界。`delete(sessionId)` 删除 session 时，PostgreSQL 的外键会级联删除其 runs。

## 自定义存储实现

可实现 `SessionStore` 接入其他数据库。实现必须保留以下行为：

- 创建只接受 `snapshot.version === 1` 且 `revision === 0`；
- 读取返回独立副本，不能泄露可修改的内部 Snapshot 引用；
- begin/complete/fail 对同一会话的状态转换具备原子性；
- revision 冲突、活动运行和不存在会话使用对应的公开错误类型；
- 完成时以存储端计算的 `revision + 1` 覆盖传入 Snapshot revision；
- 标题从 Snapshot 的第一条用户文字消息派生，仅在标题为空时写入。

相应的确定性测试在 `tests/unit/memory-store.test.ts`，PostgreSQL 集成测试在 `tests/integration/postgres-store.test.ts`。
