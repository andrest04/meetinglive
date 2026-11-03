import {
  Copy,
  FolderClosed,
  FolderOpen,
  Mic,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { isThemePreference, useTheme } from '../../app/theme';
import { SetupWizardDialog } from '../summaries/SetupWizardDialog';
import type { WizardMode } from '../summaries/wizard-state';
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  ContextMenu,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  Menu,
  Progress,
  RadioGroup,
  SectionHeader,
  Select,
  SettingRow,
  Skeleton,
  SkeletonText,
  Splitter,
  Switch,
  Tabs,
  Textarea,
  Tooltip,
  Tree,
  useToast,
  type MenuEntry,
  type TreeNode,
} from '../../ui';

// Developer tool, English only on purpose: it documents the kit, it is not product copy.

const OPTIONS = [
  { value: 'es', label: 'Spanish' },
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
];

const FOLDERS: TreeNode[] = [
  {
    id: 'inbox',
    label: 'Inbox',
    icon: FolderClosed,
  },
  {
    id: 'clients',
    label: 'Clients',
    icon: FolderOpen,
    children: [
      { id: 'clients-a', label: 'Acme rollout', icon: FolderClosed },
      {
        id: 'clients-b',
        label: 'Northwind',
        icon: FolderClosed,
        children: [{ id: 'clients-b1', label: 'Quarterly review', icon: FolderClosed }],
      },
    ],
  },
  { id: 'team', label: 'Team', icon: FolderClosed },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-hairline pt-6">
      <h2 className="text-ui font-medium tracking-wide text-ink-faint uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={['flex flex-wrap items-center gap-3', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function GalleryRoute() {
  const { preference, setPreference } = useTheme();
  const toast = useToast();
  const [language, setLanguage] = useState<string | null>('es');
  const [combo, setCombo] = useState<string | null>(null);
  const [radio, setRadio] = useState('mic');
  const [tab, setTab] = useState('transcript');
  const [folder, setFolder] = useState<string | null>('clients-a');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [progress, setProgress] = useState(64);
  const [wizard, setWizard] = useState<WizardMode | null>(null);

  const menuEntries: MenuEntry[] = [
    { id: 'rename', label: 'Rename', icon: Pencil, shortcut: 'F2', onSelect: () => undefined },
    { id: 'copy', label: 'Copy link', icon: Copy, shortcut: 'Ctrl+L', onSelect: () => undefined },
    { id: 'sep', kind: 'separator' },
    { id: 'delete', label: 'Delete', icon: Trash2, onSelect: () => undefined },
  ];

  return (
    <div className="flex flex-col gap-10 pb-10" data-testid="gallery">
      <SectionHeader
        level={1}
        title="Component gallery"
        description="Every piece of the kit, live. Visible in development and unpackaged builds only."
        action={
          <RadioGroup
            label="Theme"
            orientation="horizontal"
            value={preference}
            onValueChange={(next) => {
              if (isThemePreference(next)) setPreference(next);
            }}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        }
      />

      <Section title="Buttons">
        <Row label="Buttons">
          <Button variant="primary" icon={Mic}>
            Record
          </Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="quiet" icon={Plus}>
            New folder
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="secondary" size="sm">
            Small
          </Button>
        </Row>
        <Row label="Icon buttons">
          <IconButton label="Settings" icon={Settings} />
          <IconButton label="Search" icon={Search} variant="secondary" />
          <IconButton label="Delete" icon={Trash2} disabled />
        </Row>
      </Section>

      <Section title="Fields">
        <div className="grid max-w-3xl grid-cols-2 gap-x-6 gap-y-5">
          <Field label="Title" description="Shown at the top of the note.">
            <Input placeholder="Weekly sync" />
          </Field>
          <Field label="Folder" error="Choose a folder that exists.">
            <Input defaultValue="Clients/Acme" />
          </Field>
          <Field label="Notes" className="col-span-2">
            <Textarea rows={3} placeholder="Optional. Write in your own words." />
          </Field>
          <Field label="Language">
            <Select
              label="Language"
              options={OPTIONS}
              value={language}
              onValueChange={setLanguage}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-ui font-medium">Search languages</span>
            <Combobox
              label="Search languages"
              options={OPTIONS}
              value={combo}
              onValueChange={setCombo}
              placeholder="Type to filter"
              emptyText="No language matches."
              clearLabel="Clear"
              openLabel="Show all"
            />
          </div>
        </div>
      </Section>

      <Section title="Choices">
        <div className="grid max-w-3xl grid-cols-3 gap-6">
          <div className="flex flex-col gap-3">
            <Checkbox label="Save the audio" defaultChecked />
            <Checkbox label="Notify me before a meeting" description="One minute before." />
            <Checkbox label="Disabled" disabled />
          </div>
          <div className="flex flex-col gap-3">
            <Switch label="Live transcription" defaultChecked />
            <Switch label="Speaker labels" />
            <Switch label="Disabled" disabled />
          </div>
          <RadioGroup
            label="Input"
            value={radio}
            onValueChange={setRadio}
            options={[
              { value: 'mic', label: 'Microphone' },
              { value: 'system', label: 'All system audio' },
              { value: 'app', label: 'One app', description: 'Teams, Zoom or a browser.' },
            ]}
          />
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          label="Meeting views"
          value={tab}
          onValueChange={setTab}
          className="max-w-xl"
          tabs={[
            { value: 'transcript', label: 'Transcript', content: <SkeletonText lines={2} /> },
            {
              value: 'summary',
              label: 'Summary',
              content: <EmptyState message="No summary yet." className="py-2" />,
            },
            { value: 'notes', label: 'Notes', content: <p className="text-read">Your notes.</p> },
          ]}
        />
      </Section>

      <Section title="Menus, tooltip and dialog">
        <Row label="Overlays">
          <Menu entries={menuEntries} trigger={<Button variant="secondary">Actions</Button>} />
          <ContextMenu
            entries={menuEntries}
            className="flex h-8 items-center rounded-control border border-dashed border-border-control px-3 text-ui text-ink-muted"
          >
            Right click here
          </ContextMenu>
          <Tooltip content="Start recording">
            <Button variant="secondary" icon={Mic}>
              Hover or focus
            </Button>
          </Tooltip>
          <Button
            variant="secondary"
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            Open dialog
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              toast.show({ title: 'Copied', description: 'Transcript copied to the clipboard.' });
              toast.show({
                title: 'Could not save the note',
                description: 'Close any program using the file, then try again.',
                kind: 'error',
              });
            }}
          >
            Show notices
          </Button>
        </Row>
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Delete this meeting?"
          description="This permanently deletes the meeting and its recording."
          closeLabel="Close"
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setDialogOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setDialogOpen(false);
                }}
              >
                Delete
              </Button>
            </>
          }
        />
      </Section>

      <Section title="Status">
        <div className="grid max-w-3xl grid-cols-2 gap-x-6 gap-y-5">
          <Progress label="Downloading the model" value={progress} showValue />
          <Progress label="Preparing" value={null} />
          <Row label="Badges" className="col-span-2">
            <Badge tone="live">Live</Badge>
            <Badge>Saved</Badge>
            <Badge tone="outline">Recommended</Badge>
            <Kbd>Ctrl</Kbd>
            <Kbd>Enter</Kbd>
          </Row>
          <div className="col-span-2">
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setProgress((value) => (value >= 100 ? 0 : value + 12));
              }}
            >
              Advance progress
            </Button>
          </div>
        </div>
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading the meeting"
          className="flex max-w-xl flex-col gap-3"
        >
          <Skeleton className="h-6 w-2/3" />
          <SkeletonText lines={3} />
        </div>
      </Section>

      <Section title="Tree and splitter">
        <div className="grid grid-cols-2 gap-8">
          <div className="max-w-xs">
            <Tree
              label="Library folders"
              nodes={FOLDERS}
              selectedId={folder}
              onSelect={setFolder}
              defaultExpandedIds={['clients']}
            />
          </div>
          <div className="h-40 overflow-hidden rounded-control border border-hairline">
            <Splitter
              label="Resize the panes"
              defaultSize={180}
              minSize={96}
              maxSize={320}
              first={<div className="p-3 text-ui text-ink-muted">Transcript</div>}
              second={<div className="p-3 text-ui text-ink-muted">Chat</div>}
            />
          </div>
        </div>
      </Section>

      <Section title="Layout pieces">
        <div className="max-w-xl">
          <SectionHeader
            title="Transcription"
            description="Language and engine."
            action={<Button size="sm">Set up</Button>}
          />
          <div className="mt-2">
            <SettingRow title="Live transcription" description="Captions while you record.">
              {({ titleId }) => <Switch label="On" aria-labelledby={titleId} defaultChecked />}
            </SettingRow>
            <SettingRow title="Language">
              <Select
                label="Language"
                options={OPTIONS}
                value={language}
                onValueChange={setLanguage}
              />
            </SettingRow>
          </div>
          <EmptyState
            message="No meetings recorded yet."
            action={<Button variant="secondary">Record a meeting</Button>}
          />
        </div>
      </Section>

      <Section title="Summary setup wizard">
        <Row>
          <Button
            onClick={() => {
              setWizard('choose');
            }}
          >
            Open the wizard
          </Button>
          <Button
            onClick={() => {
              setWizard('local-only');
            }}
          >
            Open on the model step
          </Button>
        </Row>
        <SetupWizardDialog
          open={wizard !== null}
          mode={wizard ?? 'choose'}
          onFinished={() => {
            setWizard(null);
          }}
        />
      </Section>
    </div>
  );
}
