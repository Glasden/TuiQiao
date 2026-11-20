import { conflict, invalid, isRecord, nonempty, seedRank } from './validation.js';

export { createGame, GameError } from './validation.js';

const modes = [
  { id: 'ze', name: '择字', group: 'xuan' },
  { id: 'bian', name: '辨字', group: 'xuan' },
  { id: 'chai', name: '拆篇', group: 'xuan' },
  { id: 'zi', name: '填字', group: 'xie' },
  { id: 'ju', name: '补句', group: 'xie' },
  { id: 'fu', name: '自赋', group: 'xie' },
];
const grades = [
  [95, '上上'], [88, '上中'], [80, '上下'], [70, '中上'], [60, '中中'],
  [50, '中下'], [35, '下上'], [20, '下中'], [0, '下下'],
];
const square = '□';
const keyFor = (j, i) => `${j}.${i}`;
const originalChar = (game, offset) => String.fromCodePoint(game.poem.codePointAt(offset));
const terminal = game => game.status === 'submitted' || game.status === 'revealed';
const usesPools = mode => mode === 'ze' || mode === 'bian' || mode === 'chai';

export function canBrowseRhymes(game) {
  return game.play?.mode === 'fu' || terminal(game);
}

function requirePlaying(game) {
  if (game.status !== 'playing') throw conflict('选定难度且尚未交卷时才能进行此操作');
}

function rowData(game, j) {
  const line = game.layout[j];
  const report = game.original.ju[j];
  return {
    end: report?.end ?? '句',
    punct: line.punct,
    stanzaEnd: report?.stanzaEnd ?? (j === game.layout.length - 1),
    rhyme: report?.rhyme ?? false,
    rhymeGroup: report?.rhymeGroup ?? null,
    rhymeIndex: (report?.cells.length ?? 0) - 1,
    cells: line.offsets.map((offset, i) => {
      const char = originalChar(game, offset);
      const cell = report?.cells[i];
      return {
        char, offset,
        want: cell?.want ?? '中',
        got: cell?.char === char ? cell.got : null,
      };
    }),
  };
}

function blankAt(game, j, i) {
  if (game.play.mode === 'fu' || game.play.mode === 'chai') return true;
  if (game.play.mode === 'ju') return game.hiddenLines.includes(j);
  return game.cloze.includes(keyFor(j, i));
}

function blankCount(game, mode) {
  if (mode === 'zi' || mode === 'ze' || mode === 'bian') return game.cloze.length;
  if (mode === 'ju') {
    return game.hiddenLines.reduce((sum, j) => sum + game.layout[j].offsets.length, 0);
  }
  return game.layout.reduce((sum, row) => sum + row.offsets.length, 0);
}

function seedOrder(items, keyOf) {
  return items.map((item, i) => ({ item, rank: seedRank(keyOf(item, i)) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

function makeDecoys(game, blanks, prosody) {
  const prefix = `${game.id}/bian`;
  const book = game.rhymebook.id;
  const { kind } = game.form;
  const fold = char => prosody.simplify(char);
  const used = new Set(blanks.map(({ char }) => fold(char)));
  const decoys = (game.decoys ?? []).filter(char => !used.has(fold(char)));
  const target = Math.min(10, Math.max(3, Math.ceil(blanks.length / 2)));
  if (decoys.length >= target) return decoys;

  for (const char of decoys) used.add(fold(char));
  const ordered = seedOrder(blanks, ({ key }) => `${prefix}/blank/${key}`);
  for (let round = 0; round < 2; round++) {
    for (const { key, char } of ordered) {
      const { known, readings: [reading] } = prosody.charInfo(char, book, kind);
      if (!known || !reading) continue;
      const common = prosody.rhymeChars(reading.rhyme, book, kind, reading.tone)
        .flatMap(({ common }) => Array.from(common));
      const candidates = seedOrder(common, candidate => `${prefix}/pick/${key}/${candidate}`);
      const picked = candidates.find(candidate => !used.has(fold(candidate)));
      if (picked === undefined) continue;
      decoys.push(picked);
      if (decoys.length === target) return decoys;
      used.add(fold(picked));
    }
  }
  return decoys;
}

function makePools(game, mode, prosody) {
  const cloze = new Set(game.cloze);
  const split = mode === 'chai' && blankCount(game, mode) > 28;
  const pools = [];
  let ju = [];
  let blanks = [];
  function closePool() {
    const tiles = blanks.map(({ char }) => char);
    if (mode === 'bian') tiles.push(...makeDecoys(game, blanks, prosody));
    const prefix = `${game.id}/${mode}/${pools.length}`;
    pools.push({ ju, tiles: seedOrder(tiles, (_, i) => `${prefix}/${i}`) });
    ju = [];
    blanks = [];
  }
  for (const [j, { offsets }] of game.layout.entries()) {
    const row = offsets.flatMap((offset, i) => {
      const key = keyFor(j, i);
      return mode === 'chai' || cloze.has(key) ? [{ key, char: originalChar(game, offset) }] : [];
    });
    if (split && blanks.length && blanks.length + row.length > 20) closePool();
    if (row.length) {
      ju.push(j);
      for (const blank of row) blanks.push(blank);
    }
    const { stanzaEnd, rhyme } = game.original.ju[j] ?? {};
    if (split && blanks.length && (stanzaEnd || (rhyme && blanks.length >= 10))) closePool();
  }
  if (!split || blanks.length) closePool();
  return pools;
}

function availablePools(game) {
  return (game.play.pools ?? []).map(({ ju, tiles }) => {
    const available = tiles.slice();
    for (const key of game.play.hinted) {
      const [j, i] = key.split('.').map(Number);
      if (!ju.includes(j) || !blankAt(game, j, i)) continue;
      const char = originalChar(game, game.layout[j].offsets[i]);
      const index = available.indexOf(char);
      if (index !== -1) available.splice(index, 1);
    }
    return { ju, tiles: available };
  });
}

function filterPoolCells(game, cells) {
  const kept = {};
  for (const { ju, tiles } of availablePools(game)) {
    const counts = new Map();
    for (const char of tiles) counts.set(char, (counts.get(char) ?? 0) + 1);
    for (const j of ju) {
      for (const i of game.layout[j].offsets.keys()) {
        const key = keyFor(j, i);
        const char = cells[key];
        if (!counts.get(char)) continue;
        kept[key] = char;
        counts.set(char, counts.get(char) - 1);
      }
    }
  }
  return kept;
}

function freeText(game) {
  return game.play.mode === 'fu' && game.form.kind === 'free';
}

function summary({ ok, complete, issues, stats, rhymes }) {
  return { ok, complete, issues, stats, rhymes };
}

function fuPattern(report) {
  return {
    variantLabel: report.variant?.label ?? null,
    ju: report.ju.map(({ end, punct, stanzaEnd, rhyme, cells }, j) => ({
      end, punct: punct || (stanzaEnd || (report.form.kind === 'shi' && j % 2) ? '。' : end === '读' ? '、' : '，'),
      stanzaEnd, rhyme, cells: cells.map(({ want }) => want),
    })),
  };
}

function playerJu(game) {
  const { mode, cells, hinted } = game.play;
  const rows = mode === 'fu' ? game.play.pattern.ju.map(row => row.cells) : game.layout.map(row => row.offsets);
  return rows.map((row, j) => {
    const chars = row.map((offset, i) => {
      const key = keyFor(j, i);
      if (mode !== 'fu' && (!blankAt(game, j, i) || hinted.includes(key))) {
        return originalChar(game, offset);
      }
      const char = cells[key];
      return char && char !== square && !/\s/u.test(char) ? char : null;
    });
    while (chars.at(-1) === null) chars.pop();
    return chars.map(char => char ?? square).join('');
  });
}

function playerReport(game, prosody) {
  const args = { form: game.form.name, rhymebook: game.rhymebook.id, partial: true };
  if (game.form.kind === 'free') return prosody.checkPoem({ ...args, text: playerPoem(game) });
  const ju = playerJu(game);
  const useOriginal = game.form.kind !== 'shi' || ju.every(line => !line);
  const variant = useOriginal ? (game.original.variant?.index ?? 'auto') : 'auto';
  return prosody.checkPoem({ ...args, variant, ju });
}

function refreshFu(game, prosody, publish) {
  const report = playerReport(game, prosody);
  if (!freeText(game)) game.play.pattern = fuPattern(report);
  if (publish) game.play.report = summary(report);
  return report;
}

export function setMode(game, mode, { prosody }) {
  const index = modes.findIndex(entry => entry.id === mode);
  if (index === -1) throw invalid(`mode 须为以下之一：${modes.map(entry => entry.id).join('、')}`);
  if (game.status !== 'new' &&
      (game.status !== 'playing' || index >= modes.findIndex(entry => entry.id === game.play.mode))) {
    throw conflict('对局进行中只能降档，交卷后不能更换难度');
  }
  const prev = game.play;
  const pools = usesPools(mode) ? makePools(game, mode, prosody) : null;
  game.status = 'playing';
  game.play = {
    mode,
    cells: {},
    text: game.form.kind === 'free' && mode === 'fu' ? '' : null,
    pattern: null,
    pools,
    feedback: {},
    tried: {},
    checks: prev?.checks ?? 0,
    patternHint: prev?.patternHint ?? false,
    hinted: prev?.hinted ?? [],
    glossed: prev?.glossed ?? [],
    imageryCount: prev?.imageryCount ?? 0,
    report: null,
    submittedAt: null,
    score: null,
    resultProsody: null,
    review: null,
  };
  if (mode === 'fu' && !freeText(game)) {
    const initial = prosody.checkPoem({
      form: game.form.name, rhymebook: game.rhymebook.id, ju: [],
      partial: true, variant: game.original.variant?.index ?? 'auto',
    });
    game.play.pattern = fuPattern(initial);
  }
}

function storeDraft(game, input) {
  if (!isRecord(input)) throw invalid('请求体须为 JSON 对象');
  if (freeText(game)) {
    if (typeof input.text !== 'string' || Object.hasOwn(input, 'cells')) {
      throw invalid('自由体自赋须提交 text 文本');
    }
    game.play.text = input.text;
    return;
  }
  if (!isRecord(input.cells) || Object.hasOwn(input, 'text')) {
    throw invalid('格子模式须提交 cells 对象');
  }
  const rows = game.play.mode === 'fu' ?
    game.play.pattern.ju.map(row => row.cells) : game.layout.map(row => row.offsets);
  const cells = {};
  for (const [key, value] of Object.entries(input.cells)) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(key);
    if (!match) continue;
    const j = Number(match[1]);
    const i = Number(match[2]);
    if (!(i < rows[j]?.length) || !blankAt(game, j, i) || game.play.hinted.includes(key)) continue;
    if (typeof value !== 'string') throw invalid(`第 ${j + 1} 句第 ${i + 1} 格须为文本`);
    const [char] = value;
    if (char) cells[key] = char;
  }
  game.play.cells = usesPools(game.play.mode) ? filterPoolCells(game, cells) : cells;
}

export function saveDraft(game, input, { prosody } = {}) {
  requirePlaying(game);
  storeDraft(game, input);
  if (game.play.mode === 'fu' && !freeText(game)) refreshFu(game, prosody, false);
}

function feedback(game, prosody) {
  const { mode, cells, hinted } = game.play;
  const poolMode = usesPools(mode);
  const result = {};
  const book = game.rhymebook.id;
  const info = char => prosody.charInfo(char, book, game.form.kind);
  // 繁简视为同字：两边都折成简体再比
  const fold = char => prosody.simplify?.(char) ?? char;
  // 词依古韵时，韵组可能依平水韵通押，name 便是平水韵名而非词林部名，两部韵书都要查
  const rhymesOf = (char, tone) => [
    info(char),
    ...(book === 'guyun' && game.form.kind === 'ci' ? [prosody.charInfo(char, 'guyun', 'shi')] : []),
  ].flatMap(({ readings }) => readings.filter(reading => reading.tone === tone).map(reading => reading.rhyme));
  for (const [j] of game.layout.entries()) {
    const row = rowData(game, j);
    const remaining = new Map();
    for (const [i, { char }] of row.cells.entries()) {
      const key = keyFor(j, i);
      if (!blankAt(game, j, i) || hinted.includes(key)) continue;
      if (cells[key] && fold(cells[key]) === fold(char)) {
        result[key] = 'hit';
      } else if (poolMode) {
        if (cells[key]) result[key] = 'miss';
      } else {
        remaining.set(fold(char), (remaining.get(fold(char)) ?? 0) + 1);
      }
    }
    if (poolMode) continue;
    const rhyme = game.original.rhymes.find(group => group.group === row.rhymeGroup);
    for (const [i, { char, got }] of row.cells.entries()) {
      const key = keyFor(j, i);
      const input = cells[key];
      if (!input || result[key]) continue;
      const { tones } = info(input);
      if (i === row.rhymeIndex && row.rhyme && rhyme?.name && rhymesOf(input, rhyme.tone).includes(rhyme.name)) {
        result[key] = 'rhyme';
      } else if (mode === 'ju' && remaining.get(fold(input)) > 0) {
        result[key] = 'present';
        remaining.set(fold(input), remaining.get(fold(input)) - 1);
      } else {
        result[key] = tones.some(tone => (got ?? info(char).tones).includes(tone)) ? 'tone' : 'miss';
      }
    }
  }
  return result;
}

export function check(game, input, { prosody }) {
  requirePlaying(game);
  storeDraft(game, input);
  const { play } = game;
  if (play.mode === 'fu') {
    refreshFu(game, prosody, true);
  } else {
    play.checks++;
    play.feedback = feedback(game, prosody);
    play.tried ??= {};
    for (const [key, fb] of Object.entries(play.feedback)) {
      const char = play.cells[key];
      const entries = play.tried[key] ??= [];
      const entry = entries.find(item => item.char === char);
      if (entry) {
        entry.fb = fb;
      } else {
        entries.push({ char, fb });
        if (entries.length > 12) entries.shift();
      }
    }
  }
}

export function hint(game, input) {
  requirePlaying(game);
  if (!isRecord(input)) throw invalid('提示请求须为 JSON 对象');
  const { type, j, i } = input;
  const { play } = game;
  switch (type) {
    case 'pattern':
      if (game.form.kind === 'free') throw conflict('自由体没有可展示的谱');
      if (play.mode !== 'fu' && !usesPools(play.mode)) play.patternHint = true;
      break;
    case 'char': {
      const key = keyFor(j, i);
      if (play.mode === 'fu' || !Number.isInteger(j) || !Number.isInteger(i) ||
          j < 0 || i < 0 || !(i < game.layout[j]?.offsets.length) ||
          !blankAt(game, j, i) || play.hinted.includes(key)) {
        throw conflict('只有待填的空格可以揭字');
      }
      delete play.cells[key];
      delete play.feedback[key];
      delete play.tried?.[key];
      play.hinted.push(key);
      if (usesPools(play.mode)) {
        const kept = filterPoolCells(game, play.cells);
        for (const key of Object.keys(play.cells)) {
          if (!Object.hasOwn(kept, key)) delete play.feedback[key];
        }
        play.cells = kept;
      }
      break;
    }
    case 'gloss':
      if (!Number.isInteger(j) || !game.glosses?.[j] || play.glossed.includes(j)) {
        throw conflict('该句没有可取的句意提示');
      }
      play.glossed.push(j);
      break;
    case 'imagery':
      if (play.imageryCount >= game.imagery.length) throw conflict('意象提示已取完');
      play.imageryCount++;
      break;
    default:
      throw invalid('type 须为 pattern、char、gloss 或 imagery');
  }
}

function hintCounts(game) {
  const { patternHint, hinted, glossed, imageryCount } = game.play;
  return {
    pattern: patternHint,
    chars: hinted.length,
    glosses: glossed.length,
    imagery: game.imagery.slice(0, imageryCount),
  };
}

export function calculateScore(hit, total, checks, hints) {
  const accuracy = total ? Math.round(100 * hit / total) : 0;
  const points = Math.max(0, accuracy - 3 * Math.max(0, checks - 1) - 6 * hints.chars -
    4 * hints.glosses - 2 * hints.imagery.length - (hints.pattern ? 5 : 0));
  return { hit, total, points, grade: grades.find(([minimum]) => points >= minimum)[1] };
}

export function submit(game, input, { prosody, now = new Date() }) {
  requirePlaying(game);
  storeDraft(game, input);
  const { play } = game;
  let report;
  if (play.mode === 'fu') {
    report = refreshFu(game, prosody, true);
  } else {
    play.feedback = feedback(game, prosody);
    const hit = Object.values(play.feedback).filter(value => value === 'hit').length;
    play.score = calculateScore(hit, blankCount(game, play.mode), play.checks, hintCounts(game));
    report = playerReport(game, prosody);
  }
  play.resultProsody = { ok: report.ok, complete: report.complete, issues: report.issues };
  play.submittedAt = new Date(now).toISOString();
  game.status = 'submitted';
}

export function reveal(game) {
  if (!terminal(game)) throw conflict('交卷后才能揭晓原作');
  game.status = 'revealed';
}

export function setReview(game, input, { now = new Date() } = {}) {
  if (!terminal(game)) throw conflict('交卷后才能写评点');
  if (!isRecord(input) || !nonempty(input.comment)) throw invalid('comment 须为非空总评');
  if (Object.hasOwn(input, 'grade') && !grades.some(([, grade]) => grade === input.grade)) {
    throw invalid('grade 须为九品之一');
  }
  const highlights = Object.hasOwn(input, 'highlights') ? input.highlights : [];
  if (!Array.isArray(highlights) || highlights.length > 6 || !highlights.every(
    entry => isRecord(entry) && nonempty(entry.quote) && nonempty(entry.note),
  )) {
    throw invalid('highlights 至多 6 条，每条须有非空 quote 和 note');
  }
  game.play.review = {
    grade: input.grade ?? null,
    comment: input.comment,
    highlights: highlights.map(({ quote, note }) => ({ quote, note })),
    at: new Date(now).toISOString(),
  };
}

function playerPoem(game) {
  const { play } = game;
  if (freeText(game)) return play.text;
  if (play.mode === 'fu') {
    return play.pattern.ju.map(({ cells, punct, stanzaEnd }, j, rows) => {
      const text = cells.map((_, i) => play.cells[keyFor(j, i)] ?? square).join('');
      return text + punct + (stanzaEnd && j < rows.length - 1 ? '\n\n' : '');
    }).join('');
  }

  const parts = [];
  let cursor = 0;
  for (const [j, row] of game.layout.entries()) {
    for (const [i, offset] of row.offsets.entries()) {
      const key = keyFor(j, i);
      if (!blankAt(game, j, i) || play.hinted.includes(key)) continue;
      parts.push(game.poem.slice(cursor, offset), play.cells[key] ?? square);
      cursor = offset + originalChar(game, offset).length;
    }
  }
  return parts.join('') + game.poem.slice(cursor);
}

function toBoard(game, patternShown) {
  const { play } = game;
  if (play.mode === 'fu') {
    return {
      ju: play.pattern.ju.map(({ end, punct, stanzaEnd, rhyme, cells }, j) => ({
        end, punct, stanzaEnd, rhyme,
        gloss: play.glossed.includes(j) ? game.glosses[j] : null,
        cells: cells.map((want, i) => ({
          kind: 'blank', char: null, input: play.cells[keyFor(j, i)] ?? null, want, fb: null,
          tried: [],
        })),
      })),
    };
  }
  return {
    ju: game.layout.map((_, j) => {
      const { end, punct, stanzaEnd, rhyme, cells } = rowData(game, j);
      return {
        end, punct, stanzaEnd,
        rhyme: patternShown ? rhyme : null,
        gloss: play.glossed.includes(j) ? game.glosses[j] : null,
        cells: cells.map(({ char, want }, i) => {
          const key = keyFor(j, i);
          const kind = !blankAt(game, j, i) ? 'given' : play.hinted.includes(key) ? 'hinted' : 'blank';
          return {
            kind, char: kind === 'blank' ? null : char,
            input: kind === 'blank' ? play.cells[key] ?? null : null,
            want: patternShown ? want : null,
            fb: kind === 'blank' ? play.feedback[key] ?? null : null,
            tried: kind === 'blank' ? play.tried?.[key] ?? [] : [],
          };
        }),
      };
    }),
  };
}

function toPlayProsody(game) {
  const { play: { mode, resultProsody }, form, original } = game;
  if (!terminal(game) || form.kind === 'free' || !resultProsody) return null;
  const { ok, complete = null, issues } = resultProsody;
  if (mode === 'fu') return { ok, complete, issues };
  const visible = issues.filter(({ code, ju, pos, message }) => !original.issues.some(issue =>
    issue.code === code && issue.ju === ju && issue.pos === pos && issue.message === message));
  return { ok: !visible.some(issue => issue.level === 'error'), complete, issues: visible };
}

function toPlayView(game, prosody) {
  const { play } = game;
  const useFreeText = freeText(game);
  const poolMode = usesPools(play.mode);
  const patternShown = game.form.kind !== 'free' && (poolMode || play.mode === 'fu' || play.patternHint);
  const variantLabel = play.mode === 'fu' ? play.pattern?.variantLabel : game.original.variant?.label;
  return {
    mode: play.mode,
    freeText: useFreeText,
    text: play.text,
    patternShown,
    variantLabel: patternShown ? variantLabel ?? null : null,
    board: useFreeText ? null : toBoard(game, patternShown),
    pools: poolMode ? availablePools(game).map(({ ju, tiles }) => ({
      ju, tiles: tiles.map(char => ({ char, tones: prosody.charInfo(char, game.rhymebook.id, game.form.kind).tones })),
    })) : null,
    ...(useFreeText ? { glosses: play.glossed.map(j => ({ j, text: game.glosses[j] })) } : {}),
    checks: play.checks,
    hints: hintCounts(game),
    hintsLeft: {
      imagery: game.imagery.length - play.imageryCount,
      glosses: (game.glosses ?? []).flatMap((_, j) => play.glossed.includes(j) ? [] : [j]),
    },
    report: play.report,
    submittedAt: play.submittedAt,
    score: play.score,
    prosody: toPlayProsody(game),
    review: play.review,
  };
}

export function toView(game, { prosody } = {}) {
  const { id, title, subjects, premise, premiseNote, form, rhymebook, story, createdAt, status } = game;
  return {
    id, title, subjects, premise, premiseNote, form, rhymebook, story, createdAt, status,
    modes: modes.map(mode => ({
      ...mode, blanks: mode.id === 'ju' ? game.hiddenLines.length : blankCount(game, mode.id),
    })),
    play: game.play ? toPlayView(game, prosody) : null,
    reveal: status === 'revealed' ? {
      poem: game.poem,
      ju: game.original.ju,
      variantLabel: game.original.variant?.label ?? null,
      issues: game.original.issues,
      glosses: game.glosses,
      imagery: game.imagery,
      note: game.note,
      playerPoem: playerPoem(game),
    } : null,
  };
}

export function toListItem({ id, title, subjects, form, status, play, createdAt }) {
  const mode = play?.mode ?? null;
  const grades = { yuan: play?.score?.grade ?? null, pin: mode === 'ju' || mode === 'fu' ? play?.review?.grade ?? null : null };
  return { id, title, subjects, form: { name: form.name }, status, mode, grades, createdAt };
}

function differences(game) {
  if (!game.play || game.play.mode === 'fu') return [];
  const { hinted, cells, feedback } = game.play;
  return game.layout.flatMap(({ offsets }, j) => offsets.flatMap((offset, i) => {
    const key = keyFor(j, i);
    if (!blankAt(game, j, i) || hinted.includes(key)) return [];
    const original = originalChar(game, offset);
    const player = cells[key] ?? square;
    // 交卷时的反馈已按繁简同字判过 hit，以它为准
    const same = player === original || (terminal(game) && feedback[key] === 'hit');
    return same ? [] : [{ ju: j + 1, pos: i + 1, original, player, fb: feedback[key] ?? null }];
  }));
}

export function toResult(game) {
  const { id, title, status, form, rhymebook, play } = game;
  const reviewed = Boolean(play?.review);
  const report = play?.resultProsody ?? play?.report;
  return {
    status, id, title, form: form.name, rhymebook: rhymebook.id,
    mode: play?.mode ?? null,
    modeName: modes.find(mode => mode.id === play?.mode)?.name ?? null,
    original: game.poem,
    player: play ? playerPoem(game) : null,
    diffs: differences(game),
    score: play?.score ?? null,
    checks: play?.checks ?? 0,
    hints: play ? hintCounts(game) : { pattern: false, chars: 0, glosses: 0, imagery: [] },
    prosody: report ? { ok: report.ok, issues: report.issues } : null,
    reviewed,
    next: terminal(game) && !reviewed ? `写评点：tuiqiao review ${id} <review.json>` : null,
  };
}
