type Translate = (key: string) => string;

const LIFECYCLE_ERROR_KEYS: Record<string, string> = {
  SESSION_ARCHIVED: 'chat.sessionArchived',
  NOT_FOUND: 'chat.sessionDeleted',
  OPERATION_IN_PROGRESS: 'chat.sessionOperationInProgress',
};

/**
 * 把后端错误码翻成可读文案。认不出来的 code 原样返回后端给的消息，
 * 不要在中间层改写成看不见原文的泛化提示。
 */
export function describeChatError(
  payload: { code?: unknown },
  rawErrorMsg: string,
  t: Translate,
): string {
  const code = typeof payload.code === 'string' ? payload.code : '';
  if (code === 'model_not_configured') return t('chat.modelNotConfigured');
  const lifecycleKey = LIFECYCLE_ERROR_KEYS[code];
  if (lifecycleKey) return t(lifecycleKey);
  return rawErrorMsg;
}
