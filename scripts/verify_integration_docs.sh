#!/usr/bin/env bash
# 校验官网账号对接文档包（docs/integration/deepscient-oauth）是否完整可用。
# 仅用于本地自检，不属于发布流程必需项。

set -e
PROJECT_ROOT="$(cd "$(dirname "$(dirname "$0")")" && pwd)"
DOC_DIR="$PROJECT_ROOT/docs/integration/deepscient-oauth"

REQUIRED_FILES=(
    "README.md"
    "openapi.yaml"
    "examples/pkce.mjs"
    "examples/login-flow.mjs"
    "examples/password-login.mjs"
    "examples/curl.sh"
)

fail=0

echo "[verify] 文档包目录: $DOC_DIR"

for f in "${REQUIRED_FILES[@]}"; do
    if [[ -f "$DOC_DIR/$f" ]]; then
        echo "[verify] OK   文件存在: $f"
    else
        echo "[verify] FAIL 缺少文件: $f" >&2
        fail=1
    fi
done

# openapi.yaml 可解析（优先使用仓库 .venv）
PYTHON_BIN="python3"
if ! "$PYTHON_BIN" -c "import yaml" >/dev/null 2>&1; then
    if [[ -x "$PROJECT_ROOT/.venv/bin/python" ]]; then
        PYTHON_BIN="$PROJECT_ROOT/.venv/bin/python"
    fi
fi
if "$PYTHON_BIN" -c "import yaml, sys; yaml.safe_load(open(sys.argv[1]))" "$DOC_DIR/openapi.yaml" >/dev/null 2>&1; then
    echo "[verify] OK   openapi.yaml 可解析，解释器: $PYTHON_BIN"
else
    echo "[verify] FAIL openapi.yaml 无法解析，解释器: $PYTHON_BIN" >&2
    fail=1
fi

# 示例脚本语法
if command -v node >/dev/null 2>&1; then
    for f in pkce.mjs login-flow.mjs password-login.mjs; do
        if node --check "$DOC_DIR/examples/$f" >/dev/null 2>&1; then
            echo "[verify] OK   node --check examples/$f"
        else
            echo "[verify] FAIL node --check examples/$f" >&2
            fail=1
        fi
    done
else
    echo "[verify] SKIP 未找到 node，跳过 .mjs 语法检查"
fi

if bash -n "$DOC_DIR/examples/curl.sh" >/dev/null 2>&1; then
    echo "[verify] OK   bash -n examples/curl.sh"
else
    echo "[verify] FAIL bash -n examples/curl.sh" >&2
    fail=1
fi

if [[ $fail -ne 0 ]]; then
    echo "[verify] 校验失败" >&2
    exit 1
fi

echo "[verify] 全部校验通过"
