import { conflict, invalid, isRecord, nonempty } from './validation.js';

export { createGame, GameError } from './validation.js';

const modes = [
  { id: 'zi', name: '填字' },
  { id: 'ju', name: '补句' },
  { id: 'fu', name: '自赋' },
];
const grades = [
  [95, '上上'], [88, '上中'], [80, '上下'], [70, '中上'], [60, '中中'],
  [50, '中下'], [35, '下上'], [20, '下中'], [0, '下下'],
];
const square = '□';
const keyFor = (j, i) => `${j}.${i}`;
const originalChar = (game, offset) => String.fromCodePoint(game.poem.codePointAt(offset));
const terminal = game => game.status === 'submitted' || game.status === 'revealed';

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
  if (game.play.mode === 'fu') return true;
  if (game.play.mode === 'ju') return game.hiddenLines.includes(j);
  return game.cloze.includes(keyFor(j, i));
}

function blankCount(game, mode) {
  if (mode === 'zi') return game.cloze.length;
  if (mode === 'ju') {
    return game.hiddenLines.reduce((sum, j) => sum + game.layout[j].offsets.length, 0);
  }
  return game.layout.reduce((sum, row) => sum + row.offsets.length, 0);
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
  if (index === -1) throw invalid('mode 须为 zi、ju 或 fu');
  if (game.status !== 'new' &&
      (game.status !== 'playing' || index >= modes.findIndex(entry => entry.id === game.play.mode))) {
    throw conflict('对局进行中只能降档，交卷后不能更换难度');
  }
  const prev = game.play;
  game.status = 'playing';
  game.play = {
    mode,
    cells: {},
    text: game.form.kind === 'free' && mode === 'fu' ? '' : null,
    pattern: null,
    feedback: {},
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
  game.play.cells = cells;
}

export function saveDraft(game, input, { prosody } = {}) {
  requirePlaying(game);
  storeDraft(game, input);
  if (game.play.mode === 'fu' && !freeText(game)) refreshFu(game, prosody, false);
}

function feedback(game, prosody) {
  const { mode, cells, hinted } = game.play;
  const result = {};
  const info = char => prosody.charInfo(char, game.rhymebook.id, game.form.kind);
  for (const [j] of game.layout.entries()) {
    const row = rowData(game, j);
    const remaining = new Map();
    for (const [i, { char }] of row.cells.entries()) {
      const key = keyFor(j, i);
      if (!blankAt(game, j, i) || hinted.includes(key)) continue;
      if (cells[key] === char) {
        result[key] = 'hit';
      } else {
        remaining.set(char, (remaining.get(char) ?? 0) + 1);
      }
    }
    const rhyme = game.original.rhymes.find(group => group.group === row.rhymeGroup);
    for (const [i, { char, got }] of row.cells.entries()) {
      const key = keyFor(j, i);
      const input = cells[key];
      if (!input || result[key]) continue;
      const { tones, readings } = info(input);
      if (i === row.rhymeIndex && row.rhyme && rhyme?.name &&
          readings.some(reading => reading.rhyme === rhyme.name && reading.tone === rhyme.tone)) {
        result[key] = 'rhyme';
      } else if (mode === 'ju' && remaining.get(input) > 0) {
        result[key] = 'present';
        remaining.set(input, remaining.get(input) - 1);
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
  if (game.play.mode === 'fu') {
    refreshFu(game, prosody, true);
  } else {
    game.play.checks++;
    game.play.feedback = feedback(game, prosody);
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
      if (play.mode !== 'fu') play.patternHint = true;
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
      play.hinted.push(key);
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
  play.resultProsody = { ok: report.ok, issues: report.issues };
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
          };
        }),
      };
    }),
  };
}

function toPlayView(game) {
  const { play } = game;
  const useFreeText = freeText(game);
  const patternShown = !useFreeText && (play.mode === 'fu' || play.patternHint);
  const variantLabel = play.mode === 'fu' ? play.pattern?.variantLabel : game.original.variant?.label;
  return {
    mode: play.mode,
    freeText: useFreeText,
    text: play.text,
    patternShown,
    variantLabel: patternShown ? variantLabel ?? null : null,
    board: useFreeText ? null : toBoard(game, patternShown),
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
    review: play.review,
  };
}

export function toView(game) {
  const { id, title, subjects, premise, premiseNote, form, rhymebook, story, createdAt, status } = game;
  return {
    id, title, subjects, premise, premiseNote, form, rhymebook, story, createdAt, status,
    modes: modes.map(mode => ({
      ...mode, blanks: mode.id === 'ju' ? game.hiddenLines.length : blankCount(game, mode.id),
    })),
    play: game.play ? toPlayView(game) : null,
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
  return { id, title, subjects, form: { name: form.name }, status, mode: play?.mode ?? null, createdAt };
}

function differences(game) {
  if (!game.play || game.play.mode === 'fu') return [];
  const { hinted, cells, feedback } = game.play;
  return game.layout.flatMap(({ offsets }, j) => offsets.flatMap((offset, i) => {
    const key = keyFor(j, i);
    if (!blankAt(game, j, i) || hinted.includes(key)) return [];
    const original = originalChar(game, offset);
    const player = cells[key] ?? square;
    return player === original ? [] : [{ ju: j + 1, pos: i + 1, original, player, fb: feedback[key] ?? null }];
  }));
}

export function toResult(game) {
  const { id, title, status, form, rhymebook, play } = game;
  const reviewed = Boolean(play?.review);
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
    prosody: play?.resultProsody ?? (play?.report && { ok: play.report.ok, issues: play.report.issues }) ?? null,
    reviewed,
    next: terminal(game) && !reviewed ? `写评点：tuiqiao review ${id} <review.json>` : null,
  };
}
