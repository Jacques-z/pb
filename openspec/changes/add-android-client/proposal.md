# 变更：新增 Android 客户端

## 问题背景
当前仅有桌面客户端，移动端无法随时查看班次与接收提醒，影响一线使用效率。

## 目标
- 提供 Android 客户端，复用现有前端界面与功能
- 支持登录、查看即将到来的班次与管理控制台模块
- 应用在后台常驻并触发本地提醒

## 范围内
- Android 客户端交付与安装使用
- 复用现有前端 UI 与既有 HTTP JSON API
- 本地通知权限申请与提醒触发
- 管理控制台模块与权限提示在 Android 上可用
- GitHub Actions 在 tag 触发时打包调试版 APK 并发布到 Release

## 范围外
- iOS 客户端
- 云端推送与远程通知
- 全新原生 UI 重写
- 离线模式与多端数据冲突解决
- 签名发布包、aab 产物或应用商店发布

## 成功标准
- Android 客户端可登录并正常同步即将班次
- 在后台运行时，班次开始前 15 分钟触发本地通知
- 管理控制台模块可访问，权限控制与桌面一致
- 创建 tag 后 Release 附件包含调试版 APK

## 风险
- Android 的后台限制可能影响提醒稳定性
- Tauri 移动端能力与插件限制可能需要额外适配
- 通知权限获取失败会导致提醒不可用
- CI 环境依赖可能导致打包失败或构建时间过长

## 技术选型（默认假设 + 可替代项）
- 默认假设：使用 Tauri 打包现有前端 UI，沿用当前客户端交互与 API
- 默认假设：使用 GitHub Actions 在 tag 触发时打包调试版 APK 并发布 Release
- 可替代项：原生 Android（Kotlin/Compose）或跨平台框架重写前端
- 可替代项：手动本地打包或使用自托管 CI

## Specs Outline
- 新增 `android-client`
  - Android 客户端交付与功能覆盖
  - Android 后台提醒交付
- 新增 `android-packaging`
  - tag 触发 GitHub Actions 打包调试版 APK 并发布 Release
- 修改 `manage-console-ui`
  - 管理控制台入口描述不限定桌面平台

## 任务概览
1. 新增 android-client/android-packaging 规格并调整 manage-console-ui
2. 设计 Android 端后台提醒与 CI 打包策略
3. 实现 Android 构建与功能对齐
4. 配置 GitHub Actions 打包调试 APK
5. 完成 Android 冒烟验证
