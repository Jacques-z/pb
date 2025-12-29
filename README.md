# 排班系统 MVP

最小可用版本排班系统：服务端提供用户/人员与班次接口，桌面客户端展示即将到来的班次并在开始前 15 分钟触发本地提醒。

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

### 人员与班次
- `/people`：人员目录（来源于用户，需登录）
- `/shifts`：班次接口（需登录），`person_id` 即用户 ID
- `person_name_b64` 为姓名 UTF-8 Base64

## 客户端运行
Tauri 需要系统依赖（Linux 常见为 `webkit2gtk` 等），详情见 Tauri 官方文档。

```bash
cd client
pnpm install
pnpm tauri dev
```

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
