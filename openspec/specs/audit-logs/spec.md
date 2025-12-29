# audit-logs Specification

## Purpose
TBD - created by archiving change add-user-identity. Update Purpose after archive.
## Requirements
### Requirement: 操作日志记录
系统 MUST 记录所有成功的写操作请求。
日志条目 MUST 包含以下字段：
- id（字符串，服务端生成）
- occurred_at（RFC3339 时间戳）
- actor_user_id（可为空）
- actor_username（可为空）
- action（字符串，例如 shifts.update）
- resource_type（字符串）
- resource_id（可为空）
- request_method（字符串）
- request_path（字符串）
- status_code（整数）
日志 MUST 持久化存储。
系统 MUST NOT 记录读取操作与失败请求。

#### Scenario: 班次更新日志
- **当** 已认证用户成功更新班次
- **则** 生成包含 actor_user_id 与班次 id 的日志条目

#### Scenario: 读取不记录
- **当** 已认证用户请求人员列表
- **则** 不生成审计日志条目

#### Scenario: 失败不记录
- **当** 已认证用户尝试更新班次但请求失败
- **则** 不生成审计日志条目

### Requirement: 审计日志查询接口
系统 MUST 提供仅管理员可用的 HTTP JSON 接口用于列出审计日志。
接口路径 MUST 为 /audit-logs。
请求 MUST 携带有效的用户会话令牌，非管理员 MUST 返回 403。
响应 MUST 返回日志列表并按 occurred_at 倒序排列。
系统 MUST 支持 limit 查询参数（默认 100，最大 500）。

#### Scenario: 管理员查询日志
- **当** 管理员请求审计日志列表
- **则** 服务端返回按时间倒序的日志列表

#### Scenario: 非管理员访问
- **当** 非管理员请求审计日志列表
- **则** 服务端返回 403

#### Scenario: 缺失令牌
- **当** 请求缺失或携带无效令牌
- **则** 服务端返回 401

