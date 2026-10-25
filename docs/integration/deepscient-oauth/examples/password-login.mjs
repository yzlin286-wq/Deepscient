#!/usr/bin/env node
/**
 * grant_type=password 直登演示（在应用登录页直接输入官网账号）。
 *
 * 用法（账号从 argv 或环境变量读取，脚本内不写死任何真实凭据）：
 *   node examples/password-login.mjs <邮箱或用户名> [密码]
 * 或
 *   DEEPSCIENT_EMAIL=<邮箱或用户名> DEEPSCIENT_PASSWORD=<密码> node examples/password-login.mjs
 *
 * 本地联调（指向测试服务器）：
 *   node examples/password-login.mjs --base-url http://127.0.0.1:18090
 *
 * 注意：密码只应出现在本次请求中，不要写入磁盘或打印到日志。
 */

const DEFAULT_BASE_URL = "https://deepscient.com";
const CLIENT_ID = "deepscient-desktop";
const HTTP_TIMEOUT_MS = 30_000;

function usage() {
  console.error(`用法：
  node examples/password-login.mjs <邮箱或用户名> [密码]
  DEEPSCIENT_EMAIL=<邮箱或用户名> DEEPSCIENT_PASSWORD=<密码> node examples/password-login.mjs

可选参数：
  --base-url <URL>   覆盖默认地址 ${DEFAULT_BASE_URL}（本地联调用）`);
}

function parseArgs(argv) {
  let base = DEFAULT_BASE_URL;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base-url" && argv[i + 1]) {
      base = argv[++i];
    } else if (arg.startsWith("--base-url=")) {
      base = arg.slice("--base-url=".length);
    } else {
      positional.push(arg);
    }
  }
  return { base: base.replace(/\/+$/, ""), positional };
}

const { base, positional } = parseArgs(process.argv.slice(2));
const username = positional[0] ?? process.env.DEEPSCIENT_EMAIL;
const password = positional[1] ?? process.env.DEEPSCIENT_PASSWORD;

if (!username || !password) {
  usage();
  process.exit(1);
}

try {
  const res = await fetch(`${base}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "password",
      client_id: CLIENT_ID,
      username,
      password,
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = data?.error ?? "unknown_error";
    const message = data?.message ?? "响应不是合法 JSON";
    console.error(`登录失败（HTTP ${res.status}，error=${error}）：${message}`);
    process.exit(1);
  }

  console.log("登录成功：");
  console.log(`  access_token: ${data.access_token}`);
  console.log(`  token_type:   ${data.token_type}`);
  console.log(`  expires_in:   ${data.expires_in}`);
  console.log("\n当前用户：");
  console.log(JSON.stringify(data.user, null, 2));
  console.log("\n提示：请将 access_token 保存到 OS 凭据库或加密文件；密码不要落盘。");
} catch (err) {
  console.error(`请求失败：${err.message}`);
  process.exit(1);
}
