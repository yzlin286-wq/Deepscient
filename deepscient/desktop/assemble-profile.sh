#!/usr/bin/env bash
# DeepScient 桌面 profile 装配器（macOS 版，等价于 assemble-profile.ps1）
#
# 目标：把 @local/deepscient 与 @local/dsh-science 装进桌面壳专用的 dsh profile
#       （默认 <DSH_HOME>/profiles/desktop），并补齐无密钥的供应商层。
#
# 幂等：重复运行只会重新 link 两个本地包、补缺字段，不覆盖用户已经写过的配置。
# 约束：不写 ~/.dsh；不改 DeepSeek Harness.app 内任何文件。
#
# 用法：
#   bash deepscient/desktop/assemble-profile.sh [--home <dir>] [--profile <name>] [--dsh-cli <path>] [--skip-providers]
set -euo pipefail

DSH_HOME_ARG=''
PROFILE='desktop'
DSH_CLI_ARG=''
SKIP_PROVIDERS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --home) DSH_HOME_ARG="${2:-}"; shift 2 ;;
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --dsh-cli) DSH_CLI_ARG="${2:-}"; shift 2 ;;
    --skip-providers) SKIP_PROVIDERS=1; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../.." && pwd)

if [ -n "$DSH_HOME_ARG" ]; then
  dsh_home="$DSH_HOME_ARG"
elif [ -n "${DEEPSCIENT_HOME:-}" ]; then
  dsh_home="$DEEPSCIENT_HOME"
else
  dsh_home="$HOME/.deepscient"
fi
mkdir -p "$dsh_home"
dsh_home=$(cd "$dsh_home" && pwd)

logs_dir="$dsh_home/logs"
mkdir -p "$logs_dir"
stamp=$(date '+%Y%m%d-%H%M%S')
log_path="$logs_dir/assemble-profile-$stamp.log"

log() {
  local line
  line="[$(date '+%H:%M:%S')] $*"
  printf '%s\n' "$line"
  printf '%s\n' "$line" >>"$log_path"
}

# 打包形态：本脚本位于 <App>/Contents/Resources/deepscient/deepscient/desktop
packaged_cli="$repo_root/cli/dsh"

resolve_dsh_cli() {
  if [ -n "$DSH_CLI_ARG" ]; then
    [ -f "$DSH_CLI_ARG" ] || { echo "指定的 --dsh-cli 不存在：$DSH_CLI_ARG" >&2; exit 1; }
    dsh_cli="$DSH_CLI_ARG"
    dsh_cli_source='参数 --dsh-cli'
    return
  fi
  if [ -n "${DSH_CLI:-}" ] && [ -f "${DSH_CLI}" ]; then
    dsh_cli="$DSH_CLI"
    dsh_cli_source='环境变量 DSH_CLI'
    return
  fi
  if [ -x "$packaged_cli" ]; then
    dsh_cli="$packaged_cli"
    dsh_cli_source='打包垫片 resources/deepscient/cli/dsh'
    return
  fi
  local candidate
  for candidate in \
    "$repo_root/dist/DeepScient.app/Contents/Resources/deepscient/cli/dsh" \
    "$HOME/Applications/DeepScient.app/Contents/Resources/deepscient/cli/dsh" \
    "/Applications/DeepScient.app/Contents/Resources/deepscient/cli/dsh" \
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
    "$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"; do
    if [ -x "$candidate" ]; then
      dsh_cli="$candidate"
      dsh_cli_source="$candidate"
      return
    fi
  done
  if command -v dsh >/dev/null 2>&1; then
    dsh_cli=$(command -v dsh)
    dsh_cli_source='PATH 中的 dsh'
    return
  fi
  echo '找不到 dsh。安装 DeepSeek Harness 桌面版，或用 --dsh-cli 指向 dsh 可执行文件。' >&2
  exit 1
}

log 'DeepScient desktop profile 装配开始'
log "DSH_HOME : $dsh_home"
log "profile  : $PROFILE"
log "repoRoot : $repo_root"
log "log      : $log_path"

packages=("$repo_root/deepscient" "$repo_root/dsh-science")
bundle_names=('@local/deepscient' '@local/dsh-science')

for package_dir in "${packages[@]}"; do
  if [ ! -f "$package_dir/package.json" ]; then
    if [ -d "$repo_root/../deepscient" ]; then
      echo "打包形态缺少 resources/deepscient/{deepscient,dsh-science}，请重新构建安装包。缺失：$package_dir" >&2
    fi
    echo "缺少本地包：$package_dir/package.json" >&2
    exit 1
  fi
done

resolve_dsh_cli
log "dsh CLI  : ${dsh_cli}（来源：${dsh_cli_source}）"

profile_dir="$dsh_home/profiles/$PROFILE"
manifest_path="$profile_dir/package.json"
mkdir -p "$profile_dir"

if [ ! -f "$manifest_path" ]; then
  node -e '
    const fs = require("node:fs")
    const [target, profile] = process.argv.slice(1)
    const skeleton = {
      name: `dsh-profile-${profile}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } },
    }
    fs.writeFileSync(target, JSON.stringify(skeleton, null, 2) + "\n")
  ' "$manifest_path" "$PROFILE"
  log "已写入 profile 骨架：$manifest_path"
else
  log "profile 已存在：$manifest_path"
fi

workspace_path="$profile_dir/pnpm-workspace.yaml"
if [ ! -f "$workspace_path" ]; then
  printf 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n' >"$workspace_path"
  log '已写入 pnpm-workspace.yaml'
fi

patch_path="$profile_dir/cordis.patch.yml"
if [ ! -f "$patch_path" ]; then
  printf '# DeepScient 桌面 profile 的用户补丁层（由 deepscient/desktop/assemble-profile.sh 维护）\n# 只写 apiKeyEnv 名称，不写密钥。\n[]\n' >"$patch_path"
  log '已写入空的 cordis.patch.yml'
fi

export DSH_HOME="$dsh_home"
export DSH_PROFILE="$PROFILE"

for package_dir in "${packages[@]}"; do
  log "link 本地包：$package_dir"
  if ! output=$("$dsh_cli" plugin --profile "$PROFILE" add "$package_dir" 2>&1); then
    printf '%s\n' "$output" | while IFS= read -r line; do log "  $line"; done
    echo "dsh plugin add 失败：${dsh_cli} plugin --profile ${PROFILE} add ${package_dir}（日志：${log_path}）" >&2
    exit 1
  fi
  printf '%s\n' "$output" | while IFS= read -r line; do log "  $line"; done
done

node -e '
  const fs = require("node:fs")
  const [manifestPath, ...required] = process.argv.slice(1)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  const current = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
  const missing = required.filter((name) => !current.includes(name))
  if (missing.length > 0) {
    manifest.dsh.profile.bundles = [...current, ...missing]
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
    console.log(`已补写 bundles：${missing.join(", ")}`)
  } else {
    console.log(`bundles 已包含：${required.join(", ")}`)
  }
' "$manifest_path" "${bundle_names[@]}" | while IFS= read -r line; do log "$line"; done

provider_block=$(cat <<'YAML'
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      treeapi:
        displayName: treeapi
        apiKeyEnv: TREEAPI_API_KEY
        api: openai-responses
        baseURL: https://api.treeapi.online/v1
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
      ccagent:
        displayName: ccagent
        apiKeyEnv: CCAGENT_API_KEY
        api: openai-responses
        baseURL: https://un.ccagent.cn/v1
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: ccagent
    model: deepseek-v4.1-flash
YAML
)

if [ "$SKIP_PROVIDERS" -eq 0 ]; then
  patch_text=$(cat "$patch_path")
  if printf '%s\n' "$patch_text" | grep -Eq '(^|[[:space:]])treeapi:[[:space:]]*$' \
    && printf '%s\n' "$patch_text" | grep -Eq '(^|[[:space:]])ccagent:[[:space:]]*$'; then
    log '供应商层已包含 treeapi / ccagent，跳过'
  else
    stripped=$(printf '%s\n' "$patch_text" | sed '/^[[:space:]]*#/d' | sed '/^[[:space:]]*$/d')
    if [ -z "$stripped" ] || [ "$stripped" = '[]' ]; then
      {
        printf '# DeepScient 桌面 profile 的用户补丁层（由 deepscient/desktop/assemble-profile.sh 维护）\n'
        printf '# 只写 apiKeyEnv 名称，不写密钥；密钥请设环境变量 TREEAPI_API_KEY / CCAGENT_API_KEY。\n'
        printf '%s\n' "$provider_block"
      } >"$patch_path"
      log '已写入供应商层（treeapi / ccagent + 默认模型）'
    elif ! printf '%s\n' "$patch_text" | grep -q 'id:[[:space:]]*llm-pi-ai'; then
      {
        printf '%s\n' "$patch_text"
        printf '%s\n' "$provider_block"
      } >"$patch_path"
      log '已追加供应商层（treeapi / ccagent + 默认模型）'
    else
      log '警告：cordis.patch.yml 已有 llm-pi-ai 配置但缺少 treeapi / ccagent，保留用户改动，请手工补齐'
    fi
  fi
fi

# 桌面壳必需的覆写：openInitialWindow → readWelcomeState 会调用 account/getState。
# DeepScient 公共补丁关闭了 account-controller，该 RPC 于是 404，壳报
# "desktop welcome: Web request failed" 且不创建任何窗口；这里只在本 profile 层重新启用。
desktop_block=$(cat <<'YAML'

# 桌面壳需要 account/getState 才能建窗；只在桌面层重新启用，不改公共补丁。
- id: account-controller
  name: "@deepseek-ai/dsh-api-account-controller"
  disabled: false
- id: deepseek-account
  name: "@deepseek-ai/dsh-deepseek-account-platform"
  disabled: false
YAML
)

current_patch=$(cat "$patch_path" 2>/dev/null || true)
if printf '%s\n' "$current_patch" | grep -q 'id:[[:space:]]*account-controller'; then
  log '桌面覆写已包含 account-controller / deepseek-account，跳过'
else
  {
    printf '%s\n' "$current_patch"
    printf '%s\n' "$desktop_block"
  } >"$patch_path"
  log '已追加桌面覆写（account-controller / deepseek-account 重新启用）'
fi

log '装配完成。下一步：运行 deepscient-desktop.sh 启动桌面窗口。'
log "日志已保存：$log_path"
