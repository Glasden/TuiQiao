// 推敲 · 网页端。无框架、无构建：一个模块管路由、渲染与逐格输入。
const app = document.getElementById('app');
const gid = (location.pathname.match(/^\/g\/([a-z0-9]+)/i) || [])[1] || null;

const S = {
  view: null,
  inputs: new Map(),   // 'j.i' → 玩家所填；本地为准，服务端的 input 只在初次载入与换档时采用
  stale: new Set(),    // 上次「试」之后又改过的格，其反馈作废
  text: '',            // 自由体的草稿
  cur: null,           // 最近聚焦的格
  composing: false,
  dirty: false,
  saveTimer: 0,
  liveSeq: 0,
  pollTimer: 0,
  pollUntil: 0,
};

const NUM = '〇一二三四五六七八九十';
const cn = (n) => (n <= 10 ? NUM[n] : n < 20 ? '十' + NUM[n - 10] : NUM[Math.floor(n / 10)] + '十' + (n % 10 ? NUM[n % 10] : ''));
const isHan = (c) => /\p{Script=Han}/u.test(c);
const paras = (s) => String(s || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
const MODE = {
  zi: { name: '填字', rank: '入门', desc: (n) => '原作缺' + cn(n) + '字，据故事补全' },
  ju: { name: '补句', rank: '登堂', desc: (n) => '原作佚' + cn(n) + '句，凭上下文续成' },
  fu: { name: '自赋', rank: '入室', desc: (n, v) => '只凭故事，依' + v.form.name + '之律自作一首' },
};
const STATUS = { new: '未启封', playing: '推敲中', submitted: '已交卷', revealed: '已揭晓' };
const PU = { 平: 'ping', 仄: 'ze', 中: 'zhong' };

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON 的错误页 */ }
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || '请求未成（' + res.status + '）');
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer = 0;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), 2800);
}

// ── 状态 ──────────────────────────────────────────────

const board = () => S.view?.play?.board || null;
function eachCell(fn) {
  const b = board();
  if (!b) return;
  b.ju.forEach((ju, j) => ju.cells.forEach((c, i) => fn(c, j + '.' + i, j, i)));
}
function blankKeys() {
  const keys = [];
  eachCell((c, k) => { if (c.kind === 'blank') keys.push(k); });
  return keys;
}
function cellsPayload() {
  const out = {};
  for (const k of blankKeys()) out[k] = S.inputs.get(k) || '';
  return out;
}
const draftBody = () => (S.view.play.freeText ? { text: S.text } : { cells: cellsPayload() });
const locked = () => !!S.view?.play?.submittedAt;

function adopt(view, { fresh = false, checked = false } = {}) {
  const prev = S.view;
  S.view = view;
  if (fresh || !prev || prev.id !== view.id || prev.play?.mode !== view.play?.mode) {
    S.inputs.clear();
    S.stale.clear();
    S.cur = null;
    S.text = view.play?.text || '';
    eachCell((c, k) => { if (c.kind === 'blank' && c.input) S.inputs.set(k, c.input); });
  } else {
    eachCell((c, k) => { if (c.kind !== 'blank') S.inputs.delete(k); });
  }
  if (checked) S.stale.clear();
  render();
  schedulePoll();
}

async function act(name, body, opts) {
  try {
    await flushDraft(true);
    const view = await api('POST', '/api/games/' + gid + '/' + name, body);
    adopt(view, opts);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

function touch() {
  S.dirty = true;
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => flushDraft(false), isLive() ? 450 : 900);
}
const isLive = () => S.view?.play?.mode === 'fu' && !S.view.play.freeText;

// 存草稿。自赋档顺带取回格律报告（服务端不计次），只修补谱与批，不重建输入框。
async function flushDraft(quiet) {
  clearTimeout(S.saveTimer);
  S.saveTimer = 0;
  if (!S.dirty || !S.view?.play || locked()) return;
  S.dirty = false;
  const seq = ++S.liveSeq;
  try {
    if (isLive() && !quiet) {
      const view = await api('POST', '/api/games/' + gid + '/check', draftBody());
      if (seq === S.liveSeq && !locked()) { S.view = view; patchLive(); }
    } else {
      await api('POST', '/api/games/' + gid + '/draft', draftBody());
    }
  } catch { /* 草稿存不上不打扰玩家，下次改动再试 */ }
}

function schedulePoll() {
  clearTimeout(S.pollTimer);
  const p = S.view?.play;
  if (!gid || !p || !p.submittedAt || p.review) return;
  if (!S.pollUntil) S.pollUntil = Date.now() + 45 * 60 * 1000;
  if (Date.now() > S.pollUntil) return;
  S.pollTimer = setTimeout(async () => {
    try {
      if (!document.hidden) {
        const view = await api('GET', '/api/games/' + gid);
        if (view.play?.review || view.status !== S.view.status) return adopt(view);
      }
    } catch { /* 服务暂时不在也无妨 */ }
    schedulePoll();
  }, 4000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedulePoll(); });

// ── 逐格输入 ──────────────────────────────────────────

const cellEl = (k) => app.querySelector('[data-cell="' + k + '"]');
const inputEl = (k) => app.querySelector('input[data-k="' + k + '"]');
function focusCell(k) {
  const el = inputEl(k);
  if (el && !el.disabled) { el.focus(); return true; }
  return false;
}

function setCell(k, ch) {
  if (ch) S.inputs.set(k, ch); else S.inputs.delete(k);
  S.stale.add(k);
  const cell = cellEl(k);
  if (cell) {
    const inp = cell.querySelector('input.ch');
    if (inp && inp.value !== ch) inp.value = ch;
    cell.className = cell.className.replace(/\s*\b(fb-\w+|bad|warn|empty)\b/g, '') + (ch ? '' : ' empty');
  }
  touch();
}

function commit(inp) {
  const k = inp.dataset.k;
  const old = S.inputs.get(k) || '';
  let raw = inp.value;
  if (raw === old) return;
  // 光标没选中旧字时，新字会接在旧字前后：把旧字剥掉
  if (old && raw.length > old.length) {
    if (raw.startsWith(old)) raw = raw.slice(old.length);
    else if (raw.endsWith(old)) raw = raw.slice(0, -old.length);
  }
  const chars = [...raw].filter(isHan);
  if (!chars.length) {
    if (raw === '') setCell(k, ''); else inp.value = old;
    return;
  }
  // 一次敲进多个字（输入法整句上屏）时，顺着读序往后铺
  const keys = blankKeys();
  const at = keys.indexOf(k);
  const n = Math.min(chars.length, keys.length - at);
  for (let x = 0; x < n; x++) setCell(keys[at + x], chars[x]);
  const next = keys[at + n];
  setTimeout(() => focusCell(next || keys[at + n - 1]), 0);
}

function onBoardInput(e) {
  const inp = e.target;
  if (!inp.matches || !inp.matches('input.ch')) return;
  if (e.type === 'compositionstart') { S.composing = true; return; }
  if (e.type === 'compositionend') { S.composing = false; commit(inp); return; }
  if (e.isComposing || S.composing) return;
  commit(inp);
}

function onBoardKey(e) {
  const inp = e.target;
  if (!inp.matches || !inp.matches('input.ch') || e.isComposing || e.keyCode === 229) return;
  const k = inp.dataset.k;
  const keys = blankKeys();
  const at = keys.indexOf(k);
  const go = (key) => { if (key) { e.preventDefault(); focusCell(key); } };
  if (e.key === 'Backspace' && !inp.value) {
    const prev = keys[at - 1];
    if (prev) { e.preventDefault(); setCell(prev, ''); focusCell(prev); }
  } else if (e.key === 'ArrowDown') go(keys[at + 1]);
  else if (e.key === 'ArrowUp') go(keys[at - 1]);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    // 竖排自右向左：左键去下一句，右键回上一句，尽量落在同一行
    const [j, i] = k.split('.').map(Number);
    const step = e.key === 'ArrowLeft' ? 1 : -1;
    const total = board().ju.length;
    for (let jj = j + step; jj >= 0 && jj < total; jj += step) {
      const inCol = keys.filter((x) => x.startsWith(jj + '.'));
      if (!inCol.length) continue;
      inCol.sort((a, b) => Math.abs(a.split('.')[1] - i) - Math.abs(b.split('.')[1] - i));
      go(inCol[0]);
      break;
    }
  } else if (e.key === 'Enter' && S.view.play.mode !== 'fu') {
    e.preventDefault();
    doCheck();
  }
}

function onBoardFocus(e) {
  const inp = e.target;
  if (!inp.matches || !inp.matches('input.ch')) return;
  S.cur = inp.dataset.k;
  app.querySelectorAll('.cur-col').forEach((el) => el.classList.remove('cur-col'));
  inp.closest('.col')?.classList.add('cur-col');
  if (inp.value) setTimeout(() => { if (document.activeElement === inp && !S.composing) inp.select(); }, 0);
}

// ── 动作 ──────────────────────────────────────────────

const doCheck = () => act('check', draftBody(), { checked: true });
function curPos() {
  if (!S.cur) return null;
  const [j, i] = S.cur.split('.').map(Number);
  return { j, i };
}
function hintChar() {
  const pos = curPos();
  if (!pos || !blankKeys().includes(S.cur)) return toast('先点选要揭的那一格');
  act('hint', { type: 'char', j: pos.j, i: pos.i });
}
function hintGloss() {
  const left = S.view.play.hintsLeft.glosses;
  if (S.view.play.freeText) return act('hint', { type: 'gloss', j: left[0] });  // 素笺无格可选，依次给
  const pos = curPos();
  if (!pos || !left.includes(pos.j)) return toast(pos ? '这一句的句意已经问过了' : '先点选要问的那一句');
  act('hint', { type: 'gloss', j: pos.j });
}
function twoStep(btn, label, fn) {
  if (btn.dataset.armed) return fn();
  const old = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = old; } }, 3200);
}

// ── 渲染：零件 ────────────────────────────────────────

const yuwei = (text) => h('div', { class: 'yuwei' }, h('span', {}, text));
const seal = (text, cls) => h('span', { class: 'yin ' + (cls || '') }, text);
const btn = (label, onclick, cls, extra) => h('button', { class: 'btn ' + (cls || ''), type: 'button', onclick, ...extra }, label);
const pu = (want) => (want ? h('i', { class: 'pu ' + PU[want], title: want === '中' ? '可平可仄' : want }) : null);
const rhymeName = (v) => (v.rhymebook.id === 'guyun' ? (v.form.kind === 'ci' ? '词林正韵' : v.form.kind === 'shi' ? '平水韵' : '古韵') : v.rhymebook.name);

function mei() {
  return h('div', { class: 'mei' },
    h('a', { class: 'hao', href: '/', 'aria-label': '推敲 · 卷帙' }, seal('推敲'), h('b', {}, '推敲')),
    h('nav', {}, h('a', { href: '/' }, '卷帙')));
}

// 诗笺：自右向左的竖排。ju 是句的数组；cell(j, i) 造格，foot(j) 造句脚。
function jian(ju, { title, small, cell, foot, cap }) {
  const ques = [];
  let cur = [];
  ju.forEach((line, j) => {
    cur.push(h('div', { class: 'col', 'data-col': j },
      line.cells.map((_, i) => cell(j, i)),
      h('div', { class: 'jiao' }, foot ? foot(j) : null)));
    if (line.stanzaEnd || j === ju.length - 1) { ques.push(h('div', { class: 'que' }, cur)); cur = []; }
  });
  // 两阕合计不超过十句时并排（上阕在右），窄屏上超过六句再改回上下叠放
  const many = ques.length > 1;
  const widest = Math.max(...ques.map((q) => q.children.length));
  const heng = many && ju.length <= 10;
  const el = h('div', { class: 'jian' + (ju.length <= 4 ? ' shao' : ''), style: '--n:' + (heng ? ju.length : widest) + ';--nm:' + (heng && ju.length <= 6 ? ju.length : widest) },
    h('div', { class: 'xin' }, title, small ? h('small', {}, small) : null),
    h('div', { class: 'ques' + (heng ? ' heng' : '') + (many && ju.length > 6 ? ' die' : '') }, ques));
  return cap ? h('div', {}, h('div', { class: 'jian-cap' }, cap), el) : el;
}
const footOf = (line) => [line.punct || null, line.rhyme ? h('b', {}, line.end === '叶' || line.end === '叠' ? line.end : '韵') : null];

function issueMarks(report) {
  const marks = new Map();
  for (const it of report?.issues || []) {
    if (it.ju == null || it.pos == null) continue;
    const k = it.ju + '.' + it.pos;
    if (it.level === 'error' || !marks.has(k)) marks.set(k, it.level === 'error' ? 'bad' : 'warn');
  }
  return marks;
}

function playBoard(v) {
  const p = v.play;
  const off = locked();
  const marks = p.mode === 'fu' ? issueMarks(p.report) : new Map();
  const el = jian(p.board.ju, {
    title: v.title,
    small: p.patternShown && p.variantLabel ? v.form.name + ' · ' + p.variantLabel : v.form.name,
    foot: (j) => footOf(p.board.ju[j]),
    cell: (j, i) => {
      const c = p.board.ju[j].cells[i];
      const k = j + '.' + i;
      const cls = ['cell'];
      let ch;
      if (c.kind === 'blank') {
        const val = S.inputs.get(k) || '';
        ch = h('input', {
          class: 'ch', type: 'text', 'data-k': k, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
          enterkeyhint: 'next', disabled: off, 'aria-label': '第' + cn(j + 1) + '句第' + cn(i + 1) + '字',
        });
        ch.value = val;
        if (!val) cls.push('empty');
        else if (c.fb && !S.stale.has(k)) cls.push('fb-' + c.fb);
        if (val && marks.has(k) && !S.stale.has(k)) cls.push(marks.get(k));
      } else {
        ch = h('span', { class: 'ch' }, c.char);
        if (c.kind === 'hinted') cls.push('hinted');
      }
      return h('div', { class: cls.join(' '), 'data-cell': k }, pu(c.want), ch);
    },
  });
  for (const type of ['input', 'compositionstart', 'compositionend']) el.addEventListener(type, onBoardInput);
  el.addEventListener('keydown', onBoardKey);
  el.addEventListener('focusin', onBoardFocus);
  return el;
}

// 自赋档边写边校：只换谱点、批注与旁注，输入框原地不动
function patchLive() {
  const p = S.view.play;
  if (!p?.board) return;
  const marks = issueMarks(p.report);
  eachCell((c, k) => {
    const cell = cellEl(k);
    if (!cell) return;
    const dot = cell.querySelector('.pu');
    if (dot && c.want) { dot.className = 'pu ' + PU[c.want]; dot.title = c.want === '中' ? '可平可仄' : c.want; }
    cell.classList.remove('bad', 'warn');
    if (S.inputs.get(k) && marks.has(k)) cell.classList.add(marks.get(k));
  });
  S.stale.clear();
  const small = app.querySelector('.jian .xin small');
  if (small && p.variantLabel) small.textContent = S.view.form.name + ' · ' + p.variantLabel;
  p.board.ju.forEach((line, j) => {
    const foot = app.querySelector('[data-col="' + j + '"] .jiao');
    if (foot) foot.replaceChildren(...footOf(line).filter(Boolean));
  });
  app.querySelector('.pang-slot')?.replaceChildren(...[pang(S.view)].filter(Boolean));
}

function legend(v) {
  const p = v.play;
  const item = (cls, text, inner) => h('span', { class: 'li' }, h('span', { class: 'cell ' + cls }, inner), text);
  const out = [];
  if (p.mode !== 'fu' && p.checks > 0) {
    out.push(item('fb-hit', '字合'), item('fb-rhyme', '韵合'), item('fb-tone', '平仄合'));
    if (p.mode === 'ju') out.push(item('fb-present', '字在句中别处'));
    out.push(item('fb-miss', '未合'));
  }
  if (p.patternShown && p.board) out.push(item('', '平', pu('平')), item('', '仄', pu('仄')), item('', '可平可仄', pu('中')));
  return out.length ? h('div', { class: 'zhuji' }, out) : null;
}

function pang(v) {
  const p = v.play;
  const parts = [];
  const got = p.board ? p.board.ju.map((line, j) => ({ j, text: line.gloss })) : p.glosses || [];
  const glosses = got.filter((g) => g.text).map((g) => h('li', {}, h('b', {}, '第' + cn(g.j + 1) + '句'), g.text));
  if (glosses.length) parts.push(h('h3', {}, '句意'), h('ul', {}, glosses));
  if (p.hints.imagery.length) parts.push(h('h3', {}, '意象'), h('div', { class: 'xiang' }, p.hints.imagery.map((x) => h('span', { class: 'pai zhu' }, x))));
  if (p.mode === 'fu' && p.report) {
    const { issues, ok, complete } = p.report;
    const rows = issues.map((it) => h('li', {
      class: it.level === 'error' ? 'err' : 'warn',
      'data-j': it.ju == null ? null : it.ju,
      onclick: it.ju == null ? null : () => focusCell(it.ju + '.' + (it.pos || 0)),
    }, it.message));
    if (!rows.length && S.inputs.size) rows.push(h('li', { class: 'ok' }, complete && ok ? '通篇合律。' : '落笔处皆合律。'));
    if (rows.length) parts.push(h('h3', {}, '格律'), h('ul', {}, rows));
  }
  return parts.length ? h('section', { class: 'pang' }, parts) : null;
}

function tools(v) {
  const p = v.play;
  const left = p.hintsLeft;
  const out = [];
  const hasGloss = left.glosses.length > 0;
  if (p.mode !== 'fu') {
    out.push(btn(['试', p.checks ? h('small', {}, ' ' + cn(p.checks)) : null], doCheck, '', { title: '看看填得如何（回车）' }));
    if (v.form.kind !== 'free') out.push(btn('示律', () => act('hint', { type: 'pattern' }), '', { disabled: p.patternShown, title: '标出每字的平仄与韵脚' }));
    out.push(btn('揭字', hintChar, '', { title: '揭开选中的那一格' }));
  }
  if (hasGloss || p.hints.glosses > 0) out.push(btn('句意', hintGloss, '', { disabled: !hasGloss, title: '问选中那一句的大意' }));
  if (left.imagery > 0 || p.hints.imagery.length) out.push(btn(['意象', left.imagery ? h('small', {}, ' 余' + cn(left.imagery)) : null], () => act('hint', { type: 'imagery' }), '', { disabled: !left.imagery, title: '讨一个原作用到的意象' }));
  if (out.length) out.push(h('span', { class: 'sep' }));
  out.push(btn('交卷', (e) => twoStep(e.currentTarget, '确定交卷', () => act('submit', draftBody(), { checked: true })), 'zhu'));
  const lower = { fu: ['ju', 'zi'], ju: ['zi'], zi: [] }[p.mode];
  const down = lower.map((m) => btn('改作' + MODE[m].name, (e) => twoStep(e.currentTarget, '降档会清空已填，确定？', () => act('mode', { mode: m })), 'qing'));
  return [h('div', { class: 'an' }, out), down.length ? h('div', { class: 'an' }, down) : null];
}

// ── 渲染：各节 ────────────────────────────────────────

function head(v) {
  return h('header', { class: 'ti' },
    h('h1', {}, v.title),
    h('div', { class: 'fu' }, v.form.name, h('i', {}, '·'), rhymeName(v), v.play ? [h('i', {}, '·'), MODE[v.play.mode].name] : null),
    h('div', { class: 'ren' }, v.subjects.map((s) => h('span', { class: 'pai' }, s)), h('span', { class: 'pai zhu' }, v.premise === 'alternate' ? '改写' : '依史')));
}

function story(v) {
  return h('section', { class: 'mian' }, yuwei('谜面'),
    v.premiseNote ? h('p', { class: 'yi' }, '改写之意：' + v.premiseNote) : null,
    paras(v.story).map((t) => h('p', {}, t)));
}

function picker(v) {
  const pick = (m) => act('mode', { mode: m }, { fresh: true });
  return h('section', { class: 'ze' }, yuwei('择题'),
    h('div', { class: 'qian-row' }, v.modes.map((m) => h('button', { class: 'qian', type: 'button', onclick: () => pick(m.id) },
      h('b', {}, MODE[m.id].name), h('span', {}, MODE[m.id].desc(m.blanks, v)), h('em', {}, MODE[m.id].rank)))),
    h('p', { class: 'zhu-note' }, '谜底是一首' + v.form.name + '。择定之后，只可由难改易。'));
}

function playArea(v) {
  const p = v.play;
  const off = locked();
  let body;
  if (p.freeText) {
    body = off ? h('pre', { class: 'su-read' }, S.text || '（白卷）') : h('textarea', {
      class: 'su', placeholder: '此体无谱，随意落笔。', 'aria-label': '你的诗',
      oninput: (e) => { S.text = e.target.value; touch(); },
    }, S.text);
  } else {
    body = playBoard(v);
  }
  return h('section', { class: 'jian-wrap' }, yuwei(off ? '君作' : MODE[p.mode].name), body,
    legend(v), off ? null : tools(v), h('div', { class: 'pang-slot' }, pang(v)));
}

function reviewBox(v) {
  const r = v.play.review;
  if (!r) {
    return h('p', { class: 'hou' }, h('span', { class: 'mo' }), h('span', { class: 'mo' }), h('span', { class: 'mo' }),
      h('br'), '评点人正在斟酌',
      h('small', {}, '若久无动静，回到对话里说一声「我交卷了」。'));
  }
  return h('div', { class: 'pi' },
    paras(r.comment).map((t) => h('p', {}, t)),
    (r.highlights || []).map((x) => h('blockquote', {}, h('q', {}, x.quote), h('span', {}, x.note))));
}

function aftermath(v) {
  const p = v.play;
  const grade = p.score?.grade || p.review?.grade || null;
  const hintCount = p.hints.chars + p.hints.glosses + p.hints.imagery.length + (p.hints.pattern && p.mode !== 'fu' ? 1 : 0);
  const rows = [];
  if (p.score) rows.push(['合字', p.score.hit + ' / ' + p.score.total], ['试笔', cn(p.checks) + '次']);
  rows.push(['提示', hintCount ? cn(hintCount) + '次' : '未用']);
  if (p.score) rows.push(['得分', String(p.score.points)]);
  return h('section', { class: 'juan' }, yuwei('品第'),
    h('div', { class: 'pin' }, grade ? seal(grade, 'luo') : seal('待评', 'kong'),
      h('dl', {}, rows.map(([a, b]) => [h('dt', {}, a), h('dd', {}, b)]))),
    reviewBox(v),
    v.status === 'revealed' ? null : h('div', { class: 'an', style: 'margin-top:34px' },
      btn('揭晓原作', async () => { if (await act('reveal')) document.querySelector('.jie')?.scrollIntoView({ behavior: 'smooth' }); }, 'zhu')));
}

function reveal(v) {
  const r = v.reveal;
  const p = v.play;
  const small = r.variantLabel ? v.form.name + ' · ' + r.variantLabel : v.form.name;
  const origCell = (j, i) => {
    const c = r.ju[j].cells[i];
    const mine = p?.board && !p.freeText && p.mode !== 'fu' ? p.board.ju[j]?.cells[i] : null;
    const cls = ['cell'];
    let note = null;
    if (c.ok === false) cls.push('bad');
    if (mine?.kind === 'hinted') cls.push('hinted');
    if (mine?.kind === 'blank') {
      if (mine.input === c.char) cls.push('fb-hit');
      else { cls.push('orig-miss'); if (mine.input) note = h('span', { class: 'yi-zi', title: '君作「' + mine.input + '」' }, mine.input); }
    }
    return h('div', { class: cls.join(' ') }, pu(c.want), h('span', { class: 'ch' }, c.char), note);
  };
  const orig = jian(r.ju, { title: v.title, small, cell: origCell, foot: (j) => footOf(r.ju[j]), cap: p?.mode === 'fu' && !p.freeText ? '原作' : null });
  let boards = orig;
  if (p?.mode === 'fu' && !p.freeText && p.board) {
    const marks = issueMarks(p.report);
    const mine = jian(p.board.ju, {
      title: v.title, small: '君作', cap: '君作', foot: (j) => footOf(p.board.ju[j]),
      cell: (j, i) => {
        const c = p.board.ju[j].cells[i];
        const val = c.input || '';
        return h('div', { class: 'cell mine ' + (val ? marks.get(j + '.' + i) || '' : 'empty') }, pu(c.want), h('span', { class: 'ch' }, val || '□'));
      },
    });
    boards = h('div', { class: 'jian-pair' }, orig, mine);
  }
  const notes = [];
  if (r.glosses?.length) notes.push(h('h3', {}, '句意'), h('ol', {}, r.glosses.map((g, j) => h('li', {}, h('b', {}, cn(j + 1)), h('span', {}, g)))));
  if (r.imagery?.length) notes.push(h('h3', {}, '意象'), h('div', { class: 'xiang' }, r.imagery.map((x) => h('span', { class: 'pai zhu' }, x))));
  const flaws = (r.issues || []).filter((it) => it.code !== 'unknown-char');
  if (flaws.length) notes.push(h('h3', {}, '原作小疵'), h('ul', {}, flaws.map((it) => h('li', { class: it.level === 'error' ? 'err' : 'warn' }, it.message))));
  return h('section', { class: 'jie' }, yuwei('原作'),
    p?.freeText ? h('div', { class: 'jian-pair' }, h('pre', { class: 'su-read' }, r.poem)) : boards,
    p && p.mode !== 'fu' ? h('div', { class: 'zhuji' },
      h('span', { class: 'li' }, h('span', { class: 'cell fb-hit' }), '你填中的字'),
      h('span', { class: 'li' }, h('span', { style: 'color:var(--zhu)' }, '朱字'), '未中，旁注为你所填')) : null,
    notes.length ? h('section', { class: 'pang' }, notes) : null,
    r.note ? h('section', { class: 'shou' }, yuwei('手记'), paras(r.note).map((t) => h('p', {}, t))) : null,
    h('p', { class: 'ci' }, '欲再来一局，回到对话里说一声便是。'));
}

function renderGame() {
  const v = S.view;
  document.title = v.title + ' · 推敲';
  const revealed = v.status === 'revealed';
  const showPlay = v.play && !(revealed && !(v.play.freeText));
  return h('main', { class: 'ye' }, head(v), story(v),
    !v.play ? picker(v) : null,
    showPlay ? playArea(v) : null,
    v.play?.submittedAt ? aftermath(v) : null,
    revealed && v.reveal ? reveal(v) : null);
}

function renderHome(games) {
  return h('main', { class: 'ye' },
    h('header', { class: 'ti' }, h('h1', {}, '推敲'), h('div', { class: 'fu' }, '鸟宿池边树', h('i', {}, '·'), '僧敲月下门')),
    yuwei('卷帙'),
    games.length ? h('ul', { class: 'mu' }, games.map((g) => h('li', {}, h('a', { href: '/g/' + g.id },
      h('span', { class: 't' }, g.title, h('small', {}, g.form.name + (g.mode ? ' · ' + MODE[g.mode].name : ''))),
      h('span', { class: 'z pai' + (g.status === 'new' ? ' zhu' : '') }, STATUS[g.status] || g.status),
      h('span', { class: 'd' }, String(g.createdAt).slice(0, 10).replace(/-/g, '.')),
      h('span', { class: 's' }, (g.subjects || []).join('　'))))))
      : h('div', { class: 'kong-ye' }, '案上尚无一卷。', h('br'), '回到对话里，说一句', h('q', {}, '来一局推敲'), '，再报上你想写的人与事。'));
}

function render() {
  const keep = document.activeElement?.dataset?.k;
  const y = window.scrollY;
  app.replaceChildren(mei(), gid ? renderGame() : renderHome(S.games || []));
  if (keep) focusCell(keep);
  window.scrollTo(0, y);
}

async function boot() {
  try {
    if (gid) adopt(await api('GET', '/api/games/' + gid), { fresh: true });
    else { S.games = (await api('GET', '/api/games')).games; render(); }
  } catch (err) {
    app.replaceChildren(mei(), h('main', { class: 'ye' }, h('div', { class: 'kong-ye' },
      err.status === 404 ? '查无此卷。' : '取卷未成：' + err.message, h('br'), h('a', { href: '/' }, '回卷帙'))));
  }
}
window.addEventListener('pagehide', () => { if (S.dirty && S.view?.play && !locked()) navigator.sendBeacon?.('/api/games/' + gid + '/draft', new Blob([JSON.stringify(draftBody())], { type: 'application/json' })); });
boot();
