#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/cli/index.js';

async function loadProsody() {
  try {
    return await import('../src/prosody/index.js');
  } catch (error) {
    throw new Error(`无法加载韵律核心 src/prosody/index.js：${error.message}`, { cause: error });
  }
}

process.exitCode = await runCli(process.argv.slice(2), {
  loadProsody,
  bin: fileURLToPath(import.meta.url),
});
