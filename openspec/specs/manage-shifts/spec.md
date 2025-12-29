# manage-shifts Specification

## Purpose
TBD - created by archiving change add-scheduling-mvp. Update Purpose after archive.
## Requirements
### Requirement: 班次增删改查接口
系统 MUST 提供 HTTP JSON 接口用于创建、更新、删除和列出班次。
系统 MUST 返回包含以下字段的班次对象：
- id（字符串，服务端生成）
- person_id（字符串，人员 ID）
- person_name_b64（字符串，Base64 编码的人员姓名）
- start_at（带时区偏移的 RFC3339 时间戳）
- end_at（带时区偏移的 RFC3339 时间戳）
- created_at（RFC3339 时间戳）
- updated_at（RFC3339 时间戳）
系统 MUST 在列表响应中按 start_at 升序返回班次。
列表操作 MUST 只返回 start_at 大于或等于当前服务端时间的班次。

#### Scenario: 创建班次
- **当** 客户端提交包含 person_id、start_at、end_at 的有效创建请求
- **则** 服务端创建班次并返回包含 person_name_b64 的完整对象

#### Scenario: 更新班次
- **当** 客户端对已存在班次提交有效更新请求
- **则** 服务端更新该班次并返回更新后的对象

#### Scenario: 删除班次
- **当** 客户端删除一个已存在班次
- **则** 后续列表响应不再包含该班次

#### Scenario: 获取即将到来的班次
- **当** 客户端请求班次列表
- **则** 服务端返回 start_at 大于或等于当前时间的班次，按 start_at 升序排列

### Requirement: 班次输入字段
创建与更新请求 MUST 包含以下字段：
- person_id（字符串）
- start_at（带时区偏移的 RFC3339 时间戳）
- end_at（带时区偏移的 RFC3339 时间戳）
服务端 MUST 通过 person_id 关联人员目录并在响应中返回对应的 person_name_b64。

#### Scenario: 以人员 ID 创建
- **当** 客户端提交包含 person_id、start_at、end_at 的创建请求
- **则** 服务端返回包含 person_id 与 person_name_b64 的班次对象

#### Scenario: 缺少必填字段
- **当** 创建或更新请求缺少 person_id 或 start_at 或 end_at
- **则** 服务端返回 400 且不创建或更新班次

### Requirement: 人员 ID 校验
系统 MUST 拒绝引用不存在人员的班次请求。

#### Scenario: 人员不存在
- **当** 创建或更新请求的 person_id 在人员目录中不存在
- **则** 服务端返回 400 且不创建或更新班次

### Requirement: 班次时间校验
系统 MUST 拒绝 end_at 小于或等于 start_at 的班次。

#### Scenario: 时间范围非法
- **当** 客户端提交 end_at 小于或等于 start_at 的班次
- **则** 服务端返回 400 且不创建或更新该班次

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

### Requirement: 班次权限范围
系统 MUST 允许任何已认证用户创建、更新、删除任意班次（不限制是否为本人）。

#### Scenario: 修改他人班次
- **当** 已认证用户更新他人的班次
- **则** 服务端允许并返回更新后的班次

