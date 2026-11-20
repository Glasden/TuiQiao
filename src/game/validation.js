import { createHash } from 'node:crypto';

export class GameError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function invalid(message) {
  return new GameError(400, 'invalid-input', message);
}

export function conflict(message) {
  return new GameError(409, 'conflict', message);
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validationError(errors, report) {
  const error = new Error(errors.join('\n'));
  error.errors = errors;
  if (report) error.report = report;
  return error;
}

function parseCloze(cloze, poem, positions) {
  let plain = '';
  let start = null;
  const marks = new Set();
  for (const char of cloze) {
    if (char === '【') {
      if (start !== null) return null;
      start = plain.length;
    } else if (char === '】') {
      if (start === null || start === plain.length) return null;
      const group = plain.slice(start);
      if (!/^\p{Script=Han}+$/u.test(group)) return null;
      for (const match of group.matchAll(/\p{Script=Han}/gu)) {
        marks.add(start + match.index);
      }
      start = null;
    } else {
      plain += char;
    }
  }
  if (start !== null || plain !== poem) return null;
  const blanks = positions.flatMap((row, j) => row.offsets.flatMap(
    (offset, i) => marks.has(offset) ? [`${j}.${i}`] : [],
  ));
  return blanks.length === marks.size ? blanks : null;
}

function layoutFor(poem, split, report) {
  const offsets = Array.from(poem.matchAll(/\p{Script=Han}/gu), match => match.index);
  const hanCount = text => Array.from(text.matchAll(/\p{Script=Han}/gu)).length;
  const aligned = report.ju.reduce((sum, row) => sum + hanCount(row.text), 0) === offsets.length;
  let cursor = 0;
  const lineCount = aligned ? report.ju.length : Math.max(report.ju.length, split.ju.length);
  return Array.from({ length: lineCount }, (_, j) => {
    // For a complete text, the core may cut an unpunctuated line at several
    // metrical boundaries. On length errors, keep the source row positions.
    const source = aligned ? report.ju[j] : split.ju[j];
    const length = source ? hanCount(source.text) : 0;
    const line = {
      offsets: offsets.slice(cursor, cursor + length),
      punct: source?.punct ?? '',
    };
    cursor += length;
    return line;
  });
}

export function seedRank(key) {
  return createHash('sha256').update(key).digest().readUInt32BE();
}

function chooseBlanks(layout, id) {
  const ranked = layout.map(({ offsets }, j) => offsets.map((_, i) => {
    const key = `${j}.${i}`;
    return { key, rank: seedRank(`${id}/${key}`) };
  }).sort((a, b) => a.rank - b.rank));
  const first = ranked.flatMap(row => row.slice(0, 1));
  const rest = ranked.flatMap(row => row.slice(1)).sort((a, b) => a.rank - b.rank);
  const target = Math.round((first.length + rest.length) * 0.3);
  return [...first, ...rest.slice(0, Math.max(0, target - first.length))].map(item => item.key);
}

export function createGame(input, { prosody, id, now = new Date(), allowFlaws = false }) {
  const errors = [];
  if (!isRecord(input)) throw validationError(['建局输入须是 JSON 对象']);
  for (const [key, label] of Object.entries({
    title: '诗题', form: '体裁', story: '谜面', poem: '原作',
  })) {
    if (!nonempty(input[key])) errors.push(`${label}（${key}）须为非空文本`);
  }
  if (!Array.isArray(input.subjects) || !input.subjects.length || !input.subjects.every(nonempty)) {
    errors.push('subjects 须有至少一条人或事，且每条须为非空文本');
  }
  if (!['history', 'alternate'].includes(input.premise)) {
    errors.push('premise 须为 history 或 alternate');
  }
  const rhymebook = prosody.RHYMEBOOKS.find(book => book.id === input.rhymebook);
  if (!rhymebook) errors.push('rhymebook 须为 xinyun 或 guyun');
  for (const key of ['premiseNote', 'note', 'cloze', 'decoys']) {
    if (Object.hasOwn(input, key) && typeof input[key] !== 'string') {
      errors.push(`${key} 须为文本`);
    }
  }
  if (Object.hasOwn(input, 'imagery') &&
      (!Array.isArray(input.imagery) || input.imagery.length > 8 || !input.imagery.every(nonempty))) {
    errors.push('imagery 须为文本数组，至多 8 条，每条须为非空文本');
  }

  if (nonempty(input.poem) && !/\p{Script=Han}/u.test(input.poem)) errors.push('poem 须包含汉字');
  if (errors.length) throw validationError(errors);

  const report = prosody.checkPoem({
    form: input.form, rhymebook: input.rhymebook, text: input.poem,
  });
  const layout = layoutFor(input.poem, prosody.splitPoem(input.poem), report);
  const lineCount = layout.length;
  let cloze;
  if (typeof input.cloze === 'string') {
    cloze = parseCloze(input.cloze, input.poem, layout);
    if (cloze === null) errors.push('cloze 须与 poem 逐字相同，用成对的【】括住能对到校验报告句序的汉字');
  }
  let hiddenLines;
  if (Object.hasOwn(input, 'hiddenLines')) {
    if (!Array.isArray(input.hiddenLines) || !input.hiddenLines.every(
      j => Number.isInteger(j) && j >= 1 && j <= lineCount,
    )) {
      errors.push(`hiddenLines 须为从 1 到 ${lineCount} 的句序数组`);
    } else {
      hiddenLines = [...new Set(input.hiddenLines)].map(j => j - 1);
      if (lineCount && hiddenLines.length === lineCount) errors.push('hiddenLines 不得藏起全部句');
    }
  }
  if (Object.hasOwn(input, 'glosses') &&
      (!Array.isArray(input.glosses) || input.glosses.length !== lineCount || !input.glosses.every(nonempty))) {
    errors.push(`glosses 须按句提供 ${lineCount} 条非空白话句意`);
  }
  if (errors.length) throw validationError(errors);

  if (!report.ok && !allowFlaws) {
    throw validationError(report.issues.filter(issue => issue.level === 'error').map(issue => issue.message), report);
  }

  return {
    id,
    title: input.title,
    subjects: input.subjects,
    premise: input.premise,
    premiseNote: input.premiseNote ?? null,
    form: { ...report.form, sketch: report.variant?.sketch ?? '' },
    rhymebook: { id: rhymebook.id, name: rhymebook.name },
    story: input.story,
    createdAt: new Date(now).toISOString(),
    status: 'new',
    poem: input.poem,
    original: report,
    layout,
    cloze: cloze ?? chooseBlanks(layout, id),
    decoys: [...new Set(input.decoys?.match(/\p{Script=Han}/gu))].slice(0, 12),
    hiddenLines: hiddenLines ?? layout.flatMap((_, j) => j % 2 ? [j] : []),
    glosses: input.glosses ?? null,
    imagery: input.imagery ?? [],
    note: input.note ?? null,
    play: null,
  };
}
