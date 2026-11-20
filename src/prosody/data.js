import { readFileSync } from 'node:fs';

const datasets = new Map();

export function readData(name) {
  if (!datasets.has(name)) {
    datasets.set(name, JSON.parse(readFileSync(new URL(`../../data/${name}.json`, import.meta.url), 'utf8')));
  }
  return datasets.get(name);
}

export const RHYMEBOOKS = [
  { id: 'xinyun', name: '中华新韵', note: '依普通话读音，十四韵，无入声' },
  { id: 'guyun', name: '平水韵 · 词林正韵', note: '诗依平水韵，词依词林正韵，入声归仄' },
];

const modernSheng = ['阴平', '阳平', '上', '去'];
const bookNames = { xinyun: '中华新韵', pingshui: '平水韵', cilin: '词林正韵' };
const rhymeIndexes = new Map();
let commonOrder;

function bookKey(rhymebook, kind) {
  return rhymebook === 'guyun' ? (kind === 'ci' ? 'cilin' : 'pingshui') : 'xinyun';
}

export function bookName(rhymebook, kind = 'shi') {
  return bookNames[bookKey(rhymebook, kind)];
}

// 繁体单字折成简体；无映射（含本是简体）则原样返回
export function simplify(char) {
  const table = readData('simplified');
  return Object.hasOwn(table, char) ? table[char] : char;
}

function modernReadings(char) {
  const { names, byChar } = readData('xinyun');
  return (Object.hasOwn(byChar, char) ? byChar[char] : []).map(([sheng, rhyme, pinyin]) => ({
    tone: sheng < 2 ? '平' : '仄',
    sheng: modernSheng[sheng],
    rhyme: names[rhyme],
    pinyin,
  }));
}

export function charInfo(char, rhymebook, kind = 'shi') {
  const simplified = () => simplify(char);
  const modern = () => {
    const direct = modernReadings(char);
    return direct.length ? direct : modernReadings(simplified());
  };
  let known;
  let readings;
  if (rhymebook === 'guyun') {
    const { groups, byChar } = readData(bookKey(rhymebook, kind));
    const ids = byChar[char] ?? byChar[simplified()];
    known = Array.isArray(ids);
    readings = known
      ? ids.map(id => {
        const [sheng, rhyme] = groups[id];
        return { tone: sheng === '平' ? '平' : '仄', sheng, rhyme };
      })
      : modern().map(reading => ({ ...reading, rhyme: '' }));
  } else {
    readings = modern();
    known = readings.length > 0;
  }
  return { char, known, tones: [...new Set(readings.map(reading => reading.tone))], readings };
}

function buildRhymeIndex(book) {
  const data = readData(book);
  const modern = book === 'xinyun';
  const groups = modern ? data.names.flatMap(name => modernSheng.map(sheng => [sheng, name])) : data.groups;
  const byName = new Map();
  const buckets = groups.map(([sheng, name]) => {
    const tone = ['平', '阴平', '阳平'].includes(sheng) ? '平' : '仄';
    if (!byName.has(name)) byName.set(name, new Map());
    const tones = byName.get(name);
    if (!tones.has(tone)) tones.set(tone, { sheng: [], chars: new Set() });
    const bucket = tones.get(tone);
    bucket.sheng.push(sheng);
    return bucket;
  });
  for (const [char, readings] of Object.entries(data.byChar)) {
    for (const reading of readings) {
      const id = modern ? reading[1] * modernSheng.length + reading[0] : reading;
      buckets[id].chars.add(char);
    }
  }

  commonOrder ??= new Map(Array.from(readData('common'), (char, i) => [char, i])
    .filter(([char]) => simplify(char) === char));
  const names = [...byName.keys()];
  if (book === 'pingshui' && names.at(-1) === '三讲') {
    // 补录的三讲位于数据末尾，以保留原字表的下标。
    names.splice(names.indexOf('四纸'), 0, names.pop());
  }
  const summaries = [];
  const rhymes = new Map();
  for (const name of names) {
    const tones = byName.get(name);
    const entries = [];
    for (const tone of ['平', '仄']) {
      const bucket = tones.get(tone);
      if (!bucket) continue;
      const common = [];
      const rare = [];
      for (const char of bucket.chars) (commonOrder.has(char) ? common : rare).push(char);
      common.sort((a, b) => commonOrder.get(a) - commonOrder.get(b));
      rare.sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
      summaries.push({ name, tone, sheng: bucket.sheng, chars: bucket.chars.size, common: common.length });
      entries.push({ name, tone, common: common.join(''), rare: rare.join('') });
    }
    rhymes.set(name, entries);
  }
  return { summaries, rhymes };
}

function rhymeIndex(rhymebook, kind) {
  const book = bookKey(rhymebook, kind);
  if (!rhymeIndexes.has(book)) rhymeIndexes.set(book, buildRhymeIndex(book));
  return rhymeIndexes.get(book);
}

export function listRhymes(rhymebook, kind = 'shi') {
  return rhymeIndex(rhymebook, kind).summaries.map(entry => ({ ...entry, sheng: [...entry.sheng] }));
}

export function rhymeChars(name, rhymebook, kind = 'shi', tone) {
  const { rhymes } = rhymeIndex(rhymebook, kind);
  // 平水韵的入声韵在表里带「入声」前缀，而人说「十一陌」时多不带：两种写法都认
  const entries = rhymes.get(name) ?? rhymes.get(`入声${name}`) ?? [];
  return entries.filter(entry => tone === undefined || entry.tone === tone).map(entry => ({ ...entry }));
}
