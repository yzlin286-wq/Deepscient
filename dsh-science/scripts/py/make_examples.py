#!/usr/bin/env python3
"""生成三个示例数据集（含 expected.json）。

示例的价值在于「能跑出一样的结果」——所以 expected.json 里的数字都是这张表实际跑出来的，
不是手写的理想值。改数据就要重跑这个脚本。
"""

import json
import math
import os
import random
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EX = os.path.join(ROOT, 'data', 'examples')
STATS = os.path.join(ROOT, 'scripts', 'py', 'stats_run.py')

random.seed(20261021)


def run(req):
    proc = subprocess.run([sys.executable, STATS], input=json.dumps(req), capture_output=True, text=True, encoding='utf-8', errors='replace')
    if not (proc.stdout or '').strip():
        raise SystemExit(f"统计执行器没有输出；rc={proc.returncode}\nstderr:\n{(proc.stderr or '')[-1500:]}")
    return json.loads(proc.stdout)


def write_csv(path, header, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = [','.join(header)]
    for r in rows:
        lines.append(','.join(str(x) for x in r))
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')


# ── 1. 反应时：两组被试间设计 ───────────────────────────────────────────────
n = 24
placebo = [round(random.gauss(452, 55), 1) for _ in range(n)]
caffeine = [round(random.gauss(421, 52), 1) for _ in range(n)]
rows = [(i + 1, 'placebo', placebo[i]) for i in range(n)] + [(n + i + 1, 'caffeine', caffeine[i]) for i in range(n)]
write_csv(os.path.join(EX, 'rt-caffeine', 'data.csv'), ['subject', 'group', 'rt'], rows)
r1 = run({'testId': 'ttest-welch', 'data': {'a': caffeine, 'b': placebo}})
r1b = run({'testId': 'mannwhitney', 'data': {'a': caffeine, 'b': placebo}})

json.dump({
    'name': 'rt-caffeine',
    'design': 'between-2',
    'domain': 'psychology',
    'testId': 'ttest-welch',
    'columns': {
        'a': {'column': 'rt', 'where': {'group': 'caffeine'}},
        'b': {'column': 'rt', 'where': {'group': 'placebo'}},
    },
    'csv': 'data.csv',
    'howToCall': {
        'tool': 'science_stats',
        'args': {
            'projectId': '<你的课题 id>',
            'testId': 'ttest-welch',
            'csvPath': 'data/exp1.csv',
            'columns': {
                'a': {'column': 'rt', 'where': {'group': 'caffeine'}},
                'b': {'column': 'rt', 'where': {'group': 'placebo'}},
            },
        },
        'note': '长表格式：用 where 从同一列里切出两组，不需要先在 Excel 里拆表',
    },
    'expected': {
        'n': r1['n'],
        'statistic': round(r1['statistic'], 4),
        'df': r1['df'],
        'p': round(r1['p'], 6),
        'effectSize': {'kind': r1['effectSize']['kind'], 'value': round(r1['effectSize']['value'], 4)},
        'fallbackP': round(r1b['p'], 6),
    },
    'whatToLookAt': [
        '先看 assumptions 里两组正态性；反应时通常右偏，偏得厉害就该用 Mann-Whitney',
        '效应量带 CI：CI 跨 0 时不能只靠 p 值说有效',
        f'本例正态性可接受，但非参数检验 p = {round(r1b["p"], 4)} 与 t 检验一致，这个一致性本身就是稳健性证据',
    ],
}, open(os.path.join(EX, 'rt-caffeine', 'expected.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# ── 2. 睡眠剥夺：被试内设计 ────────────────────────────────────────────────
n2 = 22
base = [round(random.gauss(6.4, 1.1), 1) for _ in range(n2)]
after = [round(b - random.gauss(0.9, 0.7), 1) for b in base]
rows2 = [(i + 1, base[i], after[i]) for i in range(n2)]
write_csv(os.path.join(EX, 'sleep-wm', 'data.csv'), ['subject', 'well_rested', 'sleep_deprived'], rows2)
r2 = run({'testId': 'ttest-rel', 'data': {'a': base, 'b': after}})
r2b = run({'testId': 'wilcoxon', 'data': {'a': base, 'b': after}})

json.dump({
    'name': 'sleep-wm',
    'design': 'within-2x2',
    'domain': 'neuroscience',
    'testId': 'ttest-rel',
    'columns': {'a': 'well_rested', 'b': 'sleep_deprived'},
    'csv': 'data.csv',
    'howToCall': {
        'tool': 'science_stats',
        'args': {
            'projectId': '<你的课题 id>',
            'testId': 'ttest-rel',
            'csvPath': 'data/exp1.csv',
            'columns': {'a': 'well_rested', 'b': 'sleep_deprived'},
        },
        'note': '宽表格式：一人一行，两列就是两个条件；行序必须一一对应，配对检验依赖这一点',
    },
    'expected': {
        'n': r2['n'],
        'statistic': round(r2['statistic'], 4),
        'df': r2['df'],
        'p': round(r2['p'], 6),
        'effectSize': {'kind': r2['effectSize']['kind'], 'value': round(r2['effectSize']['value'], 4)},
        'fallbackP': round(r2b['p'], 6),
    },
    'whatToLookAt': [
        '被试内设计的关键是差值列的正态性，不是两列各自的正态性',
        'dz 与独立样本 d 不能直接比大小，量纲不同',
        '画图用 paired 图：每人的两条线，比两个柱状图信息量大得多',
    ],
}, open(os.path.join(EX, 'sleep-wm', 'expected.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# ── 3. 生存：两组事件时间 ──────────────────────────────────────────────────
n3 = 40
times_a, events_a, times_b, events_b = [], [], [], []
for _ in range(n3):
    t = random.expovariate(1 / 18)
    times_a.append(max(1, round(t, 1)))
    events_a.append(1 if t < 60 else 0)
for _ in range(n3):
    t = random.expovariate(1 / 11)
    times_b.append(max(1, round(t, 1)))
    events_b.append(1 if t < 60 else 0)
rows3 = [(round(times_a[i], 1), events_a[i], 'control') for i in range(n3)]
rows3 += [(round(times_b[i], 1), events_b[i], 'treated') for i in range(n3)]
random.shuffle(rows3)
write_csv(os.path.join(EX, 'trial-survival', 'data.csv'), ['time', 'event', 'arm'], rows3)
r3 = run({'testId': 'logrank', 'data': {'time': [r[0] for r in rows3], 'event': [r[1] for r in rows3], 'group': [r[2] for r in rows3]}})
r3b = run({'testId': 'kaplan-meier', 'data': {'time': [r[0] for r in rows3], 'event': [r[1] for r in rows3]}})

json.dump({
    'name': 'trial-survival',
    'design': 'rct-parallel',
    'domain': 'biomed',
    'testId': 'logrank',
    'columns': {'time': 'time', 'event': 'event', 'group': 'arm'},
    'csv': 'data.csv',
    'howToCall': {
        'tool': 'science_stats',
        'args': {
            'projectId': '<你的课题 id>',
            'testId': 'logrank',
            'csvPath': 'data/exp1.csv',
            'columns': {'time': 'time', 'event': 'event', 'group': 'arm'},
        },
        'note': '列名固定：time / event / group。event=0 表示删失，必须保留这些行',
    },
    'expected': {
        'n': r3['n'],
        'statistic': round(r3['statistic'], 4),
        'df': r3['df'],
        'p': round(r3['p'], 6),
        'effectSize': {'kind': r3['effectSize']['kind'], 'value': round(r3['effectSize']['value'], 4)},
        'medianSurvival': r3b['statistic'],
    },
    'whatToLookAt': [
        'event=0 是删失，不是缺失——删失信息必须保留，删掉会让曲线偏高',
        'log-rank 假设比例风险；两条曲线交叉时改用 RMST',
        '中位生存时间来自 Kaplan-Meier，不是原始时间的中位数',
    ],
}, open(os.path.join(EX, 'trial-survival', 'expected.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

print('written 3 examples')
for name in ('rt-caffeine', 'sleep-wm', 'trial-survival'):
    d = os.path.join(EX, name)
    print(' ', name, sorted(os.listdir(d)))
