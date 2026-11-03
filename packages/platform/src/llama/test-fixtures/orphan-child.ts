// Child process for the no-orphan proof: starts the sidecar with the guard under test, prints
// the server pid, then waits to be killed. Arguments come from the environment.
import { createRequire } from 'node:module';
import { LlamaSidecar } from '../llama-sidecar';
import { JobProcessGuard, WatchdogProcessGuard, type ProcessJobPort } from '../process-guard';

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const addonPath = process.env.ORPHAN_ADDON_PATH;
let job: ProcessJobPort | undefined;
if (addonPath) {
  const addon = createRequire(import.meta.url)(addonPath) as {
    assignToKillOnCloseJob(p: number): void;
  };
  job = { assign: (pid) => addon.assignToKillOnCloseJob(pid) };
}
const sidecar = new LlamaSidecar({
  guard: job ? new JobProcessGuard(job) : new WatchdogProcessGuard(),
});
await sidecar.start({
  exe: need('ORPHAN_EXE'),
  modelPath: need('ORPHAN_MODEL'),
  gpuLayers:
    process.env.ORPHAN_GPU_LAYERS === 'auto' ? 'auto' : Number(process.env.ORPHAN_GPU_LAYERS ?? 0),
  argsPrefix: process.env.ORPHAN_ARGS_PREFIX
    ? (JSON.parse(process.env.ORPHAN_ARGS_PREFIX) as string[])
    : [],
  healthTimeoutMs: 120_000,
});
process.stdout.write(`PID ${sidecar.pid}
`);
setInterval(() => undefined, 1000);
