## ADDED Requirements
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
