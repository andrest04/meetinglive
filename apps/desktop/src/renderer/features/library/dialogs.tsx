import { useEffect, useId, useRef, useState } from 'react';
import { Button, Dialog, Field, Icon, Input, RadioGroup, cn } from '../../ui';
import { ChoiceGrid } from './ChoiceGrid';
import {
  ACCENT_KEYS,
  FOLDER_ICONS,
  ICON_KEYS,
  accentColor,
  type AccentKey,
  type IconKey,
} from './folder-visuals';

interface DialogChrome {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly cancelLabel: string;
  readonly closeLabel: string;
}

export interface NameDialogProps extends DialogChrome {
  readonly primaryLabel: string;
  readonly fieldLabel: string;
  readonly placeholder: string;
  readonly initialValue: string;
  /** Returns an error to show under the field, or null when it worked and the dialog may close. */
  readonly onSubmit: (name: string) => Promise<string | null>;
}

/** New folder and Rename folder. The primary action waits for a non-blank name. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  cancelLabel,
  closeLabel,
  primaryLabel,
  fieldLabel,
  placeholder,
  initialValue,
  onSubmit,
}: NameDialogProps) {
  const formId = useId();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
      setBusy(false);
    }
  }, [open, initialValue]);

  const blank = value.trim() === '';
  const submit = async (): Promise<void> => {
    if (blank || busy) return;
    setBusy(true);
    let failure: string | null;
    try {
      failure = await onSubmit(value);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      setBusy(false);
    }
    if (failure === null) onOpenChange(false);
    else setError(failure);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      closeLabel={closeLabel}
      initialFocus={inputRef}
      actions={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {cancelLabel}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={blank || busy}>
            {primaryLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={fieldLabel} error={error ?? undefined}>
          <Input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}

export interface ConfirmDialogProps extends DialogChrome {
  readonly description: string;
  readonly primaryLabel: string;
  readonly onConfirm: () => void;
}

/** A destructive confirmation. Cancel has the focus, so Enter never deletes by accident. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  closeLabel,
  primaryLabel,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      closeLabel={closeLabel}
      initialFocus={cancelRef}
      actions={
        <>
          <Button
            ref={cancelRef}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {primaryLabel}
          </Button>
        </>
      }
    />
  );
}

export interface MoveDialogProps extends DialogChrome {
  readonly primaryLabel: string;
  readonly destinations: readonly { readonly folderId: string | null; readonly path: string }[];
  /** The meeting's current folder id; unknown ids fall back to Inbox, the first row. */
  readonly currentFolderId: string | null;
  readonly onMove: (folderId: string | null) => void;
}

const INBOX_VALUE = '';

/** Pick one destination from the flattened folder paths. */
export function MoveDialog({
  open,
  onOpenChange,
  title,
  cancelLabel,
  closeLabel,
  primaryLabel,
  destinations,
  currentFolderId,
  onMove,
}: MoveDialogProps) {
  const initial = destinations.find((d) => d.folderId === currentFolderId)?.folderId ?? null;
  const [value, setValue] = useState(initial ?? INBOX_VALUE);
  useEffect(() => {
    if (open) setValue(initial ?? INBOX_VALUE);
  }, [open, initial]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      closeLabel={closeLabel}
      actions={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onMove(value === INBOX_VALUE ? null : value);
              onOpenChange(false);
            }}
          >
            {primaryLabel}
          </Button>
        </>
      }
    >
      <div className="max-h-80 overflow-y-auto py-1">
        <RadioGroup
          label={title}
          value={value}
          onValueChange={setValue}
          options={destinations.map((d) => ({
            value: d.folderId ?? INBOX_VALUE,
            label: d.path,
          }))}
        />
      </div>
    </Dialog>
  );
}

export interface PersonalityDialogProps extends DialogChrome {
  readonly primaryLabel: string;
  readonly folderName: string;
  readonly colorHeader: string;
  readonly iconHeader: string;
  readonly initialColor: AccentKey;
  readonly initialIcon: IconKey;
  readonly onSave: (colorKey: AccentKey, iconKey: IconKey) => void;
}

/** Seven colors, eighteen icons, and a live preview of the folder row. */
export function PersonalityDialog({
  open,
  onOpenChange,
  title,
  cancelLabel,
  closeLabel,
  primaryLabel,
  folderName,
  colorHeader,
  iconHeader,
  initialColor,
  initialIcon,
  onSave,
}: PersonalityDialogProps) {
  const [color, setColor] = useState<AccentKey>(initialColor);
  const [icon, setIcon] = useState<IconKey>(initialIcon);
  useEffect(() => {
    if (open) {
      setColor(initialColor);
      setIcon(initialIcon);
    }
  }, [open, initialColor, initialIcon]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      closeLabel={closeLabel}
      actions={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave(color, icon);
              onOpenChange(false);
            }}
          >
            {primaryLabel}
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex h-9 items-center gap-2 rounded-control border border-hairline px-3 text-ui-lg">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full forced-colors:bg-[CanvasText]"
            style={{ backgroundColor: accentColor(color) }}
          />
          <Icon icon={FOLDER_ICONS[icon]} style={{ color: accentColor(color) }} />
          <span className="truncate">{folderName}</span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-ui font-medium text-ink">{colorHeader}</span>
          <ChoiceGrid
            label={colorHeader}
            variant="swatch"
            value={color}
            onValueChange={(key) => {
              const next = ACCENT_KEYS.find((k) => k === key);
              if (next) setColor(next);
            }}
            choices={ACCENT_KEYS.map((key) => ({
              key,
              label: key,
              content: (
                <span
                  aria-hidden="true"
                  className={cn('size-5 rounded-full forced-colors:bg-[CanvasText]')}
                  style={{ backgroundColor: accentColor(key) }}
                />
              ),
            }))}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-ui font-medium text-ink">{iconHeader}</span>
          <ChoiceGrid
            label={iconHeader}
            variant="tile"
            value={icon}
            className="max-h-56 overflow-y-auto"
            onValueChange={(key) => {
              const next = ICON_KEYS.find((k) => k === key);
              if (next) setIcon(next);
            }}
            choices={ICON_KEYS.map((key) => ({
              key,
              label: key,
              content: <Icon icon={FOLDER_ICONS[key]} size={16} />,
            }))}
          />
        </div>
      </div>
    </Dialog>
  );
}
