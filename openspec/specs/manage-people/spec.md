# manage-people Specification

## Purpose
TBD - created by archiving change add-scheduling-mvp. Update Purpose after archive.
## Requirements
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

