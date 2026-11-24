# Orbit 用户管理

React + TypeScript 前端、Python FastAPI 后端、PostgreSQL 17 数据库。前后端使用同源部署，由一个应用镜像提供页面和 API。

## 构建和启动

需要 Docker（含 Compose）和 Make。

```sh
cp .env.example .env
make build
make up
```

访问 http://localhost:8080 。本地默认管理员：`admin` / `Admin@123456`，可在 `.env` 中配置。默认导入 8 位虚构演示用户。`SEED_DEMO=false` 可在数据库首次启动前关闭演示数据；修改后不会清除已有数据。

`make build` 实际执行 `docker build`，生成 `orbit-user-management:latest` 应用镜像。PostgreSQL 使用独立的官方镜像。`make save` 将应用镜像导出为当前目录的 `orbit-user-management.tar`。支持 `make build IMAGE_NAME=my-app IMAGE_TAG=1.0.0`；启动时使用相同变量。

```sh
make logs      # 查看服务日志
make down      # 停止服务，保留数据库
make test      # 对运行中的服务执行集成测试（需要 Python 3）
```

端口冲突时，在 `.env` 设置 `APP_PORT=8081`。运行测试时相应使用 `TEST_URL=http://localhost:8081 make test`。如更改了登录凭据，测试时通过环境变量传入 `ADMIN_USERNAME`、`ADMIN_PASSWORD`；Make 不会自动加载 `.env`。集成测试会创建并清理测试用户，操作日志会保留。

## 功能

- 管理员登录、退出、8 小时有效的服务端会话、登录限流。
- 用户新增、编辑、删除，姓名/邮箱/部门搜索，角色与状态筛选。
- 用户分页、启用/停用、批量操作，删除前确认。
- CSV 导出当前筛选下的全部数据，UTF-8 BOM 与表格公式转义。
- 工作台实时统计、操作日志分页、中文响应式界面。
- 邮箱唯一约束、参数校验、SQL 参数化、健康检查。

用户角色是此版本的成员资料分类（管理员、普通成员、只读成员）；后台登录使用独立的环境变量管理员账号，目录用户不拥有登录密码。修改目录用户角色或状态不影响后台管理员登录。

## 项目结构

```text
backend/app.py          API、数据库初始化、登录会话、静态页面服务
backend/tests/          真实 PostgreSQL 服务的 HTTP 集成测试
frontend/src/           React 页面与样式
Dockerfile              Node 构建前端 + Python 运行服务
compose.yaml            应用、PostgreSQL、持久化数据卷
Makefile                镜像构建、启动、测试、导出入口
```

数据库首次启动自动创建表、唯一索引，所有时间以 PostgreSQL TIMESTAMPTZ 存储；界面按浏览器本地时区显示，本月新增按数据库时区（默认 UTC）统计。`pgdata` 数据卷保存用户、会话及日志。`make down` 保留数据，重新构建镜像不影响数据库。已有数据卷的 PostgreSQL 账号密码不会因修改环境变量自动变更。

## 本地开发

```sh
# 终端一：数据库和 Python
# 本地开发时需为 PostgreSQL 配置本地可访问端口，或连接已有 PostgreSQL
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
export DATABASE_URL='postgresql://useradmin:your_password@localhost:5432/useradmin'
.venv/bin/uvicorn backend.app:app --reload --port 8080

# 终端二：React，Vite 将 /api 代理到 8080
cd frontend
npm ci
npm run dev
```

API 文档：http://localhost:8080/docs 。`GET /api/health` 检查 PostgreSQL；其他管理接口需要登录 Cookie。React 开发模式请使用 Vite 页面登录，以保持同源。

## 部署配置

默认仅绑定 `127.0.0.1:8080`，数据库不发布宿主机端口。对外部署时设置强管理员和数据库密码，关闭演示数据，在 HTTPS 反向代理后设置 `COOKIE_SECURE=true`。如需直接发布应用端口，可配置 `BIND_ADDRESS=0.0.0.0`。环境变量数据库密码出现在连接 URL 中，特殊字符应使用 URL 百分号编码（或直接为应用提供编码后的 `DATABASE_URL`）。

应用默认不信任代理头。反向代理应保留 Host；HTTPS 代理部署时应配置 uvicorn 仅信任代理 IP（`--proxy-headers --forwarded-allow-ips=<代理IP>`），使 Origin 校验能使用真实协议。当前版本适用于单工作空间用户资料管理；暂不包含多租户、个人登录及细粒度 RBAC。

## GitHub Actions 推送到腾讯云镜像仓库

`.github/workflows/tencent.yml` 在 `main` 分支推送或手动触发时执行：`make build` → 启动应用和真实 PostgreSQL → `make test` → 推送镜像。使用 GitHub Ubuntu runner 构建 `linux/amd64` 镜像，同时发布完整提交 SHA 和 `latest` 两个标签。测试失败不会发布镜像。

在仓库 **Settings → Secrets and variables → Actions**（或 `production` Environment）配置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `TKE_IMAGE_URL` | 完整镜像仓库地址，例如 `ccr.ccs.tencentyun.com/你的命名空间/orbit-user-management`，不带协议和标签 |
| Secret | `TENCENT_CLOUD_ACCOUNT_ID` | 腾讯云控制台提供的镜像仓库登录用户名 |
| Secret | `TKE_REGISTRY_PASSWORD` | 有推送权限的镜像仓库密码或 Token |

这两个 Secret 沿用原工作流的名称；用户名应填写控制台登录命令里的实际值。使用 TCR 企业版时，`TKE_IMAGE_URL` 改为对应实例的域名及仓库路径。提前创建命名空间和镜像仓库，并确保仓库网络规则允许 GitHub runner 访问。

工作流保留 `production` Environment；如果该环境设置了审批规则，发布前会等待其审批。此流程只构建、测试和推送应用镜像，不需要腾讯云 API Secret ID/Key、TKE 集群或 Kustomize 文件。PostgreSQL 数据和后台登录凭据不会写入镜像，运行镜像时仍需通过环境变量连接数据库和配置管理员。

如果旧运行日志显示 `docker login -u -p ''`，说明旧模板没有读取到用户名和密码。确认上述两个值建在 **Secrets** 下，名称完全一致；镜像地址则建在 **Variables** 下。更新工作流后，从 Actions 中选择新的 Tencent Container Registry 工作流并使用 **Run workflow → main**，或查看新提交触发的运行；重新运行旧记录仍会使用旧提交的工作流。
