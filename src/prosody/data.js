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
  const simplified = () => readData('simplified')[char] ?? char;
  const modern = () => {
    const direct = modernReadings(char);
    return direct.length ? direct : modernReadings(simplified());
  };
  let known;
  let readings;
  if (rhymebook === 'guyun') {
    const { groups, byChar } = readData(kind === 'ci' ? 'cilin' : 'pingshui');
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
