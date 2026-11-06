import { describe, expect, it } from 'vitest';
import { createChatRig, scopeOf } from './chat-test-kit';

// The rolling digest reads this so it never competes with a local chat answer for the model.
describe('ChatService.localAnswerInFlight', () => {
  it('is true only while a local answer streams', async () => {
    const rig = createChatRig();
    rig.provider.id = 'local';
    rig.provider.chunks = ['a', 'b'];
    const seen: boolean[] = [];
    rig.provider.beforeChunk = () => {
      seen.push(rig.service.localAnswerInFlight);
    };
    expect(rig.service.localAnswerInFlight).toBe(false);
    await rig.service.send('Hi', scopeOf(), null);
    expect(seen).toEqual([true, true]);
    expect(rig.service.localAnswerInFlight).toBe(false);
  });

  it('is false while a CLI engine answers', async () => {
    const rig = createChatRig();
    rig.provider.id = 'codex';
    rig.provider.chunks = ['a'];
    const seen: boolean[] = [];
    rig.provider.beforeChunk = () => {
      seen.push(rig.service.localAnswerInFlight);
    };
    await rig.service.send('Hi', scopeOf(), null);
    expect(seen).toEqual([false]);
  });

  it('clears after a failed local answer', async () => {
    const rig = createChatRig();
    rig.provider.id = 'local';
    rig.provider.failWith = new Error('model crashed');
    await rig.service.send('Hi', scopeOf(), null);
    expect(rig.service.localAnswerInFlight).toBe(false);
  });
});
