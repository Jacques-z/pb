# 排班系统 MVP

最小可用版本排班系统：服务端提供用户/人员与班次接口，桌面客户端展示即将到来的班次并在开始前 15 分钟触发本地提醒，并提供管理控制台。

## 目录结构
- `server/` 服务端（HTTP JSON + SQLite）
- `client/` 桌面客户端（Tauri + Vite + Vue + TypeScript + DaisyUI）
- `openspec/` 规格与变更说明

## 服务端运行
默认端口 `8787`，默认数据库为 SQLite。

```bash
cd server
pnpm install
pnpm start
```

可用环境变量：
- `SCHED_HOST`：监听地址（默认 `127.0.0.1`）
- `SCHED_PORT`：监听端口（默认 `8787`）
- `SCHED_DB_PATH`：SQLite 路径（默认 `server/data.db`）

### 管理员初始化
首次启动无用户时，需要调用 `/auth/bootstrap` 创建管理员账号，返回的 `token` 用于后续接口调用。
服务端会在收到 `password_client_hash` 后再进行随机盐慢哈希存储。

`password_client_hash` 计算方式：PBKDF2-SHA256，盐为用户名，迭代次数 100000，输出 32 字节并 Base64 编码。
客户端登录会自动处理，如需手动调用可用 Node 计算：

```bash
node -e "const {pbkdf2Sync}=require('crypto'); const u='admin'; const p='AdminPass123'; console.log(pbkdf2Sync(p, u, 100000, 32, 'sha256').toString('base64'));"
```

示例：
```bash
curl -X POST http://127.0.0.1:8787/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password_client_hash":"<hash>","person_name":"管理员"}'
```

### 登录与鉴权
- `/auth/login`：用户名 + `password_client_hash` 登录，返回 `token`
- `/auth/logout`：退出登录
- `/auth/change-password`：修改密码
- 其他接口统一使用 `Authorization: Bearer <token>`

### 用户管理（管理员）
- `POST /users`：创建用户（`username` 不可修改）
- `PUT /users/:id`：更新姓名或管理员标记
- `POST /users/:id/reset-password`：重置密码
- `DELETE /users/:id`：删除用户（若被班次引用则返回 409）

### 审计日志（管理员）
- `GET /audit-logs?limit=100`：读取审计日志（默认 100，最大 500，按时间倒序）

### 人员与班次
- `/people`：人员目录（来源于用户，需登录）
- `/shifts`：班次接口（需登录），`person_id` 即用户 ID
- `/shifts?start_at=...&end_at=...`：按时间范围查询班次（RFC3339，支持历史范围）
- `person_name_b64` 为姓名 UTF-8 Base64

## 客户端运行
Tauri 需要系统依赖（Linux 常见为 `webkit2gtk` 等），详情见 Tauri 官方文档。

```bash
cd client
pnpm install
pnpm tauri dev
```

## Android 客户端
使用 Tauri 打包现有前端，需准备 Android SDK/NDK、Java 17 与 Rust Android target。

```bash
cd client
pnpm install
pnpm tauri android init
pnpm tauri android dev
```

调试 APK 构建示例：
```bash
pnpm tauri android build -d --apk --split-per-abi
```

创建 tag（如 `v0.1.0`）后，GitHub Actions 会打包调试版 APK 并发布到 Release 附件中。

### 管理控制台
客户端内置管理控制台，可在左侧导航切换模块：
- 班次管理：列表与日/周/月视图，月视图与过去时间段只读，支持拖动端点调整时间
- 人员目录：只读查看人员列表
- 用户管理（管理员）：创建/更新/删除/重置密码
- 审计日志（管理员）：只读查看操作日志
- 账号设置：修改密码、退出登录

### 客户端冒烟清单（手动）
- 使用管理员账号登录并查看班次列表
- 在班次管理中创建/编辑/删除班次，确认列表刷新
- 切换班次日历日/周/月视图并查看排班分布
- 在日/周视图中点击新建并拖动端点调整时间，保存后刷新显示
- 在人员目录中查看人员列表并刷新
- 在用户管理中创建用户、更新姓名/管理员标记、重置密码、删除用户
- 在审计日志中加载日志并确认排序为最新在前
- 修改当前账号密码后确认会话失效并重新登录

## 测试
```bash
cd server
pnpm install
pnpm test
```

## 常见问题
- **连接失败/401**：确认服务端可访问、账号密码正确或登录已过期。
- **通知不弹**：检查系统通知权限是否授予应用。
- **Tauri 依赖缺失**：按提示安装 `webkit2gtk` 等系统依赖。
- **SQLite 依赖构建被忽略**：运行 `pnpm approve-builds`，再执行 `pnpm rebuild better-sqlite3`。
