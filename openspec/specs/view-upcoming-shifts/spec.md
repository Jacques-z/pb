# view-upcoming-shifts Specification

## Purpose
TBD - created by archiving change add-scheduling-mvp. Update Purpose after archive.
## Requirements
### Requirement: 客户端连接配置
客户端 MUST 允许用户配置服务端基础地址，并使用用户名与密码登录。
客户端 MUST 在登录成功后保存会话令牌并用于后续接口调用。
客户端 MUST 支持退出登录并清除本地令牌。

#### Scenario: 登录并保存配置
- **当** 用户输入基础地址、用户名与密码并登录
- **则** 客户端持久化设置与令牌并用于后续接口调用

#### Scenario: 退出登录
- **当** 用户执行退出登录
- **则** 客户端清除本地令牌并进入未登录状态

### Requirement: 即将到来的班次视图
客户端 MUST 展示从服务端获取的即将到来的班次，按 start_at 升序排列。
客户端 MUST 显示每个班次的人员姓名（对 person_name_b64 进行 Base64 解码）与本地时间。

#### Scenario: 展示即将到来的班次
- **当** 客户端已获取即将到来的班次
- **则** 用户看到按开始时间排序的列表且姓名已解码为可读文本

### Requirement: 班次同步频率
客户端 MUST 在启动时获取最新班次列表，并在运行期间按可配置间隔刷新。
默认刷新间隔 MUST 为 1 分钟。

#### Scenario: 自动刷新
- **当** 应用运行时间超过刷新间隔
- **则** 客户端刷新班次列表并更新显示

