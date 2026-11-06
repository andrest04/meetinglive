/**
 * Real `codex exec - --json -m gpt-5.6` output (codex-cli 0.164.0, 2026-11-05) on an account that cannot use the model; the thread id is redacted.
 */
export const CODEX_EXEC_JSON_ERROR_LINES: readonly string[] = [
  '{"type":"thread.started","thread_id":"redacted"}',
  '{"type":"item.completed","item":{"id":"redacted","type":"error","message":"Model metadata for `gpt-5.6` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}',
  '{"type":"turn.started"}',
  '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'gpt-5.6\' model is not supported when using Codex with a ChatGPT account.\\",\\"code\\":\\"model_not_found\\"}}"}',
  '{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'gpt-5.6\' model is not supported when using Codex with a ChatGPT account.\\",\\"code\\":\\"model_not_found\\"}}"}}',
];
