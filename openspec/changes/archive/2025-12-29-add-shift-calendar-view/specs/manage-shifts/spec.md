## MODIFIED Requirements
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
当未提供查询参数时，列表操作 MUST 只返回 start_at 大于或等于当前服务端时间的班次。
当请求携带 start_at 或 end_at 查询参数时，列表操作 MUST 返回 start_at 落在指定范围内的班次并允许返回历史班次。
start_at 与 end_at 查询参数 MUST 为带时区偏移的 RFC3339 时间戳。

#### Scenario: 创建班次
- **当** 客户端提交包含 person_id、start_at、end_at 的有效创建请求
- **则** 服务端创建班次并返回包含 person_name_b64 的完整对象

#### Scenario: 更新班次
- **当** 客户端对已存在班次提交有效更新请求
- **则** 服务端更新该班次并返回更新后的对象

#### Scenario: 删除班次
- **当** 客户端删除一个已存在班次
- **则** 后续列表响应不再包含该班次

#### Scenario: 获取即将到来的班次（默认）
- **当** 客户端请求班次列表且不携带范围参数
- **则** 服务端返回 start_at 大于或等于当前时间的班次，按 start_at 升序排列

#### Scenario: 获取指定时间范围
- **当** 客户端请求班次列表并携带 start_at/end_at 范围参数
- **则** 服务端返回该范围内的班次并允许包含过去班次
