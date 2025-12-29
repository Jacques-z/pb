## RENAMED Requirements
- FROM: `### Requirement: 人员增删改查接口`
- TO: `### Requirement: 人员目录查询接口`

## MODIFIED Requirements
### Requirement: 人员目录查询接口
系统 MUST 提供 HTTP JSON 接口用于列出人员目录。
人员目录 MUST 来源于用户账户，人员 id MUST 等于用户 id。
请求 MUST 通过用户身份认证。
系统 MUST 返回包含以下字段的人员对象：
- id（字符串）
- person_name_b64（字符串，Base64 编码的人员姓名）
- created_at（RFC3339 时间戳）
- updated_at（RFC3339 时间戳）

#### Scenario: 列出人员
- **当** 已认证用户请求人员列表
- **则** 服务端返回全部人员对象

## REMOVED Requirements
### Requirement: 人员输入字段
**Reason**: 人员创建与更新由用户管理接口统一处理。
**Migration**: 使用 manage-users 创建或更新用户以同步人员姓名。

### Requirement: 人员删除限制
**Reason**: 人员删除由用户删除规则统一处理。
**Migration**: 使用 manage-users 删除用户并复用班次引用约束。
