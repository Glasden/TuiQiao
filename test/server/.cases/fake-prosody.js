export const RHYMEBOOKS = [
  { id: 'xinyun', name: '中华新韵', note: '测试新韵' },
  { id: 'guyun', name: '平水韵 · 词林正韵', note: '测试古韵' },
];

const flat = new Set('玄杉霜孤晴光承钟回舟塘堂山同空春秋');
const rhymeWords = new Set('霜光塘堂');
const special = new Set('多');
export const originalIssue = {
  level: 'error', code: 'tone', ju: 0, pos: 0, message: '原作格律私密错误',
};

export function charInfo(char) {
  const known = /^\p{Script=Han}$/u.test(char);
  const tones = !known ? [] : special.has(char) ? ['平', '仄'] : [flat.has(char) ? '平' : '仄'];
  return {
    char, known, tones,
    readings: tones.map(tone => ({
      tone, sheng: tone === '平' ? '阳平' : '去', rhyme: rhymeWords.has(char) ? '七阳' : '一东',
    })),
  };
}

const definitions = [['wujue', '五绝', 'shi', 5], ['qijue', '七绝', 'shi', 7], ['hps', '浣溪沙', 'ci', 5]]
  .map(([id, name, kind, width]) => ({
    id, name, kind, desc: '四句测试谱', common: id !== 'qijue', aliases: [],
    variants: [0, 1].map(index => ({
      index, label: index ? '变体一' : '正体', sketch: '测试格式', chars: 4 * width,
      ju: Array.from({ length: 4 }, (_, j) => ({
        tones: (index ? '仄' : '平') + '中'.repeat(width - 1),
        end: j % 2 ? '韵' : '句', rhyme: Boolean(j % 2),
        rhymeGroup: j % 2 ? 1 : null, rhymeTone: j % 2 ? '平' : null,
        stanzaEnd: j === 3 || (kind === 'ci' && j === 1),
      })),
    })),
  }));

const traditional = { 鶴: '鹤', 鐘: '钟', 隱: '隐', 塘: '塘' };
export function simplify(char) {
  return Object.hasOwn(traditional, char) ? traditional[char] : char;
}

export function resolveForm(name) {
  return definitions.find(form => [form.name, form.id].includes(name)) ?? null;
}

export function listForms({ kind, commonOnly } = {}) {
  return definitions.filter(form => (!kind || kind === form.kind) && (!commonOnly || form.common))
    .map(({ id, name, kind, common, aliases, variants: [first] }) => ({
      id, name, kind, common, aliases, chars: first.chars, sketch: first.sketch,
    }));
}

export function sampleForms(n = 4) {
  return listForms({ commonOnly: true }).slice(0, n);
}

export function splitPoem(text) {
  const ju = [];
  const stanzaBreaks = [];
  const blocks = text.trim().split(/\n\s*\n/);
  for (const [block, part] of blocks.entries()) {
    for (const match of part.matchAll(/([\p{Script=Han}□]+)([^\p{Script=Han}□]*)/gu)) {
      ju.push({ text: match[1], punct: match[2].trim() });
    }
    if (block < blocks.length - 1) stanzaBreaks.push(ju.length);
  }
  return { ju, stanzaBreaks };
}

export function checkPoem({ form, rhymebook, text, ju, variant = 'auto', partial = false }) {
  const def = resolveForm(form);
  const rows = ju?.map((text, j) => ({ text, punct: j % 2 ? '。' : '，' })) ?? splitPoem(text).ju;
  const index = variant === 'auto' ? Number(rows[0]?.text.startsWith('雨')) : variant;
  const scheme = def?.variants[index];
  const issues = [];
  if (scheme && !partial && (rows.length !== scheme.ju.length || rows.some((r, j) =>
    Array.from(r.text).length !== scheme.ju[j]?.tones.length))) {
    issues.push({ level: 'error', code: 'length', ju: null, pos: null, message: '句数或字数不合测试谱' });
  }
  const output = (scheme?.ju ?? rows).map((pattern, j) => {
    const { text = '', punct = j % 2 ? '。' : '，' } = rows[j] ?? {};
    const chars = Array.from(text);
    const { end = '句', rhyme = false, rhymeGroup = null, stanzaEnd = j === rows.length - 1 } = pattern;
    const tones = pattern.tones ?? '中'.repeat(chars.length);
    if (partial && chars.length > tones.length) {
      issues.push({ level: 'warn', code: 'length', ju: j, pos: null, message: '填字超过测试谱' });
    }
    const cells = Array.from(tones, (want, i) => {
      const char = chars[i] === '□' ? null : chars[i] ?? null;
      if (!char) return { char: null, want, got: [], ok: null, known: false };
      const { known, tones: got } = charInfo(char);
      const ok = want === '中' || !known ? null : got.includes(want);
      if (!known) {
        issues.push({ level: 'warn', code: 'unknown-char', ju: j, pos: i, message: `测试字「${char}」未收录` });
      }
      return { char, want, got, ok, known };
    });
    return { text, punct, end, rhyme, rhymeGroup, stanzaEnd, cells };
  });
  const members = output.flatMap(({ rhyme, cells }, j) => {
    if (!rhyme) return [];
    const char = cells.at(-1)?.char ?? null;
    return [{ ju: j, char, rhymes: charInfo(char ?? '').readings.map(reading => reading.rhyme) }];
  });
  const stats = {
    errors: issues.filter(issue => issue.level === 'error').length,
    warns: issues.filter(issue => issue.level === 'warn').length,
  };
  return {
    ok: stats.errors === 0, complete: output.every(row => row.cells.every(cell => cell.char !== null)),
    form: def ? { id: def.id, name: def.name, kind: def.kind } : { id: form, name: form, kind: 'free' },
    rhymebook,
    variant: scheme ? { index: scheme.index, label: scheme.label, sketch: scheme.sketch } : null,
    ju: output, rhymes: members.length ? [{ group: 1, tone: '平', name: '七阳', ok: true, members }] : [],
    issues, stats,
  };
}

export const input = {
  title: '江城逆旅',
  subjects: ['水路'],
  premise: 'alternate',
  premiseNote: '雨季改道',
  form: '五绝',
  rhymebook: 'xinyun',
  story: '旅人在岸边等船。\n\n驿卒送来封信。',
  poem: '玄杉晚渡霜，孤鹤隐晴光。\n曲涧承钟影，回舟入夜塘。',
  cloze: '【玄】杉晚渡霜，孤【鹤】隐晴【光】。\n曲涧承【钟】影，回舟入【夜】塘。',
  hiddenLines: [2, 4],
  glosses: ['白话甲', '白话乙', '白话丙', '白话丁'],
  imagery: ['村灯', '城垣'],
  note: '创作手记不公开',
};
