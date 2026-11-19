import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { isProcessAlive } from '../store/index.js';
import { createApp } from './app.js';

const webDir = fileURLToPath(new URL('../../web/', import.meta.url));
const bin = fileURLToPath(new URL('../../bin/tuiqiao.js', import.meta.url));

function ipForUrl(host) {
  return host.includes(':') ? `[${host}]` : host;
}

export function publicUrl(host, port) {
  return process.env.TUIQIAO_PUBLIC_URL?.replace(/\/+$/, '') || `http://${ipForUrl(host)}:${port}`;
}

function localHost(host) {
  if (host === '0.0.0.0') return '127.0.0.1';
  if (host === '::') return '::1';
  return host;
}

function sameServer(left, right) {
  return Boolean(left && right && left.pid === right.pid && left.startedAt === right.startedAt);
}

async function responding(info) {
  if (!info || !isProcessAlive(info.pid) || typeof info.host !== 'string' ||
      !Number.isInteger(info.port) || info.port < 1 || info.port > 65535) return false;
  try {
    const response = await fetch(`http://${ipForUrl(localHost(info.host))}:${info.port}/api/meta`, {
      signal: AbortSignal.timeout(500), redirect: 'error',
    });
    if (!response.ok || response.headers.get('x-tuiqiao-pid') !== String(info.pid) ||
        response.headers.get('x-tuiqiao-started-at') !== info.startedAt) {
      await response.body?.cancel();
      return false;
    }
    return (await response.json()).name === 'tuiqiao';
  } catch {
    return false;
  }
}

async function runningServer(store) {
  const info = store.readServer();
  if (await responding(info)) return info;
  if (info) store.removeServer();
  return null;
}

export function serverStatus(store) {
  return store.withServerLock(() => runningServer(store));
}

function listen(server, options) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options);
  });
}

export async function serve({ store, prosody, host, port, log, webRoot = webDir }) {
  return store.withServerLock(async () => {
    const existing = await runningServer(store);
    if (existing) {
      log(`服务已在运行：${existing.url}`);
      return existing;
    }
    const startedAt = new Date().toISOString();
    const server = createServer(createApp({ store, prosody, webDir: webRoot, startedAt }));
    let actualPort;
    for (let candidate = port; candidate <= 65535; candidate++) {
      try {
        actualPort = await listen(server, { host, port: candidate });
        break;
      } catch (error) {
        if (error.code !== 'EADDRINUSE' || candidate === 65535) throw error;
      }
    }
    const info = { pid: process.pid, host, port: actualPort, url: publicUrl(host, actualPort), startedAt };
    try {
      store.writeServer(info);
    } catch (error) {
      server.close();
      throw error;
    }

    let closing = false;
    function shutdown() {
      if (closing) return;
      closing = true;
      server.close(() => {
        store.withServerLock(() => {
          if (sameServer(store.readServer(), info)) store.removeServer();
        }).catch(error => {
          log(`清理 server.json 失败：${error.message}`);
          process.exitCode = 1;
        }).finally(() => {
          process.off('SIGTERM', shutdown);
          process.off('SIGINT', shutdown);
        });
      });
      server.closeAllConnections?.();
    }
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    log(`推敲服务已监听 ${ipForUrl(host)}:${actualPort}，访问地址 ${info.url}`);
    return info;
  });
}

export async function startServer({ store, host, port }) {
  const existing = await serverStatus(store);
  if (existing) return { ...existing, already: true };

  const fd = openSync(store.logPath, 'a', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [bin, 'serve', '--host', host, '--port', String(port)], {
      env: { ...process.env, TUIQIAO_HOME: store.home },
      detached: true,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
    });
  } finally {
    closeSync(fd);
  }
  let failure;
  child.on('error', error => { failure = error; });
  child.unref();

  const deadline = Date.now() + 10000;
  do {
    const info = store.readServer();
    if (await responding(info)) return { ...info, already: info.pid !== child.pid };
    if (failure || child.exitCode !== null || child.signalCode !== null) break;
    await sleep(100);
  } while (Date.now() < deadline);

  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  throw new Error(`服务启动失败，请查看 ${store.logPath}${failure ? `（${failure.message}）` : ''}`);
}

export async function stopServer(store) {
  const info = await store.withServerLock(async () => {
    const active = await runningServer(store);
    if (!active) return null;
    try {
      process.kill(active.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    return active;
  });
  if (!info) return null;
  const deadline = Date.now() + 5000;
  while (sameServer(store.readServer(), info) && isProcessAlive(info.pid)) {
    if (Date.now() >= deadline) throw new Error('等待服务退出超时');
    await sleep(50);
  }
  await store.withServerLock(() => {
    if (sameServer(store.readServer(), info)) store.removeServer();
  });
  return info;
}
