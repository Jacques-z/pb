## MODIFIED Requirements
### Requirement: 日历排班视图
客户端 MUST 在班次管理中提供日/周/月视图切换。
客户端 MUST 默认展示全部人员的班次，并提供人员筛选开关以控制显示范围。
客户端 MUST 在月视图中以只读方式展示班次，不允许创建或调整。
客户端 MUST 在日/周视图允许对过去班次进行创建或调整，过去班次指 start_at 或 end_at 早于操作时间的班次。

#### Scenario: 切换视图模式
- **当** 用户在班次管理中切换日/周/月视图
- **则** 客户端按对应视图展示班次分布

#### Scenario: 过去时间段可编辑
- **当** 用户在日/周视图查看过去时间段并尝试创建或调整班次
- **则** 客户端允许编辑并提供保存入口

## ADDED Requirements
### Requirement: 班次列表范围
客户端 MUST 在班次列表中仅展示 start_at 大于或等于当前时间的班次。
客户端 MUST NOT 在列表中提供历史班次的查看入口。

#### Scenario: 列表仅展示当前及未来
- **当** 用户打开班次列表
- **则** 仅看到当前与未来的班次记录

### Requirement: 日历班次删除
客户端 MUST 在日/周视图提供删除班次入口，并调用删除接口。
客户端 MUST 在删除成功后更新日/周视图展示。

#### Scenario: 删除过去班次
- **当** 用户在日/周视图删除过去班次
- **则** 客户端调用删除接口并刷新视图

### Requirement: 审计日志过去班次标记
客户端 MUST 在审计日志列表中对班次相关写操作进行显著标记，判定规则如下：
- action 为 shifts.delete 时，始终标记。
- action 为 shifts.create 或 shifts.update 时，若对应班次 start_at 或 end_at 早于该日志 occurred_at，则标记。

#### Scenario: 删除操作标记
- **当** 审计日志列表中存在 shifts.delete 记录
- **则** 客户端对该记录进行显著标记

#### Scenario: 过去班次更新标记
- **当** 审计日志记录为 shifts.update 且该班次起讫时间早于 occurred_at
- **则** 客户端对该记录进行显著标记
