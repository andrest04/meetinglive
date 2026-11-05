import { Popover } from '@base-ui/react/popover';
import { ListFilter, X } from 'lucide-react';
import type { RefObject } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, Field, IconButton, Input, RadioGroup, Tooltip, cn } from '../../ui';
import { popupColors, popupSurface } from '../../ui/styles';
import {
  ANY_DATE,
  NO_FILTERS,
  activeFilterCount,
  normalizedRange,
  rangeDayLabel,
  type DateFilter,
  type MeetingFilters,
  type StatusFilter,
} from './meeting-filters';

export interface FilterButtonProps {
  readonly filters: MeetingFilters;
  readonly onChange: (filters: MeetingFilters) => void;
  /** The button itself: the focus comes back here when a chip goes. */
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
}

const DATE_KINDS: readonly DateFilter['kind'][] = ['any', 'last7', 'last30', 'range'];

function isDateKind(value: string): value is DateFilter['kind'] {
  return (DATE_KINDS as readonly string[]).includes(value);
}

const STATUSES: readonly StatusFilter[] = [
  'any',
  'withSummary',
  'withoutSummary',
  'withoutTranscript',
];

function isStatus(value: string): value is StatusFilter {
  return (STATUSES as readonly string[]).includes(value);
}

function dateFromKind(kind: DateFilter['kind']): DateFilter {
  return kind === 'range' ? { kind, from: null, to: null } : { kind };
}

const groupHeading = 'text-ui font-medium text-ink-muted';

/** A quiet button beside the search, and a small popover holding the two groups of choices. */
export function FilterButton({ filters, onChange, buttonRef }: FilterButtonProps) {
  const { t } = useI18n();
  const active = activeFilterCount(filters);
  const { date, status } = filters;
  const range = date.kind === 'range' ? date : null;
  const label =
    active === 0 ? t('Ui_LibraryFilters') : t('Ui_LibraryFiltersActive', String(active));
  return (
    <Popover.Root>
      <span className="relative shrink-0">
        {/* Above, because the focus comes back here on close, and below it would cover the chips. */}
        <Tooltip content={label} side="top">
          <Popover.Trigger
            render={
              <IconButton
                ref={buttonRef}
                label={label}
                icon={ListFilter}
                tooltip={false}
                variant={active === 0 ? 'quiet' : 'secondary'}
              />
            }
          />
        </Tooltip>
        {/* The edge alone is not enough: forced colors draw an edge on the quiet button too. */}
        {active === 0 ? null : (
          <span
            data-testid="library-filter-mark"
            aria-hidden="true"
            className="pointer-events-none absolute end-1 top-1 size-1.5 rounded-full bg-ink forced-colors:bg-[CanvasText]"
          />
        )}
      </span>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={4}
          side="bottom"
          align="end"
          collisionPadding={8}
          className="z-50 outline-none"
        >
          <Popover.Popup
            aria-label={t('Ui_LibraryFilters')}
            className={cn(
              popupSurface,
              popupColors,
              'flex max-h-[var(--available-height)] w-64 flex-col gap-3 overflow-y-auto p-3',
            )}
          >
            <div className="flex flex-col gap-2">
              <span className={groupHeading}>{t('Ui_LibraryFilterDate')}</span>
              <RadioGroup
                label={t('Ui_LibraryFilterDate')}
                value={date.kind}
                onValueChange={(value) => {
                  if (isDateKind(value)) onChange({ ...filters, date: dateFromKind(value) });
                }}
                options={[
                  { value: 'any', label: t('Ui_LibraryFilterAnyTime') },
                  { value: 'last7', label: t('Ui_LibraryFilterLast7') },
                  { value: 'last30', label: t('Ui_LibraryFilterLast30') },
                  { value: 'range', label: t('Ui_LibraryFilterCustom') },
                ]}
              />
              {range ? (
                <div className="flex flex-col gap-2 ps-6.5">
                  <Field label={t('Ui_LibraryFilterFrom')}>
                    <Input
                      type="date"
                      value={range.from ?? ''}
                      className="w-full"
                      onChange={(event) => {
                        onChange({
                          ...filters,
                          date: { ...range, from: event.target.value || null },
                        });
                      }}
                    />
                  </Field>
                  <Field label={t('Ui_LibraryFilterTo')}>
                    <Input
                      type="date"
                      value={range.to ?? ''}
                      className="w-full"
                      onChange={(event) => {
                        onChange({
                          ...filters,
                          date: { ...range, to: event.target.value || null },
                        });
                      }}
                    />
                  </Field>
                </div>
              ) : null}
            </div>
            <div className="h-px shrink-0 bg-hairline forced-colors:bg-[GrayText]" />
            <div className="flex flex-col gap-2">
              <span className={groupHeading}>{t('Ui_LibraryFilterStatus')}</span>
              <RadioGroup
                label={t('Ui_LibraryFilterStatus')}
                value={status}
                onValueChange={(value) => {
                  if (isStatus(value)) onChange({ ...filters, status: value });
                }}
                options={[
                  { value: 'any', label: t('Ui_LibraryFilterAnyStatus') },
                  { value: 'withSummary', label: t('Ui_LibraryFilterWithSummary') },
                  { value: 'withoutSummary', label: t('Ui_LibraryFilterWithoutSummary') },
                  { value: 'withoutTranscript', label: t('Ui_LibraryFilterWithoutTranscript') },
                ]}
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export interface FilterChipsProps {
  readonly filters: MeetingFilters;
  readonly onChange: (filters: MeetingFilters) => void;
  /** False where the line under the chips already offers it: one action, said once. */
  readonly showClear: boolean;
}

/** One removable chip per filter on, and the way to clear them all. Nothing when none is on. */
export function FilterChips({ filters, onChange, showClear }: FilterChipsProps) {
  const { t, locale } = useI18n();
  const { date, status } = filters;

  const dateLabel = (): string | null => {
    switch (date.kind) {
      case 'any':
        return null;
      case 'last7':
        return t('Ui_LibraryFilterLast7');
      case 'last30':
        return t('Ui_LibraryFilterLast30');
      case 'range': {
        const { from, to } = normalizedRange(date);
        const day = (text: string): string => rangeDayLabel(text, locale, Date.now());
        if (from !== null && to !== null) return t('Ui_LibraryFilterRange', day(from), day(to));
        if (from !== null) return t('Ui_LibraryFilterSince', day(from));
        return to === null ? null : t('Ui_LibraryFilterUntil', day(to));
      }
    }
  };
  const statusLabels: Record<Exclude<StatusFilter, 'any'>, string> = {
    withSummary: t('Ui_LibraryFilterWithSummary'),
    withoutSummary: t('Ui_LibraryFilterWithoutSummary'),
    withoutTranscript: t('Ui_LibraryFilterWithoutTranscript'),
  };

  const chips: readonly { readonly label: string; readonly next: MeetingFilters }[] = [
    ...((label) => (label === null ? [] : [{ label, next: { ...filters, date: ANY_DATE } }]))(
      dateLabel(),
    ),
    ...(status === 'any'
      ? []
      : [{ label: statusLabels[status], next: { ...filters, status: 'any' as const } }]),
  ];
  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={t('Ui_LibraryFilterChips')}
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      {chips.map(({ label, next }) => (
        <span
          key={label}
          className="inline-flex h-7 max-w-full min-w-0 items-center rounded-control border border-hairline ps-2 text-ui text-ink-muted forced-colors:border-[CanvasText]"
        >
          <span className="truncate">{label}</span>
          <IconButton
            label={t('Ui_LibraryFilterRemove', label)}
            icon={X}
            size="sm"
            tooltip={false}
            className="-my-px -me-px"
            onClick={() => {
              onChange(next);
            }}
          />
        </span>
      ))}
      {showClear ? (
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            onChange(NO_FILTERS);
          }}
        >
          {t('Ui_LibraryFilterClear')}
        </Button>
      ) : null}
    </div>
  );
}
