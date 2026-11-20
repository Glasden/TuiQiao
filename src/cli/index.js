import { cpSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createGame, setReview, toListItem, toResult } from '../game/index.js';
import { createStore } from '../store/index.js';
import { publicUrl, serve, serverStatus, startServer, stopServer } from '../server/index.js';

const usage = `推敲 · 诗词小游戏
用法：tuiqiao <命令> [参数]

  forms [--sample N] [--kind shi|ci] [--all] [--json]    列出体裁
  form <名称> [--json]                                   查看体裁的全部谱式
  check --form <名称> --rhymebook <id> [--variant N] [文件|-] [--json]
                                                         校验诗词，省略文件时读标准输入
  char <字…> [--rhymebook xinyun|guyun] [--kind shi|ci] [--json]
                                                         查字的平仄、声与韵部
  rhymes [韵部] --rhymebook <id> [--kind shi|ci] [--tone 平|仄] [--all] [--json]
                                                         列出韵部或同韵字
  create <game.json> [--allow-flaws] [--rm] [--no-start]  校验并创建对局
  wait <id> [--timeout 秒]                               等待玩家交卷，默认 540 秒
  result <id>                                            查询当前结果
  review <id> <review.json|->                            写入评点
  list [--json]                                          列出对局
  start [--port N] [--host H]                             后台启动服务
  serve [--port N] [--host H]                             前台启动服务
  stop                                                   停止服务
  status                                                 查看服务状态
  skill install [目录]                                   安装推敲技能
  skill path                                             查看技能源目录

韵书：xinyun（中华新韵）、guyun（古韵）。
缺省监听 127.0.0.1:7117，端口被占用时依次顺延。`;

const commands = new Map(Object.entries({
  forms: { min: 0, max: 0, flags: { sample: 'value', kind: 'value', all: 'bool', json: 'bool' } },
  form: { min: 1, max: 1, flags: { json: 'bool' } },
  check: { min: 0, max: 1, flags: { form: 'value', rhymebook: 'value', variant: 'value', json: 'bool' } },
  char: { min: 1, max: 1, flags: { rhymebook: 'value', kind: 'value', json: 'bool' } },
  rhymes: { min: 0, max: 1, flags: { rhymebook: 'value', kind: 'value', tone: 'value', all: 'bool', json: 'bool' } },
  create: { min: 1, max: 1, flags: { 'allow-flaws': 'bool', rm: 'bool', 'no-start': 'bool' } },
  wait: { min: 1, max: 1, flags: { timeout: 'value' } },
  result: { min: 1, max: 1 },
  review: { min: 2, max: 2 },
  list: { min: 0, max: 0, flags: { json: 'bool' } },
  start: { min: 0, max: 0, flags: { port: 'value', host: 'value' } },
  serve: { min: 0, max: 0, flags: { port: 'value', host: 'value' } },
  stop: { min: 0, max: 0 },
  status: { min: 0, max: 0 },
  skill: { min: 1, max: 2 },
}));

class UsageError extends Error {}

function parse(command, args) {
  const spec = commands.get(command);
  if (!spec) throw new UsageError(`未知命令：${command}`);
  const flags = Object.create(null);
  const values = [];
  let positional = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!positional && arg === '--') {
      positional = true;
    } else if (!positional && arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const key = arg.slice(2, eq === -1 ? undefined : eq);
      const kind = spec.flags && Object.hasOwn(spec.flags, key) ? spec.flags[key] : null;
      if (!kind || Object.hasOwn(flags, key) || (kind === 'bool' && eq !== -1)) {
        throw new UsageError(`无效或重复的选项：${arg}`);
      }
      if (kind === 'bool') {
        flags[key] = true;
      } else {
        const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
        if (!value || value.startsWith('--')) throw new UsageError(`--${key} 缺少取值`);
        flags[key] = value;
      }
    } else if (!positional && arg.startsWith('-') && arg !== '-') {
      throw new UsageError(`未知选项：${arg}`);
    } else {
      values.push(arg);
    }
  }
  if (values.length < spec.min || values.length > spec.max) {
    throw new UsageError(`命令 ${command} 的位置参数数量不正确`);
  }
  return { flags, values };
}

function integer(value, label, min, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new UsageError(`${label} 须为 ${min} 到 ${max} 的整数`);
  }
  return n;
}

function settings(flags = {}) {
  const host = flags.host ?? (process.env.TUIQIAO_HOST || '127.0.0.1');
  const port = flags.port ?? (process.env.TUIQIAO_PORT || '7117');
  if (!host.trim()) throw new UsageError('host 须为非空主机地址');
  return { host, port: integer(port, 'port', 0, 65535) };
}

function readText(file) {
  try {
    return readFileSync(file === '-' ? 0 : file, 'utf8');
  } catch (error) {
    throw new Error(`无法读取${file === '-' ? '标准输入' : `文件 ${file}`}（${error.code}）`);
  }
}

function readJson(file) {
  const text = readText(file);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${file === '-' ? '标准输入' : file} 须为有效 JSON`);
  }
}

function getGame(store, id) {
  const game = store.readGame(id);
  if (!game) throw new Error(`对局不存在：${id}`);
  return game;
}

// 建局失败时回给模型的报告：逐字明细太长，只留变体、韵脚与问题清单
function slimReport({ form, variant, rhymes, issues, stats }) {
  return {
    form: form?.name, variant: variant?.label ?? null, stats, issues,
    rhymes: (rhymes ?? []).map(({ group, tone, name, ok, members }) => ({ group, tone, name, ok, chars: members.map(m => m.char).join('') })),
  };
}

function formatReport(report, bookName) {
  const lines = [[report.form.name, report.variant?.label, bookName].filter(Boolean).join(' · ')];
  for (const [j, row] of report.ju.entries()) {
    const tones = row.cells.map(cell => cell.want).join('');
    const marks = row.cells.map(cell => cell.ok === null ? '·' : cell.ok ? '✓' : '✗').join('');
    lines.push(`${j + 1} ${row.text}  ${tones}(${row.end})  ${marks}`);
  }
  for (const { group, name, members, ok } of report.rhymes) {
    const words = members.map(({ char, rhymes }) => `${char ?? '□'}(${rhymes.join('/') || name || '—'})`);
    lines.push(`韵脚${report.rhymes.length > 1 ? group : ''}：${words.join(' ')} ${ok ? '✓' : '✗'}`);
  }
  for (const issue of report.issues) {
    lines.push(`${issue.level === 'error' ? '✗' : '·'} ${issue.message}`);
  }
  lines.push(`结论：${report.stats.errors} 处错误，${report.stats.warns} 处提醒`);
  return lines.join('\n');
}

function formatForm(form) {
  const lines = [form.name];
  if (form.desc) lines.push(form.desc);
  for (const variant of form.variants) {
    lines.push('', `[${variant.index}] ${variant.label}　${variant.chars} 字　${variant.sketch}`);
    for (const [j, row] of variant.ju.entries()) {
      const group = row.rhyme ? `第 ${row.rhymeGroup} 组${row.rhymeTone ?? ''}韵` : '';
      lines.push(`${j + 1} ${row.tones}(${row.end}) ${group}`.trimEnd());
      if (row.stanzaEnd && j < variant.ju.length - 1) lines.push('');
    }
  }
  return lines.join('\n');
}

function validateRhymeOptions({ rhymebook, kind }) {
  if (rhymebook && !['xinyun', 'guyun'].includes(rhymebook)) {
    throw new UsageError('--rhymebook 须为 xinyun 或 guyun');
  }
  if (kind && !['shi', 'ci'].includes(kind)) throw new UsageError('--kind 须为 shi 或 ci');
}

const charTables = [
  { key: 'xinyun', label: '新韵', rhymebook: 'xinyun' },
  { key: 'pingshui', label: '平水', rhymebook: 'guyun', kind: 'shi' },
  { key: 'cilin', label: '词林', rhymebook: 'guyun', kind: 'ci' },
];

function formatReadings({ known, readings }) {
  if (!known) return '未收';
  return readings.map(({ sheng, rhyme, tone }) => `${sheng}·${rhyme.replace(/^入声/u, '')}（${tone}）`).join('/');
}

async function formsOf(flags, loadProsody) {
  const kind = flags.kind;
  if (kind && !['shi', 'ci'].includes(kind)) throw new UsageError('--kind 须为 shi 或 ci');
  const count = flags.sample === undefined ? null : integer(flags.sample, '--sample', 0);
  const prosody = await loadProsody();
  if (count === null) return prosody.listForms({ kind, commonOnly: !flags.all });
  if (!kind) return prosody.sampleForms(count);
  const pool = [...prosody.listForms({ kind, commonOnly: true })];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function shellPath(bin) {
  if (/^[a-zA-Z0-9_./:-]+$/.test(bin)) return bin;
  const replacement = process.platform === 'win32' ? "''" : "'\\''";
  return "'" + bin.replaceAll("'", replacement) + "'";
}

function skillCommand(action, target, bin) {
  const source = fileURLToPath(new URL('../../skill/tuiqiao', import.meta.url));
  if (action === 'path' && !target) return { ok: true, path: source };
  if (action !== 'install') throw new UsageError('用法：tuiqiao skill install [目录] 或 tuiqiao skill path');
  const path = join(resolve(target ?? join(homedir(), '.claude', 'skills')), 'tuiqiao');
  if (path === source) throw new Error('技能安装目录与源目录相同');
  const cli = `node ${shellPath(bin)}`;
  const skill = readFileSync(join(source, 'SKILL.md'), 'utf8').replaceAll('__TUIQIAO_CLI__', () => cli);
  cpSync(source, path, { recursive: true, force: true });
  writeFileSync(join(path, 'SKILL.md'), skill);
  return { ok: true, path, cli };
}

function show(value) {
  console.log(JSON.stringify(value));
}

export async function runCli([command, ...args], { loadProsody, bin }) {
  if (!command || command === '--help' || command === '-h' ||
      (commands.has(command) && ['--help', '-h'].includes(args[0]))) {
    console.log(usage);
    return 0;
  }
  try {
    const { flags, values: [first, second] } = parse(command, args);
    const store = createStore();
    switch (command) {
      case 'forms': {
        const forms = await formsOf(flags, loadProsody);
        if (flags.json) show(forms);
        else if (forms.length) console.log(forms.map(f => `${f.name}　${f.chars} 字　${f.sketch}`).join('\n'));
        break;
      }
      case 'form': {
        const form = (await loadProsody()).resolveForm(first);
        if (!form) throw new Error(`谱库中没有体裁「${first}」`);
        if (flags.json) show(form);
        else console.log(formatForm(form));
        break;
      }
      case 'check': {
        if (!flags.form || !flags.rhymebook) throw new UsageError('check 须指定 --form 和 --rhymebook');
        validateRhymeOptions(flags);
        const variant = flags.variant === undefined ? 'auto' : integer(flags.variant, '--variant', 0);
        const prosody = await loadProsody();
        if (variant !== 'auto' && !prosody.resolveForm(flags.form)?.variants.some(v => v.index === variant)) {
          throw new Error(`体裁「${flags.form}」没有编号 ${variant} 的变体`);
        }
        const book = prosody.RHYMEBOOKS.find(entry => entry.id === flags.rhymebook);
        const report = prosody.checkPoem({
          form: flags.form, rhymebook: flags.rhymebook, text: readText(first ?? '-'), variant,
        });
        if (flags.json) show(report);
        else console.log(formatReport(report, book.name));
        return report.ok ? 0 : 1;
      }
      case 'char': {
        validateRhymeOptions(flags);
        const chars = first.match(/\p{Script=Han}/gu) ?? [];
        if (!chars.length) throw new UsageError('char 须提供至少一个汉字');
        const { rhymebook, kind } = flags;
        const tables = charTables.filter(table => !rhymebook ||
          (table.rhymebook === rhymebook && (!kind || !table.kind || table.kind === kind)));
        const { charInfo } = await loadProsody();
        const entries = chars.map(char => ({
          char,
          ...Object.fromEntries(tables.map(table => [table.key, charInfo(char, table.rhymebook, table.kind)])),
        }));
        if (flags.json) show(entries);
        else {
          console.log(entries.map(entry => [
            entry.char, ...tables.map(({ key, label }) => `${label} ${formatReadings(entry[key])}`),
          ].join('　')).join('\n'));
        }
        break;
      }
      case 'rhymes': {
        const { rhymebook, kind = 'shi', tone } = flags;
        if (!rhymebook) throw new UsageError('rhymes 须指定 --rhymebook');
        validateRhymeOptions(flags);
        if (tone && !['平', '仄'].includes(tone)) throw new UsageError('--tone 须为平或仄');
        const prosody = await loadProsody();
        if (first === undefined) {
          const entries = prosody.listRhymes(rhymebook, kind).filter(entry => !tone || entry.tone === tone);
          if (flags.json) show(entries);
          else if (entries.length) {
            console.log(entries.map(entry => `${entry.name}　${entry.tone}　常用 ${entry.common} / 共 ${entry.chars}`).join('\n'));
          }
          break;
        }
        const rhymes = prosody.rhymeChars(first, rhymebook, kind);
        if (!rhymes.length) {
          const listCommand = `tuiqiao rhymes --rhymebook ${rhymebook}${kind === 'ci' ? ' --kind ci' : ''}`;
          throw new Error(`未找到韵部「${first}」。运行 ${listCommand} 查看全部韵名`);
        }
        const entries = rhymes.filter(entry => !tone || entry.tone === tone)
          .map(entry => ({ ...entry, rare: flags.all ? entry.rare : '' }));
        if (flags.json) show(entries);
        else if (entries.length) {
          const name = prosody.bookName(rhymebook, kind);
          console.log(entries.map(entry =>
            `${entry.name} · ${entry.tone} · ${name}　常用 ${Array.from(entry.common).length} 字\n${entry.common}${entry.rare}`).join('\n'));
        }
        break;
      }
      case 'create': {
        let url;
        let game;
        try {
          if (flags.rm && first === '-') throw new UsageError('--rm 须与实际输入文件一起使用');
          const input = readJson(first);
          const prosody = await loadProsody();
          game = await store.createGame(async id => {
            const game = createGame(input, { prosody, id, allowFlaws: flags['allow-flaws'] });
            let active = await serverStatus(store);
            if (!active && !flags['no-start']) active = await startServer({ store, ...settings() });
            const address = active ?? settings();
            url = `${publicUrl(address.host, address.port)}/g/${id}`;
            return game;
          });
        } catch (error) {
          if (error instanceof UsageError) throw error;
          show({ ok: false, errors: error.errors ?? [error.message], ...(error.report ? { report: slimReport(error.report) } : {}) });
          return 1;
        }
        if (flags.rm) {
          try {
            unlinkSync(first);
          } catch (error) {
            console.error(`对局 ${game.id} 已创建，无法删除输入文件 ${first}（${error.code}）`);
            show({ ok: false, errors: [`对局 ${game.id} 已创建，无法删除输入文件`] });
            return 1;
          }
        }
        show({
          ok: true, id: game.id, url, title: game.title, form: game.form.name,
          rhymebook: game.rhymebook.id, flaws: game.original.issues,
        });
        break;
      }
      case 'wait': {
        const seconds = Number(flags.timeout ?? 540);
        if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(flags.timeout ?? '540') ||
            !Number.isFinite(seconds * 1000)) {
          throw new UsageError('--timeout 须为非负秒数');
        }
        const deadline = Date.now() + 1000 * seconds;
        for (;;) {
          const result = toResult(getGame(store, first));
          if (result.status === 'submitted' || result.status === 'revealed') {
            show(result);
            return 0;
          }
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            show({ ...result, status: 'pending' });
            return 3;
          }
          await sleep(Math.min(500, remaining));
        }
      }
      case 'result':
        show(toResult(getGame(store, first)));
        break;
      case 'review': {
        const input = readJson(second);
        const game = await store.updateGame(first, game => setReview(game, input));
        if (!game) throw new Error(`对局不存在：${first}`);
        show({ ok: true });
        break;
      }
      case 'list': {
        const games = store.listGames().map(game => {
          const { grades, ...item } = toListItem(game);
          return item;
        });
        if (flags.json) show(games);
        else {
          for (const game of games) {
            console.log(`${game.id}　${game.title}　${game.form.name}　${game.status}　${game.createdAt}`);
          }
        }
        break;
      }
      case 'start': {
        const { url, pid, port, already } = await startServer({ store, ...settings(flags) });
        show({ ok: true, url, pid, port, already });
        break;
      }
      case 'serve': {
        const config = settings(flags);
        await serve({ store, ...config, prosody: await loadProsody(), log: console.error });
        break;
      }
      case 'status': {
        const info = await serverStatus(store);
        show({ ok: true, running: Boolean(info), ...info });
        break;
      }
      case 'stop': {
        const info = await stopServer(store);
        show({ ok: true, stopped: Boolean(info), ...(info ? { pid: info.pid } : {}) });
        break;
      }
      case 'skill':
        show(skillCommand(first, second, bin));
        break;
    }
    return 0;
  } catch (error) {
    console.error(error.message);
    if (error instanceof UsageError) {
      console.error('运行 tuiqiao --help 查看用法');
      return 2;
    }
    return 1;
  }
}
