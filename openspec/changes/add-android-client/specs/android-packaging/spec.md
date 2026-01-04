## ADDED Requirements
### Requirement: Android 调试 APK 打包触发
系统 MUST 仅在仓库创建 tag 时触发 GitHub Actions 打包流程。
系统 MUST 生成 Android 调试版 APK 作为产物。

#### Scenario: 标签触发打包
- **当** 仓库创建新的 tag
- **则** GitHub Actions 触发并生成调试 APK

#### Scenario: 非标签不触发
- **当** 仓库发生非 tag 的提交或合并
- **则** GitHub Actions 不运行该打包流程

### Requirement: Release 附件发布
系统 MUST 将调试 APK 作为 GitHub Release 附件发布。
系统 MUST NOT 要求签名发布包。

#### Scenario: Release 含调试 APK
- **当** tag 触发打包完成
- **则** Release 中包含调试 APK 附件
