import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  calculateScore, check, createGame, hint, reveal, saveDraft, setMode,
  setReview, submit, toResult, toView,
} from '../../../src/game/index.js';
import * as prosody from './fake-prosody.js';
import { input, originalIssue } from './fake-prosody.js';

const stamp = '2026-01-02T03:04:05.000Z';
const deps = { prosody, id: 'abc123', now: stamp };
const make = (source = input, options = {}) => createGame(source, { ...deps, ...options });
const conflict = action => assert.throws(action, { status: 409, code: 'conflict' });
const invalid = action => assert.throws(action, { status: 400, code: 'invalid-input' });

function checkInvalid(source, pattern) {
  assert.throws(() => make(source), error =>
    Array.isArray(error.errors) && error.errors.some(message => pattern.test(message)));
}

test('建局拒绝缺失、格式错误、挖空错位及不合格律的输入', () => {
  checkInvalid(null, /JSON 对象/);
  for (const key of ['title', 'subjects', 'premise', 'form', 'rhymebook', 'story', 'poem']) {
    const source = { ...input };
    delete source[key];
    checkInvalid(source, new RegExp(key));
  }
  for (const [key, value] of [
    ['title', '  '], ['subjects', []], ['subjects', ['水路', 1]], ['premise', 'fiction'],
    ['rhymebook', 'other'], ['premiseNote', null], ['note', 7], ['cloze', 7],
    ['decoys', null], ['decoys', 1], ['decoys', ['字']],
    ['cloze', input.cloze + '！'], ['cloze', input.cloze.replace('【玄】', '【【玄】】')],
    ['cloze', input.cloze.replace('【玄】', '【】玄')], ['cloze', input.cloze.replace('【玄】', '【玄')],
    ['cloze', input.poem.replace('，', '【，】')], ['hiddenLines', [0, 4]], ['hiddenLines', [5]],
    ['hiddenLines', [1, 2, 3, 4]], ['hiddenLines', [1.1]], ['glosses', ['短']],
    ['glosses', ['一', '二', '', '四']], ['imagery', Array(9).fill('太多')],
  ]) {
    checkInvalid({ ...input, [key]: value }, new RegExp(key));
  }
  checkInvalid({ ...input, poem: '。' }, /汉字/);
  const wrong = { ...input, poem: '玄杉晚渡，孤鹤隐晴光。\n曲涧承钟影，回舟入夜塘。' };
  delete wrong.cloze;
  assert.throws(() => make(wrong), error => error.report?.stats.errors === 1 && /句数或字数/.test(error.errors[0]));
  const tolerated = make(wrong, { allowFlaws: true });
  assert.equal(tolerated.original.ok, false);
  assert.equal(tolerated.original.issues[0].code, 'length');
  setMode(tolerated, 'zi', deps);
  assert.equal(toView(tolerated).play.board.ju[0].cells.length, 4);
});

test('建局的干扰字只存汉字，按原次序去重后保留前十二个', () => {
  assert.deepEqual(make().decoys, []);
  assert.deepEqual(make({ ...input, decoys: ' a!。' }).decoys, []);
  const game = make({ ...input, decoys: '𠮷a山山，水魚鱼天地玄黃宇宙洪荒日月' });
  assert.deepEqual(game.decoys, [...'𠮷山水魚鱼天地玄黃宇宙洪']);
});

test('缺省挖空可复现且覆盖每句，Unicode 字位按原作和标点对齐', () => {
  const { cloze, hiddenLines, glosses, imagery, note, premiseNote, ...source } = input;
  const first = make(source);
  const again = make(source);
  assert.deepEqual(first.cloze, again.cloze);
  assert.equal(first.cloze.length, 6);
  assert.equal(new Set(first.cloze.map(key => key.split('.')[0])).size, 4);
  assert.deepEqual(first.hiddenLines, [1, 3]);
  assert.deepEqual(first.imagery, []);
  assert.equal(first.glosses, null);
  assert.equal(first.note, null);
  assert.equal(first.premiseNote, null);
  assert.equal(first.createdAt, stamp);
  const unicode = make({
    ...input, poem: input.poem.replace('玄杉', '𠀀杉'),
    cloze: input.cloze.replace('【玄】杉', '【𠀀杉】'),
  });
  assert.deepEqual(unicode.cloze, ['0.0', '0.1', '1.1', '1.4', '2.3', '3.3']);
  for (const form of ['浣溪沙', '逸体']) assert.deepEqual(make({ ...source, form }).hiddenLines, [1, 3]);
  const one = make({ ...source, form: '逸体', poem: '山。' });
  assert.deepEqual(one.cloze, ['0.0']);
  assert.deepEqual(one.hiddenLines, []);
});

test('四个状态的 View 只显示此时可见的信息', () => {
  const flawed = {
    ...prosody,
    checkPoem(args) {
      const report = prosody.checkPoem(args);
      if (!args.partial) {
        report.issues.push(originalIssue);
        report.stats.errors++;
        report.ok = false;
      }
      return report;
    },
  };
  const flawedDeps = { ...deps, prosody: flawed };
  const secret = [...'玄鹤光钟夜', input.note, ...input.glosses, ...input.imagery, originalIssue.message];
  const game = make(input, { allowFlaws: true, prosody: flawed });
  function doesNotLeak() {
    const view = toView(game);
    const json = JSON.stringify(view);
    for (const value of secret) assert.ok(!json.includes(value), `${game.status} 泄露了 ${value}`);
    assert.equal(view.reveal, null);
    return view;
  }

  assert.equal(doesNotLeak().play, null);
  assert.deepEqual(toView(game).modes, [
    { id: 'ze', name: '择字', group: 'xuan', blanks: 5 },
    { id: 'bian', name: '辨字', group: 'xuan', blanks: 5 },
    { id: 'chai', name: '拆篇', group: 'xuan', blanks: 20 },
    { id: 'zi', name: '填字', group: 'xie', blanks: 5 },
    { id: 'ju', name: '补句', group: 'xie', blanks: 2 },
    { id: 'fu', name: '自赋', group: 'xie', blanks: 20 },
  ]);
  setMode(game, 'zi', flawedDeps);
  const { play } = doesNotLeak();
  assert.equal(play.board.ju[0].rhyme, null);
  assert.deepEqual(play.board.ju[0].cells[0], {
    kind: 'blank', char: null, input: null, want: null, fb: null, tried: [],
  });
  hint(game, { type: 'pattern' });
  assert.equal(doesNotLeak().play.board.ju[0].cells[0].want, '平');
  submit(game, { cells: {} }, flawedDeps);
  assert.equal(doesNotLeak().status, 'submitted');
  reveal(game);
  const { reveal: unveiled } = toView(game);
  assert.equal(unveiled.poem, input.poem);
  assert.equal(unveiled.note, input.note);
  assert.deepEqual(unveiled.glosses, input.glosses);
  assert.deepEqual(unveiled.imagery, input.imagery);
  assert.deepEqual(unveiled.issues, [originalIssue]);
  assert.equal(unveiled.ju[0].cells[0].char, '玄');

  for (const [mode, hidden] of [['ju', '孤鹤隐晴光回舟入夜塘'], ['fu', '玄鹤光钟夜']]) {
    const trial = make(input, { allowFlaws: true, prosody: flawed });
    setMode(trial, mode, flawedDeps);
    check(trial, { cells: {} }, flawedDeps);
    const view = JSON.stringify(toView(trial));
    for (const value of [...hidden, input.note, ...input.glosses, ...input.imagery, originalIssue.message]) {
      assert.ok(!view.includes(value), `${mode} 泄露了 ${value}`);
    }
  }
});

test('填字与补句反馈按优先级分配，草稿只取首个字符', () => {
  const zi = make();
  setMode(zi, 'zi', deps);
  saveDraft(zi, { cells: { '0.0': '山水', '0.1': '鹤', '9.0': '多', '_bad': '夜' } }, deps);
  let play = toView(zi).play;
  assert.equal(play.checks, 0);
  assert.equal(play.board.ju[0].cells[0].input, '山');
  assert.equal(play.board.ju[0].cells[0].fb, null);
  assert.equal(play.board.ju[0].cells[1].input, null);
  check(zi, { cells: { '0.0': '玄', '1.1': '多', '1.4': '堂', '2.3': '雨' } }, deps);
  play = toView(zi).play;
  assert.equal(play.checks, 1);
  assert.deepEqual([play.board.ju[0].cells[0].fb, play.board.ju[1].cells[1].fb,
    play.board.ju[1].cells[4].fb, play.board.ju[2].cells[3].fb, play.board.ju[3].cells[3].fb],
  ['hit', 'tone', 'rhyme', 'miss', null]);

  const ju = make();
  setMode(ju, 'ju', deps);
  const cells = { '1.0': '晴', '1.1': '晴', '1.2': '隐', '1.3': '山', '1.4': '堂' };
  check(ju, { cells }, deps);
  assert.deepEqual(toView(ju).play.board.ju[1].cells.map(cell => cell.fb),
    ['present', 'miss', 'hit', 'tone', 'rhyme']);
  check(ju, { cells: { ...cells, '1.3': '晴' } }, deps);
  assert.deepEqual(toView(ju).play.board.ju[1].cells.map(cell => cell.fb),
    ['tone', 'miss', 'hit', 'hit', 'rhyme']);
  invalid(() => saveDraft(ju, { text: '' }));
  invalid(() => saveDraft(ju, { cells: { '1.0': true } }));
});

test('曾试之字兼容旧档，同格同字更新反馈并保留首次试字次序', () => {
  const game = make();
  setMode(game, 'ju', deps);
  delete game.play.tried;
  const board = () => toView(game).play.board.ju[1].cells;
  assert.deepEqual(board()[0].tried, []);
  saveDraft(game, { cells: { '1.0': '晴' } }, deps);
  assert.deepEqual(board()[0].tried, []);
  check(game, { cells: { '1.0': '晴' } }, deps);
  check(game, { cells: { '1.0': '春' } }, deps);
  assert.deepEqual(board()[0].tried, [{ char: '晴', fb: 'present' }, { char: '春', fb: 'tone' }]);
  check(game, { cells: { '1.0': '晴', '1.3': '晴' } }, deps);
  assert.deepEqual(board()[0].tried, [{ char: '晴', fb: 'tone' }, { char: '春', fb: 'tone' }]);
  assert.deepEqual(toView(game).play.board.ju[0].cells[0].tried, []);

  hint(game, { type: 'char', j: 1, i: 0 });
  assert.equal(board()[0].kind, 'hinted');
  assert.deepEqual(board()[0].tried, []);
  assert.ok(!Object.hasOwn(game.play.tried, '1.0'));
  submit(game, { cells: { '1.3': '秋' } }, deps);
  assert.deepEqual(board()[3].tried, [{ char: '晴', fb: 'hit' }]);

  const oldGame = make();
  setMode(oldGame, 'zi', deps);
  delete oldGame.play.tried;
  hint(oldGame, { type: 'char', j: 0, i: 0 });
  assert.deepEqual(toView(oldGame).play.board.ju[0].cells[0].tried, []);
});

test('每格只保留最近十二条曾试之字，换档清空，自赋没有曾试之字', () => {
  const game = make();
  setMode(game, 'fu', deps);
  check(game, { cells: { '1.4': '堂' } }, deps);
  assert.deepEqual(toView(game).play.board.ju[1].cells[4].tried, []);
  assert.deepEqual(game.play.tried, {});
  setMode(game, 'ju', deps);
  const chars = [...'天地玄黄宇宙洪荒日月盈昃辰'];
  for (const char of chars) check(game, { cells: { '1.4': char } }, deps);
  assert.deepEqual(toView(game).play.board.ju[1].cells[4].tried.map(({ char }) => char), chars.slice(1));
  setMode(game, 'zi', deps);
  assert.deepEqual(toView(game).play.board.ju[1].cells[4].tried, []);
  assert.deepEqual(game.play.tried, {});
});

test('繁简同字：繁体所填与原作简体同字算 hit，补句的 present 与交卷差异亦然', () => {
  const zi = make();
  setMode(zi, 'zi', deps);
  check(zi, { cells: { '1.1': '鶴', '2.3': '鐘' } }, deps);
  let play = toView(zi).play;
  assert.deepEqual([play.board.ju[1].cells[1].fb, play.board.ju[2].cells[3].fb], ['hit', 'hit']);
  submit(zi, { cells: { '1.1': '鶴', '2.3': '鐘' } }, deps);
  assert.equal(toView(zi).play.score.hit, 2);
  assert.deepEqual(toResult(zi).diffs.map(diff => diff.original), ['玄', '光', '夜']);

  const ju = make();
  setMode(ju, 'ju', deps);
  check(ju, { cells: { '1.0': '隱', '1.1': '鶴' } }, deps);
  play = toView(ju).play;
  assert.deepEqual(play.board.ju[1].cells.slice(0, 2).map(cell => cell.fb), ['present', 'hit']);
});

test('词依古韵、原作韵组依平水韵通押时，韵脚位按平水韵也算韵合', () => {
  // 原作韵组记作平水韵名「七阳」；词林正韵只给部名，须改查平水韵才配得上
  const ciProsody = {
    ...prosody,
    charInfo(char, rhymebook, kind) {
      const info = prosody.charInfo(char);
      if (kind !== 'ci') return info;
      return { ...info, readings: info.readings.map(reading => ({ ...reading, rhyme: '第二部' })) };
    },
  };
  const ciDeps = { ...deps, prosody: ciProsody };
  const game = make({ ...input, form: '浣溪沙', rhymebook: 'guyun' }, ciDeps);
  assert.equal(game.original.rhymes[0].name, '七阳');
  setMode(game, 'zi', ciDeps);
  check(game, { cells: { '1.4': '堂' } }, ciDeps);
  assert.equal(toView(game).play.board.ju[1].cells[4].fb, 'rhyme');
  check(game, { cells: { '1.4': '同' } }, ciDeps);
  assert.equal(toView(game).play.board.ju[1].cells[4].fb, 'tone');
});

test('自赋用玩家 Report 决定诗的变体，固定词的变体并支持自由文本', () => {
  const calls = [];
  const options = {
    prosody: {
      ...prosody,
      checkPoem(args) {
        calls.push(args);
        return prosody.checkPoem(args);
      },
    },
  };
  const shi = make();
  setMode(shi, 'fu', options);
  const initial = toView(shi).play;
  assert.equal(initial.variantLabel, '正体');
  assert.equal(initial.report, null);
  assert.ok(initial.board.ju.every(row => row.cells.every(cell => cell.kind === 'blank' && cell.fb === null && cell.char === null)));
  saveDraft(shi, { cells: { '0.0': '雨', '0.3': '多' } }, options);
  assert.equal(toView(shi).play.variantLabel, '变体一');
  assert.equal(toView(shi).play.report, null);
  check(shi, { cells: { '0.0': '雨', '0.3': '多' } }, options);
  assert.deepEqual(calls.at(-1).ju, ['雨□□多', '', '', '']);
  assert.equal(calls.at(-1).variant, 'auto');
  assert.equal(toView(shi).play.board.ju[0].cells[0].want, '仄');
  assert.equal(toView(shi).play.checks, 0);
  assert.deepEqual(toView(shi).play.report.stats, { errors: 0, warns: 0 });
  assert.equal(toView(shi).play.report.complete, false);
  check(shi, { cells: {} }, options);
  assert.equal(calls.at(-1).variant, 0);
  assert.equal(toView(shi).play.variantLabel, '正体');
  assert.equal(toView(shi).play.board.ju[0].cells[0].want, '平');

  const ci = make({ ...input, form: '浣溪沙' });
  setMode(ci, 'fu', options);
  check(ci, { cells: { '0.0': '雨' } }, options);
  assert.equal(calls.at(-1).variant, 0);
  assert.equal(toView(ci).play.variantLabel, '正体');

  const free = make({ ...input, form: '逸体' });
  setMode(free, 'fu', options);
  invalid(() => saveDraft(free, { cells: {} }));
  check(free, { text: '落花。' }, options);
  hint(free, { type: 'gloss', j: 1 });
  const view = toView(free).play;
  assert.equal(view.freeText, true);
  assert.equal(view.patternShown, false);
  assert.equal(view.text, '落花。');
  assert.equal(view.board, null);
  assert.deepEqual(view.glosses, [{ j: 1, text: input.glosses[1] }]);
  assert.ok(!JSON.stringify(view).includes(input.glosses[0]));
  submit(free, { text: '沉花。' }, { ...options, now: stamp });
  assert.equal(toView(free).play.prosody, null);
  assert.equal(toResult(free).player, '沉花。');
  assert.equal(toResult(free).score, null);
  assert.deepEqual(toResult(free).diffs, []);
});

test('交卷后的格律过滤原作同一瑕疵并重算 ok，Result 保留完整问题清单', () => {
  const warning = { ...originalIssue, pos: 1, level: 'warn' };
  const playerError = { ...originalIssue, message: '玩家新填字的平仄错误' };
  const checking = {
    ...prosody,
    checkPoem(args) {
      const report = prosody.checkPoem(args);
      const issues = args.partial
        ? [originalIssue, { ...originalIssue, level: 'warn' }, warning]
        : [originalIssue];
      if (args.ju?.[1]?.includes('雨')) issues.push(playerError);
      const errors = issues.filter(issue => issue.level === 'error').length;
      return { ...report, ok: !errors, issues, stats: { errors, warns: issues.length - errors } };
    },
  };
  const options = { ...deps, prosody: checking };
  for (const mode of ['zi', 'ju', 'fu']) {
    const game = make(input, { prosody: checking, allowFlaws: true });
    setMode(game, mode, options);
    check(game, { cells: {} }, options);
    assert.equal(toView(game).play.prosody, null);
    const cells = mode === 'zi'
      ? { '0.0': '玄', '1.1': '鹤', '1.4': '光', '2.3': '钟', '3.3': '夜' }
      : mode === 'ju' ? { '1.0': '雨' } : {};
    submit(game, { cells }, options);
    const issues = [originalIssue, { ...originalIssue, level: 'warn' }, warning];
    if (mode === 'ju') issues.push(playerError);
    assert.deepEqual(toResult(game).prosody, { ok: false, issues });
    const expected = {
      ok: mode === 'zi', complete: mode === 'zi',
      issues: mode === 'fu' ? issues : mode === 'ju' ? [warning, playerError] : [warning],
    };
    assert.deepEqual(toView(game).play.prosody, expected);
    reveal(game);
    assert.deepEqual(toView(game).play.prosody, expected);
    delete game.play.resultProsody.complete;
    assert.deepEqual(toView(game).play.prosody, { ...expected, complete: null });
  }

  const free = make({ ...input, form: '逸体' });
  setMode(free, 'zi', deps);
  submit(free, { cells: {} }, deps);
  assert.equal(toView(free).play.prosody, null);
});

test('只能降档，累计次数与已取的提示保留，草稿和反馈清空', () => {
  const game = make();
  invalid(() => setMode(game, 'unknown', deps));
  conflict(() => saveDraft(game, { cells: {} }, deps));
  setMode(game, 'fu', deps);
  check(game, { cells: { '0.0': '多' } }, deps);
  hint(game, { type: 'imagery' });
  conflict(() => setMode(game, 'fu', deps));
  setMode(game, 'ju', deps);
  assert.equal(toView(game).play.board.ju[1].cells[0].input, null);
  assert.equal(toView(game).play.report, null);
  conflict(() => setMode(game, 'fu', deps));
  check(game, { cells: { '1.4': '堂' } }, deps);
  hint(game, { type: 'pattern' });
  hint(game, { type: 'char', j: 1, i: 1 });
  hint(game, { type: 'gloss', j: 1 });
  setMode(game, 'zi', deps);
  const { play } = toView(game);
  assert.equal(play.board.ju[1].cells[4].input, null);
  assert.equal(play.board.ju[1].cells[4].fb, null);
  assert.equal(play.board.ju[1].cells[1].kind, 'hinted');
  assert.equal(play.board.ju[1].gloss, input.glosses[1]);
  assert.equal(play.checks, 1);
  assert.deepEqual(play.hints, { pattern: true, chars: 1, glosses: 1, imagery: [input.imagery[0]] });
  conflict(() => setMode(game, 'ju', deps));
  submit(game, { cells: {} }, deps);
  conflict(() => setMode(game, 'zi', deps));
});

function shuffled(tiles, mode, pool = 0) {
  const rank = i => createHash('sha256').update(`${deps.id}/${mode}/${pool}/${i}`).digest().readUInt32BE();
  return tiles.map((char, i) => ({ char, rank: rank(i) }))
    .sort((a, b) => a.rank - b.rank).map(({ char }) => char);
}

test('六档可逐档或跨档降低，旧对局的盘和干扰字缺省可读', () => {
  const game = make();
  delete game.decoys;
  setMode(game, 'fu', deps);
  delete game.play.pools;
  assert.equal(toView(game).play.pools, null);
  for (const [mode, higher] of [['ju', 'fu'], ['zi', 'ju'], ['chai', 'zi'], ['bian', 'chai'], ['ze', 'bian']]) {
    setMode(game, mode, deps);
    conflict(() => setMode(game, higher, deps));
    conflict(() => setMode(game, mode, deps));
    assert.equal(toView(game, deps).play.mode, mode);
  }

  const skipped = make();
  setMode(skipped, 'ju', deps);
  check(skipped, { cells: { '1.0': '孤', '1.1': '鹤' } }, deps);
  hint(skipped, { type: 'pattern' });
  hint(skipped, { type: 'char', j: 1, i: 0 });
  hint(skipped, { type: 'char', j: 1, i: 1 });
  setMode(skipped, 'ze', deps);
  const { play } = toView(skipped, deps);
  assert.equal(play.board.ju[1].cells[0].kind, 'given');
  assert.equal(play.board.ju[1].cells[1].kind, 'hinted');
  assert.equal(play.pools[0].tiles.length, 4);
  assert.equal(play.checks, 1);
  assert.deepEqual(play.hints, { pattern: true, chars: 2, glosses: 0, imagery: [] });
  assert.deepEqual(skipped.play.cells, {});
  assert.deepEqual(skipped.play.feedback, {});
  assert.deepEqual(skipped.play.tried, {});
  submit(skipped, { cells: { '0.0': '玄', '1.4': '光', '2.3': '钟', '3.3': '夜' } }, deps);
  assert.deepEqual(toResult(skipped).score, { hit: 4, total: 5, points: 63, grade: '中中' });
});

test('择字只为有空格的句分一盘，同字保留多枚，盘与洗牌可复现', () => {
  const source = {
    ...input, form: '逸体', poem: '玄玄光，山。𠮷鹤。', cloze: '【玄玄】光，山。【𠮷鹤】。',
    hiddenLines: [], glosses: ['甲', '乙', '丙'], decoys: '甲乙',
  };
  const game = make(source);
  const again = make(source);
  setMode(game, 'ze', deps);
  setMode(again, 'ze', deps);
  const tiles = shuffled([...'玄玄𠮷鹤'], 'ze');
  assert.deepEqual(game.play.pools, [{ ju: [0, 2], tiles }]);
  assert.deepEqual(again.play.pools, game.play.pools);
  assert.deepEqual(toView(game, deps).play.pools, [{
    ju: [0, 2], tiles: tiles.map(char => ({ char, tones: prosody.charInfo(char).tones })),
  }]);
  assert.equal(toView(game, deps).play.patternShown, false);
  assert.equal(toView(game, deps).play.board.ju[0].cells[0].want, null);
  conflict(() => hint(game, { type: 'pattern' }));
});

test('辨字过滤原字和繁简同字，用首读音与种子次序补常用干扰字', () => {
  const source = { ...input, cloze: input.poem.replace('鹤', '【鹤】'), decoys: '鹤、鶴、鹿' };
  const calls = [];
  const options = { ...deps, prosody: {
    ...prosody,
    charInfo(char) {
      const info = prosody.charInfo(char);
      return char === '鹤' ? { ...info, readings: [...info.readings, { rhyme: '另一韵', tone: '平' }] } : info;
    },
    rhymeChars(...args) {
      calls.push(args);
      return [{ common: '鶴鹤鹿甲乙丙', rare: '丁' }];
    },
  } };
  const game = make(source);
  setMode(game, 'bian', options);
  assert.deepEqual(calls, Array.from({ length: 2 }, () => ['一东', 'xinyun', 'shi', '仄']));
  assert.deepEqual(game.play.pools, [{ ju: [1], tiles: shuffled([...'鹤鹿丙乙'], 'bian') }]);
  const again = make(source);
  setMode(again, 'bian', options);
  assert.deepEqual(again.play.pools, game.play.pools);

  const noDecoys = make(source);
  delete noDecoys.decoys;
  setMode(noDecoys, 'bian', options);
  assert.equal(noDecoys.play.pools[0].tiles.length, 3);

  const author = make({ ...source, decoys: '甲乙丙丁戊己庚辛壬癸魚鱼' });
  setMode(author, 'bian', deps);
  assert.deepEqual(author.play.pools[0].tiles, shuffled([...'鹤甲乙丙丁戊己庚辛壬癸魚鱼'], 'bian'));
});

test('辨字按种子排列空格，跳过未收录的原字和无常用字的韵', () => {
  const calls = [];
  const options = { ...deps, prosody: {
    ...prosody,
    charInfo(char) {
      return { known: char !== '夜', readings: [{ rhyme: char, tone: '平' }] };
    },
    rhymeChars(name) {
      calls.push(name);
      return name === '钟' ? [] : [{ common: '甲乙丙' }];
    },
  } };
  const game = make();
  setMode(game, 'bian', options);
  assert.deepEqual(calls, [...'钟光玄鹤']);
  assert.equal(game.play.pools[0].tiles.length, 8);
  assert.deepEqual(game.play.pools[0].tiles.slice().sort(), [...'玄鹤光钟夜甲乙丙'].sort());
});

test('拆篇二十八字一盘，律诗两句一盘，盘外的字不跨盘使用', () => {
  const { cloze, glosses, ...base } = input;
  const shortLines = ['折戟沉沙铁未销', '自将磨洗认前朝', '东风不与周郎便', '铜雀春深锁二乔'];
  const short = make({ ...base, form: '七绝', poem: shortLines.join('。') + '。' });
  setMode(short, 'chai', deps);
  assert.deepEqual(short.play.pools, [{ ju: [0, 1, 2, 3], tiles: shuffled([...shortLines.join('')], 'chai') }]);

  const lines = ['国破山河在', '城春草木深', '感时花溅泪', '恨别鸟惊心', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪'];
  const game = make({ ...base, form: '五律', poem: lines.join('。') + '。', decoys: '甲乙' });
  setMode(game, 'chai', deps);
  assert.deepEqual(game.play.pools, [0, 1, 2, 3].map(i => ({
    ju: [i * 2, i * 2 + 1], tiles: shuffled([...(lines[i * 2] + lines[i * 2 + 1])], 'chai', i),
  })));
  assert.ok(toView(game, deps).play.board.ju.every(row => row.cells.every(cell => cell.kind === 'blank')));
  saveDraft(game, { cells: { '0.0': '感', '0.1': '国', '2.0': '国', '2.1': '感' } }, deps);
  assert.deepEqual(game.play.cells, { '0.1': '国', '2.1': '感' });
});

test('长篇拆篇在阕末和超二十字前分盘，超长单句独占一盘', () => {
  const { cloze, glosses, ...base } = input;
  const game = make({
    ...base, form: '逸体', poem: `松竹风。\n\n${'山'.repeat(11)}，${'水'.repeat(11)}，${'云'.repeat(21)}，月。`,
  });
  setMode(game, 'chai', deps);
  assert.deepEqual(game.play.pools.map(({ ju, tiles }) => [ju, tiles.length]), [
    [[0], 3], [[1], 11], [[2], 11], [[3], 21], [[4], 1],
  ]);
  const flawed = make({ ...base, poem: `${input.poem}\n江湖。` }, { allowFlaws: true });
  setMode(flawed, 'chai', deps);
  assert.deepEqual(flawed.play.pools[0].ju, [0, 1, 2, 3, 4]);
  assert.equal(flawed.play.pools[0].tiles.length, 22);
});

test('选字按句字序扣盘，揭字取走第一枚原字并退回超量格和反馈', () => {
  const game = make({
    ...input, form: '逸体', poem: '玄玄光，鹤。', cloze: '【玄玄光】，【鹤】。',
    hiddenLines: [], glosses: ['甲', '乙'],
  });
  setMode(game, 'ze', deps);
  const cells = { '1.0': '玄', '0.2': '玄多', '0.1': '鶴', '0.0': '玄', '0.3': '光' };
  saveDraft(game, { cells }, deps);
  assert.deepEqual(game.play.cells, { '0.0': '玄', '0.2': '玄' });
  assert.deepEqual(game.play.feedback, {});
  check(game, { cells }, deps);
  assert.deepEqual(game.play.feedback, { '0.0': 'hit', '0.2': 'miss' });
  const initial = toView(game, deps).play.pools[0].tiles;
  hint(game, { type: 'char', j: 0, i: 1 });
  const view = toView(game, deps).play;
  const first = initial.findIndex(({ char }) => char === '玄');
  assert.deepEqual(view.pools[0].tiles, initial.filter((_, i) => i !== first));
  assert.equal(game.play.pools[0].tiles.length, 4);
  assert.deepEqual(game.play.cells, { '0.0': '玄' });
  assert.deepEqual(game.play.feedback, { '0.0': 'hit' });
  assert.deepEqual(view.board.ju[0].cells[2], {
    kind: 'blank', char: null, input: null, want: null, fb: null, tried: [{ char: '玄', fb: 'miss' }],
  });
  submit(game, { cells: { '0.0': '玄', '0.1': '光', '0.2': '鹤', '1.0': '鹤' } }, deps);
  assert.deepEqual(game.play.cells, { '0.0': '玄', '0.2': '鹤' });
  const result = toResult(game);
  assert.equal(result.modeName, '择字');
  assert.equal(result.player, '玄玄鹤，□。');
  assert.deepEqual(result.score, { hit: 1, total: 4, points: 19, grade: '下下' });
  assert.deepEqual(result.diffs, [
    { ju: 1, pos: 3, original: '光', player: '鹤', fb: 'miss' },
    { ju: 2, pos: 1, original: '鹤', player: '□', fb: null },
  ]);
});

test('选字三档自动显谱，示律不收费，试字只有命中或落空', () => {
  for (const [mode, name] of [['ze', '择字'], ['bian', '辨字'], ['chai', '拆篇']]) {
    const game = make({ ...input, decoys: '堂甲乙' });
    setMode(game, mode, deps);
    hint(game, { type: 'pattern' });
    const view = toView(game, deps).play;
    assert.equal(view.hints.pattern, false);
    assert.equal(view.patternShown, true);
    assert.equal(view.variantLabel, '正体');
    assert.equal(view.board.ju[1].rhyme, true);
    assert.equal(view.board.ju[1].cells[4].want, '中');
    const wrong = mode === 'bian' ? '堂' : mode === 'chai' ? '塘' : '玄';
    check(game, { cells: { '1.4': wrong } }, deps);
    const tried = [{ char: wrong, fb: 'miss' }];
    assert.equal(toView(game, deps).play.board.ju[1].cells[4].fb, 'miss');
    assert.deepEqual(toView(game, deps).play.board.ju[1].cells[4].tried, tried);
    const cells = {};
    for (const [j, { offsets }] of game.layout.entries()) {
      for (const [i, offset] of offsets.entries()) {
        if (view.board.ju[j].cells[i].kind === 'blank') cells[`${j}.${i}`] = input.poem[offset];
      }
    }
    submit(game, { cells }, deps);
    const result = toResult(game);
    const total = mode === 'chai' ? 20 : 5;
    assert.deepEqual(result.score, { hit: total, total, points: 100, grade: '上上' });
    assert.equal(result.mode, mode);
    assert.equal(result.modeName, name);
    assert.deepEqual(result.diffs, []);
    assert.equal(result.player, input.poem);
    const board = toView(game, deps).play.board;
    assert.equal(board.ju[1].cells[4].fb, 'hit');
    assert.deepEqual(board.ju[1].cells[4].tried, tried);
  }
});

test('四种提示只显示已取内容并拒绝不可用请求', () => {
  const game = make();
  conflict(() => hint(game, { type: 'pattern' }));
  setMode(game, 'zi', deps);
  invalid(() => hint(game, { type: 'other' }));
  hint(game, { type: 'pattern' });
  hint(game, { type: 'pattern' });
  assert.equal(toView(game).play.variantLabel, '正体');
  assert.equal(toView(game).play.board.ju[1].rhyme, true);
  conflict(() => hint(game, { type: 'char', j: 0, i: 1 }));
  conflict(() => hint(game, { type: 'char', j: -1, i: 1 }));
  hint(game, { type: 'char', j: 0, i: 0 });
  assert.equal(toView(game).play.board.ju[0].cells[0].char, '玄');
  conflict(() => hint(game, { type: 'char', j: 0, i: 0 }));
  hint(game, { type: 'gloss', j: 0 });
  assert.equal(toView(game).play.board.ju[0].gloss, input.glosses[0]);
  assert.deepEqual(toView(game).play.hintsLeft.glosses, [1, 2, 3]);
  conflict(() => hint(game, { type: 'gloss', j: 0 }));
  conflict(() => hint(game, { type: 'gloss', j: 6 }));
  hint(game, { type: 'imagery' });
  assert.deepEqual(toView(game).play.hints.imagery, [input.imagery[0]]);
  hint(game, { type: 'imagery' });
  assert.equal(toView(game).play.hintsLeft.imagery, 0);
  conflict(() => hint(game, { type: 'imagery' }));

  const fu = make();
  setMode(fu, 'fu', deps);
  hint(fu, { type: 'pattern' });
  assert.equal(toView(fu).play.hints.pattern, false);
  conflict(() => hint(fu, { type: 'char', j: 0, i: 0 }));

  const { glosses, ...source } = input;
  const free = make({ ...source, form: '逸体' });
  setMode(free, 'zi', deps);
  conflict(() => hint(free, { type: 'pattern' }));
  conflict(() => hint(free, { type: 'gloss', j: 0 }));
});

test('评分含全部扣分项、零空格和九品边界', () => {
  const grades = [
    [100, '上上'], [95, '上上'], [94, '上中'], [88, '上中'], [87, '上下'], [80, '上下'],
    [79, '中上'], [70, '中上'], [69, '中中'], [60, '中中'], [59, '中下'], [50, '中下'],
    [49, '下上'], [35, '下上'], [34, '下中'], [20, '下中'], [19, '下下'], [0, '下下'],
  ];
  const noHints = { chars: 0, glosses: 0, imagery: [], pattern: false };
  for (const [points, grade] of grades) {
    assert.deepEqual(calculateScore(points, 100, 1, noHints), { hit: points, total: 100, points, grade });
  }
  assert.equal(calculateScore(2, 3, 0, noHints).points, 67);
  assert.equal(calculateScore(3, 3, 3, { chars: 2, glosses: 1, imagery: ['一', '二'], pattern: true }).points, 69);
  assert.equal(calculateScore(1, 9, 1, { ...noHints, chars: 8 }).points, 0);
  assert.equal(calculateScore(0, 0, 0, noHints).points, 0);
});

test('交卷、揭晓与评点状态及结果差异', () => {
  const game = make();
  assert.equal(toResult(game).status, 'new');
  conflict(() => reveal(game));
  conflict(() => setReview(game, { comment: '未交卷' }));
  setMode(game, 'zi', deps);
  conflict(() => reveal(game));
  hint(game, { type: 'char', j: 0, i: 0 });
  check(game, { cells: { '1.1': '鹤' } }, deps);
  submit(game, { cells: { '1.1': '鹤', '1.4': '堂', '2.3': '钟', '0.0': '多' } }, deps);
  const result = toResult(game);
  assert.equal(result.status, 'submitted');
  assert.equal(result.player, '玄杉晚渡霜，孤鹤隐晴堂。\n曲涧承钟影，回舟入□塘。');
  assert.deepEqual(result.diffs, [
    { ju: 2, pos: 5, original: '光', player: '堂', fb: 'rhyme' },
    { ju: 4, pos: 4, original: '夜', player: '□', fb: null },
  ]);
  assert.deepEqual(result.score, { total: 5, hit: 2, points: 34, grade: '下中' });
  assert.deepEqual(result.prosody, { ok: true, issues: [] });
  assert.equal(result.checks, 1);
  assert.equal(toView(game).play.submittedAt, stamp);
  assert.equal(toView(game).reveal, null);
  assert.match(result.next, /abc123/);
  conflict(() => submit(game, { cells: {} }, deps));
  conflict(() => check(game, { cells: {} }, deps));
  conflict(() => hint(game, { type: 'imagery' }));
  for (const bad of [{}, { comment: '好', grade: '高' }, { comment: '好', highlights: Array(7).fill({}) }]) {
    invalid(() => setReview(game, bad));
  }
  setReview(game, { comment: '第一稿' }, deps);
  assert.equal(toView(game).play.review.grade, null);
  reveal(game);
  reveal(game);
  setReview(game, {
    grade: '中中', comment: '再评', highlights: [{ quote: '晴堂', note: '字义相通', extra: true }],
  }, deps);
  assert.equal(toView(game).reveal.playerPoem, result.player);
  assert.deepEqual(toView(game).play.review, {
    grade: '中中', comment: '再评', highlights: [{ quote: '晴堂', note: '字义相通' }], at: stamp,
  });
  assert.equal(toResult(game).reviewed, true);
  assert.equal(toResult(game).next, null);
});
