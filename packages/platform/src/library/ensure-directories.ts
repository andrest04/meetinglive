import fs from 'node:fs/promises';
import nodePath from 'node:path';
import type { AppPaths } from '@vozella/core';

/**
 * Spec 3.1 `EnsureDirectoriesExist`: Inbox and the model folders, then a best-effort removal of
 * the old Whisper cache. IO and permission errors are swallowed on the cleanup only; failing to
 * create a directory is a real error the caller should see.
 */
export async function ensureDirectoriesExist(paths: AppPaths): Promise<void> {
  for (const dir of [
    paths.inboxDirectory,
    paths.transcriptionModelsDirectory,
    paths.nemoSpeechDirectory,
    paths.summaryModelsDirectory,
  ]) {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs
    .rm(nodePath.join(paths.rootDirectory, 'WhisperModels'), { recursive: true, force: true })
    .catch(() => undefined);
  await fs
    .rm(nodePath.join(paths.modelsDirectory, 'ggml-base.bin'), { force: true })
    .catch(() => undefined);
}
