/**
 * 登录门（AuthGate）+ 双 Tab 登录框的界面行为。
 *
 * 覆盖：
 * - `initialized=false` 加载页、`enabled=false` 直通、未登录只渲染整页登录；
 * - 账号密码登录成功后原地进入主界面（不刷新页面）；
 * - 401 invalid_credentials：提示、保留用户名、清空密码；
 * - 403 email_not_verified：展示官网回带的邮箱与重发按钮，重发后进入 60 秒冷却；
 * - 切换 Tab 清空密码与错误、保留用户名。
 *
 * 用 vite 的 ssrLoadModule 直接加载 TSX（和生产同一套转换），jsdom + react-dom 渲染。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, createElement } from 'react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

// react-dom 的 `canUseDOM` 在模块初始化时求值：必须先把 window/document 铺好再加载它，
// 否则合成事件（onChange / onSubmit）不会挂上，输入框永远停在受控的旧值。
const bootstrap = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window: bootstrap.window,
  document: bootstrap.window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import('react-dom/client');

const vite = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.cache/auth-gate/vite',
  server: { middlewareMode: true, hmr: false, watch: null },
  define: { 'import.meta.env.DEV': false },
});
let modules;
try {
  modules = await Promise.all([
    vite.ssrLoadModule('/src/components/AuthGate/index.tsx'),
    vite.ssrLoadModule('/src/stores/authStore.ts'),
    vite.ssrLoadModule('/src/services/webClient.ts'),
  ]);
} finally {
  await vite.close();
}
const [{ AuthGate }, { useAuthStore }, { webClient }] = modules;
const initialState = useAuthStore.getState();

const resources = Object.fromEntries(
  ['en', 'zh'].map((language) => [
    language,
    { translation: JSON.parse(readFileSync(new URL(`../src/i18n/locales/${language}.json`, import.meta.url), 'utf8')) },
  ]),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await sleep(20);
  }
}

function json(status, body, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
  });
}

/**
 * 每个用例一套独立的 DOM / i18n / store。`routes` 是极简后端。
 * 预置 `initialized/enabled/islogin` 由调用方通过 `state` 指定。
 */
async function withGate(routes, state, run) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });
  const calls = [];
  const globals = {
    window: dom.window,
    document: dom.window.document,
    sessionStorage: dom.window.sessionStorage,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return routes(String(url), init);
    },
  };
  const saved = new Map();
  for (const [name, value] of Object.entries(globals)) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const originalReconnect = webClient.reconnect;
  webClient.reconnect = async () => {};

  useAuthStore.setState(initialState, true);
  useAuthStore.setState(state);

  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources, initImmediate: false, showSupportNotice: false });

  const root = createRoot(document.getElementById('root'));
  const byId = (id) => document.querySelector(`[data-testid="${id}"]`);
  const tick = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  const mount = async () =>
    act(async () => {
      root.render(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(
            AuthGate,
            null,
            createElement('div', { 'data-testid': 'main-ui' }, 'main workspace'),
          ),
        ),
      );
    });

  /** 走原生 setter + input 事件，让 React 的受控 input 收到变更。 */
  const typeInto = async (element, value) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(element, value);
      element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };

  const click = async (element) => {
    await act(async () => {
      element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  const submitForm = async (form) => {
    await act(async () => {
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  try {
    await run({ dom, calls, byId, mount, tick, typeInto, click, submitForm });
  } finally {
    await act(async () => {
      root.unmount();
    });
    webClient.reconnect = originalReconnect;
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    dom.window.close();
  }
}

const statusRoute = (body) => () => json(200, body);

test('initialized=false 先显示加载页，查到状态后（enabled=false）直通主界面', async () => {
  let releaseStatus = null;
  await withGate(
    (url) => {
      if (url.endsWith('/status')) {
        return new Promise((resolve) => {
          releaseStatus = () => resolve(json(200, { enabled: false, islogin: false }));
        });
      }
      throw new Error(`unexpected ${url}`);
    },
    { initialized: false, enabled: false, islogin: false },
    async ({ byId, mount, tick }) => {
      await mount();
      assert.ok(byId('auth-gate-loading'), '还没查到状态时应该是加载页');
      assert.equal(byId('main-ui'), null, '加载中不能渲染主界面');
      assert.equal(byId('auth-gate-screen'), null);

      await waitFor(() => releaseStatus !== null);
      await act(async () => {
        releaseStatus();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await tick();
      await waitFor(() => useAuthStore.getState().initialized);

      assert.equal(byId('auth-gate-loading'), null);
      assert.ok(byId('main-ui'), '登录功能关闭时直接渲染主界面');
      assert.equal(useAuthStore.getState().enabled, false);
    },
  );
});

test('enabled=false 时不进入登录门', async () => {
  await withGate(
    statusRoute({ enabled: false, islogin: false }),
    { initialized: true, enabled: false, islogin: false },
    async ({ byId, mount, tick }) => {
      await mount();
      await tick();
      assert.ok(byId('main-ui'));
      assert.equal(byId('auth-gate-screen'), null, '登录功能关闭时不该有登录页');
    },
  );
});

test('已登录时直接渲染主界面', async () => {
  await withGate(
    statusRoute({ enabled: true, islogin: true, userId: 'u1' }),
    { initialized: true, enabled: true, islogin: true, userId: 'u1' },
    async ({ byId, mount, tick }) => {
      await mount();
      await tick();
      assert.ok(byId('main-ui'));
      assert.equal(byId('auth-gate-screen'), null);
    },
  );
});

test('未登录时只渲染整页登录门，主界面不挂载', async () => {
  await withGate(
    statusRoute({ enabled: true, islogin: false }),
    { initialized: true, enabled: true, islogin: false },
    async ({ byId, mount, tick }) => {
      await mount();
      await tick();

      assert.ok(byId('auth-gate-screen'), '应显示整页登录');
      assert.ok(byId('auth-login-screen'));
      assert.equal(byId('main-ui'), null, '未登录不能渲染主界面');
      assert.ok(byId('auth-tab-authorize'));
      assert.ok(byId('auth-tab-password'));
    },
  );
});

test('账号密码登录成功后原地进入主界面', async () => {
  await withGate(
    (url, init) => {
      if (url.endsWith('/status')) return json(200, { enabled: true, islogin: false });
      if (url.endsWith('/password-login')) {
        assert.deepEqual(JSON.parse(init.body), { username: 'ada@example.com', password: 's3cret' });
        assert.equal(init.headers['X-Jiuwen-Auth'], '1');
        return json(200, {
          ok: true,
          enabled: true,
          islogin: true,
          userId: 'u1',
          userName: 'Ada',
          email: 'ada@example.com',
          balance: 12,
        });
      }
      throw new Error(`unexpected ${url}`);
    },
    { initialized: true, enabled: true, islogin: false },
    async ({ byId, mount, tick, typeInto, click, submitForm }) => {
      await mount();
      await tick();

      // 切到账号密码 Tab
      await click(byId('auth-tab-password'));
      await tick();
      assert.ok(byId('auth-password-panel'), '应切到账号密码面板');

      await typeInto(byId('auth-password-username'), 'ada@example.com');
      await typeInto(byId('auth-password-input'), 's3cret');
      await submitForm(byId('auth-password-panel'));
      await waitFor(() => useAuthStore.getState().islogin);
      await tick();

      const state = useAuthStore.getState();
      assert.equal(state.islogin, true);
      assert.equal(state.loginMethod, 'password');
      assert.equal(state.userName, 'Ada');
      assert.ok(byId('main-ui'), '登录成功后不刷新页面即可进入主界面');
      assert.equal(byId('auth-gate-screen'), null);
    },
  );
});

test('401 invalid_credentials：提示错误、保留用户名、清空密码', async () => {
  await withGate(
    (url) => {
      if (url.endsWith('/status')) return json(200, { enabled: true, islogin: false });
      if (url.endsWith('/password-login')) {
        return json(401, { ok: false, message: '用户名或密码错误', error: 'invalid_credentials' });
      }
      throw new Error(`unexpected ${url}`);
    },
    { initialized: true, enabled: true, islogin: false, loginMode: 'password' },
    async ({ byId, mount, tick, typeInto, submitForm }) => {
      await mount();
      await tick();

      await typeInto(byId('auth-password-username'), 'ada@example.com');
      await typeInto(byId('auth-password-input'), 'wrong-pass');
      await submitForm(byId('auth-password-panel'));
      await waitFor(() => useAuthStore.getState().errorCode === 'invalid_credentials');
      await tick();

      const error = byId('auth-error');
      assert.ok(error, '应显示错误提示');
      assert.equal(error.getAttribute('data-error-code'), 'invalid_credentials');
      assert.equal(error.textContent, '用户名或密码错误');
      assert.equal(byId('auth-password-username').value, 'ada@example.com', '用户名要保留');
      assert.equal(byId('auth-password-input').value, '', '密码要清空');
      assert.equal(useAuthStore.getState().islogin, false);
      assert.equal(byId('main-ui'), null);
    },
  );
});

test('403 email_not_verified：显示官网回带的邮箱与重发按钮，重发后进入冷却', async () => {
  await withGate(
    (url) => {
      if (url.endsWith('/status')) return json(200, { enabled: true, islogin: false });
      if (url.endsWith('/password-login')) {
        return json(403, {
          ok: false,
          message: '邮箱尚未验证',
          error: 'email_not_verified',
          email: 'ada@example.com',
          can_resend: true,
        });
      }
      if (url.endsWith('/resend-verification')) return json(200, { ok: true, resend_after: 60 });
      throw new Error(`unexpected ${url}`);
    },
    { initialized: true, enabled: true, islogin: false, loginMode: 'password' },
    async ({ byId, mount, tick, typeInto, click, submitForm }) => {
      await mount();
      await tick();

      await typeInto(byId('auth-password-username'), 'ada');
      await typeInto(byId('auth-password-input'), 's3cret');
      await submitForm(byId('auth-password-panel'));
      await waitFor(() => useAuthStore.getState().errorCode === 'email_not_verified');
      await tick();

      assert.equal(byId('auth-resend-email').textContent, 'ada@example.com');
      const resendButton = byId('auth-resend-button');
      assert.ok(resendButton, '应提供重发验证邮件按钮');
      assert.equal(resendButton.disabled, false);

      await click(resendButton);
      await waitFor(() => useAuthStore.getState().resendCooldownUntil > Date.now());
      await tick();

      const success = byId('auth-resend-success');
      assert.ok(success, '重发成功要有提示');
      assert.match(byId('auth-resend-cooldown').textContent, /6\d\s*s|60/);
      assert.equal(byId('auth-resend-button').disabled, true, '冷却期间不能再点');
    },
  );
});

test('切换 Tab 清空密码与错误，但保留用户名', async () => {
  await withGate(
    (url) => {
      if (url.endsWith('/status')) return json(200, { enabled: true, islogin: false });
      if (url.endsWith('/password-login')) {
        return json(401, { ok: false, message: '用户名或密码错误', error: 'invalid_credentials' });
      }
      throw new Error(`unexpected ${url}`);
    },
    { initialized: true, enabled: true, islogin: false, loginMode: 'password' },
    async ({ byId, mount, tick, typeInto, click, submitForm }) => {
      await mount();
      await tick();

      await typeInto(byId('auth-password-username'), 'ada@example.com');
      await typeInto(byId('auth-password-input'), 'wrong-pass');
      await submitForm(byId('auth-password-panel'));
      await waitFor(() => useAuthStore.getState().errorCode === 'invalid_credentials');
      await tick();
      assert.ok(byId('auth-error'));

      await click(byId('auth-tab-authorize'));
      await tick();
      await click(byId('auth-tab-password'));
      await tick();

      assert.ok(byId('auth-password-panel'));
      assert.equal(byId('auth-error'), null, '换 Tab 要清掉旧错误');
      assert.equal(byId('auth-password-input').value, '', '换 Tab 要清掉密码');
      assert.equal(byId('auth-password-username').value, 'ada@example.com', '用户名要保留');
    },
  );
});
