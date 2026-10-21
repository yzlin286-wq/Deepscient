# 示例 3：两组事件时间（生存分析）

## 这是什么

80 名对象，随机分 `control` 与 `treated` 两组，观察事件发生时间，随访上限 60 周。
到随访结束还没发生事件的记为**删失**。**示例数据，非真实试验。**

## 数据

`data.csv`：

| 列 | 含义 |
| --- | --- |
| `time` | 从入组到事件或随访终点的时间（周） |
| `event` | `1` = 事件发生，`0` = 删失 |
| `arm` | `control` / `treated` |

`event=0` 的行是删失，不是缺失。删掉它们会让生存曲线整体偏高——
这是生存分析里最常见也最难被发现的一个错误。

## 怎么跑

```json
{
  "testId": "logrank",
  "csvPath": "data/exp1.csv",
  "columns": { "time": "time", "event": "event", "group": "arm" }
}
```

想看曲线：

```json
{ "testId": "kaplan-meier", "csvPath": "data/exp1.csv",
  "columns": { "time": "time", "event": "event" } }
```

## 该看什么

1. `logrank` 假设**比例风险**：两组的风险比在整个随访期恒定。曲线交叉时这个假设不成立，
   改用 RMST 或分时段分析。
2. HR 的置信区间比点估计重要。样本少时 HR 的 CI 会宽到无法解释。
3. 中位生存时间来自 Kaplan-Meier 估计，不是原始时间的中位数——两者在有删失时不同。
