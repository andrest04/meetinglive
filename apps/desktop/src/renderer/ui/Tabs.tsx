import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem {
  readonly value: string;
  readonly label: string;
  readonly content: ReactNode;
}

export interface TabsProps {
  readonly tabs: readonly TabItem[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** Accessible name of the tab list. */
  readonly label: string;
  readonly className?: string;
}

/** Arrow keys move between tabs and select them; the panel is a tab stop of its own. */
export function Tabs({ tabs, value, onValueChange, label, className }: TabsProps) {
  return (
    <BaseTabs.Root
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange(next);
      }}
      className={className}
    >
      <BaseTabs.List
        activateOnFocus
        aria-label={label}
        className="relative flex gap-5 border-b border-hairline"
      >
        {tabs.map((tab) => (
          <BaseTabs.Tab
            key={tab.value}
            value={tab.value}
            className={cn(
              'h-9 -mb-px border-b-2 border-transparent px-0.5 text-ui-lg text-ink-muted select-none',
              'transition-colors duration-150 ease-out-quick hover:text-ink',
              'data-active:font-medium data-active:text-ink',
            )}
          >
            {tab.label}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator
          className={cn(
            'absolute bottom-0 left-0 h-0.5 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] bg-ink',
            'transition-[translate,width] duration-150 ease-out-quick',
            'forced-colors:bg-[Highlight]',
          )}
        />
      </BaseTabs.List>
      {tabs.map((tab) => (
        <BaseTabs.Panel key={tab.value} value={tab.value} className="pt-4">
          {tab.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
