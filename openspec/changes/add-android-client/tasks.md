# Tasks

## 1. 规格与设计
- [x] 1.1 新增 android-client 规格
- [x] 1.2 修改 manage-console-ui 的管理控制台入口描述
- [x] 1.3 补充 Android 端后台提醒与权限策略设计
- [x] 1.4 新增 android-packaging 规格并补充 CI 打包策略设计

## 2. Android 客户端实现
- [ ] 2.1 建立 Android 构建与打包流程（Tauri）
- [ ] 2.2 复用现有前端 UI 并完成登录与配置
- [ ] 2.3 对齐即将班次视图与刷新策略
- [ ] 2.4 对齐管理控制台模块与权限提示

## 3. 提醒与后台
- [ ] 3.1 处理通知权限与渠道配置
- [ ] 3.2 后台常驻并触发本地提醒
- [ ] 3.3 班次变更时更新与取消提醒

## 4. CI 打包
- [x] 4.1 配置 tag 触发的 GitHub Actions 打包调试 APK
- [x] 4.2 将 APK 作为 Release 附件发布

## 5. 验证
- [ ] 5.1 Android 冒烟：登录与即将班次展示
- [ ] 5.2 Android 冒烟：后台提醒触发
- [ ] 5.3 Android 冒烟：管理控制台权限与操作
- [ ] 5.4 CI 冒烟：tag 触发后 Release 含调试 APK
