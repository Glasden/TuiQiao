import { partsForPingshui } from './cilin-parts.js';
import { charInfo } from './data.js';
import { linkedRhymeGroups } from './forms.js';

const neighbors = ['东冬', '江阳', '讲养', '支微齐', '鱼虞', '佳灰', '真文元', '寒删先', '萧肴豪', '庚青蒸', '覃盐咸'];
function neighbor(a, b) {
  return neighbors.some(group => group.includes(a.at(-1)) && group.includes(b.at(-1)));
}

function chooseRhyme(members, opening, allowNeighbor) {
  if (!members.length) return opening?.rhymes[0] ?? null;
  let winner = null;
  let best = -1;
  const names = new Set(members.flatMap(member => member.rhymes));
  for (const name of names) {
    const score = members.filter(member => member.rhymes.includes(name)).length;
    const openingFits = opening?.rhymes.includes(name) || (allowNeighbor && opening?.rhymes.some(rhyme => neighbor(name, rhyme)));
    const points = score * 2 + (openingFits ? 1 : 0);
    if (points <= best) continue;
    best = points;
    winner = name;
  }
  return winner;
}

function sharedRhymes(lists) {
  return [...new Set(lists[0])].filter(name => lists.every(list => list.includes(name)));
}

function pingshuiMatch(candidates, chosen) {
  const byGroup = new Map();
  for (const member of candidates) {
    if (!byGroup.has(member.group)) byGroup.set(member.group, []);
    byGroup.get(member.group).push(member);
  }
  const options = Array.from(byGroup, ([group, members]) => {
    const pingshui = sharedRhymes(members.map(({ char, tone }) => charInfo(char, 'guyun', 'shi').readings
      .filter(reading => reading.tone === tone && reading.rhyme)
      .map(reading => reading.rhyme)));
    return { group, pingshui, cilin: sharedRhymes(members.map(member => member.rhymes)) };
  });
  if (options.length === 1) {
    const [{ group, pingshui }] = options;
    return pingshui.length ? { part: null, groups: new Map([[group, pingshui[0]]]) } : null;
  }

  // 叶 and its regular group use opposite tones. They still have to share a
  // Cilin part, which can be one of the parts of a common Pingshui rhyme.
  const partsByGroup = options.map(({ group, pingshui, cilin }) => {
    const parts = new Map(cilin.map(part => [part, null]));
    for (const name of pingshui) {
      for (const part of partsForPingshui(name)) {
        if (!parts.has(part)) parts.set(part, name);
      }
    }
    return { group, parts };
  });
  // Keep valid groups when another group has a faulty 叶 reading. Optimize
  // the number of matching feet, just as for the ordinary Cilin choice.
  const parts = new Set([chosen, ...candidates.flatMap(member => member.rhymes),
    ...partsByGroup.flatMap(({ parts }) => [...parts.keys()])]);
  let best = null;
  let bestCount = candidates.filter(member => member.rhymes.includes(chosen)).length;
  for (const part of parts) {
    const groups = new Map(partsByGroup.flatMap(({ group, parts }) =>
      parts.get(part) ? [[group, parts.get(part)]] : []));
    if (!groups.size) continue;
    const count = candidates.filter(member => groups.has(member.group) || member.rhymes.includes(part)).length;
    if (count > bestCount || (count === bestCount && best && groups.size < best.groups.size)) {
      best = { part, groups };
      bestCount = count;
    }
  }
  return best;
}

function checkRepeat(group, member, issue) {
  if (member.end === '叠' || !member.rhymes.length) return;
  const previous = group.members.find(other => other.ju < member.ju && other.char === member.char && other.rhymes.length);
  if (previous) {
    issue('warn', 'repeat-rhyme', member.ju, member.pos,
      `第${member.ju + 1}句韵脚「${member.char}」与第${previous.ju + 1}句重复`);
  }
}

function checkDie(lines, index, issue) {
  const previous = lines[index - 1];
  if (!previous) return;
  const line = lines[index];
  const pos = line.cells.findIndex(({ char }, i) => char && previous.cells[i]?.char && char !== previous.cells[i].char);
  const filled = [line, previous].every(row => row.cells.every(cell => cell.char));
  if (pos === -1 && (!filled || line.text === previous.text)) return;
  issue('warn', 'die', index, pos === -1 ? null : pos,
    `第${index + 1}句「${line.text}」应重叠第${index}句「${previous.text}」`);
}

export function checkRhymes(lines, infos, variant, kind, rhymebook, issue) {
  const groups = new Map();
  const families = new Map();
  const links = linkedRhymeGroups(variant);
  for (const [index, pattern] of variant.ju.entries()) {
    if (!pattern.rhyme) continue;
    if (pattern.end === '叠') checkDie(lines, index, issue);
    const { rhymeGroup: number, rhymeTone: tone } = pattern;
    if (!groups.has(number)) groups.set(number, { group: number, tone, name: null, ok: true, members: [] });
    const pos = pattern.tones.length - 1;
    const { char } = lines[index].cells[pos];
    const info = infos[index][pos];
    const rhymes = info?.known
      ? [...new Set(info.readings.filter(reading => reading.tone === tone).map(reading => reading.rhyme))]
      : [];
    const member = { ju: index, char, rhymes, pos, info, end: pattern.end, group: number, tone };
    groups.get(number).members.push(member);
    const family = links.get(number) ?? number;
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(member);
  }
  for (const [family, members] of families) {
    const valid = members.filter(member => member.rhymes.length);
    const opening = kind === 'shi' && valid[0]?.ju === 0 ? valid.shift() : null;
    const allowNeighbor = rhymebook === 'guyun' && kind === 'shi';
    // Prefer a regular rhyme over 叶 when their coverage is tied.
    const candidates = [...valid.filter(member => member.group === family), ...valid.filter(member => member.group !== family)];
    const chosen = chooseRhyme(candidates, opening, allowNeighbor);
    const fallback = kind === 'ci' && rhymebook === 'guyun' && candidates.some(member => !member.rhymes.includes(chosen))
      ? pingshuiMatch(candidates, chosen) : null;
    const part = fallback ? fallback.part : chosen;
    const anchor = candidates.find(member => member.rhymes.includes(part) || fallback?.groups.has(member.group));
    if (fallback) {
      for (const [number, name] of fallback.groups) {
        if (groups.get(number).members.some(member => member.info?.known && !member.rhymes.length)) continue;
        const first = candidates.find(member => member.group === number);
        issue('warn', 'neighbor-rhyme', first.ju, first.pos,
          `第${first.ju + 1}句第${first.pos + 1}字韵脚「${first.char}」所在韵组依平水韵${name}通押`);
      }
    }
    for (const member of members) {
      const { ju, pos, char, info, rhymes } = member;
      const group = groups.get(member.group);
      const pingshui = fallback?.groups.get(member.group);
      const name = pingshui ?? part;
      group.name = name;
      checkRepeat(group, member, issue);
      if (!info?.known) continue;
      const cell = lines[ju].cells[pos];
      const label = `第${ju + 1}句第${pos + 1}字韵脚「${char}」`;
      if (!rhymes.length) {
        issue('error', 'rhyme', ju, pos, `${label}应押${group.tone}声韵，实为${info.tones.join('或')}`);
      } else if (pingshui || rhymes.includes(name)) {
        if (pingshui) rhymes.push(pingshui);
        cell.ok = true;
        continue;
      } else if (member === opening && allowNeighbor && rhymes.some(rhyme => neighbor(name, rhyme))) {
        issue('warn', 'neighbor-rhyme', ju, pos, `${label}借邻韵${rhymes.find(rhyme => neighbor(name, rhyme))}，本篇押${name}`);
        cell.ok = true;
        continue;
      } else {
        issue('error', 'rhyme', ju, pos, `${label}属${rhymes.join('或')}，应与第${anchor.ju + 1}句「${anchor.char}」同押${name}`);
      }
      group.ok = cell.ok = false;
    }
  }
  return [...groups.values()].map(({ group, tone, name, ok, members }) => ({
    group, tone, name, ok, members: members.map(({ ju, char, rhymes }) => ({ ju, char, rhymes })),
  }));
}
