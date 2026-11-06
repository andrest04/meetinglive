import { describe, expect, it, vi } from 'vitest';
import { createChatFilesBridge } from './chat-files';

const list = { attachments: [], notice: null };

describe('chat files bridge (drop)', () => {
  it('sends the paths of dropped files to main, never to the page', async () => {
    const invoke = vi.fn().mockResolvedValue(list);
    const paths = new Map<unknown, string>();
    const a = new File(['a'], 'a.txt');
    const b = new File(['b'], 'b.pdf');
    paths.set(a, 'C:\\docs\\a.txt');
    paths.set(b, 'C:\\docs\\b.pdf');
    const bridge = createChatFilesBridge({ invoke } as never, (f) => paths.get(f) ?? '');
    const result = await bridge.attachToChat([a, b]);
    expect(invoke).toHaveBeenCalledWith('chat.attach.drop', {
      paths: ['C:\\docs\\a.txt', 'C:\\docs\\b.pdf'],
    });
    expect(JSON.stringify(result)).not.toContain('docs');
  });

  it('skips files without a path on disk (built by the page) and sends at most 10', async () => {
    const invoke = vi.fn().mockResolvedValue(list);
    const files = Array.from({ length: 12 }, (_, i) => new File(['x'], `f${String(i)}.txt`));
    const bridge = createChatFilesBridge({ invoke } as never, (f) =>
      f.name === 'f0.txt' ? '' : `C:\\${f.name}`,
    );
    await bridge.attachToChat(files);
    const sent = (invoke.mock.calls[0]?.[1] as { paths: string[] }).paths;
    expect(sent).toHaveLength(10);
    expect(sent).not.toContain('C:\\f0.txt');
  });

  it('with no usable file it only lists, and a throwing lookup counts as no path', async () => {
    const invoke = vi.fn().mockResolvedValue(list);
    const bridge = createChatFilesBridge({ invoke } as never, () => {
      throw new Error('not a file');
    });
    await bridge.attachToChat([new File(['x'], 'x.txt')]);
    expect(invoke).toHaveBeenCalledWith('chat.attach.list', {});
  });
});
