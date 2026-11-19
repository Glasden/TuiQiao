import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createGame, setReview } from '../../../src/game/index.js';
import { createApp } from '../../../src/server/app.js';
import { createStore } from '../../../src/store/index.js';
import * as prosody from './fake-prosody.js';
import { input } from './fake-prosody.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'tuiqiao-http-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const webDir = join(dir, 'web');
  await mkdir(join(webDir, 'assets'), { recursive: true });
  await writeFile(join(webDir, 'index.html'), '<h1>推敲</h1>');
  await writeFile(join(webDir, 'assets', 'app.js'), 'window.ready = true;');
  await writeFile(join(webDir, 'private.txt'), '不能读取');
  await symlink(join(webDir, 'private.txt'), join(webDir, 'assets', 'symlink.txt'));

  const store = createStore(join(dir, 'data'));
  const server = createServer(createApp({ store, prosody, webDir }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections?.();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    store,
    get: path => fetch(base + path),
    post: (path, body) => fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    raw: (path, options) => fetch(base + path, options),
    build(source, now) {
      return store.createGame(id => createGame(source, { id, now, prosody }));
    },
  };
}

async function response(promise, status = 200) {
  const result = await promise;
  assert.equal(result.status, status);
  assert.equal(result.headers.get('content-type'), 'application/json; charset=utf-8');
  const data = await result.json();
  if (status >= 400) {
    assert.equal(typeof data.error.code, 'string');
    assert.equal(typeof data.error.message, 'string');
  }
  return data;
}

test('HTTP 实现全部 API 路由，并在 CLI 写入后重新从磁盘读取', async t => {
  const { store, build, get, post } = await fixture(t);
  const { id } = await build(input, '2020-01-01');
  const recent = await build({ ...input, title: '新一局' }, '2021-01-01');
  const base = `/api/games/${id}`;
  const meta = await response(get('/api/meta'));
  assert.equal(meta.name, 'tuiqiao');
  assert.match(meta.version, /^\d+\.\d+\.\d+/);
  const list = await response(get('/api/games'));
  assert.deepEqual(list.games.map(game => game.id), [recent.id, id]);
  assert.deepEqual(Object.keys(list.games[0]).sort(),
    ['createdAt', 'form', 'id', 'mode', 'status', 'subjects', 'title']);
  assert.deepEqual(list.games[0].form, { name: input.form });

  assert.equal((await response(get(base))).status, 'new');
  await response(post(`${base}/reveal`), 409);
  await response(post(`${base}/mode`, { mode: 'other' }), 400);
  assert.equal((await response(post(`${base}/mode`, { mode: 'zi' }))).status, 'playing');
  await response(post(`${base}/mode`, { mode: 'ju' }), 409);
  const draft = await response(post(`${base}/draft`, { cells: { '0.0': '多余' } }));
  assert.equal(draft.play.board.ju[0].cells[0].input, '多');
  assert.equal(draft.play.checks, 0);

  const checks = await Promise.all(Array.from({ length: 3 }, () =>
    response(post(`${base}/check`, { cells: { '0.0': '玄' } }))));
  assert.deepEqual(checks.map(view => view.play.checks).sort(), [1, 2, 3]);
  assert.ok(checks.every(view => view.play.board.ju[0].cells[0].fb === 'hit'));
  const hints = await Promise.all([
    response(post(`${base}/hint`, { type: 'gloss', j: 1 })),
    response(post(`${base}/hint`, { type: 'imagery' })),
  ]);
  const hinted = await response(get(base));
  assert.equal(hinted.play.board.ju[1].gloss, input.glosses[1]);
  assert.deepEqual(hinted.play.hints.imagery, [input.imagery[0]]);
  assert.ok(hints.every(view => view.play.board.ju[2].gloss === null));
  await response(post(`${base}/hint`, { type: 'gloss', j: 1 }), 409);

  const submitted = await response(post(`${base}/submit`, { cells: { '0.0': '玄' } }));
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.reveal, null);
  await response(post(`${base}/draft`, { cells: {} }), 409);

  await Promise.all([
    store.updateGame(id, game => setReview(game, { comment: '从别处写入的评点' })),
    response(post(`${base}/reveal`)),
  ]);
  const result = await response(get(base + '?fresh=yes'));
  assert.equal(result.status, 'revealed');
  assert.equal(result.play.review.comment, '从别处写入的评点');
  assert.equal(result.reveal.poem, input.poem);
  assert.equal((await response(post(`${base}/reveal`))).status, 'revealed');

  assert.equal(store.readGame('../invalid'), null);
  const files = await readdir(join(store.home, 'games'));
  assert.deepEqual(files.sort(), [`${id}.json`, `${recent.id}.json`].sort());
  const stored = JSON.parse(await readFile(join(store.home, 'games', `${id}.json`), 'utf8'));
  assert.equal(stored.play.review.comment, '从别处写入的评点');
  assert.equal(stored.original.ju.length, 4);
});

test('HTTP 拒绝无效 JSON、过大请求、未知路径、目录穿越和越界符号链接', async t => {
  const { build, get, post, raw } = await fixture(t);
  const { id } = await build(input, '2020-01-01');
  const path = `/api/games/${id}/mode`;
  await response(get('/api/games/999999'), 404);
  await response(get('/api/games/..%2fserver'), 404);
  await response(get('/api/unknown'), 404);
  await response(post(`/api/games/${id}/review`, {}), 404);
  const malformed = await response(raw(path, { method: 'POST', body: '{' }), 400);
  assert.equal(malformed.error.code, 'invalid-json');
  const oversized = await response(raw(path, { method: 'POST', body: '国'.repeat(100000) }), 400);
  assert.equal(oversized.error.code, 'body-too-large');

  async function* chunks() {
    for (let i = 0; i < 5; i++) yield Buffer.alloc(64 * 1024, 0x61);
  }
  const chunked = await response(raw(path, { method: 'POST', body: chunks(), duplex: 'half' }), 400);
  assert.equal(chunked.error.code, 'body-too-large');

  for (const path of ['/', `/g/${id}`, '/g/missing']) {
    const page = await get(path);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal(await page.text(), '<h1>推敲</h1>');
  }
  const asset = await get('/assets/app.js?v=1');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cache-control'), 'no-cache');
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal(await asset.text(), 'window.ready = true;');
  for (const path of [
    '/assets/missing.js', '/assets/../private.txt', '/assets/..%2fprivate.txt',
    '/assets/foo%5C..%5Cprivate.txt', '/assets/%E9', '/assets/symlink.txt', '/assets/app.js/',
  ]) {
    await response(get(path), 404);
  }
});
