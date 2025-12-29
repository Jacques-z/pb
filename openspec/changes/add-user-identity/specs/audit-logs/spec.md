## ADDED Requirements
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
