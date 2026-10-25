/**
 * 侧栏会话列表：「未命名空会话」不再占位。
 *
 * 覆盖：
 * - isUntitledEmptySession 的判定规则（空未命名隐藏 / 已重命名保留 / 有消息保留 /
 *   有 agent_group_name 的模块会话保留）；
 * - 项目会话列表（服务端会话 + pending 本地会话）与置顶列表都会过滤掉该会话；
 * - 只隐藏展示，项目会话总数（分页依据）不变；
 * - 会话仍留在 sessionStore 中，聊天区按 session_id 正常渲染。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// workspaceStore 初始化与 i18n 语言检测会读 localStorage；node 下先铺一个最小 stub。
const storage = new Map();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  },
});
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: globalThis.window.localStorage,
});

const { useWorkspaceStore, isUntitledEmptySession } = await import(
  '../node_modules/.cache/workspace-sessions/stores/workspaceStore.js'
);
const { projectRegistryClient } = await import(
  '../node_modules/.cache/workspace-sessions/features/workspace/projectRegistryClient.js'
);
const { useSessionStore } = await import(
  '../node_modules/.cache/workspace-sessions/stores/sessionStore.js'
);

function makeSession(overrides = {}) {
  return {
    session_id: 'sid',
    title: '',
    display_title: null,
    project_id: 'default',
    project_dir: '',
    work_mode: 'work',
    mode: 'agent',
    status: 'active',
    message_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function resetWorkspace() {
  useWorkspaceStore.setState({
    projects: [],
    projectSessions: {},
    projectSessionTotals: {},
    sessionVisibility: {},
    pinnedSessions: [],
    error: null,
  });
}

const untitledEmpty = makeSession({ session_id: 'untitled-empty' });
const renamedEmpty = makeSession({
  session_id: 'renamed-empty',
  title: '我改过的名字',
  display_title: '我改过的名字',
  is_custom_title: true,
});
const withMessages = makeSession({
  session_id: 'with-messages',
  title: '有消息的会话',
  message_count: 3,
});
const agentGroupEmpty = makeSession({
  session_id: 'agent-group-empty',
  agent_group_name: 'research-group',
});

test('isUntitledEmptySession: 未命名空会话判定', () => {
  assert.equal(isUntitledEmptySession(untitledEmpty), true);
  assert.equal(isUntitledEmptySession(makeSession({ title: '   ', display_title: '  ' })), true);
  assert.equal(isUntitledEmptySession(makeSession({ message_count: undefined })), true);

  assert.equal(isUntitledEmptySession(renamedEmpty), false, '用户重命名过的空会话要保留');
  assert.equal(
    isUntitledEmptySession(makeSession({ title: '重命名过', is_custom_title: true })),
    false,
    'is_custom_title=true 即使用户清空标题也要保留',
  );
  assert.equal(isUntitledEmptySession(withMessages), false, '有消息的会话要保留');
  assert.equal(
    isUntitledEmptySession(makeSession({ title: '自动标题', message_count: 0 })),
    false,
    '已有标题（如后端生成）的会话要保留',
  );
  assert.equal(isUntitledEmptySession(agentGroupEmpty), false, '有 agent_group_name 的模块会话要保留');
});

test('loadProjectSessions 过滤未命名空会话，但不改动分页总数', async () => {
  resetWorkspace();
  const originalGetSessions = projectRegistryClient.getSessions;
  projectRegistryClient.getSessions = async () => ({
    sessions: [untitledEmpty, renamedEmpty, withMessages, agentGroupEmpty],
    total: 5,
  });
  try {
    await useWorkspaceStore.getState().loadProjectSessions('default', 10);
  } finally {
    projectRegistryClient.getSessions = originalGetSessions;
  }

  const state = useWorkspaceStore.getState();
  assert.deepEqual(
    state.projectSessions.default.map((session) => session.session_id),
    ['renamed-empty', 'with-messages', 'agent-group-empty'],
  );
  assert.equal(state.projectSessionTotals.default, 5, '总数仍按服务端统计，分页逻辑不变');
});

test('loadProjectSessions 也过滤 pending 本地会话中的未命名空会话', async () => {
  resetWorkspace();
  const pendingLocalWithTitle = makeSession({
    session_id: 'local-pending',
    title: '本地待发会话',
    is_processing: true,
  });
  const pendingLocalUntitled = makeSession({
    session_id: 'local-pending-untitled',
    is_processing: true,
  });
  useWorkspaceStore.setState({
    projectSessions: { default: [pendingLocalWithTitle, pendingLocalUntitled] },
    projectSessionTotals: { default: 2 },
  });

  const originalGetSessions = projectRegistryClient.getSessions;
  projectRegistryClient.getSessions = async () => ({
    sessions: [untitledEmpty, withMessages],
    total: 2,
  });
  try {
    await useWorkspaceStore.getState().loadProjectSessions('default', 10);
  } finally {
    projectRegistryClient.getSessions = originalGetSessions;
  }

  assert.deepEqual(
    useWorkspaceStore.getState().projectSessions.default.map((session) => session.session_id),
    ['local-pending', 'with-messages'],
  );
});

test('loadPinnedSessions 过滤置顶区里的未命名空会话', async () => {
  resetWorkspace();
  const pinnedUntitled = makeSession({ session_id: 'pinned-untitled', pinned: true });
  const pinnedRenamed = makeSession({
    session_id: 'pinned-renamed',
    title: '置顶旧会话',
    is_custom_title: true,
    pinned: true,
  });
  const originalPinnedSessions = projectRegistryClient.pinnedSessions;
  projectRegistryClient.pinnedSessions = async () => ({
    sessions: [pinnedUntitled, pinnedRenamed, agentGroupEmpty],
  });
  try {
    await useWorkspaceStore.getState().loadPinnedSessions();
  } finally {
    projectRegistryClient.pinnedSessions = originalPinnedSessions;
  }

  assert.deepEqual(
    useWorkspaceStore.getState().pinnedSessions.map((session) => session.session_id),
    ['pinned-renamed', 'agent-group-empty'],
  );
});

test('隐藏只作用于侧栏列表：会话仍留在 sessionStore 供聊天区渲染', async () => {
  resetWorkspace();
  useSessionStore.getState().addSession(untitledEmpty);
  try {
    const originalGetSessions = projectRegistryClient.getSessions;
    projectRegistryClient.getSessions = async () => ({ sessions: [untitledEmpty], total: 1 });
    try {
      await useWorkspaceStore.getState().loadProjectSessions('default', 10);
    } finally {
      projectRegistryClient.getSessions = originalGetSessions;
    }

    assert.deepEqual(useWorkspaceStore.getState().projectSessions.default, []);
    assert.ok(
      useSessionStore.getState().sessions.some((session) => session.session_id === 'untitled-empty'),
      '聊天区仍按 session_id 读取会话，前端不得删除它',
    );
  } finally {
    useSessionStore.getState().removeSession(untitledEmpty.session_id);
  }
});
