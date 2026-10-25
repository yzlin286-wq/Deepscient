#!/usr/bin/env bash
# DeepScient 发布脚本：校验 → 构建 → 打标签 → 推送 → 创建 GitHub Release → 上传资产。
#
# 用法：
#   ./scripts/release.sh --dry-run
#   ./scripts/release.sh
#   ./scripts/release.sh --skip-build
#   ./scripts/release.sh --branch feat/deepscient-v0.2 --remote github
#   ./scripts/release.sh --notes "本次发布说明" 或 --notes-file path/to/notes.md
#
# 环境变量：
#   GITHUB_TOKEN              必填（真实发布时）；只从环境读取，绝不打印。
#   CCAGENT_PARTNER_APP_SECRET 真实构建时必填；由构建进程继承，不会写入产物或日志。
#
# 资产命名契约（与 updater / 安装文档保持一致）：
#   dist/DeepScient-${VERSION}-macos.dmg
#   dist/deepscient-oauth.zip（可选，存在则一并上传）

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
REPO_SLUG="yzlin286-wq/Deepscient"
API_URL="https://api.github.com/repos/${REPO_SLUG}/releases"

BRANCH="feat/deepscient-v0.2"
REMOTE="github"
DRY_RUN=false
SKIP_BUILD=false
NOTES=""
NOTES_FILE=""

usage() {
    sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

log() {
    printf '%s\n' "$*"
}

fail() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            ;;
        --skip-build)
            SKIP_BUILD=true
            ;;
        --branch)
            [ "$#" -ge 2 ] || fail "--branch 需要一个分支名"
            BRANCH="$2"
            shift
            ;;
        --remote)
            [ "$#" -ge 2 ] || fail "--remote 需要一个远端名"
            REMOTE="$2"
            shift
            ;;
        --notes)
            [ "$#" -ge 2 ] || fail "--notes 需要发布说明文本"
            NOTES="$2"
            shift
            ;;
        --notes-file)
            [ "$#" -ge 2 ] || fail "--notes-file 需要一个文件路径"
            NOTES_FILE="$2"
            shift
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            printf 'ERROR: 未知参数 %s\n\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

# ── 1. 仓库根校验 ────────────────────────────────────────────────────────────
if [ "$(pwd -P)" != "$REPO_ROOT" ]; then
    fail "请在仓库根目录运行：cd \"$REPO_ROOT\" && ./scripts/release.sh ..."
fi
[ -f "$REPO_ROOT/pyproject.toml" ] || fail "缺少 pyproject.toml，当前目录不是仓库根。"
[ -d "$REPO_ROOT/.git" ] || fail "缺少 .git，当前目录不是 Git 仓库根。"

# ── 2. Git 状态与分支校验 ────────────────────────────────────────────────────
CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
[ -n "$CURRENT_BRANCH" ] || fail "当前处于 detached HEAD，无法发布。"
[ "$CURRENT_BRANCH" = "$BRANCH" ] || fail "当前分支是 ${CURRENT_BRANCH}，与 --branch ${BRANCH} 不一致。"

git remote get-url "$REMOTE" >/dev/null 2>&1 \
    || fail "远端 ${REMOTE} 不存在，请先添加（例如 git remote add github <url>）。"
git rev-parse --verify --quiet "refs/heads/${BRANCH}" >/dev/null \
    || fail "本地分支 ${BRANCH} 不存在。"

# dist/ 被 .gitignore 忽略；这里额外兼容显式的构建产物改动。
DIRTY="$(git status --porcelain | grep -v -E '^(..|\?\?) dist/' || true)"
if [ -n "$DIRTY" ]; then
    printf 'ERROR: 工作区不干净，请先提交或暂存以下改动：\n%s\n' "$DIRTY" >&2
    exit 1
fi

# ── 3. 版本单一来源校验 ──────────────────────────────────────────────────────
log "==> 校验 build config（pyproject 为版本唯一来源）"
python3 scripts/build_config.py --check
VERSION="$(python3 scripts/build_config.py --version | tr -d '[:space:]')"
[ -n "$VERSION" ] || fail "无法从 pyproject.toml 读取版本号。"
TAG="v${VERSION}"
DMG_NAME="DeepScient-${VERSION}-macos.dmg"
DMG_PATH="$REPO_ROOT/dist/${DMG_NAME}"
OAUTH_ZIP="$REPO_ROOT/dist/deepscient-oauth.zip"

log "==> 版本：${VERSION}  标签：${TAG}  分支：${BRANCH}  远端：${REMOTE}"

# ── 4. 标签唯一性校验 ────────────────────────────────────────────────────────
if git rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null; then
    fail "本地已存在标签 ${TAG}。请先确认版本号，或删除旧标签：git tag -d ${TAG}"
fi
set +e
REMOTE_TAGS="$(git ls-remote --exit-code --tags "$REMOTE" "refs/tags/${TAG}" 2>&1)"
REMOTE_TAGS_CODE=$?
set -e
case "$REMOTE_TAGS_CODE" in
    0)
        fail "远端 ${REMOTE} 已存在标签 ${TAG}。请先确认版本号，或删除远端标签：git push ${REMOTE} :refs/tags/${TAG}"
        ;;
    2)
        # git ls-remote 在 --exit-code 下无匹配标签时返回 2。
        ;;
    *)
        printf 'ERROR: 无法查询远端标签（git ls-remote 退出码 %s）：\n%s\n' \
            "$REMOTE_TAGS_CODE" "$REMOTE_TAGS" >&2
        exit 1
        ;;
esac

# ── 5. 真实发布的前置检查 ────────────────────────────────────────────────────
if [ "$DRY_RUN" = false ]; then
    [ -n "${GITHUB_TOKEN:-}" ] || fail "缺少 GITHUB_TOKEN 环境变量（只从环境读取，不会打印）。"
fi

# ── 6. 构建生产包 ────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
    log "[dry-run] 跳过构建；预期产物：dist/${DMG_NAME}"
elif [ "$SKIP_BUILD" = true ]; then
    log "==> 跳过构建（--skip-build），使用现有 dist 产物"
else
    [ -n "${CCAGENT_PARTNER_APP_SECRET:-}" ] \
        || fail "缺少 CCAGENT_PARTNER_APP_SECRET 环境变量，无法构建生产包。"
    export CCAGENT_PARTNER_APP_SECRET
    log "==> 构建生产包（scripts/build-electron-exe.sh，不含 --test）"
    "$REPO_ROOT/scripts/build-electron-exe.sh"
fi

if [ "$DRY_RUN" = false ]; then
    if [ ! -f "$DMG_PATH" ]; then
        {
            printf 'ERROR: 未找到预期构建产物：dist/%s\n' "$DMG_NAME"
            printf '       发布资产必须使用 DeepScient-${VERSION}-macos.dmg 命名（与更新器资产匹配规则一致）。\n'
            ACTUAL_DMGS="$(find "$REPO_ROOT/dist" -maxdepth 1 -name '*.dmg' -print 2>/dev/null || true)"
            if [ -n "$ACTUAL_DMGS" ]; then
                printf '       dist/ 下实际存在的 dmg：\n'
                printf '%s\n' "$ACTUAL_DMGS" | sed 's/^/         - /'
                printf '       请修正打包脚本的产品命名后重新构建，不要手工改名后发布。\n'
            fi
        } >&2
        exit 1
    fi
fi

# ── 7. 打标签并推送 ──────────────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
    log "[dry-run] git tag -a ${TAG} -m \"DeepScient ${VERSION}\""
    log "[dry-run] git push ${REMOTE} ${BRANCH}"
    log "[dry-run] git push ${REMOTE} ${TAG}"
else
    log "==> 创建标签 ${TAG}"
    git tag -a "$TAG" -m "DeepScient ${VERSION}"
    log "==> 推送分支与标签到 ${REMOTE}"
    git push "$REMOTE" "$BRANCH"
    git push "$REMOTE" "$TAG"
fi

# ── 8. 组装 Release 说明 ─────────────────────────────────────────────────────
BODY=""
if [ -n "$NOTES" ]; then
    BODY="$NOTES"
elif [ -n "$NOTES_FILE" ]; then
    [ -f "$NOTES_FILE" ] || fail "发布说明文件不存在：${NOTES_FILE}"
    BODY="$(cat "$NOTES_FILE")"
elif [ -f "$REPO_ROOT/CHANGELOG.md" ]; then
    BODY="$(awk -v version="$VERSION" '
        $0 ~ "^##[[:space:]]+\\[?" version "\\]?([[:space:]]|$)" { found = 1; next }
        found && /^##[[:space:]]/ { exit }
        found { print }
    ' "$REPO_ROOT/CHANGELOG.md")"
fi
if [ -z "${BODY//[[:space:]]/}" ]; then
    BODY="DeepScient ${TAG}"
fi

# ── 9. 创建 GitHub Release 并上传资产 ────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
    log "[dry-run] POST ${API_URL}（tag_name=${TAG}, name=DeepScient ${TAG}）"
    log "[dry-run] 上传 dist/${DMG_NAME}"
    if [ -f "$OAUTH_ZIP" ]; then
        log "[dry-run] 上传 dist/deepscient-oauth.zip"
    fi
    log "[dry-run] 完成（未创建标签、未推送、未调用 GitHub API）"
    exit 0
fi

PAYLOAD="$(
    BODY="$BODY" TAG="$TAG" VERSION="$VERSION" python3 - <<'PY'
import json
import os

print(json.dumps({
    "tag_name": os.environ["TAG"],
    "name": f"DeepScient {os.environ['VERSION']}",
    "body": os.environ["BODY"],
    "draft": False,
    "prerelease": False,
}))
PY
)"

RESPONSE_FILE="$(mktemp)"
cleanup() {
    rm -f "$RESPONSE_FILE"
}
trap cleanup EXIT

log "==> 创建 GitHub Release ${TAG}"
HTTP_CODE="$(
    curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' -X POST "$API_URL" \
        -H "Authorization: Bearer ${GITHUB_TOKEN}" \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        -H "Content-Type: application/json" \
        --data-binary "$PAYLOAD"
)"
if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
    printf 'ERROR: 创建 GitHub Release 失败（HTTP %s）\n' "$HTTP_CODE" >&2
    cat "$RESPONSE_FILE" >&2
    printf '\n提示：确认 GITHUB_TOKEN 具备 repo 权限，且标签 %s 已推送。\n' "$TAG" >&2
    exit 1
fi

UPLOAD_URL="$(
    python3 - "$RESPONSE_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
print(data.get("upload_url", ""))
PY
)"
[ -n "$UPLOAD_URL" ] || fail "GitHub Release 响应中缺少 upload_url。"
UPLOAD_BASE="${UPLOAD_URL%%\{*}"

upload_asset() {
    local path="$1"
    local name
    name="$(basename "$path")"
    log "==> 上传 ${name}"
    HTTP_CODE="$(
        curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' -X POST \
            "${UPLOAD_BASE}?name=${name}" \
            -H "Authorization: Bearer ${GITHUB_TOKEN}" \
            -H "Accept: application/vnd.github+json" \
            -H "Content-Type: application/octet-stream" \
            --data-binary "@${path}"
    )"
    if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
        printf 'ERROR: 上传 %s 失败（HTTP %s）\n' "$name" "$HTTP_CODE" >&2
        cat "$RESPONSE_FILE" >&2
        exit 1
    fi
}

upload_asset "$DMG_PATH"
if [ -f "$OAUTH_ZIP" ]; then
    upload_asset "$OAUTH_ZIP"
else
    log "==> 跳过 dist/deepscient-oauth.zip（不存在）"
fi

log "==> 发布完成：https://github.com/${REPO_SLUG}/releases/tag/${TAG}"
