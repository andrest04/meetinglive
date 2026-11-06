/**
 * A successful `codex exec - --json` run, written by hand in the codex-cli 0.164 event shape (thread/turn/item events). No real success sample could be captured: every model failed on this machine with model_not_found. The item.updated line checks growth handling.
 */
export const CODEX_EXEC_JSON_LINES: readonly string[] = [
  '{"type":"thread.started","thread_id":"redacted"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `gpt-5.6` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}',
  '{"type":"turn.started"}',
  '{"type":"item.started","item":{"id":"item_1","type":"reasoning","text":""}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"**Greeting in five words**"}}',
  '{"type":"item.started","item":{"id":"item_2","type":"agent_message","text":""}}',
  '{"type":"item.updated","item":{"id":"item_2","type":"agent_message","text":"¡Hola! ¿Cómo"}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"¡Hola! ¿Cómo estás hoy, amigo?"}}',
  '{"type":"turn.completed","usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0}}',
];
