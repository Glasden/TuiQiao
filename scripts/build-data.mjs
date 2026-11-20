import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cilinParts, partsForPingshui } from '../src/prosody/cilin-parts.js';

const root = new URL('../', import.meta.url);
const sourceUrls = {
  chinese_word_rhyme: 'https://github.com/charlesix59/chinese_word_rhyme',
  'pinyin-data': 'https://github.com/mozillazg/pinyin-data',
  opencc: 'https://github.com/ByVoid/OpenCC/blob/master/data/dictionary/TSCharacters.txt',
};

function source(path) {
  try {
    return readFileSync(new URL(`.cache/sources/${path}`, root), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`缺少 .cache/sources/${path}，请从 ${sourceUrls[path.split('/')[0]]} 下载并放到该路径。`);
  }
}

const han = /^\p{Script=Han}$/u;
const names = ['一麻', '二波', '三皆', '四开', '五微', '六豪', '七尤', '八寒', '九文', '十唐', '十一庚', '十二齐', '十三支', '十四姑'];
const finals = [
  'a ia ua', 'o e uo', 'ie üe', 'ai uai', 'ei ui', 'ao iao', 'ou iu', 'an ian uan üan',
  'en in un ün', 'ang iang uang', 'eng ing ong iong', 'i er ü', 'zhi chi shi ri zi ci si', 'u',
];
const finalIndex = new Map(finals.flatMap((row, i) => row.split(' ').map(final => [final, i])));
const zeroInitial = {
  ya: 'ia', ye: 'ie', yao: 'iao', you: 'iu', yan: 'ian', yin: 'in', yang: 'iang',
  ying: 'ing', yong: 'iong', yu: 'ü', yue: 'üe', yuan: 'üan', yun: 'ün', yi: 'i',
  wa: 'ua', wo: 'uo', wai: 'uai', wei: 'ui', wan: 'uan', wen: 'un', wang: 'uang',
  weng: 'eng', wu: 'u',
};
const toneMarks = ['\u0304', '\u0301', '\u030c', '\u0300'];

function modernReading(pinyin) {
  const decomposed = pinyin.normalize('NFD');
  const tone = toneMarks.findIndex(mark => decomposed.includes(mark));
  if (tone === -1) return null;
  const syllable = decomposed.replace(/[\u0304\u0301\u030c\u0300]/gu, '').normalize('NFC');
  const final = zeroInitial[syllable] ?? (finalIndex.get(syllable) === 12
    ? syllable
    : syllable.replace(/^([jqx])u/u, '$1ü').replace(/^(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcs])/u, ''));
  const rhyme = finalIndex.get(final);
  return rhyme === undefined ? null : [tone, rhyme, pinyin];
}

function modernBook() {
  const byChar = {};
  for (const file of ['kXHC1983', 'kTGHZ2013', 'kMandarin']) {
    for (const line of source(`pinyin-data/${file}.txt`).split(/\r?\n/u)) {
      const entry = /^U\+([\dA-F]+):\s*([^\s#]+)/u.exec(line);
      if (!entry) continue;
      const code = parseInt(entry[1], 16);
      if (code < 0x4e00 || code > 0x9fff) continue;
      const char = String.fromCodePoint(code);
      if (byChar[char]) continue;
      // These entries include contextual tone changes in kXHC1983.
      const base = { 一: 'yī', 不: 'bù', 七: 'qī', 八: 'bā' }[char];
      const readings = [...new Set(base ? [base] : entry[2].split(','))].map(modernReading).filter(Boolean);
      if (readings.length) byChar[char] = readings;
    }
  }
  return { names, byChar };
}

function indexReading({ groups, byChar }, sheng, rhyme, char) {
  if (!han.test(char)) return;
  let id = groups.findIndex(group => group[0] === sheng && group[1] === rhyme);
  if (id === -1) id = groups.push([sheng, rhyme]) - 1;
  const readings = byChar[char] ??= [];
  if (!readings.includes(id)) readings.push(id);
}

function pingshuiBook() {
  const book = { groups: [], byChar: {} };
  const data = JSON.parse(source('chinese_word_rhyme/Pingshui_Rhyme.json'));
  for (const [sheng, rhymes] of Object.entries(data)) {
    for (const [rhyme, chars] of Object.entries(rhymes)) {
      for (const char of chars) indexReading(book, sheng.at(-3), rhyme, char);
    }
  }
  // Keep the raw indexes and readings authoritative. New groups are appended.
  const originalChars = new Set(Object.keys(book.byChar));
  const supplement = readFileSync(new URL('pingshui-supplement.txt', import.meta.url), 'utf8');
  for (const line of supplement.split(/\r?\n/u)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [char, sheng, rhyme, extra] = line.trim().split(/\s+/u);
    if (!han.test(char) || !/^[平上去入]$/u.test(sheng) || !rhyme || extra) {
      throw new Error(`平水韵补字表格式有误「${line}」`);
    }
    if (originalChars.has(char)) {
      const readings = book.byChar[char].map(id => book.groups[id]);
      if (!readings.some(([voice, name]) => voice === sheng && name === rhyme)) {
        console.warn(`平水韵补录「${char} ${sheng} ${rhyme}」与原表读音不同，沿用原表的${readings.map(row => row.join(' ')).join('、')}`);
      }
      continue;
    }
    indexReading(book, sheng, rhyme, char);
  }
  return book;
}

function cilinBook(pingshui) {
  const book = { groups: [], byChar: {} };
  const data = JSON.parse(source('chinese_word_rhyme/Cilin_Rhyme.json'));
  for (const [rhyme, categories] of Object.entries(data)) {
    const part = cilinParts.find(({ name }) => name === rhyme);
    if (!part) throw new Error(`词林正韵包含未知韵部「${rhyme}」`);
    for (const [category, chars] of Object.entries(categories)) {
      for (const char of chars) {
        const sheng = category[0];
        if (sheng !== '仄') {
          indexReading(book, sheng, rhyme, char);
          continue;
        }
        const oblique = (pingshui.byChar[char] ?? [])
          .map(id => pingshui.groups[id])
          .filter(([voice, name]) => '上去'.includes(voice) && part.groups.includes(name.at(-1)));
        // Cilin sometimes records only 仄. Leave both subdivisions possible
        // if Pingshui supplies no reading in this part.
        for (const voice of new Set(oblique.length ? oblique.map(([voice]) => voice) : ['上', '去'])) {
          indexReading(book, voice, rhyme, char);
        }
      }
    }
  }
  for (const [char, ids] of Object.entries(pingshui.byChar)) {
    if (book.byChar[char]) continue;
    for (const id of ids) {
      const [sheng, rhyme] = pingshui.groups[id];
      for (const part of partsForPingshui(rhyme)) indexReading(book, sheng, part, char);
    }
  }
  return book;
}

const toneCode = { 中: '0', 平: '1', 仄: '2' };
const endCode = { 句: ',', 韵: '=', 读: ':', 叠: '*', 叶: '~', 平: '=', 仄: '=', 换: '%', 重: '=' };
const digits = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function chineseNumber(text) {
  const [tens, ones] = text.split('十');
  return ones === undefined ? digits[tens] : (digits[tens] ?? 1) * 10 + (digits[ones] ?? 0);
}

// Some raw shift flags also mark pauses inside a stanza. Use the sketch's
// counts when they agree with the raw boundary positions.
function stanzaEnds(sketch, tunes) {
  const raw = tunes.flatMap((cell, i) => cell.shift === 'true' ? [i] : []);
  if (sketch.startsWith('单调')) return new Set([tunes.length - 1]);
  const counts = Array.from(sketch.matchAll(/(?:前后段各|前两段各|每段各|[前中后]段|后一段|第[一二三四]段)([一二两三四五六七八九十]+)句/gu),
    match => chineseNumber(match[1]));
  if (sketch.includes('前后段各') || sketch.includes('前两段各')) counts.unshift(counts[0]);
  if (sketch.includes('每段各') && counts.length === 1 && sketch.startsWith('三段')) counts.push(counts[0], counts[0]);
  const expected = { 双: 2, 三: 3, 四: 4 }[sketch[0]];
  if (!expected || raw.length <= expected || counts.length !== expected || counts.some(count => !count)) return new Set(raw);
  const candidates = [];
  for (const countReads of [false, true]) {
    const ends = tunes.flatMap((cell, i) => cell.rhythm && (countReads || cell.rhythm !== '读') ? [i] : []);
    let cursor = 0;
    const boundaries = counts.slice(0, -1).map(count => ends[(cursor += count) - 1]);
    if (!boundaries.every(i => raw.includes(i) && i < tunes.length - 1)) continue;
    boundaries.push(tunes.length - 1);
    if (cursor + counts.at(-1) === ends.length) return new Set(boundaries);
    candidates.push(boundaries);
  }
  return new Set(candidates[0] ?? raw);
}

function ciTunes() {
  const tunes = {};
  const data = JSON.parse(source('chinese_word_rhyme/Ci_Tunes.json'));
  for (const [name, { desc, formats }] of Object.entries(data)) {
    if (!formats?.length) continue;
    const patterns = formats.map(format => {
      const { sketch, author, tunes } = format;
      const shifts = stanzaEnds(sketch, tunes);
      const pattern = tunes.map(({ tune, rhythm }, i) => {
        const stanzaEnd = shifts.has(i) || i === tunes.length - 1;
        const end = rhythm || stanzaEnd ? endCode[rhythm] ?? ',' : '';
        return toneCode[tune] + end + (stanzaEnd ? '!' : '');
      }).join('');
      return [sketch, author, pattern];
    });
    // Short sketches such as 定格 often duplicate a fully described variant.
    // When same-length variants agree on the raw breaks, reuse their stanza markers.
    const structures = new Map();
    for (const [i, format] of formats.entries()) {
      const key = format.tunes.flatMap((cell, i) => cell.shift ? [i] : []).join();
      const pattern = patterns[i][2];
      if (/^[单双]调|^[三四]段/u.test(format.sketch)) {
        const boundaries = new Set(Array.from(pattern.matchAll(/!/gu),
          match => pattern.slice(0, match.index).replace(/[^012]/gu, '').length));
        if (!structures.has(key)) structures.set(key, boundaries);
        else if ([...(structures.get(key) ?? [])].join() !== [...boundaries].join()) structures.set(key, null);
      } else {
        const boundaries = structures.get(key);
        if (!boundaries) continue;
        let length = 0;
        patterns[i][2] = pattern.replace(/([012]+)([^012!])!?/gu, (_, tones, end) => {
          length += tones.length;
          return tones + end + (boundaries.has(length) ? '!' : '');
        });
      }
    }
    const shortDesc = Array.from((desc ?? '').trim()).slice(0, 120).join('');
    tunes[name] = [shortDesc, patterns];
  }
  return tunes;
}

function simplifications() {
  const byChar = {};
  for (const line of source('opencc/TSCharacters.txt').split(/\r?\n/u)) {
    const [traditional, values] = line.split('\t');
    if (!/^[\u4e00-\u9fff]$/u.test(traditional) || !values) continue;
    const simplified = values.trim().split(/\s+/u)[0];
    if (simplified !== traditional && han.test(simplified)) byChar[traditional] = simplified;
  }
  return byChar;
}

function commonChars() {
  const bytes = [];
  for (let row = 0xb0; row <= 0xd7; row++) {
    for (let col = 0xa1; col <= (row === 0xd7 ? 0xf9 : 0xfe); col++) bytes.push(row, col);
  }
  return new TextDecoder('gb2312', { fatal: true }).decode(Uint8Array.from(bytes));
}

function buildDatasets() {
  const pingshui = pingshuiBook();
  return {
    xinyun: modernBook(), pingshui, cilin: cilinBook(pingshui),
    tunes: ciTunes(), simplified: simplifications(), common: commonChars(),
  };
}

try {
  const datasets = process.argv.includes('--common') ? { common: commonChars() } : buildDatasets();
  mkdirSync(new URL('data/', root), { recursive: true });
  for (const [name, data] of Object.entries(datasets)) {
    writeFileSync(new URL(`data/${name}.json`, root), JSON.stringify(data) + '\n');
  }
  console.log(`已生成 ${Object.keys(datasets).length} 个格律数据文件。`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
