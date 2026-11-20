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

test('CLI char 可按韵表查字，输出文本或 JSON', { skip: noProsody }, async t => {
  const { run, json } = await fixture(t);
  const usage = run(['--help']).stdout;
  assert.match(usage, /char <字…>/);
  assert.match(usage, /rhymes \[韵部\]/);
  assert.deepEqual(run(['char', '白，石a𠮷']).stdout.trimEnd().split('\n'), [
    '白　新韵 阳平·四开（平）　平水 入·十一陌（仄）　词林 入·第十七部（仄）',
    '石　新韵 去·八寒（仄）/阳平·十三支（平）　平水 入·十一陌（仄）　词林 入·第十七部（仄）',
    '𠮷　新韵 未收　平水 未收　词林 未收',
  ]);
  const [all] = json(['char', '白', '--json']);
  assert.deepEqual(Object.keys(all), ['char', 'xinyun', 'pingshui', 'cilin']);
  assert.deepEqual(all.xinyun, {
    char: '白', known: true, tones: ['平'],
    readings: [{ tone: '平', sheng: '阳平', rhyme: '四开', pinyin: 'bái' }],
  });
  assert.deepEqual(json(['char', '白', '--rhymebook', 'guyun', '--json']),
    [{ char: '白', pingshui: all.pingshui, cilin: all.cilin }]);
  assert.deepEqual(json(['char', '白', '--rhymebook', 'guyun', '--kind', 'ci', '--json']),
    [{ char: '白', cilin: all.cilin }]);
  assert.deepEqual(json(['char', '白', '--rhymebook', 'xinyun', '--json']),
    [{ char: '白', xinyun: all.xinyun }]);
  assert.match(run(['char', 'abc，！'], 2).stderr, /汉字/);
});

test('CLI rhymes 可列韵和韵字，按平仄筛选并选择是否包含僻字', { skip: noProsody }, async t => {
  const { run, json } = await fixture(t);
  const list = ['rhymes', '--rhymebook', 'guyun'];
  const words = ['rhymes', '七阳', '--rhymebook', 'guyun'];
  assert.match(run(list).stdout, /^七阳　平　常用 145 \/ 共 273$/m);
  const oblique = json([...list, '--tone', '仄', '--json']);
  assert.equal(oblique.length, 76);
  assert.ok(oblique.every(entry => entry.tone === '仄'));
  const [header, common] = run(words).stdout.trimEnd().split('\n');
  assert.equal(header, '七阳 · 平 · 平水韵　常用 145 字');
  assert.equal(common.length, 145);
  assert.ok(common.includes('阳'));
  assert.deepEqual(json([...words, '--json']), [{ name: '七阳', tone: '平', common, rare: '' }]);
  const [all] = json([...words, '--all', '--tone', '平', '--json']);
  assert.equal([...all.rare].length, 128);
  assert.equal(run([...words, '--all']).stdout.trimEnd(), `${header}\n${common}${all.rare}`);
  assert.deepEqual(json([...words, '--tone', '仄', '--json']), []);
  const [ci] = json(['rhymes', '第十七部', '--rhymebook', 'guyun', '--kind', 'ci', '--json']);
  assert.equal(ci.tone, '仄');
  assert.match(run([...list, '无此韵'], 1).stderr, /tuiqiao rhymes --rhymebook guyun/);
  assert.match(run([...list, ''], 1).stderr, /未找到韵部/);
  assert.match(run(['rhymes'], 2).stderr, /--rhymebook/);
  assert.match(run([...list, '--tone', '入'], 2).stderr, /--tone/);
});

test('CLI create 校验干扰字类型并将去重后的汉字写入对局', { skip: noProsody }, async t => {
  const { home, json } = await fixture(t);
  const path = join(home, 'source.json');
  const args = ['create', path, '--no-start'];
  await writeFile(path, JSON.stringify({ ...source, decoys: ['铁'] }));
  const invalid = json(args, 1);
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join('\n'), /decoys 须为文本/);
  await writeFile(path, JSON.stringify({ ...source, decoys: '銅，𠮷铜 銅a' }));
  const created = json(args);
  assert.equal(created.ok, true);
  const stored = JSON.parse(await readFile(join(home, 'games', `${created.id}.json`), 'utf8'));
  assert.deepEqual(stored.decoys, [...'銅𠮷铜']);
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
    const listed = json(['list', '--json']).find(entry => entry.id === game.id);
    assert.equal(listed.status, 'revealed');
    assert.ok(!Object.hasOwn(listed, 'grades'));
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
