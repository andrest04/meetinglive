// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Mic } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  Checkbox,
  Dialog,
  IconButton,
  Menu,
  Notice,
  RadioGroup,
  Splitter,
  Switch,
  Tabs,
  Tree,
  type TreeNode,
} from '.';

describe('Button and IconButton', () => {
  it('runs its handler and does not when disabled', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Record</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Record
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('gives an icon button its accessible name and hides the glyph', () => {
    render(<IconButton label="Start recording" icon={Mic} tooltip={false} />);
    const button = screen.getByRole('button', { name: 'Start recording' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(button.querySelector('svg')).toHaveAttribute('stroke-width', '1.5');
  });
});

describe('Checkbox and Switch', () => {
  it('toggle with Space and are named by their label', async () => {
    render(
      <>
        <Checkbox label="Save the audio" />
        <Switch label="Live transcription" />
      </>,
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Save the audio' });
    const toggle = screen.getByRole('switch', { name: 'Live transcription' });

    await userEvent.tab();
    expect(checkbox).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(checkbox).toBeChecked();

    await userEvent.tab();
    expect(toggle).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(toggle).toBeChecked();
  });
});

describe('RadioGroup', () => {
  it('moves and selects with the arrow keys', async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup
        label="Input"
        value="mic"
        onValueChange={onValueChange}
        options={[
          { value: 'mic', label: 'Microphone' },
          { value: 'system', label: 'System audio' },
        ]}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Input' })).toBeInTheDocument();
    screen.getByRole('radio', { name: 'Microphone' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(onValueChange).toHaveBeenCalledWith('system');
  });
});

describe('Tabs', () => {
  it('selects with the arrow keys and shows the matching panel', async () => {
    function Harness() {
      const [value, setValue] = useState('a');
      return (
        <Tabs
          label="Views"
          value={value}
          onValueChange={setValue}
          tabs={[
            { value: 'a', label: 'Transcript', content: <p>First panel</p> },
            { value: 'b', label: 'Summary', content: <p>Second panel</p> },
          ]}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument();
    screen.getByRole('tab', { name: 'Transcript' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Second panel')).toBeVisible();
  });
});

describe('Menu', () => {
  it('opens from the keyboard, skips separators and runs the chosen entry', async () => {
    const onRename = vi.fn();
    render(
      <Menu
        trigger={<Button>Actions</Button>}
        entries={[
          { id: 'rename', label: 'Rename', onSelect: onRename },
          { id: 'sep', kind: 'separator' },
          { id: 'delete', label: 'Delete', onSelect: () => undefined },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    // Opening with the keyboard lands on the first entry; the separator is skipped.
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{Enter}');
    expect(onRename).toHaveBeenCalledTimes(1);
  });
});

describe('Dialog', () => {
  it('is named by its title, and Escape asks to close', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="Delete this meeting?"
        description="This cannot be undone."
        closeLabel="Close"
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Delete this meeting?' });
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});

describe('Tree', () => {
  const nodes: TreeNode[] = [
    { id: 'inbox', label: 'Inbox' },
    { id: 'clients', label: 'Clients', children: [{ id: 'acme', label: 'Acme' }] },
  ];

  function Harness() {
    const [selected, setSelected] = useState<string | null>(null);
    return <Tree label="Folders" nodes={nodes} selectedId={selected} onSelect={setSelected} />;
  }

  it('has one tab stop, opens a folder with Right and selects with Enter', async () => {
    render(<Harness />);
    expect(screen.getByRole('tree', { name: 'Folders' })).toBeInTheDocument();
    const items = screen.getAllByRole('treeitem');
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1);

    await userEvent.tab();
    expect(screen.getByRole('treeitem', { name: 'Inbox' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    const clients = screen.getByRole('treeitem', { name: 'Clients' });
    expect(clients).toHaveFocus();
    expect(clients).toHaveAttribute('aria-expanded', 'false');

    await userEvent.keyboard('{ArrowRight}');
    expect(clients).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{ArrowRight}');
    const acme = screen.getByRole('treeitem', { name: 'Acme' });
    expect(acme).toHaveFocus();
    expect(acme).toHaveAttribute('aria-level', '2');

    await userEvent.keyboard('{Enter}');
    expect(acme).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Splitter', () => {
  // jsdom has no pointer capture; Electron does.
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;

  it('exposes its value and resizes with the keyboard, restoring on double click', async () => {
    const onSizeChange = vi.fn();
    render(
      <Splitter
        label="Resize navigation pane"
        defaultSize={200}
        minSize={100}
        maxSize={300}
        onSizeChange={onSizeChange}
        first={<div>one</div>}
        second={<div>two</div>}
      />,
    );
    const handle = screen.getByRole('separator', { name: 'Resize navigation pane' });
    expect(handle).toHaveAttribute('aria-valuenow', '200');
    expect(handle).toHaveAttribute('aria-valuemin', '100');
    expect(handle).toHaveAttribute('aria-valuemax', '300');
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');

    handle.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(handle).toHaveAttribute('aria-valuenow', '216');
    await userEvent.keyboard('{End}');
    expect(handle).toHaveAttribute('aria-valuenow', '300');
    await userEvent.dblClick(handle);
    expect(handle).toHaveAttribute('aria-valuenow', '200');
    expect(onSizeChange).toHaveBeenLastCalledWith(200);
  });
});

describe('Tree controlled expansion and row menus', () => {
  const nodes: TreeNode[] = [
    { id: 'inbox', label: 'Inbox', accent: null },
    { id: 'clients', label: 'Clients', accent: 'red', children: [{ id: 'acme', label: 'Acme' }] },
  ];

  it('reports expansion changes and shows only what the owner expanded', async () => {
    const onExpandedChange = vi.fn();
    const { rerender } = render(
      <Tree
        label="Folders"
        nodes={nodes}
        selectedId={null}
        onSelect={() => undefined}
        expandedIds={new Set()}
        onExpandedChange={onExpandedChange}
      />,
    );
    expect(screen.queryByRole('treeitem', { name: 'Acme' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('treeitem', { name: 'Clients' }));
    screen.getByRole('treeitem', { name: 'Clients' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onExpandedChange).toHaveBeenLastCalledWith(new Set(['clients']));
    // The owner has not changed its set, so the tree stays closed.
    expect(screen.queryByRole('treeitem', { name: 'Acme' })).not.toBeInTheDocument();
    rerender(
      <Tree
        label="Folders"
        nodes={nodes}
        selectedId={null}
        onSelect={() => undefined}
        expandedIds={new Set(['clients'])}
      />,
    );
    expect(screen.getByRole('treeitem', { name: 'Acme' })).toBeInTheDocument();
  });

  it('opens a menu on right click only for rows that have one', async () => {
    const onSelect = vi.fn();
    render(
      <Tree
        label="Folders"
        nodes={nodes}
        selectedId={null}
        onSelect={onSelect}
        nodeMenu={(id) =>
          id === 'clients'
            ? [{ id: 'rename', label: 'Rename', onSelect: () => undefined }]
            : undefined
        }
      />,
    );
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('treeitem', { name: 'Inbox' }),
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('treeitem', { name: 'Clients' }),
    });
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
  });
});

describe('Notice', () => {
  it('speaks politely, and closes only when it was given a way to', async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Notice>Saved elsewhere</Notice>);
    expect(screen.getByRole('status')).toHaveTextContent('Saved elsewhere');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(
      <Notice onDismiss={onDismiss} dismissLabel="Close">
        Saved elsewhere
      </Notice>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
