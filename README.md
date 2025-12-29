# 排班系统 MVP

最小可用版本排班系统：服务端提供人员与班次接口，桌面客户端展示即将到来的班次并在开始前 15 分钟触发本地提醒。

## 目录结构
- `server/` 服务端（HTTP JSON + SQLite）
- `client/` 桌面客户端（Tauri + Vite + Vue + TypeScript + DaisyUI）
- `openspec/` 规格与变更说明

## 服务端运行
默认端口 `8787`，默认令牌 `dev-token`，默认数据库为 SQLite。

```bash
node server/app.js
```

可用环境变量：
- `SCHED_HOST`：监听地址（默认 `127.0.0.1`）
- `SCHED_PORT`：监听端口（默认 `8787`）
- `SCHED_DB_PATH`：SQLite 路径（默认 `server/data.db`）
- `SCHED_TOKEN`：API Token（默认 `dev-token`）

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
- **连接失败/401**：确认服务端 `SCHED_TOKEN` 与客户端配置一致。
- **通知不弹**：检查系统通知权限是否授予应用。
- **Tauri 依赖缺失**：按提示安装 `webkit2gtk` 等系统依赖。
- **SQLite 依赖构建被忽略**：运行 `pnpm approve-builds`，再执行 `pnpm rebuild better-sqlite3`。
