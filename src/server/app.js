import { readFileSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import {
  GameError, canBrowseRhymes, check, hint, reveal, saveDraft, setMode, submit, toListItem, toView,
} from '../game/index.js';
import { conflict, invalid } from '../game/validation.js';
import { GAME_ID } from '../store/index.js';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const maxBody = 256 * 1024;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const actions = new Map(Object.entries({
  mode: (game, body, deps) => setMode(game, body?.mode, deps),
  draft: saveDraft, check, hint, submit, reveal,
}));

function notFound(message = '未找到该路径') {
  return new GameError(404, 'not-found', message);
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function lookup(game, params, prosody) {
  const chars = params.get('chars');
  const rhyme = params.get('rhyme');
  if ((chars === null) === (rhyme === null)) throw invalid('须在 chars 和 rhyme 中选一种查法');

  const rhymebook = game.rhymebook.id;
  const { kind } = game.form;
  const book = prosody.bookName(rhymebook, kind);
  if (chars !== null) {
    const han = chars.match(/\p{Script=Han}/gu) ?? [];
    if (han.length < 1 || han.length > 8) throw invalid('chars 须包含 1 到 8 个汉字');
    return { book, chars: han.map(char => prosody.charInfo(char, rhymebook, kind)) };
  }
  const tone = params.get('tone') ?? undefined;
  if (tone !== undefined && tone !== '平' && tone !== '仄') throw invalid('tone 须为平或仄');
  if (!canBrowseRhymes(game)) throw conflict('仅自赋或交卷后可以浏览同韵字');
  const rhymes = prosody.rhymeChars(rhyme, rhymebook, kind, tone).map(({ name, tone, common, rare }) => ({
    name, tone, common, more: Array.from(rare).length,
  }));
  return { book, rhymes };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new GameError(400, 'body-too-large', 'JSON 请求体不得超过 256 KB');
    if (Number(req.headers['content-length']) > maxBody) {
      req.resume();
      reject(tooLarge());
      return;
    }
    let length = 0;
    const chunks = [];
    req.on('error', reject);
    req.on('aborted', () => reject(new GameError(400, 'invalid-json', 'JSON 请求传输中断')));
    req.on('data', chunk => {
      length += chunk.length;
      if (length > maxBody) {
        chunks.length = 0;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (length > maxBody) return;
      try {
        resolve(length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new GameError(400, 'invalid-json', '请求体须为有效 JSON'));
      }
    });
  });
}

function decodeAsset(path) {
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.includes('\\') || decoded.includes('\0') ||
        decoded.split('/').some(part => !part || part === '.' || part === '..')) {
      throw notFound();
    }
    return decoded;
  } catch {
    throw notFound();
  }
}

async function sendStatic(res, webDir, name, asset = false) {
  try {
    const root = await realpath(webDir);
    const dir = asset ? await realpath(join(root, 'assets')) : root;
    if (asset && !dir.startsWith(root + sep)) throw notFound();
    const path = await realpath(join(dir, name));
    if (!path.startsWith(dir + sep) || !(await stat(path)).isFile()) throw notFound();
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': contentTypes[extname(name).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) throw notFound();
    throw error;
  }
}

export function createApp({ store, prosody, webDir, startedAt }) {
  async function route(req, res) {
    // Use the raw path so encoded dot segments are rejected before URL normalization.
    const url = req.url ?? '';
    const path = url.split('?', 1)[0];
    if (req.method === 'GET' && path === '/api/meta') {
      if (startedAt) {
        res.setHeader('X-Tuiqiao-Pid', String(process.pid));
        res.setHeader('X-Tuiqiao-Started-At', startedAt);
      }
      return json(res, 200, { name: 'tuiqiao', version });
    }
    if (req.method === 'GET' && path === '/api/games') {
      return json(res, 200, { games: store.listGames().map(toListItem) });
    }

    const match = /^\/api\/games\/([^/]+)(?:\/([^/]+))?$/.exec(path);
    if (match) {
      const [, id, action] = match;
      if (!GAME_ID.test(id)) throw notFound('对局不存在');
      let game;
      if (req.method === 'GET' && (!action || action === 'lookup')) {
        game = store.readGame(id);
      } else if (req.method === 'POST' && actions.has(action)) {
        const body = await readBody(req);
        game = await store.updateGame(id, current => actions.get(action)(current, body, { prosody }));
      } else {
        throw notFound();
      }
      if (!game) throw notFound('对局不存在');
      if (action === 'lookup') {
        const params = new URLSearchParams(url.slice(path.length + 1));
        return json(res, 200, lookup(game, params, prosody));
      }
      return json(res, 200, toView(game, { prosody }));
    }

    if (req.method === 'GET') {
      if (path === '/' || /^\/g\/[^/]+$/.test(path)) return sendStatic(res, webDir, 'index.html');
      if (path.startsWith('/assets/')) return sendStatic(res, webDir, decodeAsset(path.slice(8)), true);
    }
    throw notFound();
  }

  return (req, res) => {
    route(req, res).catch(error => {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof GameError) {
        json(res, error.status, { error: { code: error.code, message: error.message } });
      } else {
        // Error messages from storage and the prosody core can contain the original poem.
        json(res, 500, { error: { code: 'internal-error', message: '服务暂时无法处理该请求' } });
      }
    });
  };
}
