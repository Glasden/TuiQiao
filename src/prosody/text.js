export function splitPoem(text) {
  const source = String(text ?? '').replace(/\r\n?/gu, '\n').trim();
  const ju = [];
  const stanzaBreaks = [];
  let start = 0;
  for (const match of source.matchAll(/(?:[，。、；：！？,.;:!?\n][^\S\n]*)+/gu)) {
    const line = source.slice(start, match.index).trim();
    start = match.index + match[0].length;
    if (!line) continue;
    const punct = match[0].replace(/\s/gu, '') || '\n';
    ju.push({ text: line, punct });
    if (/\n[^\S\n]*\n/u.test(match[0]) && start < source.length) stanzaBreaks.push(ju.length);
  }
  if (start < source.length) ju.push({ text: source.slice(start).trim(), punct: '' });
  return { ju, stanzaBreaks };
}

export function poemInput(text, ju, free) {
  if (ju !== undefined) {
    const lines = Array.from(ju, line => ({ chars: Array.from(String(line ?? '').replace(/\s/gu, '')), punct: '' }));
    return { lines, stanzaBreaks: [], chars: lines.flatMap(line => line.chars), byText: false };
  }
  const split = splitPoem(text);
  const glyph = free ? /\S/gu : /[\p{Script=Han}□]/gu;
  const lines = split.ju.map(({ text, punct }) => ({ chars: text.match(glyph) ?? [], punct }));
  return { lines, stanzaBreaks: split.stanzaBreaks, chars: lines.flatMap(line => line.chars), byText: true };
}

export function alignText(input, patterns) {
  const punctuation = new Map();
  let position = 0;
  for (const { chars, punct } of input.lines) {
    position += chars.length;
    if (chars.length && punct) punctuation.set(position, punct);
  }
  position = 0;
  return patterns.map(({ tones }) => {
    const chars = input.chars.slice(position, position + tones.length);
    position += tones.length;
    return { chars, punct: punctuation.get(position) ?? '' };
  });
}
