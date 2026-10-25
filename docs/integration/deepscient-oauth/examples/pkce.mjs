#!/usr/bin/env node
/**
 * PKCE（S256）与 state 生成。
 *
 * - verifier：43–128 字符（本实现固定 43 字符，满足 RFC 7636 要求）
 * - challenge：BASE64URL(SHA256(verifier))
 * - state：随机 hex，回调时原样比对，用于防 CSRF
 *
 * 用法：
 *   node examples/pkce.mjs
 *
 * 在应用代码中引用：
 *   import { createPkce } from "./examples/pkce.mjs";
 *
 * 注意：每次登录都应生成一组新值，不要复用。
 */

import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export function createPkce() {
  // 32 字节随机数 → BASE64URL 编码后为 43 字符，落在 RFC 7636 的 [43, 128] 区间
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  return { verifier, challenge, state };
}

// `node pkce.mjs` 直接运行时打印 JSON；被其它模块 import 时不打印
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(createPkce(), null, 2));
}
