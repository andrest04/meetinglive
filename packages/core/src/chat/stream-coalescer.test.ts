import { describe, expect, it } from 'vitest';
import { ManualClock } from './chat-test-kit';
import { StreamCoalescer } from './stream-coalescer';

function setup() {
  const clock = new ManualClock();
  const pushes: string[] = [];
  const coalescer = new StreamCoalescer(clock, (text) => pushes.push(text));
  return { clock, pushes, coalescer };
}

describe('StreamCoalescer', () => {
  it('pushes nothing until a chunk has visible text', () => {
    const { coalescer, pushes } = setup();
    coalescer.append('  ');
    coalescer.append('\n');
    coalescer.flush();
    expect(pushes).toEqual([]);
  });

  it('pushes the first visible chunk at once with leading whitespace trimmed', () => {
    const { coalescer, pushes } = setup();
    coalescer.append('  \n');
    coalescer.append(' Hello');
    expect(pushes).toEqual(['Hello']);
  });

  it('pushes at most once per 80 ms', () => {
    const { coalescer, pushes, clock } = setup();
    coalescer.append('a');
    clock.advance(79);
    coalescer.append('b');
    expect(pushes).toEqual(['a']);
    clock.advance(1);
    coalescer.append('c');
    expect(pushes).toEqual(['a', 'abc']);
  });

  it('flushes what the last push left out, once', () => {
    const { coalescer, pushes, clock } = setup();
    coalescer.append('a');
    clock.advance(10);
    coalescer.append('b');
    coalescer.flush();
    coalescer.flush();
    expect(pushes).toEqual(['a', 'ab']);
  });

  it('does not flush again when the last push held everything', () => {
    const { coalescer, pushes } = setup();
    coalescer.append('all');
    coalescer.flush();
    expect(pushes).toEqual(['all']);
  });

  it('keeps the full untrimmed text for the caller', () => {
    const { coalescer } = setup();
    coalescer.append(' x ');
    expect(coalescer.text).toBe(' x ');
  });
});
