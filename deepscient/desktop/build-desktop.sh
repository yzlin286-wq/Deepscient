#!/usr/bin/env bash
# DeepScient 桌面派生构建（macOS 版，等价于 build-desktop.ps1）
#
# 目标：把官方 DeepSeek Harness.app（Electron 桌面壳，macOS 构建产物）派生成独立应用
#       dist/DeepScient.app：改名、改 appId、把默认数据根从 ~/.dsh 改成 ~/.deepscient、
#       解包 app.asar 以便改写主进程、内置两个本地插件、提供 CLI 垫片与启动器。
#
# 只读约束：绝不修改源 .app；不复制任何用户数据/密钥；不写 ~/.dsh。
# 幂等：重复运行只重建 dist/DeepScient.app。
#
# 用法：
#   bash deepscient/desktop/build-desktop.sh [--shell <DeepSeek Harness.app>] [--dest <DeepScient.app>] [--asar <asar 可执行文件>]
set -euo pipefail

shell_app=''
dest_app=''
asar_bin=''

while [ $# -gt 0 ]; do
  case "$1" in
    --shell) shell_app="${2:-}"; shift 2 ;;
    --dest) dest_app="${2:-}"; shift 2 ;;
    --asar) asar_bin="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../.." && pwd)
started_at=$(date '+%s')

step() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = 'Darwin' ] || die 'build-desktop.sh 只在 macOS 上运行'

# ── 定位源壳 ────────────────────────────────────────────────────────────
if [ -z "$shell_app" ]; then
  shell_app="${DSH_SHELL_APP:-}"
fi
if [ -z "$shell_app" ]; then
  for candidate in \
    "$repo_root/vendor/DeepSeek Harness.app" \
    "$repo_root/../deepseek-harness/apps/desktop/.desktop-build/targets/mac-arm64/artifacts/mac-arm64/DeepSeek Harness.app" \
    "$repo_root/../deepseek-harness/apps/desktop/.desktop-build/targets/mac-arm64/DeepSeek Harness.app" \
    "$repo_root/../deepseek-harness/apps/desktop/.desktop-build/targets/mac-arm64/artifacts/DeepSeek Harness.app" \
    "$repo_root/../deepseek-harness/apps/desktop/dist/mac-arm64/DeepSeek Harness.app" \
    "$repo_root/../deepseek-harness/apps/desktop/dist/mac/DeepSeek Harness.app" \
    "/Applications/DeepSeek Harness.app"; do
    if [ -d "$candidate" ]; then shell_app="$candidate"; break; fi
  done
fi
[ -n "$shell_app" ] || die '找不到 DeepSeek Harness.app。用 --shell 指定，或先构建桌面壳（见 README-macos.md）'
[ -d "$shell_app" ] || die "指定的源壳不存在：$shell_app"
shell_app=$(cd "$shell_app" && pwd)

[ -z "$dest_app" ] && dest_app="$repo_root/dist/DeepScient.app"
dest_parent=$(dirname "$dest_app")
mkdir -p "$dest_parent"
dest_parent=$(cd "$dest_parent" && pwd)
dest_app="$dest_parent/$(basename "$dest_app")"

src_contents="$shell_app/Contents"
src_resources="$src_contents/Resources"
src_plist="$src_contents/Info.plist"

[ -f "$src_plist" ] || die "源壳缺少 Info.plist：$src_plist"

src_exec=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$src_plist" 2>/dev/null || true)
[ -n "$src_exec" ] || die "源壳 Info.plist 缺少 CFBundleExecutable：$src_plist"
[ -x "$src_contents/MacOS/$src_exec" ] || die "源壳可执行文件不存在：$src_contents/MacOS/$src_exec"

src_asar="$src_resources/app.asar"
src_app_dir="$src_resources/app"
if [ ! -f "$src_asar" ] && [ ! -f "$src_app_dir/package.json" ]; then
  die "源壳里既没有 app.asar 也没有解包的 app/：$src_resources"
fi

if [ "$dest_app" = "$shell_app" ]; then die '产物目录不能等于源壳目录'; fi
case "$dest_app" in
  "$shell_app"/*) die "产物目录不能位于源壳内：$dest_app" ;;
esac

src_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$src_plist" 2>/dev/null || true)
[ -n "$src_version" ] || src_version='unknown'

step 'DeepScient 桌面派生构建开始'
step "源壳     : ${shell_app}（${src_version}）"
step "产物     : $dest_app"

# ── 复制壳 ──────────────────────────────────────────────────────────────
if [ -e "$dest_app" ]; then
  step '清理旧产物'
  chmod -R u+w "$dest_app" 2>/dev/null || true
  rm -rf "$dest_app"
fi
step '复制 .app（ditto，保留符号链接与扩展属性）'
ditto "$shell_app" "$dest_app"

contents="$dest_app/Contents"
resources="$contents/Resources"
plist="$contents/Info.plist"
[ -f "$plist" ] || die "派生产物缺少 Info.plist：$plist"

# ── 可执行文件改名 ──────────────────────────────────────────────────────
step "派生可执行文件 DeepScient（原 ${src_exec}）"
if [ "$src_exec" != 'DeepScient' ]; then
  if [ -e "$contents/MacOS/DeepScient" ]; then rm -f "$contents/MacOS/DeepScient"; fi
  mv "$contents/MacOS/$src_exec" "$contents/MacOS/DeepScient"
fi
chmod +x "$contents/MacOS/DeepScient"

# Electron 用「主可执行文件名 + " Helper"」定位 Framework 里的四个 helper
# （Helper / Helper (GPU) / Helper (Renderer) / Helper (Plugin)）。主程序改名后
# 不同步改 helper，启动会直接 FATAL: Unable to find helper app。
step '派生 helper 应用（GPU / Renderer / Plugin）'
for suffix in '' ' (GPU)' ' (Renderer)' ' (Plugin)'; do
  old_helper="$contents/Frameworks/${src_exec} Helper${suffix}.app"
  new_helper="$contents/Frameworks/DeepScient Helper${suffix}.app"
  [ -d "$old_helper" ] || continue
  [ "$old_helper" = "$new_helper" ] || mv "$old_helper" "$new_helper"
  helper_plist="$new_helper/Contents/Info.plist"
  helper_exec=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$helper_plist")
  if [ "$helper_exec" != "DeepScient Helper${suffix}" ]; then
    mv "$new_helper/Contents/MacOS/$helper_exec" "$new_helper/Contents/MacOS/DeepScient Helper${suffix}"
  fi
  /usr/libexec/PlistBuddy -c "Set :CFBundleExecutable DeepScient Helper${suffix}" "$helper_plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName DeepScient Helper${suffix}" "$helper_plist"
  /usr/libexec/PlistBuddy -c 'Set :CFBundleName DeepScient Helper' "$helper_plist"
  helper_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$helper_plist")
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${helper_id/com.deepseek.harness/com.deepscient.workbench}" "$helper_plist"
done

# ── Info.plist ─────────────────────────────────────────────────────────
step '改写 Info.plist（名称 / Bundle ID / 可执行文件）'
set_plist() {
  local key="$1" value="$2"
  if /usr/libexec/PlistBuddy -c "Print :$key" "$plist" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :$key $value" "$plist"
  else
    /usr/libexec/PlistBuddy -c "Add :$key string $value" "$plist"
  fi
}
set_plist CFBundleExecutable DeepScient
set_plist CFBundleName DeepScient
set_plist CFBundleDisplayName DeepScient
set_plist CFBundleIdentifier com.deepscient.workbench

# ── 解包 app.asar（mac 构建默认只出 asar，Windows 安装包则带解包目录） ──
resources_app="$resources/app"
if [ ! -f "$resources_app/package.json" ]; then
  [ -f "$resources/app.asar" ] || die "缺少 $resources/app.asar，无法解包"
  if [ -z "$asar_bin" ]; then
    for candidate in \
      "${ELECTRON_ASAR:-}" \
      "$repo_root/../deepseek-harness/node_modules/@electron/asar/bin/asar.js" \
      "$repo_root/../deepseek-harness/node_modules/.pnpm/"@electron+asar@*/node_modules/@electron/asar/bin/asar.js \
      "$repo_root/node_modules/@electron/asar/bin/asar.js"; do
      if [ -n "$candidate" ] && [ -f "$candidate" ]; then asar_bin="$candidate"; break; fi
    done
  fi
  if [ -z "$asar_bin" ] && command -v asar >/dev/null 2>&1; then asar_bin=$(command -v asar); fi
  [ -n "$asar_bin" ] || die '找不到 @electron/asar。用 --asar 指定 asar.js，或在 deepseek-harness 里装好依赖'
  step "解包 app.asar → $resources_app"
  mkdir -p "$resources_app"
  if [ "${asar_bin##*.}" = 'js' ]; then
    node "$asar_bin" extract "$resources/app.asar" "$resources_app"
  else
    "$asar_bin" extract "$resources/app.asar" "$resources_app"
  fi
fi

# 原生模块（*.node / *.dylib / spawn-helper / rg）被 asar 放在 app.asar.unpacked，
# 关掉 asar 后必须物理合并进解包目录，否则主进程加载原生模块会失败。
if [ -d "$resources/app.asar.unpacked" ]; then
  step '合并 app.asar.unpacked（原生模块）'
  ditto "$resources/app.asar.unpacked" "$resources_app"
fi

if [ -f "$resources/app.asar" ]; then
  step 'app.asar → app.asar.disabled'
  mv -f "$resources/app.asar" "$resources/app.asar.disabled"
fi
[ -f "$resources/app.asar.disabled" ] || die '缺少 app.asar.disabled，Electron 可能仍会加载 app.asar'

# Windows 安装包形态里 resources/app/runtime 是指向 resources/runtime 的 junction；
# mac 构建只产出 asar，解包后没有这一层，主进程解析 ${app}/runtime/primary-runtime 会
# 直接 MODULE_NOT_FOUND（pnpm.mjs 找不到），所以这里补同一条相对链接。
if [ ! -e "$resources_app/runtime" ]; then
  step '补 resources/app/runtime → ../runtime'
  ln -sfn ../runtime "$resources_app/runtime"
fi
[ -d "$resources_app/runtime/primary-runtime" ] || die 'resources/app/runtime/primary-runtime 不可用（链接或运行时缺失）'

dest_app_pkg="$resources_app/package.json"
[ -f "$dest_app_pkg" ] || die "解包结果缺少 package.json：$dest_app_pkg"

# ── app/package.json ───────────────────────────────────────────────────
step '改写 resources/app/package.json'
node -e '
  const fs = require("node:fs")
  const target = process.argv[1]
  const manifest = JSON.parse(fs.readFileSync(target, "utf8"))
  manifest.name = "DeepScient"
  manifest.productName = "DeepScient"
  manifest.dshDesktopAppId = "com.deepscient.workbench"
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n")
  if (manifest.name !== "DeepScient" || manifest.productName !== "DeepScient") {
    console.error("package.json 改写失败")
    process.exit(1)
  }
' "$dest_app_pkg"

# ── 主进程 main.js ─────────────────────────────────────────────────────
dest_main="$resources_app/lib/main.js"
[ -f "$dest_main" ] || die "缺少主进程 bundle：$dest_main"

step '改写 resources/app/lib/main.js（默认数据根 + 桌面标记）'
node -e '
  const fs = require("node:fs")
  const target = process.argv[1]
  let text = fs.readFileSync(target, "utf8")
  const before = text
  text = text.replaceAll("const DSH_HOME_DIR_NAME = \".dsh\";", "const DSH_HOME_DIR_NAME = \".deepscient\";")
  text = text.replaceAll("const home = process.env.DSH_HOME || join(homedir(), \".dsh\");", "const home = process.env.DSH_HOME || join(homedir(), \".deepscient\");")
  text = text.replaceAll("* `~/.dsh`. The harness keeps all user data under one root.", "* `~/.deepscient`. The harness keeps all user data under one root.")
  if (!text.includes("const DSH_HOME_DIR_NAME = \".deepscient\";")) {
    console.error("main.js：默认数据根未改成 .deepscient（找不到 DSH_HOME_DIR_NAME 字面量）")
    process.exit(1)
  }
  if (text.includes("DSH_HOME_DIR_NAME = \".dsh\"")) {
    console.error("main.js：仍存在指向 ~/.dsh 的默认根")
    process.exit(1)
  }
  // 双击 .app 时没有启动器设置环境变量：把桌面形态的两个默认值写进主进程。
  const prelude = [
    "// DeepScient 桌面派生：Finder 双击启动时也要走桌面身份与独立数据根。",
    "process.env.DEEPSCIENT_DESKTOP ??= \"1\";",
    "process.env.DSH_PROFILE ??= \"desktop\";",
    "process.env.DSH_DESKTOP_UPDATE_CHECK_INTERVAL_MS ??= \"2147483647\";",
    "",
  ].join("\n")
  if (!text.startsWith("// DeepScient 桌面派生")) text = prelude + text
  if (text !== before) fs.writeFileSync(target, text)
  console.log("main.js 已更新")
' "$dest_main"

# ── 内置插件 ───────────────────────────────────────────────────────────
bundle_root="$resources/deepscient"
step "内置插件 → $bundle_root"
mkdir -p "$bundle_root"
for name in deepscient dsh-science; do
  src="$repo_root/$name"
  [ -f "$src/package.json" ] || die "找不到内置插件源码：$src"
  target="$bundle_root/$name"
  rm -rf "$target"
  mkdir -p "$target"
  step "复制插件 $name"
  rsync -a \
    --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
    --exclude 'logs' --exclude 'backup' --exclude 'skills-vendor' \
    --exclude 'desktop/vendor' --exclude 'local.patch.yml' \
    --exclude '*.log' --exclude '*.tgz' --exclude 'token.json' \
    --exclude '.env' --exclude '.env.*' --exclude '*.pem' --exclude '*.key' \
    "$src/" "$target/"
done

for required in \
  "$bundle_root/deepscient/package.json" \
  "$bundle_root/dsh-science/package.json" \
  "$bundle_root/dsh-science/lib/science/orchestra/scheduler.js" \
  "$bundle_root/dsh-science/data/org/roles.json"; do
  [ -f "$required" ] || die "内置插件缺少关键文件：$required"
done

# ── CLI 垫片 ───────────────────────────────────────────────────────────
cli_dir="$bundle_root/cli"
mkdir -p "$cli_dir"
cli_entry="$resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"
[ -f "$cli_entry" ] || die "CLI 垫片入口不存在：$cli_entry"
cat >"$cli_dir/dsh" <<'SHIM'
#!/bin/sh
# 只在本应用内有效：用本应用自带的 Electron（Node 模式）跑 desktop-host CLI。
set -e
here=$(cd "$(dirname "$0")" && pwd)
resources=$(cd "$here/../.." && pwd)
contents=$(cd "$resources/.." && pwd)
entry="$resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"
[ -f "$entry" ] || entry="$resources/app.asar.unpacked/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"
ELECTRON_RUN_AS_NODE=1 exec "$contents/MacOS/DeepScient" --expose-internals "$entry" "$@"
SHIM
chmod +x "$cli_dir/dsh"
step "已写入 CLI 垫片：$cli_dir/dsh"

# ── 启动器 ─────────────────────────────────────────────────────────────
launcher="$dest_parent/启动 DeepScient.command"
cat >"$launcher" <<'LAUNCH'
#!/bin/sh
# DeepScient 桌面版启动器：双击或 `bash "启动 DeepScient.command"`。
cd "$(dirname "$0")" || exit 1
exec ./DeepScient.app/Contents/Resources/deepscient/deepscient/desktop/deepscient-desktop.sh "$@"
LAUNCH
chmod +x "$launcher"
step "已写入启动器：$launcher"

# ── 硬约束自检 ─────────────────────────────────────────────────────────
for bad in "$bundle_root/deepscient/node_modules" "$bundle_root/dsh-science/node_modules" \
  "$bundle_root/deepscient/skills-vendor" "$bundle_root/dsh-science/skills-vendor" \
  "$bundle_root/deepscient/token.json" "$bundle_root/dsh-science/token.json"; do
  [ ! -e "$bad" ] || die "插件目录里出现了不应存在的条目：$bad"
done
for forbidden in "$dest_app/profiles" "$resources/profiles" "$dest_app/.deepscient"; do
  [ ! -e "$forbidden" ] || die "产物里出现了不应存在的目录：$forbidden"
done

# ── BUILD-INFO.json ────────────────────────────────────────────────────
step '写入 BUILD-INFO.json'
file_count=$(find "$dest_app" -type f | wc -l | tr -d ' ')
total_bytes=$(du -sk "$dest_app" | awk '{print $1 * 1024}')
plugin_entry_sha=$(shasum -a 256 "$bundle_root/deepscient/host/index.js" | awk '{print $1}')
node -e '
  const fs = require("node:fs")
  const [target, payload] = process.argv.slice(1)
  fs.writeFileSync(target, JSON.stringify(JSON.parse(payload), null, 2) + "\n")
' "$resources/BUILD-INFO.json" "$(node -e '
  const out = {
    source: process.argv[1],
    destination: process.argv[2],
    shellVersion: process.argv[3],
    productVersion: JSON.parse(require("node:fs").readFileSync(process.argv[4], "utf8")).version,
    platform: `${process.platform}-${process.arch}`,
    builtAt: new Date().toISOString(),
    files: Number(process.argv[5]),
    bytes: Number(process.argv[6]),
    excluded: {
      note: "未复制任何用户数据或密钥：不含 profiles/、token.json、.env、私钥；插件只含源码与随包数据，不含 node_modules / skills-vendor",
    },
    bundledPlugins: [{ name: "deepscient", entry: "host/index.js", entrySha256: process.argv[7] }],
  }
  process.stdout.write(JSON.stringify(out))
' "$shell_app" "$dest_app" "$src_version" "$dest_app_pkg" "$file_count" "$total_bytes" "$plugin_entry_sha")"

# ── 重新 ad-hoc 签名 ───────────────────────────────────────────────────
# 派生改动了 Info.plist、主可执行文件、helper 与 Resources，原 ad-hoc 签名必然失效；
# arm64 上签名无效的应用会被内核拒绝启动，所以整包重签（含 JIT 与库校验豁免）。
if command -v codesign >/dev/null 2>&1; then
  step '重新 ad-hoc 签名（--deep，含 JIT / 库校验豁免）'
  ent_plist="$dest_parent/.deepscient-entitlements.plist"
  cat >"$ent_plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
  </dict>
</plist>
PLIST
  sign_log="$dest_parent/.deepscient-sign.log"
  if codesign --force --deep --sign - --options runtime --entitlements "$ent_plist" "$dest_app" >"$sign_log" 2>&1; then
    if codesign --verify --deep --strict "$dest_app" >>"$sign_log" 2>&1; then
      step '签名校验通过'
    else
      step "警告：签名校验未通过，详见 $sign_log"
    fi
  else
    step "警告：ad-hoc 重签失败，详见 $sign_log"
  fi
  rm -f "$ent_plist"
fi

elapsed=$(( $(date '+%s') - started_at ))
printf '\n构建完成\n'
printf '产物路径 : %s\n' "$dest_app"
printf '启动器   : %s\n' "$launcher"
printf '壳版本   : %s\n' "$src_version"
printf '文件数   : %s\n' "$file_count"
printf '总字节   : %s\n' "$total_bytes"
printf '耗时     : %s 秒\n' "$elapsed"
