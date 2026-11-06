/**
 * Worker-thread entry for chat attachments: PDF, Word and PowerPoint text is parsed here, so a
 * large file cannot freeze the main process. Bundled by electron-vite as `workers/extract.js`.
 */
import { parentPort } from 'node:worker_threads';
import { serveDocumentExtraction } from '@vozella/platform';

if (parentPort !== null) serveDocumentExtraction(parentPort);
