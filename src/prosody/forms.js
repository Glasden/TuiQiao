import { readData } from './data.js';

export const shiTones = { A: '中仄平平仄', B: '中平仄仄平', C: '中平中仄仄', D: '中仄仄平平' };
const shiForms = [
  ['wujue', '五绝', '五言绝句', 5, 4],
  ['qijue', '七绝', '七言绝句', 7, 4],
  ['wulv', '五律', '五言律诗', 5, 8],
  ['qilv', '七律', '七言律诗', 7, 8],
].map(([id, name, fullName, width, lines]) => {
  const desc = `${fullName}，${lines}句，每句${width}字，押平韵`;
  const cycles = width === 5 ? ['BDAB', 'CDAB', 'DBCD', 'ABCD'] : ['DBCD', 'ABCD', 'BDAB', 'CDAB'];
  const variants = cycles.map((cycle, index) => {
    const laterCycle = cycle.replace(/^B/u, 'C').replace(/^D/u, 'A');
    const ju = Array.from({ length: lines }, (_, i) => {
      // In a regulated octave the second half repeats the cycle without
      // inheriting the optional rhyme on the opening line.
      const type = i < 4 ? cycle[i] : laterCycle[i - 4];
      const tones = (width === 7 ? ('AD'.includes(type) ? '中平' : '中仄') : '') + shiTones[type];
      const rhyme = type === 'B' || type === 'D';
      return { tones, end: rhyme ? '韵' : '句', rhyme, rhymeGroup: rhyme ? 1 : null,
        rhymeTone: rhyme ? '平' : null, stanzaEnd: i === lines - 1 };
    });
    const label = `${ju[0].tones[1]}起首句${ju[0].rhyme ? '入韵' : '不入韵'}`;
    return { index, label, sketch: `${desc} · ${label}`, chars: width * lines, ju };
  });
  return { id, name, kind: 'shi', desc, common: true, aliases: [fullName], variants };
});

const commonCi = new Set((
  '浣溪沙 如梦令 菩萨蛮 卜算子 西江月 清平乐 忆江南 蝶恋花 鹧鸪天 虞美人 临江仙 水调歌头 念奴娇 满江红 ' +
  '渔家傲 点绛唇 采桑子 江城子 青玉案 沁园春 相见欢 长相思 忆秦娥 一剪梅 醉花阴 定风波 破阵子 踏莎行 ' +
  '南乡子 生查子 浪淘沙令 鹊桥仙 天净沙 忆王孙 捣练子 减字木兰花 诉衷情 苏幕遮 谒金门 好事近'
).split(' '));

const ciAliases = {
  忆江南: ['望江南', '江南好', '梦江南'],
  古调笑: ['调笑令'],
  念奴娇: ['酹江月', '大江东去'],
  蝶恋花: ['鹊踏枝', '凤栖梧'],
  采桑子: ['丑奴儿'],
  忆秦娥: ['秦楼月'],
  江城子: ['江神子'],
  贺新郎: ['金缕曲'],
  木兰花令: ['木兰花'],
};

const rhymeLinks = new WeakMap();
export function linkedRhymeGroups(variant) {
  return rhymeLinks.get(variant) ?? new Map();
}

function groupCiRhymes(ju, changes) {
  let base;
  // Keep a regular rhyme through intervening 叶 positions. Those positions
  // get their own tone, linked to the regular group's rhyme class.
  const groups = ju.map((line, i) => {
    if (line.end !== '韵') return null;
    const tone = line.tones.at(-1);
    if (changes.has(i) || base?.tone !== tone) base = { tone };
    return base;
  });
  base = null;
  let previous;
  let next;
  const upcoming = groups.map(() => null);
  for (let i = groups.length - 1; i >= 0; i--) {
    upcoming[i] = next;
    if (groups[i]) next = groups[i];
  }
  const leaves = new Map();
  for (const [i, line] of ju.entries()) {
    if (line.end === '韵') {
      base = previous = groups[i];
    } else if (line.end === '叶') {
      const next = upcoming[i];
      const tone = line.tones.at(-1) === '中'
        ? ((base ?? next)?.tone === '仄' ? '平' : '仄')
        : line.tones.at(-1);
      const anchor = base && base.tone !== tone ? base : next && next.tone !== tone ? next : null;
      if (!leaves.has(anchor)) leaves.set(anchor, new Map());
      const byTone = leaves.get(anchor);
      if (!byTone.has(tone)) byTone.set(tone, { tone, anchor });
      groups[i] = previous = byTone.get(tone);
    } else if (line.end === '叠') {
      groups[i] = previous ?? { tone: line.tones.at(-1) };
      previous = groups[i];
    }
  }
  const ordered = [...new Set(groups.filter(Boolean))];
  for (const [i, group] of ordered.entries()) group.number = i + 1;
  for (const [i, line] of ju.entries()) {
    line.rhymeGroup = groups[i]?.number ?? null;
    line.rhymeTone = groups[i]?.tone ?? null;
  }
  return new Map(ordered.filter(group => group.anchor).map(group => [group.number, group.anchor.number]));
}

const endings = { ',': '句', '=': '韵', ':': '读', '*': '叠', '~': '叶', '%': '韵' };
const numerals = '零一二三四五六七八九';
function chineseOrdinal(n) {
  if (n < 10) return numerals[n];
  const tens = Math.floor(n / 10);
  return (tens > 1 ? numerals[tens] : '') + '十' + (n % 10 ? numerals[n % 10] : '');
}

function ciVariant([sketch, author, pattern], index) {
  let chars = 0;
  const changes = new Set();
  const ju = Array.from(pattern.matchAll(/([012]+)([,=:*~%])(!?)/gu), ([, codes, code, shift], i) => {
    const tones = codes.replace(/[012]/gu, digit => '中平仄'[digit]);
    const end = endings[code];
    chars += tones.length;
    if (code === '%') changes.add(i);
    return { tones, end, rhyme: end !== '句' && end !== '读', rhymeGroup: null, rhymeTone: null, stanzaEnd: shift === '!' };
  });
  const label = (index === 0 ? '正体' : `变体${chineseOrdinal(index + 1)}`) + (author ? ` · ${author}` : '');
  const variant = { index, label, sketch, chars, ju };
  rhymeLinks.set(variant, groupCiRhymes(ju, changes));
  return variant;
}

let catalog;
function ciCatalog() {
  if (catalog) return catalog;
  const data = readData('tunes');
  const claimed = new Map();
  for (const [name, [desc]] of Object.entries(data)) {
    for (const [, alias] of desc.matchAll(/又名《([^《》]{2,12})》/gu)) {
      if (!claimed.has(alias)) claimed.set(alias, name);
      else if (claimed.get(alias) !== name) claimed.set(alias, null);
    }
  }
  for (const [name, aliases] of Object.entries(ciAliases)) {
    if (Object.hasOwn(data, name)) for (const alias of aliases) claimed.set(alias, name);
  }
  const aliases = new Map();
  const byName = new Map();
  for (const [alias, name] of claimed) {
    if (!name || Object.hasOwn(data, alias)) continue;
    aliases.set(alias, name);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(alias);
  }
  const summaries = Object.entries(data).map(([name, [, [[sketch, , pattern]]]]) => ({
    id: name, name, kind: 'ci', chars: pattern.replace(/[^012]/gu, '').length, common: commonCi.has(name),
    sketch, aliases: byName.get(name) ?? [],
  }));
  const formDefs = new Map();
  const form = name => {
    if (!Object.hasOwn(data, name)) return null;
    if (!formDefs.has(name)) {
      const [desc, patterns] = data[name];
      formDefs.set(name, { id: name, name, kind: 'ci', desc, common: commonCi.has(name),
        aliases: byName.get(name) ?? [], variants: patterns.map(ciVariant) });
    }
    return formDefs.get(name);
  };
  catalog = { aliases, summaries, form };
  return catalog;
}

export function listForms({ kind, commonOnly = false } = {}) {
  const shi = !kind || kind === 'shi' ? shiForms.map(({ id, name, kind, common, aliases, variants: [first] }) => ({
    id, name, kind, chars: first.chars, common, sketch: first.sketch, aliases,
  })) : [];
  const ci = !kind || kind === 'ci' ? ciCatalog().summaries : [];
  return [...shi, ...ci].filter(form => !commonOnly || form.common);
}

export function sampleForms(n = 4, rng = Math.random) {
  const pool = listForms({ commonOnly: true });
  const sample = [];
  const take = kind => {
    const candidates = pool.filter(form => !kind || form.kind === kind);
    const form = candidates[Math.floor(rng() * candidates.length)];
    pool.splice(pool.indexOf(form), 1);
    sample.push(form);
  };
  const size = Math.min(Math.floor(n), pool.length);
  if (size >= 2) {
    take('shi');
    take('ci');
  }
  while (sample.length < size) take();
  return sample;
}

export function resolveForm(nameOrAlias) {
  let name = String(nameOrAlias ?? '').trim().split(/[·・]/u, 1)[0];
  let previous;
  do {
    previous = name;
    name = name.trim().replace(/^[《〈]+|[》〉]+$/gu, '')
      .replace(/(?:词牌|词牌名|[（(]\s*(?:词牌|词|曲牌|曲)\s*[）)])$/u, '').trim();
  } while (name !== previous);
  if (!name) return null;
  const shi = shiForms.find(form => form.id === name || form.name === name || form.aliases.includes(name));
  if (shi) return shi;
  const { aliases, form } = ciCatalog();
  return form(name) ?? form(aliases.get(name));
}
