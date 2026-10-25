#!/usr/bin/env bash
#
# Deepscient 统一账号中心 curl 最小示例（注册 / 登录 / userinfo / revoke）。
#
# 用法（先设置环境变量，脚本内不写死任何真实值）：
#   export DS_EMAIL="you@example.com"        # 邮箱或用户名
#   export DS_PASSWORD="your-password"       # 至少 8 位
#   export DS_TOKEN="<access_token>"         # login 成功后从响应中获取
#
#   bash examples/curl.sh register           # 注册（需 DS_EMAIL / DS_PASSWORD）
#   bash examples/curl.sh login              # 密码直登 grant_type=password（需 DS_EMAIL / DS_PASSWORD）
#   bash examples/curl.sh userinfo           # 校验登录态（需 DS_TOKEN）
#   bash examples/curl.sh revoke              # 撤销 token（需 DS_TOKEN）
#
# 可选：本地联调时覆盖默认地址
#   BASE_URL=http://127.0.0.1:18090 bash examples/curl.sh login

set -euo pipefail

BASE_URL="${BASE_URL:-https://deepscient.com}"
CLIENT_ID="deepscient-desktop"

usage() {
  cat <<'EOF'
用法（先设置环境变量，脚本内不写死任何真实值）：
  export DS_EMAIL="you@example.com"        # 邮箱或用户名
  export DS_PASSWORD="your-password"       # 至少 8 位
  export DS_TOKEN="<access_token>"         # login 成功后从响应中获取

  bash examples/curl.sh register           # 注册（需 DS_EMAIL / DS_PASSWORD）
  bash examples/curl.sh login              # 密码直登 grant_type=password（需 DS_EMAIL / DS_PASSWORD）
  bash examples/curl.sh userinfo           # 校验登录态（需 DS_TOKEN）
  bash examples/curl.sh revoke             # 撤销 token（需 DS_TOKEN）

可选：本地联调时覆盖默认地址
  BASE_URL=http://127.0.0.1:18090 bash examples/curl.sh login
EOF
}

case "${1:-}" in
  register)
    : "${DS_EMAIL:?请先设置 DS_EMAIL（邮箱或用户名）}"
    : "${DS_PASSWORD:?请先设置 DS_PASSWORD（至少 8 位）}"
    curl -sS -X POST "$BASE_URL/api/auth/register" \
      -H "Content-Type: application/json" \
      -d "{\"email\": \"$DS_EMAIL\", \"password\": \"$DS_PASSWORD\"}"
    echo
    ;;
  login)
    : "${DS_EMAIL:?请先设置 DS_EMAIL（邮箱或用户名）}"
    : "${DS_PASSWORD:?请先设置 DS_PASSWORD}"
    curl -sS -X POST "$BASE_URL/api/oauth/token" \
      -H "Content-Type: application/json" \
      -d "{\"grant_type\": \"password\", \"client_id\": \"$CLIENT_ID\", \"username\": \"$DS_EMAIL\", \"password\": \"$DS_PASSWORD\"}"
    echo
    echo "提示：从上方响应的 access_token 字段取值，export DS_TOKEN=... 后可运行 userinfo / revoke。"
    ;;
  userinfo)
    : "${DS_TOKEN:?请先设置 DS_TOKEN（login 成功后获得的 access_token）}"
    curl -sS "$BASE_URL/api/oauth/userinfo" \
      -H "Authorization: Bearer $DS_TOKEN"
    echo
    ;;
  revoke)
    : "${DS_TOKEN:?请先设置 DS_TOKEN（login 成功后获得的 access_token）}"
    curl -sS -X POST "$BASE_URL/api/oauth/revoke" \
      -H "Content-Type: application/json" \
      -d "{\"token\": \"$DS_TOKEN\"}"
    echo
    ;;
  *)
    usage
    exit 1
    ;;
esac
