import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  renameSync, rmSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const GAME_ID = /^[a-z0-9]{6}$/;
const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function writeJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {
      flag: 'wx', mode: 0o600,
    });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

function emptyLockDirectory(path) {
  try {
    rmdirSync(path);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  }
}

async function withLock(path, operation) {
  // Publishing a nonempty directory prevents contenders from replacing a live lock.
  const staged = mkdtempSync(`${path}-`);
  const owner = `${process.pid}-${randomUUID()}`;
  const deadline = Date.now() + 5000;
  try {
    writeFileSync(join(staged, owner), '');
    for (;;) {
      try {
        renameSync(staged, path);
        break;
      } catch (error) {
        if (!['ENOTEMPTY', 'EEXIST', 'EPERM'].includes(error.code)) throw error;
        if (Date.now() >= deadline) throw new Error('对局数据正忙，请稍后再试');
        try {
          const [current] = readdirSync(path);
          if (current && !isProcessAlive(Number(current.split('-', 1)[0]))) {
            unlinkSync(join(path, current));
            emptyLockDirectory(path);
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await sleep(20);
      }
    }
    try {
      return await operation();
    } finally {
      unlinkSync(join(path, owner));
      emptyLockDirectory(path);
    }
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

export function createStore(home = process.env.TUIQIAO_HOME || join(homedir(), '.tuiqiao')) {
  home = resolve(home);
  const gamesDir = join(home, 'games');
  const serverFile = join(home, 'server.json');
  const readGame = id => GAME_ID.test(id) ? readJson(join(gamesDir, `${id}.json`)) : null;

  return {
    home,
    logPath: join(home, 'server.log'),
    readGame,
    async createGame(build) {
      mkdirSync(gamesDir, { recursive: true, mode: 0o700 });
      for (;;) {
        const id = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
        const path = join(gamesDir, `${id}.json`);
        if (existsSync(path)) continue;
        const game = await withLock(join(gamesDir, `.${id}.lock`), async () => {
          if (existsSync(path)) return null;
          const game = await build(id);
          writeJson(path, game);
          return game;
        });
        if (game) return game;
      }
    },
    async updateGame(id, update) {
      if (!readGame(id)) return null;
      return withLock(join(gamesDir, `.${id}.lock`), async () => {
        const game = readGame(id);
        if (!game) return null;
        await update(game);
        writeJson(join(gamesDir, `${id}.json`), game);
        return game;
      });
    },
    listGames() {
      let names;
      try {
        names = readdirSync(gamesDir);
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
      return names.flatMap(name => {
        if (!name.endsWith('.json')) return [];
        const game = readGame(name.slice(0, -5));
        return game ? [game] : [];
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    },
    withServerLock(operation) {
      mkdirSync(home, { recursive: true, mode: 0o700 });
      return withLock(join(home, '.server.lock'), operation);
    },
    readServer() {
      return readJson(serverFile);
    },
    writeServer(info) {
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeJson(serverFile, info);
    },
    removeServer() {
      rmSync(serverFile, { force: true });
    },
  };
}
