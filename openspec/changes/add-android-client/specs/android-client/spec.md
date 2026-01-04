## ADDED Requirements
### Requirement: Android 客户端交付
系统 MUST 提供可安装的 Android 客户端。
Android 客户端 MUST 复用现有前端界面并提供登录、即将班次、管理控制台与账号设置等模块。
Android 客户端 MUST 使用既有 HTTP JSON API 与鉴权机制，不新增专用接口。

#### Scenario: Android 客户端登录并使用模块
- **当** 用户在 Android 客户端登录成功
- **则** 可访问即将班次与管理控制台等模块并正常调用现有接口

### Requirement: Android 后台提醒交付
Android 客户端 MUST 在进入后台后仍能调度并触发本地提醒。

#### Scenario: 后台触发提醒
- **当** 应用进入后台且到达班次提醒时间
- **则** 系统显示对应的本地通知
