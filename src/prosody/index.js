import { charInfo } from './data.js';
import { resolveForm, shiTones } from './forms.js';
import { alignText, poemInput } from './text.js';
import { checkRhymes } from './rhymes.js';

export { charInfo, RHYMEBOOKS } from './data.js';
export { listForms, resolveForm, sampleForms } from './forms.js';
export { splitPoem } from './text.js';

const reportedForm = ({ id, name, kind }) => ({ id, name, kind });
const reportedVariant = ({ index, label, sketch }) => ({ index, label, sketch });

function cellChar(char) {
  return char && char !== '□' ? char : null;
}

function reportResult(report) {
  const errors = report.issues.filter(issue => issue.level === 'error').length;
  const complete = report.ju.length > 0 && report.ju.every(line => line.cells.length > 0 && line.cells.every(cell => cell.char));
  return { ...report, ok: errors === 0, complete, stats: { errors, warns: report.issues.length - errors } };
}

function matchShi(line, infos, index, issue) {
  const { cells } = line;
  const offset = cells.length - 5;
  const type = cells.slice(offset).map(cell => cell.want).join('');
  const [first, second, third, fourth, fifth] = infos.slice(offset);
  const only = (info, tone) => info?.known && info.tones.length === 1 && info.tones[0] === tone;
  const can = (info, tone) => !info?.known || info.tones.includes(tone);
  const position = offset + 2;
  const local = (level, code, pos, message) => issue(level, code, index, pos, message);
  if (type === shiTones.B) {
    if (only(first, '仄') && only(third, '仄') && can(second, '平') && can(fourth, '仄') && can(fifth, '平')) {
      cells[offset].ok = false;
      local('error', 'guping', offset, `第${index + 1}句第${offset + 1}字「${first.char}」和第${position + 1}字「${third.char}」皆仄，犯孤平。可将两字之一改为平声`);
    } else if (only(third, '平') && can(first, '仄')) {
      cells[position].ok = true;
      if (first?.known) cells[offset].ok = true;
    } else if (first?.known && (can(first, '平') || third?.known)) {
      cells[offset].ok = true;
    }
  } else if (type === shiTones.C) {
    if (third?.known) cells[position].ok = true;
    if (only(fourth, '平') && can(first, '平') && can(second, '平') && can(third, '仄') && can(fifth, '仄')) {
      cells[offset + 3].ok = true;
    } else if ([third, fourth, fifth].every(info => only(info, '仄'))) {
      local('warn', 'sanze', position, `第${index + 1}句末三字「${third.char}${fourth.char}${fifth.char}」皆仄，第${position + 1}字可改用平声`);
    }
  } else if (type === shiTones.D && only(third, '平') &&
      [fourth, fifth].every(info => info?.known && can(info, '平'))) {
    cells[position].ok = false;
    local('error', 'sanping', position, `第${index + 1}句末三字「${third.char}${fourth.char}${fifth.char}」皆平，第${position + 1}字「${third.char}」应仄，犯三平尾`);
  }
}

function lineReport(chars, punct, pattern, lookup, index, issue) {
  const tones = pattern?.tones ?? '中'.repeat(chars.length);
  const infos = Array.from(tones, (_, pos) => {
    const char = cellChar(chars[pos]);
    if (!char) return null;
    const info = lookup(char);
    if (!info.known) {
      const note = info.tones.length ? `，普通话声调可作${info.tones.join('或')}` : '';
      issue('warn', 'unknown-char', index, pos, `第${index + 1}句第${pos + 1}字「${char}」未收于所用韵书${note}`);
    }
    return info;
  });
  const cells = Array.from(tones, (want, pos) => {
    const info = infos[pos];
    return { char: info?.char ?? null, want, got: info?.tones ?? [], ok: null, known: info?.known ?? false };
  });
  const { end, rhyme, rhymeGroup, stanzaEnd } = pattern ?? { end: '句', rhyme: false, rhymeGroup: null, stanzaEnd: false };
  return { line: { text: chars.filter(cellChar).join(''), punct, end, rhyme, rhymeGroup, stanzaEnd, cells }, infos };
}

function checkVariant(form, rhymebook, input, variant, partial, lookup) {
  const issues = [];
  const issue = (level, code, ju, pos, message) => issues.push({ level, code, ju, pos, message });
  const source = input.byText && input.chars.length === variant.chars ? alignText(input, variant.ju) : input.lines;
  const lines = [];
  const infos = [];
  for (const [index, pattern] of variant.ju.entries()) {
    const { chars, punct } = source[index] ?? { chars: [], punct: '' };
    const width = pattern.tones.length;
    const actual = chars.filter(cellChar).length;
    if (chars.length > width || (!partial && actual !== width)) {
      const overflow = chars.length > width;
      const message = `第${index + 1}句应${width}字，实为${overflow ? chars.length : actual}字`;
      issue(partial ? 'warn' : 'error', 'length', index, overflow ? width : null,
        partial ? `${message}，仅校验前${width}格` : message);
    }
    const row = lineReport(chars.slice(0, width), punct, pattern, lookup, index, issue);
    lines.push(row.line);
    infos.push(row.infos);
    if (form.kind === 'shi') matchShi(row.line, row.infos, index, issue);
    for (const [pos, cell] of row.line.cells.entries()) {
      if (!cell.known || cell.want === '中' || cell.ok !== null || (pattern.rhyme && pos === width - 1)) continue;
      cell.ok = cell.got.includes(cell.want);
      if (!cell.ok) issue('error', 'tone', index, pos, `第${index + 1}句第${pos + 1}字「${cell.char}」应${cell.want}，实为${cell.got.join('或')}`);
    }
  }
  for (const [i, line] of source.slice(variant.ju.length).entries()) {
    if (partial && !line.chars.some(cellChar)) continue;
    const index = variant.ju.length + i;
    issue(partial ? 'warn' : 'error', 'length', index, null, `第${index + 1}句应0字，实为${line.chars.filter(cellChar).length}字，超出谱面`);
  }
  const rhymes = checkRhymes(lines, infos, variant, form.kind, rhymebook, issue);
  return reportResult({ form: reportedForm(form), rhymebook, variant: reportedVariant(variant), ju: lines, rhymes, issues });
}

function checkFree(name, rhymebook, input, lookup) {
  const issues = [];
  const issue = (level, code, ju, pos, message) => issues.push({ level, code, ju, pos, message });
  const breaks = new Set([...input.stanzaBreaks, input.lines.length]);
  const ju = input.lines.map(({ chars, punct }, index) => {
    const { line } = lineReport(chars, punct, null, lookup, index, issue);
    line.stanzaEnd = breaks.has(index + 1);
    return line;
  });
  return reportResult({ form: { id: name, name, kind: 'free' }, rhymebook, variant: null, ju, rhymes: [], issues });
}

export function checkPoem({ form, rhymebook = 'guyun', text, ju, variant = 'auto', partial = false }) {
  if (!['guyun', 'xinyun'].includes(rhymebook)) throw new RangeError(`未知韵书「${rhymebook}」`);
  const definition = resolveForm(form);
  const input = poemInput(text, ju, !definition);
  const cache = new Map();
  const lookup = char => {
    if (!cache.has(char)) cache.set(char, charInfo(char, rhymebook, definition?.kind ?? 'free'));
    return cache.get(char);
  };
  if (!definition) return checkFree(String(form ?? '自由体').trim(), rhymebook, input, lookup);

  // 浪淘沙 is also used as shorthand for the longer tune. Keep the
  // canonical short tune unless its length rules out that interpretation.
  let selected = definition;
  if (definition.id === '浪淘沙' && variant === 'auto' && !definition.variants.some(v => v.chars === input.chars.length)) {
    const longer = resolveForm('浪淘沙令');
    if (longer?.variants.some(v => v.chars === input.chars.length)) selected = longer;
  }
  if (selected.id === '木兰花令' && variant === 'auto' && !selected.variants.some(v => v.chars === input.chars.length)) {
    const yulouchun = resolveForm('玉楼春');
    if (yulouchun?.variants.some(v => v.chars === input.chars.length)) selected = yulouchun;
  }
  if (variant !== 'auto') {
    const fixed = Number.isInteger(variant) ? selected.variants[variant] : null;
    if (!fixed) throw new RangeError(`「${selected.name}」没有下标为${variant}的格式`);
    return checkVariant(selected, rhymebook, input, fixed, partial, lookup);
  }

  const exact = selected.variants.filter(v => v.chars === input.chars.length);
  let winner;
  for (const v of exact.length ? exact : selected.variants) {
    const report = checkVariant(selected, rhymebook, input, v, partial, lookup);
    if (!winner || report.stats.errors < winner.stats.errors) winner = report;
    if (winner.ok) break;
  }
  return winner;
}
