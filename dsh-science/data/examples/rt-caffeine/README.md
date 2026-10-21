# 示例 1：咖啡因与简单反应时（被试间）

## 这是什么

24 人随机分两组，一组 200 mg 咖啡因、一组安慰剂，测简单反应时。**这是生成的示例数据**，
不是真实验结果——它的作用是让你在还没有自己的数据时，把整条链先跑通一遍。

## 数据

`data.csv` 是长表：

| 列 | 含义 |
| --- | --- |
| `subject` | 被试编号 |
| `group` | `placebo` / `caffeine` |
| `rt` | 简单反应时（ms） |

## 怎么跑

```json
{
  "testId": "ttest-welch",
  "csvPath": "data/exp1.csv",
  "columns": {
    "a": { "column": "rt", "where": { "group": "caffeine" } },
    "b": { "column": "rt", "where": { "group": "placebo" } }
  }
}
```

`where` 就是长表的解法：不用先在 Excel 里把表拆成两列，直接从同一列按分组切出来。
`a` 与 `b` 的顺序决定了效应量的符号，写方案时就定下来，别看到结果再调。

## 该看什么

1. `assumptions` 里两组的正态性。反应时通常右偏，偏得厉害就换 `mannwhitney`。
2. `effectSize.ci` 跨 0 时，不能只凭 p 值说有效。
3. `warnings` 里会列出假设不满足时的备选检验 id——那是 `statistics.json` 里登记过的，
   不是临时想的。

## 预期输出

`expected.json` 里是这张表实际跑出来的数字（含 p、效应量、非参数对照）。
换数据就要重跑 `scripts/py/make_examples.py`，不要手改。
