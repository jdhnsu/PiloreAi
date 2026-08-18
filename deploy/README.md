# PiLore 容器部署说明

本文档说明如何在 Docker 环境中部署 PiLore、PostgreSQL 和 codapi-dind，并在离线环境中恢复镜像与数据。

## 1. 适用场景

本部署包含 3 个核心服务：

- `postgres:16`：用于持久化 PiLore 会话与认证数据
- `codapi-dind:latest`：为代码执行服务提供沙箱环境
- `pilore-edu-agent:latest`：PiLore Web 入口

对应部署文件：

- [deploy/docker-compose.yml](docker-compose.yml)

## 2. 环境变量与覆盖规则

`docker compose` 在读取环境变量时，顺序通常是：

1. `env_file` 读取默认值
2. `environment` 中显式变量覆盖同名值

也就是说：

- `.env` 是默认配置源
- `docker-compose.yml` 中的 `environment:` 会覆盖 `.env` 中同名变量
- 这是正常行为，部署时应明确写清楚要覆盖的字段

特别注意：

- `DB_HOST=postgres`：容器内必须使用服务名，不要写 `127.0.0.1`
- `EXEC_API_BASE=http://codapi-dind:1313`：容器内访问另一个服务时必须使用服务名
- `FAUX_DEMO=0`：启用真实模式
- `BETA_USERS_FILE=/app/data/beta-users.json`：在容器中指向挂载数据目录

## 3. 镜像导出

已将需要使用到的镜像全部导出到 [out](../out) 目录：

- [out/codapi-dind.tar](../out/codapi-dind.tar)
- [out/postgres-16.tar](../out/postgres-16.tar)
- [out/pilore-edu-agent.tar](../out/pilore-edu-agent.tar)

导出命令：

```bash
cd /home/jdh/developmentSpace/docker/PiloreAi
mkdir -p out

docker save -o out/pilore-edu-agent.tar pilore-edu-agent:latest
docker save -o out/postgres-16.tar postgres:16
docker save -o out/codapi-dind.tar codapi-dind:latest
```

离线恢复命令：

```bash
docker load -i out/pilore-edu-agent.tar
docker load -i out/postgres-16.tar
docker load -i out/codapi-dind.tar
```

## 4. 先决条件

在启动前，请确认：

- Docker 已安装并运行
- 项目已存在 [Dockerfile](../Dockerfile)
- 已生成注册表文件（真实模式需要）
- `.env` 中包含必要配置

### 生成邀请码注册表

如果你使用真实模式（非演示模式），需要先生成 beta 用户代码：

```bash
cd /home/jdh/developmentSpace/docker/PiloreAi
npm run gen:beta-codes
```

这会生成：

- `data/beta-users.json`

注意：

- 这个文件要保存在容器持久化卷中
- 若文件不存在，PiLore 会在启动时直接退出

## 5. 启动部署

在项目根目录执行：

```bash
cd /home/jdh/developmentSpace/docker/PiloreAi
docker compose -f deploy/docker-compose.yml up -d
```

查看状态：

```bash
docker compose -f deploy/docker-compose.yml ps
docker logs -f pilore
```

检查页面：

```bash
curl -I http://localhost:9600/
```

如果返回 HTTP 200，说明 Web 服务正常。

## 6. 持久化说明

当前 compose 中已经为核心数据添加了 Docker Volume：

- `postgres-data`：PostgreSQL 数据目录
- `pilore-data`：PiLore 的 `/app/data` 目录，用来存放注册表

配置如下：

```yaml
volumes:
  - postgres-data:/var/lib/postgresql/data
  - pilore-data:/app/data
```

这意味着：

- 容器重建后数据不会丢失
- 仅删除容器不会丢失数据库和注册表
- 如需彻底清空数据，需要执行 `docker volume rm ...`

## 7. 数据目录说明

PiLore 在真实模式下依赖以下路径：

- `/app/data/beta-users.json`：邀请码注册表
- `/app/migrations`：数据库迁移脚本（只读挂载）

这些目录在 compose 中已经映射好了。

## 8. 关键注意事项

### 8.1 不能直接写 `127.0.0.1` 给容器内服务

在容器内部，`localhost` 指向自己，不能访问其他服务。必须使用 Compose 服务名：

```text
postgres
codapi-dind
```

### 8.2 容器启动依赖顺序

`pilore` 依赖：

- `postgres` 健康检查通过
- `codapi-dind` 启动

如果数据库没有准备好，PiLore 可能启动失败或回退内存模式。

### 8.3 真正模式需要数据库与注册表

如果 `FAUX_DEMO=0`，则需要：

- 数据库可连接
- `SESSION_ENCRYPTION_KEY` 合法
- `AUTH_SECRET` 合法
- `BETA_USERS_FILE` 可访问

否则容器会退出。

### 8.4 .env 不一定是最终生效值

因为 `docker-compose.yml` 中的 `environment` 会覆盖 `env_file`，所以如果启动时看起来 `.env` 没生效，先检查：

```bash
docker compose -f deploy/docker-compose.yml config
```

这个命令会输出最终展开后的配置，最适合排查覆盖问题。

### 8.5 生产环境不要硬编码敏感数据

当前文件中有以下敏感配置：

- 数据库密码
- `AUTH_SECRET`
- `SESSION_ENCRYPTION_KEY`
- API Key

建议生产部署时：

- 使用 `.env` 或宿主机 secret
- 不要直接提交到 Git
- 使用更安全的 secret 管理方案

## 9. 关闭/重启

停止：

```bash
docker compose -f deploy/docker-compose.yml down
```

重启：

```bash
docker compose -f deploy/docker-compose.yml restart
```

如果只想重建容器而保留数据：

```bash
docker compose -f deploy/docker-compose.yml up -d --force-recreate
```

## 10. 清理数据

注意：以下操作会删除持久化数据。

```bash
docker volume rm deploy_postgres-data deploy_pilore-data
```

或者直接：

```bash
docker compose -f deploy/docker-compose.yml down -v
```

## 11. 常见问题排查

### 页面打不开

检查：

```bash
docker ps -a
docker logs pilore
```

重点看：

- Postgres 不可用
- 未找到注册表
- API key 缺失
- 数据库密码不匹配

### 访问 codapi 不成功

检查：

```bash
docker logs codapi-dind
curl http://localhost:1313/health
```

### PostgreSQL 连不上

检查：

```bash
docker logs pilore-postgres
```

并确认：

- `POSTGRES_DB=pilore`
- `POSTGRES_USER=pilore`
- `POSTGRES_PASSWORD=pilorepass`
- `DB_HOST=postgres`

## 12. 推荐部署流程

最稳妥的顺序如下：

1. 确认镜像已本地存在或已 load
2. 生成邀请码文件
3. 配置 `.env` / 运行环境变量
4. 运行 `docker compose up -d`
5. 查看 logs
6. 访问 `http://localhost:9600`
7. 若需要离线迁移，直接使用 [out](../out) 下的 tar 包

## 13. 结论

这套部署方案已具备：

- 可重复部署
- 服务间网络正确
- 数据卷持久化
- 离线镜像导出
- 可恢复的容器编排

如果需要，我可以继续为你补一份“生产版 docker-compose + .env.example”版本，把所有敏感项剥离出来，并做成更安全的部署模板。
