const numbers = '零一二三四五六七八九十';

// The final character identifies the Pingshui group. Groups divided in
// Cilin (for example 十灰) occur in each applicable part.
export const cilinParts = [
  '东冬董肿送宋', '江阳讲养绛漾', '支微齐灰纸尾荠贿寘未霁泰队', '鱼虞语麌御遇',
  '佳灰蟹贿泰卦队', '真文元轸吻阮震问愿', '元寒删先阮旱潸铣愿翰谏霰', '萧肴豪筱巧皓啸效号',
  '歌哿个', '佳麻马卦祃', '庚青蒸梗迥敬径', '尤有宥', '侵寝沁', '覃盐咸感琰豏勘艳陷',
  '屋沃', '觉药', '质陌锡职缉', '物月曷黠屑叶', '合洽',
].map((groups, i) => {
  const number = i + 1;
  const name = `第${number <= 10 ? numbers[number] : '十' + numbers[number - 10]}部`;
  return { name, groups };
});

export function partsForPingshui(rhyme) {
  return cilinParts.filter(({ groups }) => groups.includes(rhyme.at(-1))).map(({ name }) => name);
}
