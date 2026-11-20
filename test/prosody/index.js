import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  bookName, charInfo, checkPoem, listForms, listRhymes, resolveForm, rhymeChars, RHYMEBOOKS, sampleForms, splitPoem,
} from '../../src/prosody/index.js';

// 名作
const tower = '白日依山尽，黄河入海流。欲穷千里目，更上一层楼。';
const redCliff = '折戟沉沙铁未销，自将磨洗认前朝。东风不与周郎便，铜雀春深锁二乔。';
const yanHuan = '一曲新词酒一杯，去年天气旧亭台。夕阳西下几时回？\n\n无可奈何花落去，似曾相识燕归来。小园香径独徘徊。';
const classics = [
  ['王之涣《登鹳雀楼》', '五绝', tower],
  ['杜甫《春望》', '五律', '国破山河在，城春草木深。感时花溅泪，恨别鸟惊心。烽火连三月，家书抵万金。白头搔更短，浑欲不胜簪。'],
  ['李白《早发白帝城》', '七绝', '朝辞白帝彩云间，千里江陵一日还。两岸猿声啼不住，轻舟已过万重山。'],
  ['苏轼《浣溪沙·山下兰芽短浸溪》', '浣溪沙', '山下兰芽短浸溪，松间沙路净无泥，萧萧暮雨子规啼。谁道人生无再少？门前流水尚能西！休将白发唱黄鸡。'],
  ['晏殊《浣溪沙·一曲新词酒一杯》', '浣溪沙', yanHuan],
  ['李清照《如梦令·常记溪亭日暮》', '如梦令', '常记溪亭日暮，沉醉不知归路。兴尽晚回舟，误入藕花深处。争渡，争渡，惊起一滩鸥鹭。'],
  ['辛弃疾《西江月·明月别枝惊鹊》', '西江月', '明月别枝惊鹊，清风半夜鸣蝉。稻花香里说丰年，听取蛙声一片。\n\n七八个星天外，两三点雨山前。旧时茅店社林边，路转溪桥忽见。'],
  ['李煜《虞美人·春花秋月何时了》', '虞美人', '春花秋月何时了？往事知多少。小楼昨夜又东风，故国不堪回首月明中。\n\n雕栏玉砌应犹在，只是朱颜改。问君能有几多愁？恰似一江春水向东流。'],
  ['温庭筠《菩萨蛮·小山重叠金明灭》', '菩萨蛮', '小山重叠金明灭，鬓云欲度香腮雪。懒起画蛾眉，弄妆梳洗迟。\n\n照花前后镜，花面交相映。新帖绣罗襦，双双金鹧鸪。'],
  ['苏轼《水调歌头·明月几时有》', '水调歌头', '明月几时有？把酒问青天。不知天上宫阙，今夕是何年。我欲乘风归去，又恐琼楼玉宇，高处不胜寒。起舞弄清影，何似在人间。\n\n转朱阁，低绮户，照无眠。不应有恨，何事长向别时圆？人有悲欢离合，月有阴晴圆缺，此事古难全。但愿人长久，千里共婵娟。'],
  ['岳飞《满江红·怒发冲冠》', '满江红', '怒发冲冠，凭栏处、潇潇雨歇。抬望眼、仰天长啸，壮怀激烈。三十功名尘与土，八千里路云和月。莫等闲、白了少年头，空悲切。\n\n靖康耻，犹未雪。臣子恨，何时灭。驾长车，踏破贺兰山缺。壮志饥餐胡虏肉，笑谈渴饮匈奴血。待从头、收拾旧山河，朝天阙。'],
  ['马致远《天净沙·秋思》', '天净沙', '枯藤老树昏鸦，小桥流水人家，古道西风瘦马。夕阳西下，断肠人在天涯。'],
];

for (const [title, form, text] of classics) {
  test(`${title}合古韵`, () => {
    const report = checkPoem({ form, text, rhymebook: 'guyun' });
    assert.equal(report.stats.errors, 0, JSON.stringify(report.issues));
    assert.equal(report.complete, true);
    assert.ok(report.rhymes.length > 0);
    assert.ok(report.rhymes.every(rhyme => rhyme.ok && rhyme.name));
  });
}

test('杜牧《赤壁》古韵零错误、零提醒', () => {
  const report = checkPoem({ form: '七绝', text: redCliff, rhymebook: 'guyun' });
  assert.equal(report.complete, true);
  assert.deepEqual(report.issues, []);
  assert.equal(report.rhymes[0].name, '二萧');
});

test('杜甫《登高》的出律限于首句「猿」', () => {
  const text = '风急天高猿啸哀，渚清沙白鸟飞回。无边落木萧萧下，不尽长江滚滚来。万里悲秋常作客，百年多病独登台。艰难苦恨繁霜鬓，潦倒新停浊酒杯。';
  const report = checkPoem({ form: '七律', text, rhymebook: 'guyun' });
  // 「天高猿啸哀」为平平平仄平，五字末段不符合正格或孤平拗救。
  assert.ok(report.stats.errors <= 1, JSON.stringify(report.issues));
  for (const error of report.issues.filter(issue => issue.level === 'error')) {
    assert.deepEqual([error.code, error.ju, error.pos], ['tone', 0, 4]);
    assert.match(error.message, /第1句第5字「猿」/u);
  }
  assert.ok(report.complete);
  assert.ok(report.rhymes.every(rhyme => rhyme.ok));
});

test('《登鹳雀楼》用中华新韵时「一层楼」三平尾', () => {
  const report = checkPoem({ form: '五绝', text: tower, rhymebook: 'xinyun' });
  const [issue] = report.issues;
  assert.deepEqual([issue.level, issue.code, issue.ju, issue.pos], ['error', 'sanping', 3, 2]);
  assert.match(issue.message, /第4句.*一层楼.*第3字「一」/u);
  assert.equal(report.ju[3].cells[2].ok, false);
});


// 校验与报告
const towerLines = ['白日依山尽', '黄河入海流', '欲穷千里目', '更上一层楼'];
function five(ju, options = {}) {
  return checkPoem({ form: '五绝', rhymebook: 'guyun', variant: 3, ju, ...options });
}

test('splitPoem 记录中英文标点、换行和阕界', () => {
  const result = splitPoem('  上， 下; 东！？\r\n \r\n 国\n 夜。  ');
  assert.deepEqual(result, {
    ju: [
      { text: '上', punct: '，' }, { text: '下', punct: ';' }, { text: '东', punct: '！？' },
      { text: '国', punct: '\n' }, { text: '夜', punct: '。' },
    ],
    stanzaBreaks: [3],
  });
});

test('全文按谱字数切句并保留句末原标点', () => {
  const report = checkPoem({ form: '五绝', text: '白日依，山尽黄河入海流；欲穷千里目！更上一层楼' });
  assert.equal(report.ok, true);
  assert.deepEqual(report.ju.map(line => line.text), towerLines);
  assert.deepEqual(report.ju.map(line => line.punct), ['', '；', '！', '']);
  assert.deepEqual(report.ju.map(line => line.stanzaEnd), [false, false, false, true]);
});

test('总字数不合时按原文句读指出长短，ju 输入始终按下标对位', () => {
  const report = checkPoem({ form: '五绝', text: '白日依山，黄河入海流。欲穷千里目，更上一层楼。' });
  const length = report.issues.find(issue => issue.code === 'length');
  assert.deepEqual([length.level, length.ju, length.message], ['error', 0, '第1句应5字，实为4字']);
  assert.equal(report.complete, false);

  const ju = five(['白日依', '山尽黄河入海流', ...towerLines.slice(2)]);
  assert.equal(ju.ok, false);
  assert.deepEqual(ju.issues.filter(issue => issue.code === 'length').map(issue => issue.ju), [0, 1]);
});

test('自动择体优先总字数，并列取较小下标，可固定变体', () => {
  const exact = checkPoem({ form: '浣溪沙', text: '东'.repeat(44) });
  assert.equal(exact.variant.index, 2);
  assert.equal(exact.issues.some(issue => issue.code === 'length'), false);
  const fixed = checkPoem({ form: '浣溪沙', text: '东'.repeat(44), variant: 0 });
  assert.equal(fixed.variant.index, 0);
  assert.ok(fixed.issues.some(issue => issue.code === 'length'));
  const tie = checkPoem({ form: '七律', ju: [], partial: true });
  assert.equal(tie.variant.index, 0);
  assert.equal(tie.complete, false);
});

test('partial 校验已填的位置，保留空格，截断超长并提醒', () => {
  const report = five(['白□依山尽超', '黄河', ''], { partial: true });
  assert.equal(report.ok, true);
  assert.equal(report.complete, false);
  assert.deepEqual(report.issues.map(issue => [issue.level, issue.code, issue.ju, issue.pos]), [['warn', 'length', 0, 5]]);
  assert.deepEqual(report.ju[0].cells[1], { char: null, want: '仄', got: [], ok: null, known: false });
  assert.equal(report.ju[0].cells[2].char, '依');
  assert.equal(report.ju[1].cells.at(-1).char, null);
  assert.equal(report.rhymes[0].members[0].char, null);
  const bad = five(['白山'], { partial: true });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.issues.map(issue => [issue.code, issue.ju, issue.pos]), [['tone', 0, 1]]);
});

test('孤平、本句拗救、三仄尾和特拗', () => {
  const lone = five([towerLines[0], '海河入海流', ...towerLines.slice(2)]);
  assert.equal(lone.stats.errors, 1);
  assert.deepEqual([lone.issues[0].code, lone.issues[0].ju, lone.issues[0].pos], ['guping', 1, 0]);
  assert.equal(lone.ju[1].cells[0].ok, false);
  const rescued = five([towerLines[0], '海河登海流', ...towerLines.slice(2)]);
  assert.equal(rescued.ok, true);
  assert.equal(rescued.ju[1].cells[2].ok, true);
  const unfilled = five([towerLines[0], '□河登海流'], { partial: true });
  assert.equal(unfilled.ok, true);

  const triple = five([...towerLines.slice(0, 2), '欲穷万里目', towerLines[3]]);
  assert.deepEqual(triple.issues.map(issue => [issue.level, issue.code]), [['warn', 'sanze']]);
  const special = five([...towerLines.slice(0, 2), '闲云入秋暮', towerLines[3]]);
  assert.deepEqual(special.issues, []);
  assert.equal(special.ju[2].cells[3].ok, true);
});

test('近体诗辨别出韵、借邻韵、韵脚平仄和重韵', () => {
  const ju = ['小径晓来冬', '晴川宿雨东', '闲云低野岸', '暮鼓入长风'];
  const check = lines => five(lines, { variant: 2 });
  const borrowed = check(ju);
  assert.deepEqual(borrowed.issues.map(issue => [issue.level, issue.code, issue.ju]), [['warn', 'neighbor-rhyme', 0]]);
  assert.equal(borrowed.rhymes[0].name, '一东');
  assert.equal(borrowed.ju[0].cells.at(-1).ok, true);

  const off = check([...ju.slice(0, 3), '暮鼓入长庚']);
  const rhyme = off.issues.find(issue => issue.code === 'rhyme');
  assert.deepEqual([rhyme.level, rhyme.ju, rhyme.pos], ['error', 3, 4]);
  assert.match(rhyme.message, /「庚」属八庚.*第2句「东」.*一东/u);
  assert.equal(off.ju[3].cells.at(-1).ok, false);

  const oblique = check([...ju.slice(0, 3), '暮鼓入长雪']);
  assert.match(oblique.issues.find(issue => issue.code === 'rhyme').message, /「雪」应押平声韵，实为仄/u);
  const repeated = check([...ju.slice(0, 3), '暮鼓入长东']);
  assert.ok(repeated.issues.some(issue => issue.code === 'repeat-rhyme' && issue.level === 'warn'));
});

test('多音字任一读音合平仄或押韵即通过', () => {
  const report = five(['客行依山尽', '晴川宿雨光', towerLines[2], '暮鼓入长行']);
  assert.deepEqual(report.issues, []);
  assert.equal(report.ju[0].cells[1].ok, true);
  assert.equal(report.ju[3].cells[4].ok, true);
  assert.equal(report.rhymes[0].name, '七阳');
});

test('词按韵组报出韵，叶韵另标声调并与本韵同部', () => {
  const changed = checkPoem({
    form: '菩萨蛮', variant: 0,
    text: '小山重叠金明灭，鬓云欲度香腮雨。懒起画蛾眉，弄妆梳洗迟。照花前后镜，花面交相映。新帖绣罗襦，双双金鹧鸪。',
  });
  assert.deepEqual(changed.issues.map(issue => [issue.code, issue.ju, issue.pos]), [['rhyme', 1, 6]]);
  assert.deepEqual(changed.rhymes.map(rhyme => [rhyme.group, rhyme.tone, rhyme.ok]),
    [[1, '仄', false], [2, '平', true], [3, '仄', true], [4, '平', true]]);

  const sky = '枯藤老树昏鸦，小桥流水人家，古道西风瘦马。夕阳西下，断肠人在天涯。';
  const leaves = checkPoem({ form: '天净沙', text: sky });
  assert.deepEqual(leaves.ju.map(line => line.rhymeGroup), [1, 1, 2, 2, 1]);
  assert.deepEqual(leaves.rhymes.map(rhyme => [rhyme.tone, rhyme.name]), [['平', '第十部'], ['仄', '第十部']]);
  const off = checkPoem({ form: '天净沙', text: sky.replace('瘦马', '瘦鸟'), variant: 1 });
  assert.deepEqual(off.issues.map(issue => [issue.code, issue.ju]), [['rhyme', 2]]);
});

test('古韵词组可在平水韵内通押，支持逐字反馈并保持声调校验', () => {
  const options = { form: '浣溪沙', rhymebook: 'guyun', variant: 0 };
  const report = checkPoem({ ...options, text: yanHuan });
  const [group] = report.rhymes;
  assert.deepEqual([group.name, group.ok], ['十灰', true]);
  assert.deepEqual(report.issues.map(({ level, code, ju, pos }) => [level, code, ju, pos]),
    [['warn', 'neighbor-rhyme', 0, 6]]);
  assert.match(report.issues[0].message, /依平水韵十灰通押/u);
  assert.equal(group.members.length, 5);
  assert.ok(group.members.every(({ ju, rhymes }) => rhymes.includes('十灰') && report.ju[ju].cells.at(-1).ok));

  const off = checkPoem({ ...options, text: yanHuan.replace('旧亭台', '旧亭堂') });
  assert.equal(off.rhymes[0].ok, false);
  assert.ok(off.issues.some(issue => issue.code === 'rhyme' && issue.ju === 1 && issue.pos === 6));
  const wrongTone = checkPoem({ ...options, text: yanHuan.replace('旧亭台', '旧亭海') });
  assert.equal(wrongTone.rhymes[0].ok, false);
  assert.match(wrongTone.issues.find(issue => issue.code === 'rhyme').message, /「海」应押平声韵，实为仄/u);
  const modern = checkPoem({ ...options, text: yanHuan, rhymebook: 'xinyun' });
  assert.ok(modern.issues.some(issue => issue.code === 'rhyme'));
  assert.ok(modern.rhymes.every(group => group.name !== '十灰'));
});

test('词的平水韵通押同时保留叶韵同部约束', () => {
  const ju = ['明月别枝惊鹊', '清风半夜衔杯', '稻花香里望高台', '听取蛙声不悔',
    '七八个星天外', '两三点雨方回', '旧时茅店远归来', '路转溪桥看海'];
  const options = { form: '西江月', rhymebook: 'guyun', variant: 0 };
  const report = checkPoem({ ...options, ju });
  assert.equal(report.ok, true);
  assert.deepEqual(report.rhymes.map(({ tone, name, ok }) => [tone, name, ok]),
    [['平', '十灰', true], ['仄', '十贿', true]]);
  const off = checkPoem({ ...options, ju: [...ju.slice(0, -1), '路转溪桥听曲'] });
  assert.deepEqual(off.rhymes.map(group => group.ok), [true, false]);
  assert.deepEqual(off.issues.filter(issue => issue.level === 'error').map(({ code, ju, pos }) => [code, ju, pos]),
    [['rhyme', 7, 5]]);
});

test('钦定词谱的叠句按全文比对并与上一韵脚同组', () => {
  const ju = ['常记溪亭日暮', '沉醉不知归路', '兴尽晚回舟', '误入藕花深处', '争渡', '轻渡', '惊起一滩鸥鹭'];
  const report = checkPoem({ form: '如梦令', ju, variant: 0 });
  const die = report.issues.find(issue => issue.code === 'die');
  assert.deepEqual([die.level, die.ju, die.pos], ['warn', 5, 0]);
  assert.match(die.message, /第6句「轻渡」.*第5句「争渡」/u);
  assert.equal(report.ju[4].rhymeGroup, report.ju[5].rhymeGroup);
  assert.equal(report.issues.some(issue => issue.code === 'repeat-rhyme'), false);
});

test('自由体保留输入和阕界，仅提醒未收字', () => {
  const report = checkPoem({ form: '自题', rhymebook: 'xinyun', text: '秋水𠮷，东风。\n\n归。' });
  assert.deepEqual(report.form, { id: '自题', name: '自题', kind: 'free' });
  assert.equal(report.variant, null);
  assert.deepEqual(report.rhymes, []);
  assert.deepEqual(report.ju.map(line => line.stanzaEnd), [false, true, true]);
  assert.ok(report.ju.every(line => line.cells.every(cell => cell.want === '中' && cell.ok === null)));
  assert.equal(report.ok, true);
  assert.equal(report.complete, true);
  assert.deepEqual(report.issues.map(issue => [issue.level, issue.code, issue.ju, issue.pos]), [['warn', 'unknown-char', 0, 2]]);
});


// 韵书与词谱
test('韵书按古入声、新平声和多音字区分读音', () => {
  assert.deepEqual(RHYMEBOOKS.map(({ id }) => id), ['xinyun', 'guyun']);
  for (const char of ['白', '国', '一']) {
    const ancient = charInfo(char, 'guyun');
    assert.equal(ancient.known, true);
    assert.deepEqual(ancient.tones, ['仄']);
    assert.ok(ancient.readings.every(reading => reading.sheng === '入'));
    const modern = charInfo(char, 'xinyun');
    assert.equal(modern.known, true);
    assert.deepEqual(modern.tones, ['平']);
    assert.ok(modern.readings.every(reading => reading.pinyin));
  }
  assert.deepEqual(charInfo('行', 'xinyun').tones, ['平', '仄']);
  assert.deepEqual(charInfo('行', 'guyun').tones, ['平', '仄']);
  assert.deepEqual(charInfo('白', 'guyun', 'ci').readings,
    [{ tone: '仄', sheng: '入', rhyme: '第十七部' }]);
  assert.deepEqual(charInfo('國', 'guyun').readings, charInfo('国', 'guyun').readings);
  assert.deepEqual(charInfo('雨', 'guyun', 'ci').readings.map(({ sheng, rhyme }) => [sheng, rhyme]),
    [['上', '第四部'], ['去', '第四部']]);
  assert.deepEqual(charInfo('眚', 'guyun', 'ci').readings.map(({ sheng, rhyme }) => [sheng, rhyme]),
    [['上', '第十一部'], ['去', '第十一部']]);
  assert.deepEqual(charInfo('菑', 'guyun', 'ci').readings.map(({ rhyme }) => rhyme), ['第三部', '第五部']);
});

test('反查三张韵表，按韵部与平仄合并并依韵书次序列出', () => {
  assert.equal(bookName('xinyun', 'ci'), '中华新韵');
  assert.equal(bookName('guyun', 'free'), '平水韵');
  assert.equal(bookName('guyun', 'ci'), '词林正韵');

  const pingshui = listRhymes('guyun');
  assert.equal(pingshui.length, 106);
  assert.deepEqual(pingshui.slice(30, 34).map(({ name }) => name), ['一董', '二肿', '三讲', '四纸']);
  assert.deepEqual(pingshui.filter(({ name }) => name === '七阳'),
    [{ name: '七阳', tone: '平', sheng: ['平'], chars: 273, common: 145 }]);
  const yang = rhymeChars('七阳', 'guyun', 'free');
  assert.equal(yang.length, 1);
  assert.equal(yang[0].tone, '平');
  assert.ok(yang[0].common.includes('阳'));
  assert.deepEqual(rhymeChars('七阳', 'guyun', 'shi', '仄'), []);
  assert.deepEqual(rhymeChars('无此韵', 'guyun'), []);
  // 入声韵带不带「入声」前缀都查得到
  assert.deepEqual(rhymeChars('十一陌', 'guyun'), rhymeChars('入声十一陌', 'guyun'));
  assert.ok(rhymeChars('十一陌', 'guyun')[0].common.includes('白'));

  const xinyun = listRhymes('xinyun');
  assert.equal(xinyun.length, 28);
  assert.deepEqual(xinyun.filter(({ name }) => name === '八寒').map(({ tone, sheng }) => [tone, sheng]),
    [['平', ['阴平', '阳平']], ['仄', ['上', '去']]]);
  const cilin = listRhymes('guyun', 'ci');
  assert.equal(cilin.length, 33);
  assert.deepEqual(cilin.slice(-5).map(({ tone, sheng }) => [tone, sheng]), Array(5).fill(['仄', ['入']]));
  assert.deepEqual(rhymeChars('第十七部', 'guyun', 'ci').map(({ tone }) => tone), ['仄']);
});

test('同韵字去重，一级字按字表次序，繁体和僻字按码位归入 rare', () => {
  const table = JSON.parse(readFileSync(new URL('../../data/common.json', import.meta.url), 'utf8'));
  assert.equal(new Set(table).size, 3755);
  assert.ok(table.includes('乾'));
  const [{ common, rare }, oblique] = rhymeChars('八寒', 'xinyun');
  assert.equal(oblique.tone, '仄');
  assert.ok(common.includes('干'));
  assert.ok(!common.includes('乾'));
  assert.equal([...rare].filter(char => char === '乾').length, 1);
  assert.equal(common, [...table].filter(char => common.includes(char)).join(''));
  assert.deepEqual([...rare], [...new Set(rare)].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)));
});

test('古韵补字含三讲、上去多读和入声，词林沿用原表归部', () => {
  const readings = [
    ['溪', '平', '平', '八齐', '第三部'],
    ['啼', '平', '平', '八齐', '第三部'],
    ['炉', '平', '平', '七虞', '第四部'],
    ['沉', '平', '平', '十二侵', '第十三部'],
    ['讲', '仄', '上', '三讲', '第二部'],
    ['迹', '仄', '入', '入声十一陌', '第十七部'],
    ['桌', '仄', '入', '入声三觉', '第十六部'],
  ];
  for (const [char, tone, sheng, rhyme, part] of readings) {
    for (const [kind, name] of [['shi', rhyme], ['ci', part]]) {
      assert.deepEqual(charInfo(char, 'guyun', kind),
        { char, known: true, tones: [tone], readings: [{ tone, sheng, rhyme: name }] });
    }
  }
  assert.deepEqual(charInfo('扫', 'guyun').readings.map(({ sheng, rhyme }) => [sheng, rhyme]),
    [['上', '十九皓'], ['去', '二十号']]);
  assert.deepEqual(charInfo('桔', 'guyun', 'ci').readings.map(({ rhyme }) => rhyme), ['第十七部', '第十八部']);
});

test('新韵区分翘舌支韵、ü 韵和其余零声母韵母', () => {
  const chars = {
    花: '一麻', 窝: '二波', 月: '三皆', 外: '四开', 危: '五微', 腰: '六豪',
    优: '七尤', 圆: '八寒', 犬: '八寒', 云: '九文', 军: '九文', 王: '十唐', 翁: '十一庚',
    儿: '十二齐', 鱼: '十二齐', 居: '十二齐', 资: '十三支', 知: '十三支', 乌: '十四姑',
  };
  for (const [char, rhyme] of Object.entries(chars)) {
    assert.equal(charInfo(char, 'xinyun').readings[0].rhyme, rhyme, char);
  }
});

test('古韵缺字的现代读音只提供参考', () => {
  const info = charInfo('堃', 'guyun');
  assert.equal(info.known, false);
  assert.deepEqual(info.tones, ['平']);
  assert.ok(info.readings.every(reading => reading.rhyme === ''));
  const report = checkPoem({
    form: '五绝', rhymebook: 'guyun', variant: 3, ju: ['白堃依山尽'], partial: true,
  });
  assert.deepEqual(report.issues.map(issue => [issue.level, issue.pos, issue.code]), [['warn', 1, 'unknown-char']]);
  assert.match(report.issues[0].message, /第1句第2字「堃」.*普通话声调可作平/u);
});

test('resolveForm 支持诗体全称、书名号、副题、词牌后缀和别名', () => {
  const names = {
    '  七言绝句  ': 'qijue', 五言律诗: 'wulv', '《浣溪沙·游蕲水清泉寺》': '浣溪沙',
    ' 《 望江南（词）·梳洗罢 》 ': '忆江南', '《江南好》词牌': '忆江南',
    '梦江南词牌名': '忆江南', '调笑令(词)': '古调笑', '酹江月': '念奴娇',
    大江东去: '念奴娇', 鹊踏枝: '蝶恋花', 凤栖梧: '蝶恋花', 丑奴儿: '采桑子',
    秦楼月: '忆秦娥', 江神子: '江城子', 金缕曲: '贺新郎',
    玉楼春: '玉楼春', 木兰花令: '木兰花令', 木兰花: '木兰花令',
    浪淘沙: '浪淘沙', 浪淘沙令: '浪淘沙令', 塞上秋: '天净沙',
  };
  for (const [name, expected] of Object.entries(names)) assert.equal(resolveForm(name)?.id, expected, name);
  assert.equal(resolveForm('未知曲目'), null);
  assert.equal(resolveForm('清平调辞'), null);
});

test('浪淘沙和木兰花令保留各自正谱，自动校验可按字数识别通名', () => {
  const short = checkPoem({ form: '浪淘沙', text: '九曲黄河万里沙，浪淘风簸自天涯。如今直上银河去，同到牵牛织女家。' });
  assert.equal(short.form.id, '浪淘沙');
  const long = checkPoem({
    form: '浪淘沙',
    text: '帘外雨潺潺，春意阑珊。罗衾不耐五更寒。梦里不知身是客，一晌贪欢。独自莫凭栏，无限江山。别时容易见时难。流水落花春去也，天上人间。',
  });
  assert.equal(long.form.id, '浪淘沙令');
  assert.ok(long.ok);
  const yulou = checkPoem({ form: '木兰花', text: '东'.repeat(56) });
  assert.equal(yulou.form.id, '玉楼春');
});

test('目录保留全部可用词谱和常用体裁，抽样不重复且兼含诗词', () => {
  const shi = listForms({ kind: 'shi' });
  const ci = listForms({ kind: 'ci' });
  assert.deepEqual(shi.map(form => [form.id, form.chars]), [['wujue', 20], ['qijue', 28], ['wulv', 40], ['qilv', 56]]);
  assert.equal(ci.length, 817);
  assert.equal(ci.reduce((total, { id }) => total + resolveForm(id).variants.length, 0), 2475);
  assert.equal(listForms({ commonOnly: true }).length, 44);
  for (const n of [2, 4, 8, 100]) {
    const picked = sampleForms(n, () => 0.42);
    assert.equal(picked.length, Math.min(n, 44));
    assert.equal(new Set(picked.map(form => form.id)).size, picked.length);
    assert.deepEqual(new Set(picked.map(form => form.kind)), new Set(['shi', 'ci']));
    assert.ok(picked.every(form => form.common));
  }
  assert.equal(sampleForms(1, () => 0.8).length, 1);
  assert.deepEqual(sampleForms(0), []);
});

test('正体和变体保留词谱注明的阕界，读是独立句位', () => {
  const huan = resolveForm('浣溪沙');
  assert.equal(huan.variants[0].label, '正体 · 韩偓');
  assert.equal(huan.variants[1].label, '变体二 · 薛昭蕴');
  const man = resolveForm('满江红').variants[0];
  assert.ok(man.ju.some(line => line.end === '读'));
  let cursor = 0;
  const breaks = man.ju.flatMap(line => {
    cursor += line.tones.length;
    return line.stanzaEnd ? [cursor] : [];
  });
  assert.deepEqual(breaks, [47, 93]);
});

