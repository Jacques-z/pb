## ADDED Requirements
### Requirement: 用户登录与会话令牌
系统 MUST 提供用户名+密码登录接口。
登录请求 MUST 包含 username 与 password_client_hash。
password_client_hash MUST 为客户端使用用户名作盐的慢哈希结果。
系统 MUST 在登录成功后返回会话令牌。
所有受保护接口请求 MUST 在 Authorization 头中使用 Bearer 携带令牌。
系统 MUST 对无效或过期令牌返回 401。

#### Scenario: 登录成功
- **当** 用户提交正确的 username 与 password_client_hash
- **则** 服务端返回会话令牌

#### Scenario: 令牌校验失败
- **当** 请求携带无效或过期令牌
- **则** 服务端返回 401

### Requirement: 用户自助修改密码
系统 MUST 允许已认证用户修改自己的密码。
修改密码请求 MUST 包含 current_password_client_hash 与 new_password_client_hash。
客户端 MUST 使用用户名作盐的慢哈希生成上述字段。
系统 MUST 在修改成功后使该用户的旧会话令牌失效。

#### Scenario: 修改密码成功
- **当** 已认证用户提交正确的 current_password_client_hash 与 new_password_client_hash
- **则** 服务端更新密码并使旧令牌失效

#### Scenario: 当前密码错误
- **当** 已认证用户提交错误的 current_password_client_hash
- **则** 服务端拒绝修改并返回 400 或 401

### Requirement: 密码双重慢哈希存储
系统 MUST 对客户端提交的 password_client_hash 再次使用随机盐进行慢哈希并持久化。
系统 MUST NOT 存储明文密码或 password_client_hash。

#### Scenario: 用户登录校验
- **当** 用户提交 password_client_hash 登录
- **则** 服务端使用已存随机盐慢哈希比对并决定是否通过
