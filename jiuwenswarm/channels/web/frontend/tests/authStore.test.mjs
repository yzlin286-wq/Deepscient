import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.cache/auth-store/vite',
  server: { middlewareMode: true, hmr: false, watch: null },
  define: { 'import.meta.env.DEV': false },
});
let modules;
try {
  modules = await Promise.all([
    vite.ssrLoadModule('/src/stores/authStore.ts'),
    vite.ssrLoadModule('/src/services/webClient.ts'),
  ]);
} finally {
  await vite.close();
}
const [{ useAuthStore }, { webClient }] = modules;
const initialState = useAuthStore.getState();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await sleep(20);
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function withBackend(routes, run) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const windows = [];
  dom.window.open = (url) => {
    const win = { url, opener: dom.window, closed: false, close() { this.closed = true; } };
    windows.push(win);
    return win;
  };
  const calls = [];
  const saved = new Map();
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    sessionStorage: dom.window.sessionStorage,
    CustomEvent: dom.window.CustomEvent,
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return routes(String(url), init);
    },
  })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const originalReconnect = webClient.reconnect;
  webClient.reconnect = async () => {};
  useAuthStore.setState(initialState, true);
  try {
    await run({ windows, calls });
  } finally {
    useAuthStore.getState().cancelLogin();
    webClient.reconnect = originalReconnect;
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    dom.window.close();
  }
}

const authorizeBody = (n) => ({ authorizeUrl: `https://oauth/${n}`, state: `s${n}`, claimToken: `ct${n}` });

const accountStatus = {
  enabled: true,
  provider: 'deepscient',
  userId: 'user-1',
  userName: 'Ada',
  email: 'ada@example.com',
  role: 'pro',
  balance: 128.5,
  expiresAt: '2026-12-31T00:00:00Z',
  accountCenterUrl: 'https://deepscient.example/account',
  registerUrl: 'https://deepscient.example/register',
};

test('login completes when the claim succeeds and applies the account fields', async () => {
  const claims = [];
  await withBackend((url, init) => {
    if (url.endsWith('/authorize')) return json(200, authorizeBody(1));
    if (url.endsWith('/claim')) {
      claims.push(JSON.parse(init.body));
      return json(200, { ok: true, islogin: true, ...accountStatus });
    }
    throw new Error(`unexpected ${url}`);
  }, async ({ windows, calls }) => {
    await useAuthStore.getState().startLogin();
    assert.equal(windows.length, 1);
    await useAuthStore.getState().checkLogin();
    await waitFor(() => useAuthStore.getState().islogin);

    assert.deepEqual(claims, [{ state: 's1', claimToken: 'ct1' }]);
    const state = useAuthStore.getState();
    assert.equal(state.phase, 'idle');
    assert.equal(state.userId, 'user-1');
    assert.equal(state.userName, 'Ada');
    assert.equal(state.email, 'ada@example.com');
    assert.equal(state.role, 'pro');
    assert.equal(state.balance, 128.5);
    assert.equal(state.expiresAt, '2026-12-31T00:00:00Z');
    assert.equal(state.accountCenterUrl, 'https://deepscient.example/account');
    assert.equal(state.registerUrl, 'https://deepscient.example/register');
    // 免费额度接口已下线：登录后不再去拉 models / quota
    assert.equal(calls.some((call) => /\/(models|quota)$/.test(call.url)), false);
  });
});

test('the callback page broadcast triggers a claim; window messages do not', async () => {
  await withBackend((url) => {
    if (url.endsWith('/authorize')) return json(200, authorizeBody(1));
    if (url.endsWith('/claim')) return json(200, { islogin: true, userId: 'openid-1' });
    throw new Error(`unexpected ${url}`);
  }, async ({ windows, calls }) => {
    await useAuthStore.getState().startLogin();
    assert.equal(windows[0].opener, null, '授权窗口不能留着能反向导航本页的引用');

    window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'jiuwenswarm:auth-callback' } }));
    await sleep(50);
    assert.equal(calls.filter((c) => c.url.endsWith('/claim')).length, 0);

    const landing = new BroadcastChannel('jiuwenswarm:auth');
    landing.postMessage({ type: 'jiuwenswarm:auth-callback', ok: true });
    landing.close();
    await waitFor(() => useAuthStore.getState().islogin);

    const stateChanging = calls.filter((c) => /\/(authorize|claim)$/.test(c.url));
    assert.equal(stateChanging.length, 2);
    for (const call of stateChanging) assert.equal(call.init.headers['X-Jiuwen-Auth'], '1');
  });
});

test('cancel while fetching the authorize URL: no browser window, no claim triggers', async () => {
  let releaseAuthorize = null;
  await withBackend((url) => {
    if (url.endsWith('/authorize')) {
      return new Promise((resolve) => {
        releaseAuthorize = () => resolve(json(200, authorizeBody(1)));
      });
    }
    throw new Error(`unexpected ${url}`);
  }, async ({ windows, calls }) => {
    const pending = useAuthStore.getState().startLogin();
    await waitFor(() => releaseAuthorize !== null);
    useAuthStore.getState().cancelLogin();
    releaseAuthorize();
    await pending;

    assert.equal(windows.length, 0, '用户已经取消了，不能再替他打开浏览器');
    assert.equal(useAuthStore.getState().phase, 'idle');
    window.dispatchEvent(new window.Event('focus'));
    await sleep(50);
    assert.equal(calls.filter((c) => c.url.endsWith('/claim')).length, 0);
  });
});

test('cancel then log in again: a late result from the first round is ignored', async () => {
  let authorizeCount = 0;
  let releaseFirstClaim = null;
  await withBackend((url, init) => {
    if (url.endsWith('/authorize')) {
      authorizeCount += 1;
      return json(200, authorizeBody(authorizeCount));
    }
    if (url.endsWith('/claim')) {
      const body = JSON.parse(init.body);
      if (body.state === 's1') {
        return new Promise((resolve) => {
          releaseFirstClaim = () => resolve(json(200, { islogin: true, userId: 'stale' }));
        });
      }
      return json(202, {});
    }
    throw new Error(`unexpected ${url}`);
  }, async () => {
    await useAuthStore.getState().startLogin();
    const firstClaim = useAuthStore.getState().checkLogin();
    await waitFor(() => releaseFirstClaim !== null);

    useAuthStore.getState().cancelLogin();
    await useAuthStore.getState().startLogin();
    releaseFirstClaim();
    await firstClaim;

    assert.equal(useAuthStore.getState().islogin, false, '已作废那一轮的认领结果不能生效');
    assert.equal(useAuthStore.getState().phase, 'waiting', '新流程的状态不能被旧流程踩掉');
  });
});

test('concurrent refresh() calls share one status request', async () => {
  let releaseStatus = null;
  await withBackend((url) => {
    if (url.endsWith('/status')) {
      return new Promise((resolve) => {
        releaseStatus = () => resolve(json(200, { enabled: true, islogin: false }));
      });
    }
    throw new Error(`unexpected ${url}`);
  }, async ({ calls }) => {
    const store = useAuthStore.getState();
    const first = store.refresh();
    const second = store.refresh();
    const third = store.refresh();
    assert.equal(first, second);
    assert.equal(second, third);

    await waitFor(() => releaseStatus !== null);
    releaseStatus();
    await Promise.all([first, second, third]);

    const statusCalls = () => calls.filter((c) => c.url.endsWith('/status')).length;
    assert.equal(statusCalls(), 1);
    assert.equal(useAuthStore.getState().enabled, true);

    releaseStatus = null;
    const again = useAuthStore.getState().refresh();
    await waitFor(() => releaseStatus !== null);
    releaseStatus();
    await again;
    assert.equal(statusCalls(), 2);
  });
});

test('refresh() on a signed-out backend keeps the account urls and empty account fields', async () => {
  await withBackend((url) => {
    if (url.endsWith('/status')) {
      return json(200, {
        enabled: true,
        provider: 'deepscient',
        islogin: false,
        userId: null,
        accountCenterUrl: 'https://deepscient.example/account',
        registerUrl: 'https://deepscient.example/register',
      });
    }
    throw new Error(`unexpected ${url}`);
  }, async () => {
    await useAuthStore.getState().refresh();
    const state = useAuthStore.getState();
    assert.equal(state.initialized, true);
    assert.equal(state.enabled, true);
    assert.equal(state.islogin, false);
    assert.equal(state.accountCenterUrl, 'https://deepscient.example/account');
    assert.equal(state.registerUrl, 'https://deepscient.example/register');
    assert.equal(state.email, null);
    assert.equal(state.role, null);
    assert.equal(state.balance, null);
    assert.equal(state.expiresAt, null);
  });
});

test('refreshAccount() applies the fresh account fields', async () => {
  await withBackend((url, init) => {
    if (url.endsWith('/refresh')) {
      assert.equal(init.method, 'POST');
      return json(200, { ok: true, islogin: true, ...accountStatus, balance: 99.25, role: 'admin' });
    }
    throw new Error(`unexpected ${url}`);
  }, async ({ calls }) => {
    useAuthStore.setState({ initialized: true, enabled: true, islogin: true, userId: 'user-1' });
    await useAuthStore.getState().refreshAccount();

    const state = useAuthStore.getState();
    assert.equal(state.islogin, true);
    assert.equal(state.email, 'ada@example.com');
    assert.equal(state.role, 'admin');
    assert.equal(state.balance, 99.25);
    assert.equal(state.expiresAt, '2026-12-31T00:00:00Z');
    const call = calls.find((item) => item.url.endsWith('/refresh'));
    assert.equal(call.init.headers['X-Jiuwen-Auth'], '1');
  });
});

test('refreshAccount() with 401 clears the whole signed-in state', async () => {
  await withBackend((url) => {
    if (url.endsWith('/refresh')) {
      return json(401, { error: { code: 'oauth_unauthorized', message: '登录已过期，请重新登录' } });
    }
    throw new Error(`unexpected ${url}`);
  }, async () => {
    useAuthStore.setState({
      initialized: true,
      enabled: true,
      islogin: true,
      userId: 'user-1',
      userName: 'Ada',
      email: 'ada@example.com',
      role: 'pro',
      balance: 128.5,
      expiresAt: '2026-12-31T00:00:00Z',
    });

    await useAuthStore.getState().refreshAccount();

    const state = useAuthStore.getState();
    assert.equal(state.islogin, false);
    assert.equal(state.userId, null);
    assert.equal(state.userName, null);
    assert.equal(state.email, null);
    assert.equal(state.role, null);
    assert.equal(state.balance, null);
    assert.equal(state.expiresAt, null);
    assert.equal(state.enabled, true, '一次 401 不该把登录功能当成关闭');
  });
});

test('logout() clears every account field but keeps the account urls', async () => {
  await withBackend((url) => {
    if (url.endsWith('/logout')) return json(200, { ok: true, islogin: false });
    throw new Error(`unexpected ${url}`);
  }, async () => {
    useAuthStore.setState({
      initialized: true,
      enabled: true,
      islogin: true,
      userId: 'user-1',
      userName: 'Ada',
      email: 'ada@example.com',
      role: 'pro',
      balance: 128.5,
      expiresAt: '2026-12-31T00:00:00Z',
      accountCenterUrl: 'https://deepscient.example/account',
      registerUrl: 'https://deepscient.example/register',
      phase: 'idle',
    });

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    assert.equal(state.islogin, false);
    assert.equal(state.userId, null);
    assert.equal(state.userName, null);
    assert.equal(state.email, null);
    assert.equal(state.role, null);
    assert.equal(state.balance, null);
    assert.equal(state.expiresAt, null);
    assert.equal(state.accountCenterUrl, 'https://deepscient.example/account');
    assert.equal(state.registerUrl, 'https://deepscient.example/register');
    assert.equal(state.phase, 'idle');
  });
});

// ── 账号密码登录 ──────────────────────────────────────────────────────────

function jsonWithHeaders(status, body, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

test('passwordLogin() applies the account status and records the login method', async () => {
  await withBackend((url, init) => {
    if (url.endsWith('/password-login')) {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { username: 'ada', password: 's3cret' });
      assert.equal(init.headers['X-Jiuwen-Auth'], '1');
      assert.equal(init.headers['Content-Type'], 'application/json');
      return jsonWithHeaders(200, { ok: true, islogin: true, ...accountStatus }, {
        'X-Auth-Session': 'session-from-header',
      });
    }
    throw new Error(`unexpected ${url}`);
  }, async ({ calls }) => {
    useAuthStore.setState({ initialized: true, enabled: true, islogin: false });

    const ok = await useAuthStore.getState().passwordLogin('ada', 's3cret');

    assert.equal(ok, true);
    const state = useAuthStore.getState();
    assert.equal(state.islogin, true);
    assert.equal(state.userName, 'Ada');
    assert.equal(state.email, 'ada@example.com');
    assert.equal(state.balance, 128.5);
    assert.equal(state.loginMethod, 'password');
    assert.equal(state.loginMode, 'password');
    assert.equal(state.passwordSubmitting, false);
    assert.equal(state.error, null);
    assert.equal(state.errorCode, null);
    // 密码不进 store：整个状态序列化后都不该出现它
    assert.equal(JSON.stringify(state).includes('s3cret'), false);
    assert.equal(calls.filter((call) => call.url.endsWith('/password-login')).length, 1);
  });
});

test('passwordLogin() on 401 invalid_credentials keeps the error code and no session', async () => {
  await withBackend((url) => {
    if (url.endsWith('/password-login')) {
      return json(401, { ok: false, message: '用户名或密码错误', error: 'invalid_credentials' });
    }
    throw new Error(`unexpected ${url}`);
  }, async () => {
    useAuthStore.setState({ initialized: true, enabled: true, islogin: false });

    const ok = await useAuthStore.getState().passwordLogin('ada', 'wrong');

    assert.equal(ok, false);
    const state = useAuthStore.getState();
    assert.equal(state.islogin, false);
    assert.equal(state.error, '用户名或密码错误');
    assert.equal(state.errorCode, 'invalid_credentials');
    assert.equal(state.canResend, false);
    assert.equal(state.passwordSubmitting, false);
    assert.equal(JSON.stringify(state).includes('wrong'), false);
  });
});

test('passwordLogin() on 403 email_not_verified keeps the email and can_resend', async () => {
  await withBackend((url) => {
    if (url.endsWith('/password-login')) {
      return json(403, {
        ok: false,
        message: '邮箱尚未验证',
        error: 'email_not_verified',
        email: 'ada@example.com',
        can_resend: true,
      });
    }
    throw new Error(`unexpected ${url}`);
  }, async () => {
    useAuthStore.setState({ initialized: true, enabled: true, islogin: false });

    await useAuthStore.getState().passwordLogin('ada', 's3cret');

    const state = useAuthStore.getState();
    assert.equal(state.errorCode, 'email_not_verified');
    assert.equal(state.errorEmail, 'ada@example.com');
    assert.equal(state.email, null, 'attempted email 不能写进账号邮箱');
    assert.equal(state.canResend, true);
  });
});

test('passwordLogin() on 429 reads Retry-After, and auth-disabled keeps its code', async () => {
  let calls = 0;
  await withBackend((url) => {
    if (url.endsWith('/password-login')) {
      calls += 1;
      if (calls === 1) {
        return jsonWithHeaders(429, { ok: false, message: '请求过于频繁', error: 'too_many_requests' }, {
          'Retry-After': '17',
        });
      }
      return json(409, { ok: false, message: '登录未开启', error: 'auth-disabled' });
    }
    throw new Error(`unexpected ${url}`);
  }, async () => {
    useAuthStore.setState({ initialized: true, enabled: true, islogin: false });

    await useAuthStore.getState().passwordLogin('ada', 's3cret');
    assert.equal(useAuthStore.getState().errorCode, 'too_many_requests');
    assert.equal(useAuthStore.getState().retryAfter, 17);

    await useAuthStore.getState().passwordLogin('ada', 's3cret');
    assert.equal(useAuthStore.getState().errorCode, 'auth-disabled');
    assert.equal(useAuthStore.getState().retryAfter, null);
  });
});

test('resendVerification() returns the cooldown and blocks a second call while cooling', async () => {
  await withBackend((url, init) => {
    if (url.endsWith('/resend-verification')) {
      assert.deepEqual(JSON.parse(init.body), { email: 'ada@example.com' });
      assert.equal(init.headers['X-Jiuwen-Auth'], '1');
      return json(200, { ok: true, resend_after: 60 });
    }
    throw new Error(`unexpected ${url}`);
  }, async ({ calls }) => {
    useAuthStore.setState({ initialized: true, enabled: true, islogin: false });

    const seconds = await useAuthStore.getState().resendVerification('ada@example.com');
    assert.equal(seconds, 60);
    assert.ok(useAuthStore.getState().resendCooldownUntil > Date.now());

    const again = await useAuthStore.getState().resendVerification('ada@example.com');
    assert.equal(again, null);
    assert.equal(calls.filter((call) => call.url.endsWith('/resend-verification')).length, 1);
  });
});

test('resendVerification() on 429 keeps retryAfter and starts the cooldown', async () => {
  await withBackend((url) => {
    if (url.endsWith('/resend-verification')) {
      return jsonWithHeaders(429, { ok: false, message: '请求过于频繁', error: 'too_many_requests' }, {
        'Retry-After': '30',
      });
    }
    throw new Error(`unexpected ${url}`);
  }, async () => {
    useAuthStore.setState({ initialized: true, enabled: true, islogin: false, email: 'ada@example.com' });

    const seconds = await useAuthStore.getState().resendVerification('ada@example.com');

    assert.equal(seconds, null);
    const state = useAuthStore.getState();
    assert.equal(state.errorCode, 'too_many_requests');
    assert.equal(state.retryAfter, 30);
    assert.ok(state.resendCooldownUntil > Date.now());
  });
});

test('setLoginMode() switches the tab and clears the previous error', async () => {
  await withBackend(() => {
    throw new Error('setLoginMode 不该发请求');
  }, async () => {
    useAuthStore.setState({
      initialized: true,
      enabled: true,
      islogin: false,
      loginMode: 'authorize',
      error: '旧错误',
      errorCode: 'invalid_credentials',
      errorEmail: 'ada@example.com',
      canResend: true,
      retryAfter: 12,
    });

    useAuthStore.getState().setLoginMode('password');

    const state = useAuthStore.getState();
    assert.equal(state.loginMode, 'password');
    assert.equal(state.error, null);
    assert.equal(state.errorCode, null);
    assert.equal(state.errorEmail, null);
    assert.equal(state.canResend, false);
    assert.equal(state.retryAfter, null);
  });
});
