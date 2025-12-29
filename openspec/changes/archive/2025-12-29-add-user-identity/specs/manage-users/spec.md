## ADDED Requirements
### Requirement: 管理员用户管理接口
系统 MUST 提供管理员可用的 HTTP JSON 接口用于创建、更新、删除和列出用户。
系统 MUST 返回包含以下字段的用户对象：
- id（字符串，服务端生成）
- username（字符串，唯一）
- person_name_b64（字符串，Base64 编码的姓名）
- is_admin（布尔值）
- created_at（RFC3339 时间戳）
- updated_at（RFC3339 时间戳）

#### Scenario: 创建用户
- **当** 管理员提交包含 username、password_client_hash、person_name 的创建请求
- **则** 服务端创建用户并返回包含 person_name_b64 的对象

#### Scenario: 更新用户
- **当** 管理员提交包含 person_name 或 is_admin 的更新请求
- **则** 服务端更新用户并返回更新后的对象

#### Scenario: 删除用户
- **当** 管理员删除一个未被班次引用的用户
- **则** 后续用户列表不再包含该用户

#### Scenario: 列出用户
- **当** 管理员请求用户列表
- **则** 服务端返回全部用户对象

### Requirement: 管理员权限
系统 MUST 区分管理员账号与普通账号。
仅管理员可调用用户管理与密码重置接口。

#### Scenario: 非管理员访问
- **当** 非管理员用户调用用户管理接口
- **则** 服务端返回 403 且不执行操作

### Requirement: 管理员重置密码
系统 MUST 允许管理员为指定用户重置密码。

#### Scenario: 管理员重置密码
- **当** 管理员提交包含 password_client_hash 的重置密码请求
- **则** 服务端更新目标用户密码

### Requirement: 用户名不可修改
系统 MUST 拒绝修改已存在用户的 username。

#### Scenario: 修改用户名被拒绝
- **当** 管理员提交包含 username 的更新请求
- **则** 服务端返回 400 或 409 且不修改用户名

### Requirement: 用户与人员一致
系统 MUST 保持用户与人员一一对应。
人员 ID MUST 等于用户 ID。
系统 MUST 将用户姓名写入人员目录并保存为 person_name_b64。

#### Scenario: 创建用户产生人员
- **当** 管理员创建新用户
- **则** 系统同时创建同 ID 的人员记录

#### Scenario: 更新用户同步人员姓名
- **当** 管理员更新用户的 person_name
- **则** 系统同步更新人员目录的 person_name_b64

### Requirement: 用户删除限制
系统 MUST 拒绝删除仍被班次引用的用户。

#### Scenario: 用户仍被引用
- **当** 管理员删除一个仍被班次引用的用户
- **则** 服务端返回 409 且不删除该用户
