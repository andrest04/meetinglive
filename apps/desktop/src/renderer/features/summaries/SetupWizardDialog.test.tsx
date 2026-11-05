// @vitest-environment jsdom
import type { ModelRowDto } from '@vozella/contracts';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { SetupWizardDialog, type SetupWizardDialogProps } from './SetupWizardDialog';
import { installSummariesApi } from './summaries-test-kit';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const row = (fileName: string, displayName: string, extra: Partial<ModelRowDto> = {}) => ({
  fileName,
  displayName,
  fileSizeGb: 0.81,
  minRamGb: 4,
  speedKey: 'ModelSpeedFast',
  qualityKey: 'ModelQualityGood',
  useCaseKey: 'ModelUseCaseModestPcs',
  fit: 'Recommended' as const,
  downloaded: false,
  active: false,
  downloading: false,
  percent: null,
  ...extra,
});

const ROWS = [
  row('one.gguf', 'Small model', { fit: 'Recommended' }),
  row('two.gguf', 'Middle model', { fileSizeGb: 3.11, fit: 'MayBeSlow' }),
  row('three.gguf', 'Large model', { fileSizeGb: 7.12, fit: 'NotRecommended' }),
];

interface Hardware {
  totalRamGb: number;
  gpuName: string | null;
  gpuVramGb: number | null;
}
const NO_GPU: Hardware = { totalRamGb: 16, gpuName: null, gpuVramGb: null };
const WITH_GPU: Hardware = { totalRamGb: 32, gpuName: 'Test GPU', gpuVramGb: 8 };

const hardwareAnswer = (rows: readonly ModelRowDto[] = ROWS, hardware = NO_GPU) => ({
  hardware,
  rows,
  defaultFileName: rows.find((r) => r.downloaded)?.fileName ?? rows[0]?.fileName ?? null,
});

function mount(
  props: Partial<SetupWizardDialogProps> = {},
  handlers: Parameters<typeof installSummariesApi>[0] = {},
  locale: 'en' | 'es' = 'en',
) {
  const api = installSummariesApi({
    'summaries.hardware': () => hardwareAnswer(),
    'summaries.cancelLocalModel': () => ({ cancelled: true }),
    ...handlers,
  });
  const onFinished = vi.fn();
  const view = render(
    <Providers locale={locale}>
      <SetupWizardDialog open mode="choose" onFinished={onFinished} {...props} />
    </Providers>,
  );
  return { api, onFinished, view };
}

const called = (api: ReturnType<typeof installSummariesApi>, name: string) =>
  api.calls.filter((call) => call.name === name);

describe('SetupWizardDialog: chooser', () => {
  it('lists Claude Code, Codex and Local models in order, with no Grok row', async () => {
    mount();
    const dialog = await screen.findByRole('dialog', { name: 'Set up summary generation' });
    expect(within(dialog).getByText('Choose how to generate summaries')).toBeVisible();
    const buttons = within(dialog)
      .getAllByRole('button')
      .map((button) => button.getAttribute('data-testid'))
      .filter((id) => id?.startsWith('BtnEngine'));
    expect(buttons).toEqual(['BtnEngineClaudeCode', 'BtnEngineCodex', 'BtnEngineLocal']);
    expect(
      within(dialog).getByText('Uses the Claude Code CLI already installed on this PC.'),
    ).toBeVisible();
    expect(within(dialog).queryByText(/Grok/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  it('choosing Local reads the hardware and shows the model list', async () => {
    const { api } = mount();
    await userEvent.click(await screen.findByTestId('BtnEngineLocal'));
    expect(await screen.findByText('Choose a model to generate summaries')).toBeVisible();
    expect(called(api, 'summaries.hardware')).toHaveLength(1);
  });

  it('choosing a CLI leaves the chooser and shows the CLI check panel with Back', async () => {
    mount();
    await userEvent.click(await screen.findByTestId('BtnEngineCodex'));
    expect(screen.queryByTestId('BtnEngineLocal')).toBeNull();
    await userEvent.click(screen.getByTestId('BtnBackToEngineChoice'));
    expect(await screen.findByTestId('BtnEngineLocal')).toBeVisible();
  });

  it('hands the CLI panel its kind and finishes when it reports ready', async () => {
    const { onFinished } = mount({
      renderCliPanel: ({ kind, onReady }) => (
        <button type="button" onClick={onReady}>
          ready {kind}
        </button>
      ),
    });
    await userEvent.click(await screen.findByTestId('BtnEngineClaudeCode'));
    await userEvent.click(await screen.findByRole('button', { name: 'ready ClaudeCode' }));
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith({ kind: 'ClaudeCode' });
  });
});

describe('SetupWizardDialog: local-only mode (B33)', () => {
  it('opens on hardware detection and never renders the chooser', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const { api } = mount(
      { mode: 'local-only' },
      {
        'summaries.hardware': () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      },
    );
    expect(await screen.findByText('Detecting hardware...')).toBeVisible();
    expect(screen.queryByTestId('BtnEngineLocal')).toBeNull();
    expect(screen.queryByText('Choose how to generate summaries')).toBeNull();
    answer(hardwareAnswer());
    expect(await screen.findByText('Choose a model to generate summaries')).toBeVisible();
    expect(called(api, 'summaries.hardware')).toHaveLength(1);
  });

  it('shows a failed hardware read with a Try again that asks again', async () => {
    let attempts = 0;
    mount(
      { mode: 'local-only' },
      {
        'summaries.hardware': () => {
          attempts += 1;
          if (attempts === 1) return Promise.reject(new Error('probe failed'));
          return hardwareAnswer();
        },
      },
    );
    expect(await screen.findByText('probe failed')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Choose a model to generate summaries')).toBeVisible();
  });
});

describe('SetupWizardDialog: model list', () => {
  const open = async (handlers: Parameters<typeof installSummariesApi>[0] = {}) => {
    const mounted = mount({ mode: 'local-only' }, handlers);
    await screen.findByText('Choose a model to generate summaries');
    return mounted;
  };

  it('shows each row with use case, speed and quality, size and fit label', async () => {
    await open();
    const list = screen.getByTestId('ListModelOptions');
    expect(within(list).getAllByRole('radio')).toHaveLength(3);
    expect(within(list).getByText('Small model')).toBeVisible();
    expect(within(list).getByText('Runs well on this PC')).toBeVisible();
    expect(within(list).getByText('May be slow')).toBeVisible();
    expect(within(list).getByText('Too heavy for this PC')).toBeVisible();
    expect(within(list).getByText(/0\.8 GB download/)).toBeVisible();
    expect(within(list).getByText(/7\.1 GB download/)).toBeVisible();
    expect(within(list).getAllByText(/Quality/)).toHaveLength(3);
  });

  it('writes the hardware line with and without a GPU', async () => {
    cleanup();
    await open({ 'summaries.hardware': () => hardwareAnswer(ROWS, WITH_GPU) });
    expect(screen.getByTestId('TxtHardware')).toHaveTextContent(
      'Detected: 32 GB RAM, GPU Test GPU (8 GB VRAM)',
    );
    cleanup();
    await open();
    expect(screen.getByTestId('TxtHardware')).toHaveTextContent(
      'Detected: 16 GB RAM, no dedicated GPU',
    );
  });

  it('marks a downloaded model and selects the first downloaded one by default', async () => {
    const rows = [
      row('one.gguf', 'Small model'),
      row('two.gguf', 'Middle model', { downloaded: true }),
    ];
    await open({ 'summaries.hardware': () => hardwareAnswer(rows) });
    expect(screen.getByText('Middle model (downloaded)')).toBeVisible();
    expect(screen.getByRole('radio', { name: /Middle model/ })).toBeChecked();
  });

  it('selects the first row when nothing is downloaded', async () => {
    await open();
    expect(screen.getByRole('radio', { name: /Small model/ })).toBeChecked();
  });

  it('never uses the signal color for a fit badge', async () => {
    await open();
    const html = screen.getByTestId('ListModelOptions').innerHTML;
    expect(html).not.toMatch(/signal|bg-red|text-red/);
  });
});

describe('SetupWizardDialog: downloading', () => {
  const start = async (handlers: Parameters<typeof installSummariesApi>[0] = {}) => {
    const mounted = mount({ mode: 'local-only' }, handlers);
    await screen.findByText('Choose a model to generate summaries');
    return mounted;
  };

  it('downloads with a determinate bar and the progress text, then finishes with the model', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const { api, onFinished } = await start({
      'summaries.chooseLocalModel': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await userEvent.click(screen.getByTestId('BtnDownloadModel'));
    expect(await screen.findByTestId('PanelDownloading')).toBeVisible();
    expect(screen.getByTestId('TxtDownloadStatus')).toHaveTextContent(
      'Downloading Small model (0%)...',
    );
    api.emit('settings.modelEvent', { type: 'progress', fileName: 'one.gguf', percent: 42 });
    await waitFor(() => {
      expect(screen.getByTestId('TxtDownloadStatus')).toHaveTextContent(
        'Downloading Small model (42%)...',
      );
    });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(called(api, 'summaries.chooseLocalModel')[0]?.input).toEqual({ fileName: 'one.gguf' });
    finish({ status: 'saved', settings: {} });
    await waitFor(() => {
      expect(onFinished).toHaveBeenCalledWith({ kind: 'Local', fileName: 'one.gguf' });
    });
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('Cancel download stops the transfer, returns to the list and ignores a late saved answer', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const { api, onFinished } = await start({
      'summaries.chooseLocalModel': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await userEvent.click(screen.getByTestId('BtnDownloadModel'));
    await userEvent.click(await screen.findByTestId('BtnCancelDownload'));
    expect(called(api, 'summaries.cancelLocalModel')[0]?.input).toEqual({ fileName: 'one.gguf' });
    expect(await screen.findByText('Choose a model to generate summaries')).toBeVisible();
    expect(screen.queryByTestId('TxtModelError')).toBeNull();
    finish({ status: 'saved', settings: {} });
    await Promise.resolve();
    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a model to generate summaries')).toBeVisible();
  });

  it('closing the dialog during a download cancels it and reports no result (B6)', async () => {
    const { api, onFinished } = await start({
      'summaries.chooseLocalModel': () => new Promise(() => undefined),
    });
    await userEvent.click(screen.getByTestId('BtnDownloadModel'));
    await screen.findByTestId('PanelDownloading');
    await userEvent.click(screen.getByTestId('BtnSetupCancel'));
    expect(called(api, 'summaries.cancelLocalModel')).toHaveLength(1);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith(null);
  });

  it('Escape closes the dialog the same way', async () => {
    const { api, onFinished } = await start({
      'summaries.chooseLocalModel': () => new Promise(() => undefined),
    });
    await userEvent.click(screen.getByTestId('BtnDownloadModel'));
    await screen.findByTestId('PanelDownloading');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(onFinished).toHaveBeenCalledWith(null);
    });
    expect(called(api, 'summaries.cancelLocalModel')).toHaveLength(1);
  });

  it('a failed download returns to the list with a visible error and a Try again (B7)', async () => {
    let attempts = 0;
    const { api, onFinished } = await start({
      'summaries.chooseLocalModel': () => {
        attempts += 1;
        return attempts === 1
          ? { status: 'failed', message: 'network down' }
          : { status: 'saved', settings: {} };
      },
    });
    await userEvent.click(screen.getByTestId('BtnDownloadModel'));
    expect(await screen.findByTestId('TxtModelError')).toHaveTextContent(
      'Error downloading the model: network down',
    );
    expect(screen.getByText('Choose a model to generate summaries')).toBeVisible();
    expect(onFinished).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(onFinished).toHaveBeenCalledWith({ kind: 'Local', fileName: 'one.gguf' });
    });
    expect(called(api, 'summaries.chooseLocalModel')).toHaveLength(2);
  });

  it('choosing another model clears the error', async () => {
    await start({
      'summaries.chooseLocalModel': () => ({ status: 'failed', message: 'network down' }),
    });
    await userEvent.click(screen.getByTestId('BtnDownloadModel'));
    await screen.findByTestId('TxtModelError');
    await userEvent.click(screen.getByRole('radio', { name: /Middle model/ }));
    expect(screen.queryByTestId('TxtModelError')).toBeNull();
    expect(screen.getByRole('button', { name: 'Download and use this model' })).toBeVisible();
  });

  it('an already downloaded model finishes at once without a download panel (item 131)', async () => {
    const rows = [row('one.gguf', 'Small model', { downloaded: true })];
    const { onFinished } = await start({
      'summaries.hardware': () => hardwareAnswer(rows),
      'summaries.chooseLocalModel': () => ({ status: 'saved', settings: {} }),
    });
    await userEvent.click(screen.getByTestId('BtnDownloadModel'));
    await waitFor(() => {
      expect(onFinished).toHaveBeenCalledWith({ kind: 'Local', fileName: 'one.gguf' });
    });
    expect(screen.queryByTestId('PanelDownloading')).toBeNull();
  });

  it('a cancelled answer from main returns to the list without an error', async () => {
    await start({ 'summaries.chooseLocalModel': () => ({ status: 'cancelled' }) });
    await userEvent.click(screen.getByTestId('BtnDownloadModel'));
    expect(await screen.findByText('Choose a model to generate summaries')).toBeVisible();
    expect(screen.queryByTestId('TxtModelError')).toBeNull();
  });
});

describe('SetupWizardDialog: closed and Spanish', () => {
  it('renders nothing while closed', () => {
    mount({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the Spanish copy', async () => {
    mount({ mode: 'local-only' }, {}, 'es');
    expect(await screen.findByText('Elige un modelo para generar resúmenes')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeVisible();
    expect(screen.getByText('Funciona bien en este PC')).toBeVisible();
  });

  it('relabels the open model list when the language changes, speed, quality, use case and fit', async () => {
    const { api } = mount({ mode: 'local-only' });
    expect(await screen.findByText('Choose a model to generate summaries')).toBeVisible();
    expect(screen.getAllByText('Runs well on this PC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Modest PCs / laptops without a GPU').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fast · Quality Good/).length).toBeGreaterThan(0);
    api.emit('i18n.localeChanged', { locale: 'es' });
    expect(await screen.findByText('Elige un modelo para generar resúmenes')).toBeVisible();
    expect(screen.getAllByText('Funciona bien en este PC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Puede ir lento').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Equipos modestos o portátiles sin GPU').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rápido · Calidad Buena/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Recommended')).toBeNull();
    expect(screen.queryByText('Modest PCs / laptops without a GPU')).toBeNull();
  });
});
