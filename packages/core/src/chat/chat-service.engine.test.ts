import { describe, expect, it } from 'vitest';
import { createChatRig, scopeOf } from './chat-test-kit';

// Phase 5: a saved prompt may name its engine. It is resolved for that send only.
describe('ChatService.send engine override', () => {
  it('resolves the engine the send names, and the default on the next send', async () => {
    const rig = createChatRig();
    rig.provider.chunks = ['ok'];
    await rig.service.send('First', scopeOf(), null, { engine: 'codex' });
    await rig.service.send('Second', scopeOf(), null);
    expect(rig.source.engines).toEqual(['codex', undefined]);
  });

  it('a named engine that needs setup answers setup-required for that engine', async () => {
    const rig = createChatRig();
    rig.source.resolution = { status: 'needs-setup', kind: 'Codex' };
    const outcome = await rig.service.send('Hi', scopeOf(), null, { engine: 'codex' });
    expect(outcome).toEqual({ status: 'setup-required', kind: 'Codex', originalDraft: 'Hi' });
    expect(rig.source.engines).toEqual(['codex']);
  });

  it('a named engine that is gone fails like a normal send', async () => {
    const rig = createChatRig();
    rig.source.resolution = { status: 'unavailable' };
    const outcome = await rig.service.send('Hi', scopeOf(), null, { engine: 'local' });
    expect(outcome.status).toBe('failed');
  });
});
