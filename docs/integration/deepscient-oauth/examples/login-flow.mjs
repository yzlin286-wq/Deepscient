#!/usr/bin/env node
/**
 * Deepscient 授权码登录完整流程演示（PKCE S256）。
 *
 * 流程：
 *   1. 生成 verifier / challenge / state
 *   2. 从 3081 起探测空闲端口（至 3099），在 127.0.0.1 上监听 /auth/callback
 *   3. 打开系统浏览器访问官网授权页（spawn 失败则打印 URL 让用户手动打开）
 *   4. 收到回调后校验 state，用 code + code_verifier 换取 access_token
 *   5. 用 Bearer 调用 /api/oauth/userinfo 并输出 user
 *
 * 用法：
 *   node examples/login-flow.mjs
 *   node examples/login-flow.mjs --base-url https://deepscient.com
 *
 * 本地联调（指向测试服务器）：
 *   node examples/login-flow.mjs --base-url http://127.0.0.1:18090
 *
 * 等待登录回调超时 120 秒，超时或出错会以非零码退出。
 */

import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";

const DEFAULT_BASE_URL = "https://deepscient.com";
const CLIENT_ID = "deepscient-desktop";
const PORT_MIN = 3081;
const PORT_MAX = 3099;
const CALLBACK_TIMEOUT_MS = 120_000;
const HTTP_TIMEOUT_MS = 30_000;

function parseBaseUrl(argv) {
  // 支持 `--base-url <url>` 与 `--base-url=<url>` 两种写法
  const i = argv.indexOf("--base-url");
  if (i !== -1 && argv[i + 1]) return argv[i + 1].replace(/\/+$/, "");
  const prefixed = argv.find((a) => a.startsWith("--base-url="));
  if (prefixed) return prefixed.slice("--base-url=".length).replace(/\/+$/, "");
  return DEFAULT_BASE_URL;
}

function createPkce() {
  const verifier = randomBytes(32).toString("base64url"); // 43 字符
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  return { verifier, challenge, state };
}

function listen(server, port) {
  // 以「监听成功」为判断依据（而不是先连接探测），避免竞态
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function listenOnFreePort(server) {
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    try {
      await listen(server, port);
      return port;
    } catch (err) {
      if (err?.code !== "EADDRINUSE") throw err;
    }
  }
  throw new Error(`端口 ${PORT_MIN}-${PORT_MAX} 均被占用，无法启动本地回调服务`);
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    // start 是 cmd 内建命令，需经由 cmd 调用
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  const printFallback = () => {
    console.error("无法自动打开浏览器，请手动复制以下地址到浏览器完成登录：");
    console.error(`  ${url}`);
  };
  try {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", printFallback);
  } catch {
    printFallback();
  }
}

function sendPage(res, status, title, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="font-family: system-ui, -apple-system, sans-serif; text-align: center; padding-top: 80px;">
<h1>${title}</h1>
<p>${body}</p>
</body>
</html>
`);
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function assertOk(res, url) {
  if (res.ok) return;
  const data = await readJson(res);
  const error = data?.error ?? "unknown_error";
  const message = data?.message ?? "响应不是合法 JSON";
  throw new Error(`请求 ${url} 失败（HTTP ${res.status}，error=${error}）：${message}`);
}

async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`请求 ${url} 失败：${err.message}`);
  }
  await assertOk(res, url);
  return res.json();
}

async function getJson(url, token) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`请求 ${url} 失败：${err.message}`);
  }
  await assertOk(res, url);
  return res.json();
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const base = parseBaseUrl(process.argv.slice(2));
  const { verifier, challenge, state } = createPkce();

  let settle;
  const callback = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/auth/callback") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const params = url.searchParams;
    const oauthError = params.get("error");
    const code = params.get("code");
    const returnedState = params.get("state");
    if (oauthError) {
      // 用户在授权页点了「取消」等：回调 error=access_denied&state=...
      sendPage(res, 200, "授权未完成", `错误码：${oauthError}，请返回应用重试。`);
      settle.reject(new Error(`授权未完成（error=${oauthError}）`));
    } else if (!code) {
      sendPage(res, 400, "回调参数缺失", "未收到授权码，请返回应用重试。");
      settle.reject(new Error("回调缺少 code 参数"));
    } else if (returnedState !== state) {
      sendPage(res, 400, "state 校验失败", "回调的 state 与发起授权时不一致，已拒绝。");
      settle.reject(new Error("state 校验失败：回调 state 与发起授权时不一致"));
    } else {
      sendPage(res, 200, "登录成功", "请返回应用。");
      settle.resolve(code);
    }
  });

  try {
    const port = await listenOnFreePort(server);
    const redirectUri = `http://127.0.0.1:${port}/auth/callback`;

    const authorizeUrl = new URL("/oauth/authorize", base);
    authorizeUrl.searchParams.set("client_id", CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    console.log(`本地回调服务已就绪：${redirectUri}`);
    console.log(`正在打开浏览器访问授权页：`);
    console.log(`  ${authorizeUrl.href}\n`);
    openBrowser(authorizeUrl.href);

    const code = await withTimeout(
      callback,
      CALLBACK_TIMEOUT_MS,
      `等待登录超时（${CALLBACK_TIMEOUT_MS / 1000} 秒）未收到回调，流程已退出，请重试`,
    );
    console.log("已收到授权码并通过 state 校验，正在换取 token ...");

    const token = await postJson(`${base}/api/oauth/token`, {
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    console.log("换取 token 成功：");
    console.log(`  access_token: ${token.access_token}`);
    console.log(`  token_type:   ${token.token_type}`);
    console.log(`  expires_in:   ${token.expires_in}`);

    const info = await getJson(`${base}/api/oauth/userinfo`, token.access_token);
    console.log("\nuserinfo 校验成功，当前用户：");
    console.log(JSON.stringify(info.user, null, 2));
    console.log("\n提示：请将 access_token 保存到 OS 凭据库或加密文件；收到 401 时清理本地 token 并重新登录。");
  } finally {
    server.close();
    // 立即断开残留连接（如浏览器 keep-alive），避免进程无法退出
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  }
}

main().catch((err) => {
  console.error(`\n错误：${err.message}`);
  process.exit(1);
});
