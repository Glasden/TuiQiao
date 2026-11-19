import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const bin = fileURLToPath(new URL('../../../bin/tuiqiao.js', import.meta.url));
const real = fileURLToPath(new URL('../../../src/prosody/index.js', import.meta.url));
const skill = fileURLToPath(new URL('../../../skill/tuiqiao/SKILL.md', import.meta.url));
const noProsody = !existsSync(real) && '真实韵律核心暂未落地';
const noSkill = !existsSync(skill) && '技能源文件暂未落地';
const source = {
  title: '赤壁',
  subjects: ['周瑜', '赤壁之战'],
  premise: 'history',
  form: '七绝',
  rhymebook: 'guyun',
  story: '旧战场上，一人捡起了残兵器。',
  poem: '折戟沉沙铁未销，自将磨洗认前朝。\n东风不与周郎便，铜雀春深锁二乔。',
  cloze: '折戟沉沙【铁】未销，自将【磨洗】认前朝。\n东风不与周郎便，铜雀春深锁二【乔】。',
};

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'tuiqiao-cli-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = {
    ...process.env, TUIQIAO_HOME: home, TUIQIAO_PORT: '0', TUIQIAO_HOST: '127.0.0.1',
    TUIQIAO_PUBLIC_URL: 'https://example.invalid/remote/',
  };
  function run(args, code = 0, input) {
    const child = spawnSync(process.execPath, [bin, ...args], { env, input, encoding: 'utf8', timeout: 15000 });
    assert.ifError(child.error);
    assert.equal(child.status, code, `${args.join(' ')}: ${child.stdout} ${child.stderr}`);
    return child;
  }
  return {
    home, env, run,
    json: (...args) => JSON.parse(run(...args).stdout),
    serverFile: join(home, 'server.json'),
  };
}

test('CLI 中文用法、未知命令与失效服务状态', async t => {
  const { run, json, serverFile } = await fixture(t);
  assert.match(run(['--help']).stdout, /用法/);
  assert.match(run([]).stdout, /推敲/);
  assert.match(run(['other'], 2).stderr, /未知命令/);
  assert.match(run(['result', 'xxxxxx'], 1).stderr, /不存在/);
  assert.deepEqual(json(['list', '--json']), []);

  const other = createServer((req, res) => res.end('{"name":"tuiqiao","version":"test"}'));
  await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
  t.after(() => other.close());
  await writeFile(serverFile, JSON.stringify({
    pid: process.pid, host: '127.0.0.1', port: other.address().port,
    url: 'http://localhost', startedAt: '2020-01-01',
  }));
  const state = spawn(process.execPath, [bin, 'status'], {
    env: { ...process.env, TUIQIAO_HOME: join(serverFile, '..') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  state.stdout.setEncoding('utf8').on('data', data => { output += data; });
  const code = await new Promise((resolve, reject) => {
    state.once('error', reject);
    state.once('close', resolve);
  });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(output), { ok: true, running: false });
  assert.equal(existsSync(serverFile), false);
  await writeFile(serverFile, JSON.stringify({ pid: 2147483647, host: '127.0.0.1', port: other.address().port }));
  assert.deepEqual(json(['status']), { ok: true, running: false });
  assert.equal(existsSync(serverFile), false);
  assert.deepEqual(json(['stop']), { ok: true, stopped: false });
});

test('技能安装可覆盖同名文件并替换占位符', { skip: noSkill }, async t => {
  const { home, json } = await fixture(t);
  const target = join(home, 'skills');
  assert.equal(json(['skill', 'path']).path, join(skill, '..'));
  const first = json(['skill', 'install', target]);
  const installed = join(first.path, 'SKILL.md');
  const original = await readFile(skill, 'utf8');
  assert.equal(await readFile(installed, 'utf8'), original.replaceAll('__TUIQIAO_CLI__', first.cli));
  await writeFile(installed, '旧版');
  assert.deepEqual(json(['skill', 'install', target]), first);
  assert.match(await readFile(installed, 'utf8'), /node .*bin\/tuiqiao\.js/);
});

test('CLI 用真实韵律核心建局、后台起停、等待交卷与回写评点', { skip: noProsody }, async t => {
  const { home, env, run, json, serverFile } = await fixture(t);
  let serverPid;
  try {
    const path = join(home, 'input.json');
    await writeFile(path, '{}');
    assert.equal(json(['create', path, '--no-start', '--rm'], 1).ok, false);
    assert.equal(existsSync(path), true);
    await writeFile(path, JSON.stringify(source));
    const game = json(['create', path, '--no-start', '--rm']);
    assert.equal(game.ok, true);
    assert.match(game.id, /^[a-z0-9]{6}$/);
    assert.equal(game.url, `https://example.invalid/remote/g/${game.id}`);
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(serverFile), false);
    assert.equal(json(['result', game.id]).status, 'new');
    assert.equal(json(['wait', game.id, '--timeout', '0'], 3).status, 'pending');
    assert.equal(json(['list', '--json'])[0].id, game.id);
    assert.match(run(['review', game.id, '-'], 1, '{"comment":"评点"}').stderr, /交卷/);

    const forms = json(['forms', '--sample', '2', '--json']);
    assert.deepEqual(new Set(forms.map(form => form.kind)), new Set(['shi', 'ci']));
    assert.equal(json(['form', '七言绝句', '--json']).variants.length, 4);
    const report = json(['check', '--form', '七绝', '--rhymebook', 'guyun', '--json', '-'], 0, source.poem);
    assert.equal(report.ok, true);

    const joined = {
      ...source,
      poem: source.poem.replaceAll('，', ''), cloze: source.cloze.replaceAll('，', ''),
      hiddenLines: [2, 4], glosses: ['甲', '乙', '丙', '丁'],
    };
    await writeFile(path, JSON.stringify(joined));
    const resegmented = json(['create', path, '--no-start', '--rm']);
    const disk = JSON.parse(await readFile(join(home, 'games', `${resegmented.id}.json`), 'utf8'));
    assert.deepEqual(disk.hiddenLines, [1, 3]);
    assert.deepEqual(disk.cloze, ['0.4', '1.2', '1.3', '3.6']);

    const busy = createServer();
    await new Promise(resolve => busy.listen(0, '127.0.0.1', resolve));
    t.after(() => busy.close());
    const started = json(['start', '--port', String(busy.address().port)]);
    serverPid = started.pid;
    assert.equal(started.url, 'https://example.invalid/remote');
    assert.ok(started.port > busy.address().port);
    assert.equal(started.already, false);
    assert.equal(json(['start']).already, true);
    assert.equal(json(['status']).running, true);
    const base = `http://127.0.0.1:${started.port}/api/games/${game.id}`;
    const post = async (action, body) => {
      const response = await fetch(`${base}/${action}`, {
        method: 'POST', body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    assert.equal((await fetch(base).then(response => response.json())).status, 'new');
    await post('mode', { mode: 'fu' });
    const fu = await post('check', { cells: { '0.6': '销' } });
    assert.equal(fu.play.report.complete, false);
    assert.equal(fu.play.report.stats.warns, 0);
    assert.ok(fu.play.report.rhymes.some(group => group.members.some(member => member.ju === 0 && member.char === '销')));
    await post('mode', { mode: 'zi' });
    const submitted = await post('submit', { cells: { '0.4': '铁', '1.2': '雪', '3.6': '乔' } });
    assert.equal(submitted.status, 'submitted');
    assert.equal(submitted.reveal, null);
    const result = json(['wait', game.id, '--timeout', '1']);
    assert.equal(result.status, 'submitted');
    assert.match(result.player, /雪□/);
    assert.deepEqual(result.diffs.map(diff => [diff.ju, diff.pos]), [[2, 3], [2, 4]]);

    assert.deepEqual(json(['review', game.id, '-'], 0, '{"comment":"评点","grade":"中中"}'), { ok: true });
    const unveiled = await post('reveal');
    assert.equal(unveiled.play.review.comment, '评点');
    assert.equal(unveiled.reveal.poem, source.poem);
    assert.equal(json(['list', '--json']).find(entry => entry.id === game.id).status, 'revealed');
    assert.deepEqual(json(['stop']), { ok: true, stopped: true, pid: serverPid });
    assert.equal(existsSync(serverFile), false);
    assert.equal(json(['status']).running, false);

    await writeFile(path, JSON.stringify(source));
    const auto = json(['create', path, '--rm']);
    const autoStatus = json(['status']);
    serverPid = autoStatus.pid;
    assert.equal(auto.ok, true);
    assert.equal(autoStatus.running, true);
    const autoView = await fetch(`http://127.0.0.1:${autoStatus.port}/api/games/${auto.id}`);
    assert.equal((await autoView.json()).status, 'new');
    assert.deepEqual(json(['stop']), { ok: true, stopped: true, pid: serverPid });
    assert.equal(existsSync(serverFile), false);
  } finally {
    if (existsSync(serverFile)) {
      spawnSync(process.execPath, [bin, 'stop'], { env, stdio: 'ignore', timeout: 7000 });
    }
    if (existsSync(serverFile) && serverPid) {
      try {
        process.kill(serverPid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
});
