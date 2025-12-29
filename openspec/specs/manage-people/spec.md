# manage-people Specification

## Purpose
TBD - created by archiving change add-scheduling-mvp. Update Purpose after archive.
## Requirements
### Requirement: 人员增删改查接口
系统 MUST 提供 HTTP JSON 接口用于创建、更新、删除和列出人员。
系统 MUST 返回包含以下字段的人员对象：
- id（字符串，服务端生成）
- person_name_b64（字符串，Base64 编码的人员姓名）
- created_at（RFC3339 时间戳）
- updated_at（RFC3339 时间戳）

#### Scenario: 创建人员
- **当** 客户端提交包含 person_name 的有效创建请求
- **则** 服务端创建人员并返回包含 id 与 person_name_b64 的对象

#### Scenario: 更新人员
- **当** 客户端对已存在人员提交有效更新请求
- **则** 服务端更新该人员并返回更新后的对象

#### Scenario: 删除人员
- **当** 客户端删除一个未被班次引用的人员
- **则** 后续人员列表不再包含该人员

#### Scenario: 列出人员
- **当** 客户端请求人员列表
- **则** 服务端返回全部人员对象

### Requirement: 人员输入字段
创建与更新请求 MUST 包含以下字段：
- person_name（字符串，原始姓名）
服务端 MUST 将 person_name 进行 Base64 编码并保存为 person_name_b64。

#### Scenario: 以原始姓名创建
- **当** 客户端提交包含 person_name 的创建请求
- **则** 服务端保存 Base64 编码后的 person_name_b64 并返回

#### Scenario: 缺少必填字段
- **当** 创建或更新请求缺少 person_name
- **则** 服务端返回 400 且不创建或更新人员

### Requirement: 人员删除限制
系统 MUST 拒绝删除仍被班次引用的人员。

#### Scenario: 人员仍被引用
- **当** 客户端删除一个仍被班次引用的人员
- **则** 服务端返回 409 且不删除该人员

