// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RelatedMeetings } from './RelatedMeetings';

afterEach(cleanup);

describe('RelatedMeetings', () => {
  it('renders nothing when there are no related meetings (item 134)', () => {
    const { container } = render(
      <RelatedMeetings items={[]} caption="Related meetings" onOpen={() => undefined} />,
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('renders the list when there are some', () => {
    render(
      <RelatedMeetings
        items={[{ id: 'm2', title: 'Weekly sync', dateLabel: 'Sep 1' }]}
        caption="Related meetings"
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Related meetings' })).toBeTruthy();
  });
});
