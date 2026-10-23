#!/usr/bin/env bash
# DeepScient 桌面入口（macOS 版，等价于 deepscient-desktop.ps1）
#
# 用官方 DeepSeek Harness 桌面壳（Electron）承载 DeepScient：
#   - 数据根固定为 <DSH_HOME>（默认 ~/.deepscient），与 Web 形态共用同一批课题
#   - 桌面壳固定使用 profile desktop（DSH_PROFILE 默认值）
#   - userData 独立到 <DSH_HOME>/desktop-userdata，避免和日常 DeepSeek Harness 抢单实例锁
#
# 只读约束：不修改源 .app、不写 ~/.dsh。
#
# 用法：
#   bash deepscient/desktop/deepscient-desktop.sh [--home <dir>] [--executable <DeepScient>] [--no-assemble] [--web-fallback] [--create-shortcuts]
set -uo pipefail

dsh_home_arg=''
executable=''
no_assemble=0
web_fallback=0
create_shortcuts=0

while [ $# -gt 0 ]; do
  case "$1" in
    --home) dsh_home_arg="${2:-}"; shift 2 ;;
    --executable) executable="${2:-}"; shift 2 ;;
    --no-assemble) no_assemble=1; shift ;;
    --web-fallback) web_fallback=1; shift ;;
    --create-shortcuts) create_shortcuts=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../.." && pwd)

if [ -n "$dsh_home_arg" ]; then
  dsh_home="$dsh_home_arg"
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
log_path="$logs_dir/desktop-$stamp.log"
err_path="$logs_dir/desktop-$stamp.err.log"
shell_log_path="$logs_dir/desktop-$stamp.shell.log"

log() {
  local line
  line="[$(date '+%H:%M:%S')] $*"
  printf '%s\n' "$line"
  printf '%s\n' "$line" >>"$log_path"
}

# 打包形态：本脚本位于 <App>/Contents/Resources/deepscient/deepscient/desktop
packaged_app=''
case "$script_dir" in
  *.app/Contents/Resources/deepscient/deepscient/desktop)
    packaged_app="${script_dir%%.app/Contents*}".app ;;
esac

app_executable() {
  local app="$1"
  [ -d "$app" ] || return 1
  local exec
  exec=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist" 2>/dev/null || true)
  [ -n "$exec" ] && [ -x "$app/Contents/MacOS/$exec" ] || return 1
  printf '%s\n' "$app/Contents/MacOS/$exec"
}

log 'DeepScient 桌面入口'
log "DSH_HOME : $dsh_home"

if [ "$create_shortcuts" -eq 1 ]; then
  apps_dir="$HOME/Applications"
  desktop_dir="$HOME/Desktop"
  mkdir -p "$apps_dir"
  target_app="${packaged_app:-$repo_root/dist/DeepScient.app}"
  if [ -d "$target_app" ]; then
    ln -sfn "$target_app" "$apps_dir/DeepScient.app"
    log "已建立 ~/Applications/DeepScient.app → $target_app"
    if [ -d "$desktop_dir" ]; then
      ln -sfn "$target_app" "$desktop_dir/DeepScient.app"
      log '已建立桌面快捷方式'
    fi
  else
    log "未找到 DeepScient.app，跳过快捷方式（先跑 build-desktop.sh）"
  fi
  exit 0
fi

profile_dir="$dsh_home/profiles/desktop"
profile_manifest="$profile_dir/package.json"
science_link="$profile_dir/node_modules/@local/dsh-science/package.json"
need_assemble=0
reason=''
if [ ! -f "$profile_manifest" ]; then
  need_assemble=1
  reason='profile 尚未装配'
elif [ ! -f "$science_link" ]; then
  need_assemble=1
  reason='profile 依赖缺失（node_modules/@local/dsh-science 不存在），重新装配'
fi

if [ "$no_assemble" -eq 0 ] && [ "$need_assemble" -eq 1 ]; then
  if [ -f "$script_dir/assemble-profile.sh" ]; then
    log "$reason"
    if ! bash "$script_dir/assemble-profile.sh" --home "$dsh_home"; then
      printf 'assemble-profile.sh 失败，详见 %s\n' "$logs_dir" >&2
      exit 1
    fi
  fi
fi

if [ -z "$executable" ] && [ -n "$packaged_app" ]; then
  executable=$(app_executable "$packaged_app" || true)
fi
if [ -z "$executable" ]; then
  executable=$(app_executable "$repo_root/dist/DeepScient.app" || true)
fi
if [ -z "$executable" ]; then
  for candidate in '/Applications/DeepSeek Harness.app' "$HOME/Applications/DeepSeek Harness.app"; do
    executable=$(app_executable "$candidate" || true)
    [ -n "$executable" ] && break
  done
fi
[ -n "$executable" ] || { echo '找不到桌面壳：先跑 build-desktop.sh，或用 --executable 指定' >&2; exit 1; }
[ -x "$executable" ] || { echo "指定的桌面壳不可执行：$executable" >&2; exit 1; }
log "桌面壳   : $executable"

user_data_dir="$dsh_home/desktop-userdata"
mkdir -p "$user_data_dir"

export DSH_HOME="$dsh_home"
export DSH_PROFILE='desktop'
# 桌面壳转发请求时会用设备 cookie 覆盖 Cookie 头，deepscient_session 到不了后端；
# 这个标记让 host 以「磁盘 token = 本机身份」认账（Web 形态不设，行为不变）。
export DEEPSCIENT_DESKTOP='1'
# 桌面壳默认每 10 分钟检查一次 DeepSeek Harness 更新；DeepScient 不是它的发布通道，拉长到上限。
export DSH_DESKTOP_UPDATE_CHECK_INTERVAL_MS='2147483647'
export DSH_DESKTOP_DIAGNOSTIC_FILE="$logs_dir/desktop-diagnostic-$stamp.log"

instance_pids() {
  pgrep -f -- "--user-data-dir=$user_data_dir" 2>/dev/null || true
}

existing=$(instance_pids)
if [ -n "$existing" ]; then
  log "已有一个使用同一数据根的实例（PID $(printf '%s' "$existing" | tr '\n' ' ')），请求聚焦后退出"
  "$executable" --user-data-dir="$user_data_dir" >/dev/null 2>&1 &
  exit 0
fi

if [ "$web_fallback" -eq 1 ]; then
  log '按参数要求走 Web 回退'
else
  log "启动桌面壳，日志：$shell_log_path"
  "$executable" --user-data-dir="$user_data_dir" >"$shell_log_path" 2>"$err_path" &
  shell_pid=$!
  log "桌面壳 PID：$shell_pid"

  deadline=$(( $(date '+%s') + 15 ))
  while [ "$(date '+%s')" -lt "$deadline" ] && kill -0 "$shell_pid" 2>/dev/null; do sleep 0.5; done

  if kill -0 "$shell_pid" 2>/dev/null; then
    origin=''
    origin_deadline=$(( $(date '+%s') + 20 ))
    while [ -z "$origin" ] && [ "$(date '+%s')" -lt "$origin_deadline" ]; do
      if [ -f "$shell_log_path" ]; then
        origin=$(grep -Eo 'dsh web:[[:space:]]*http://127\.0\.0\.1:[0-9]+' "$shell_log_path" 2>/dev/null | head -1 | grep -Eo 'http://127\.0\.0\.1:[0-9]+' || true)
      fi
      [ -z "$origin" ] && sleep 0.5
    done
    if [ -n "$origin" ]; then
      log "桌面端口 : ${origin}（壳内 URL，不占 3081-3099）"
    else
      log '桌面端口 : 壳尚未打印（端口由桌面壳分配，日志里没有 dsh web 行）'
    fi
    log '桌面窗口已就绪（进程存活），本脚本退出'
    exit 0
  fi

  # 提前退出不等于失败：桌面壳有单实例锁，第二次启动的新进程会把窗口交给已有实例后立刻退出。
  still=$(instance_pids)
  if [ -n "$still" ]; then
    log "桌面壳已交给已有实例（PID $(printf '%s' "$still" | tr '\n' ' ')），不启动 Web 回退"
    exit 0
  fi
  log '桌面壳提前退出，回退到 Web 形态'
fi

launch_script="$repo_root/bin/deepscient"
[ -x "$launch_script" ] || { echo "桌面壳启动失败，且找不到回退启动器：$launch_script" >&2; exit 1; }
log "回退 Web 形态（${launch_script}）"
DSH_HOME="$dsh_home" exec bash "$launch_script"
