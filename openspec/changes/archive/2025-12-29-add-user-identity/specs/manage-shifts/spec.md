## ADDED Requirements
### Requirement: 班次权限范围
系统 MUST 允许任何已认证用户创建、更新、删除任意班次（不限制是否为本人）。

#### Scenario: 修改他人班次
- **当** 已认证用户更新他人的班次
- **则** 服务端允许并返回更新后的班次

## MODIFIED Requirements
### Requirement: 接口令牌鉴权
系统 MUST 对所有班次接口请求要求用户会话令牌。
请求 MUST 在 Authorization 头中使用 Bearer 方案携带令牌。
系统 MUST 对缺失或无效令牌返回 401 未授权。

#### Scenario: 缺失或无效令牌
- **当** 请求缺失令牌或令牌无效
- **则** 服务端返回 401 未授权且不返回班次数据

#### Scenario: 令牌有效
- **当** 请求携带有效令牌
- **则** 服务端正常处理请求
