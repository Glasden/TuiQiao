// 推敲 · 网页端。无框架、无构建：一个模块管路由、渲染与逐格输入。
const app = document.getElementById('app');
const gid = (location.pathname.match(/^\/g\/([a-z0-9]+)/i) || [])[1] || null;

const S = {
  view: null,
  inputs: new Map(),   // 'j.i' → 玩家所填；本地为准，服务端的 input 只在初次载入与换档时采用
  stale: new Set(),    // 上次「试」之后又改过的格，其反馈作废
  text: '',            // 自由体的草稿
  cur: null,           // 最近聚焦的格；失焦后仍高亮，揭字、句意都对着它
  edit: null,          // 这次输入开始前格里的字与选区，用来分辨新字是替换旧字还是接在旁边
  composing: false,
  dirty: false,
  saveTimer: 0,
  liveSeq: 0,
  pollTimer: 0,
  pollUntil: 0,
  yun: { open: false, q: '', res: null, rhyme: null, err: '', seq: 0 },  // 查韵面板
  tiles: new Map(),    // 选字档：'j.i' → 落在这一格的是盘上哪一枚（'盘下标.枚下标'）
  pan: 0,              // 选字档：眼下摊开的是第几盘
  drag: null,          // 正拖着的那一枚
  dragEnd: 0,          // 拖放刚结束的时刻，用来吞掉紧随其后的 click
};

const NUM = '〇一二三四五六七八九';
// 小写中文数字：十一、二十、一百零五、一百一十、一千零二十
function cn(n) {
  n = Math.max(0, Math.floor(n));
  if (n < 10) return NUM[n];
  if (n < 20) return '十' + (n % 10 ? NUM[n % 10] : '');
  if (n >= 10000) return String(n);
  const digits = [...String(n)].map(Number);
  let out = '';
  let gap = false;
  digits.forEach((d, x) => {
    if (!d) { gap = true; return; }
    if (gap && out) out += '零';
    gap = false;
    out += NUM[d] + ['', '十', '百', '千'][digits.length - 1 - x];
  });
  return out;
}
const isHan = (c) => /\p{Script=Han}/u.test(c);
const paras = (s) => String(s || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
// 六档由易到难。前三档「选字」：字在盘里，拣来落格；后三档「落笔」：字要自己写
const MODE = {
  ze: { name: '择字', desc: (n) => '缺' + cn(n) + '字，字皆在盘，各归其位' },
  bian: { name: '辨字', desc: (n) => '缺' + cn(n) + '字，盘中混有疑似之字' },
  chai: { name: '拆篇', desc: (n, v) => '全篇' + cn(n) + '字拆散，' + (v.form.kind === 'free' ? '依意' : '依律') + '拼回' },
  zi: { name: '填字', desc: (n) => '原作缺' + cn(n) + '字，据故事补全' },
  ju: { name: '补句', desc: (n) => '原作佚' + cn(n) + '句，凭上下文续成' },
  fu: { name: '自赋', desc: (n, v) => '只凭故事，依' + v.form.name + '之律自作一首' },
};
const GROUP = {
  xuan: { name: '选字', note: '字在盘中，拣来便是' },
  xie: { name: '落笔', note: '字在胸中，自己写来' },
};
const ORD = '壹贰叁肆伍陆柒捌玖';
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
    S.tiles.clear();
    S.pan = 0;
    Object.assign(S.yun, { open: false, q: '', res: null, rhyme: null, err: '' });
    eachCell((c, k) => { if (c.kind === 'blank' && c.input) S.inputs.set(k, c.input); });
  } else {
    eachCell((c, k) => { if (c.kind !== 'blank') S.inputs.delete(k); });
  }
  seatTiles();
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
  S.pollTimer = setTimeout(pollOnce, 4000);
}
async function pollOnce() {
  try {
    if (!document.hidden) {
      const view = await api('GET', '/api/games/' + gid);
      if (view.play?.review || view.status !== S.view.status) return adopt(view);
    }
  } catch { /* 服务暂时不在也无妨 */ }
  schedulePoll();
}
// 切回此页多半是刚去对话里说了一声「交卷了」：立刻问一次，时限也重新起算，不然过了时限就再也等不到评点
document.addEventListener('visibilitychange', () => {
  const p = S.view?.play;
  if (document.hidden || !gid || !p?.submittedAt || p.review) return;
  S.pollUntil = 0;
  clearTimeout(S.pollTimer);
  pollOnce();
});

// ── 逐格输入 ──────────────────────────────────────────

const cellEl = (k) => app.querySelector('[data-cell="' + k + '"]');
const inputEl = (k) => app.querySelector('.ch[data-k="' + k + '"]');  // 落笔档是输入框，选字档是按钮
function focusCell(k) {
  const el = inputEl(k);
  if (el && !el.disabled) { el.focus(); return true; }
  return false;
}
const slotLabel = (k, ch) => {
  const [j, i] = k.split('.').map(Number);
  return '第' + cn(j + 1) + '句第' + cn(i + 1) + '字' + (ch ? '「' + ch + '」，点一下收回盘中' : '，空');
};

function setCell(k, ch) {
  if (ch) S.inputs.set(k, ch); else S.inputs.delete(k);
  S.stale.add(k);
  const cell = cellEl(k);
  if (cell) {
    const el = cell.querySelector('.ch[data-k]');
    if (el?.tagName === 'INPUT') { if (el.value !== ch) el.value = ch; }
    else if (el) { el.textContent = ch; el.setAttribute('aria-label', slotLabel(k, ch)); }
    cell.className = cell.className.replace(/\s*\b(fb-\w+|bad|warn|empty)\b/g, '') + (ch ? '' : ' empty');
  }
  touch();
}

// 输入开始前记下格里的字与选区。输入法组字期间的 beforeinput 不算，只认 compositionstart 那一刻
function markEdit(inp) {
  S.edit = { k: inp.dataset.k, value: inp.value, start: inp.selectionStart, end: inp.selectionEnd };
}

// 从输入后的值里取出这次新敲的字：选区以外的旧字（光标停在旧字前后）剥掉，选中的旧字已被替换，一字不剥
function typed(raw, old, edit) {
  if (!old) return raw;
  if (edit && edit.value === old && edit.start != null) {
    const head = old.slice(0, edit.start);
    const tail = old.slice(edit.end ?? edit.start);
    if (raw.length >= head.length + tail.length && raw.startsWith(head) && raw.endsWith(tail)) {
      return raw.slice(head.length, raw.length - tail.length);
    }
    return raw;
  }
  // 没记到选区时只能猜：多出来的部分算新字
  if (raw.length > old.length) {
    if (raw.startsWith(old)) return raw.slice(old.length);
    if (raw.endsWith(old)) return raw.slice(0, -old.length);
  }
  return raw;
}

// 一次敲进多个字（输入法整句上屏）时，顺着读序往紧挨着的格里铺：
// 碰到原作给出的字，所敲与之相同就越过，不同就停；填字档的空零散，不跨句。
function spread(k, chars) {
  const b = board();
  const cross = S.view.play.mode !== 'zi';
  let [j, i] = k.split('.').map(Number);
  const out = [];
  for (const ch of chars) {
    const cell = b.ju[j]?.cells[i];
    if (!cell) break;
    if (cell.kind === 'blank') out.push([j + '.' + i, ch]);
    else if (cell.char !== ch) break;
    if (++i >= b.ju[j].cells.length) {
      if (!cross) break;
      j++;
      i = 0;
    }
  }
  return out;
}

function commit(inp) {
  const k = inp.dataset.k;
  const old = S.inputs.get(k) || '';
  const edit = S.edit?.k === k ? S.edit : null;
  S.edit = null;
  const raw = inp.value;
  if (raw === old) return;
  const chars = [...typed(raw, old, edit)].filter(isHan);
  if (!chars.length) {
    if (raw === '') setCell(k, ''); else inp.value = old;
    return;
  }
  const placed = spread(k, chars);
  for (const [key, ch] of placed) setCell(key, ch);
  const keys = blankKeys();
  const last = placed[placed.length - 1][0];
  setTimeout(() => focusCell(keys[keys.indexOf(last) + 1] || last), 0);
}

function onBoardInput(e) {
  const inp = e.target;
  if (!inp.matches || !inp.matches('input.ch')) return;
  if (e.type === 'compositionstart') { S.composing = true; markEdit(inp); return; }
  if (e.type === 'beforeinput') { if (!e.isComposing && !S.composing) markEdit(inp); return; }
  if (e.type === 'compositionend') { S.composing = false; commit(inp); return; }
  if (e.isComposing || S.composing) return;
  commit(inp);
}

function onBoardKey(e) {
  const inp = e.target;
  if (!inp.matches || !inp.matches('.ch[data-k]') || e.isComposing || e.keyCode === 229) return;
  const slot = inp.tagName === 'BUTTON';
  const k = inp.dataset.k;
  const keys = blankKeys();
  const at = keys.indexOf(k);
  const go = (key) => { if (key) { e.preventDefault(); focusCell(key); } };
  const wipe = (key) => (slot ? unseat(key) : setCell(key, ''));
  if (slot && (e.key === 'Backspace' || e.key === 'Delete') && S.inputs.get(k)) {
    e.preventDefault();
    wipe(k);
  } else if (e.key === 'Backspace' && !(slot ? S.inputs.get(k) : inp.value)) {
    const prev = keys[at - 1];
    if (prev) { e.preventDefault(); wipe(prev); focusCell(prev); }
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

// 把一组零件（可嵌套、可夹空值）填进容器，替掉原有的
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((kid) => kid != null && kid !== false)
    .map((kid) => (kid.nodeType ? kid : document.createTextNode(String(kid)))));
}

// 曾试：当前格历次「试」过的字与当时的批，点一下可改回那个字
const FB = { hit: '字合', rhyme: '韵合', tone: '平仄合', present: '字在别处', miss: '未合' };
function triedLine() {
  const el = app.querySelector('.ceng');
  if (!el) return;
  const pos = curPos();
  const k = S.cur;
  const cell = pos && board()?.ju[pos.j]?.cells[pos.i];
  const tried = cell?.kind === 'blank' ? cell.tried || [] : [];
  fill(el, tried.length ? [
    h('b', {}, '第' + cn(pos.j + 1) + '句第' + cn(pos.i + 1) + '字曾试'),
    tried.map((t) => h('button', {
      class: 'shi fb-' + t.fb, type: 'button', title: '改回「' + t.char + '」',
      onclick: () => { if (pools()) putChar(k, t.char); else setCell(k, t.char); focusCell(k); },
    }, h('i', {}, t.char), FB[t.fb] || '')),
  ] : []);
}

function markCur() {
  app.querySelectorAll('.cur-col, .cell.cur').forEach((el) => el.classList.remove('cur-col', 'cur'));
  triedLine();
  if (!S.cur || locked()) return;
  const cell = cellEl(S.cur);
  cell?.closest('.col')?.classList.add('cur-col');
  if (cell?.querySelector('.ch[data-k]')) cell.classList.add('cur');
}
function setCur(k) {
  S.cur = k;
  const p = pools() ? poolOf(k) : -1;
  if (p >= 0 && p !== S.pan) { S.pan = p; paintPan(); }
  markCur();
}

function onBoardFocus(e) {
  const inp = e.target;
  if (!inp.matches || !inp.matches('.ch[data-k]')) return;
  if (S.edit?.k !== inp.dataset.k) S.edit = null;
  setCur(inp.dataset.k);
  if (inp.tagName === 'INPUT' && inp.value) setTimeout(() => { if (document.activeElement === inp && !S.composing) inp.select(); }, 0);
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
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = old; } }, 4000);
}
function submitLabel() {
  if (S.view.play.freeText) return S.text.trim() ? '确定交卷' : '尚是白卷，确定交卷？';
  const left = blankKeys().filter((k) => !S.inputs.get(k)).length;
  return left ? '尚余' + cn(left) + '格未填，确定交卷？' : '确定交卷';
}

// ── 字盘（选字三档）──────────────────────────────────
// 格里的字只能从盘上取：点一枚落到当前格，或直接拖到格里；点已落的字，或把它拖出笺外，收回盘中。
// S.inputs 仍是「格 → 字」，S.tiles 另记落在那一格的是盘上哪一枚，同字的几枚才分得清。

const pools = () => S.view?.play?.pools || null;
const poolOf = (k) => (pools() || []).findIndex((p) => p.ju.includes(Number(k.split('.')[0])));
const panOf = (id) => Number(id.split('.')[0]);
function tileAt(id) {
  const [p, t] = id.split('.').map(Number);
  return pools()?.[p]?.tiles[t] || null;
}
function seatOf(id) {
  for (const [k, v] of S.tiles) if (v === id) return k;
  return null;
}

// 让 S.tiles 与 S.inputs、与服务端给的盘对上：先留住仍然作数的，再给没着落的字找一枚空闲的，找不到就退掉
function seatTiles() {
  const ps = pools();
  if (!ps) { S.tiles.clear(); return; }
  const keys = blankKeys().filter((k) => S.inputs.get(k));
  const taken = new Set();
  const next = new Map();
  for (const k of keys) {
    const id = S.tiles.get(k);
    if (id && !taken.has(id) && panOf(id) === poolOf(k) && tileAt(id)?.char === S.inputs.get(k)) { next.set(k, id); taken.add(id); }
  }
  for (const k of keys) {
    if (next.has(k)) continue;
    const p = poolOf(k);
    const t = ps[p] ? ps[p].tiles.findIndex((tile, x) => tile.char === S.inputs.get(k) && !taken.has(p + '.' + x)) : -1;
    if (t < 0) { S.inputs.delete(k); continue; }
    next.set(k, p + '.' + t);
    taken.add(p + '.' + t);
  }
  for (const k of [...S.inputs.keys()]) if (!next.has(k)) S.inputs.delete(k);
  S.tiles = next;
}

function syncCell(k) {
  const id = S.tiles.get(k);
  setCell(k, id ? tileAt(id).char : '');
}
// 把一枚字（在盘上的，或已落在别格的）落到 k 格；k 格原有的字，来处是格就对调，来处是盘就回盘
function seat(k, id) {
  if (poolOf(k) !== panOf(id)) return toast('这枚字不在这几句的盘里');
  const from = seatOf(id);
  if (from === k) return;
  const old = S.tiles.get(k);
  S.tiles.set(k, id);
  if (from) { if (old) S.tiles.set(from, old); else S.tiles.delete(from); }
  syncCell(k);
  if (from) syncCell(from);
  paintPan();
}
function unseat(k) {
  S.tiles.delete(k);
  syncCell(k);
  paintPan();
}
// 曾试之字改回去：盘上得还有这个字
function putChar(k, ch) {
  if (S.inputs.get(k) === ch) return;
  const p = poolOf(k);
  const used = new Set(S.tiles.values());
  const t = pools()[p].tiles.findIndex((tile, x) => tile.char === ch && !used.has(p + '.' + x));
  if (t < 0) return toast('盘中已无「' + ch + '」，先把它从别处收回');
  seat(k, p + '.' + t);
}

function tapTile(id) {
  const p = panOf(id);
  const keys = blankKeys().filter((k) => poolOf(k) === p);
  const later = (list, k) => list.find((x) => keys.indexOf(x) > keys.indexOf(k));
  const empty = keys.filter((k) => !S.inputs.get(k));
  const cur = keys.includes(S.cur) ? S.cur : null;
  let k;
  if (cur && !S.inputs.get(cur)) k = cur;
  else if (empty.length) k = (cur && later(empty, cur)) || empty[0];
  else if (cur) k = cur;                       // 这一盘的格都落满了：换掉当前格里的字
  else return toast('这几句都已落满，先点笺上的字收回一枚');
  seat(k, id);
  // 顺势移到下一个空格；这一盘落满了，就去别的盘
  const rest = keys.filter((x) => !S.inputs.get(x));
  setCur(later(rest, k) || rest[0] || blankKeys().find((x) => !S.inputs.get(x)) || k);
}

function onSlotClick(e) {
  const b = e.target.closest?.('button.ch[data-k]');
  if (!b || b.disabled || Date.now() < S.dragEnd) return;
  const k = b.dataset.k;
  if (S.inputs.get(k)) unseat(k);
  setCur(k);
}

// 拖放：用 Pointer 事件，鼠标与手指一套。挪动不足几像素算作点击，交给 click
function onDragStart(e) {
  if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || !pools() || locked()) return;
  const tile = e.target.closest?.('.zi[data-t]');
  const slot = tile ? null : e.target.closest?.('button.ch[data-k]');
  const id = tile ? tile.dataset.t : slot ? S.tiles.get(slot.dataset.k) : null;
  if (!id) return;
  S.drag = { id, pid: e.pointerId, x: e.clientX, y: e.clientY, k: slot ? slot.dataset.k : null, ghost: null, over: null };
}
function onDragMove(e) {
  const d = S.drag;
  if (!d || e.pointerId !== d.pid) return;
  if (!d.ghost) {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 7) return;
    d.ghost = h('div', { class: 'zi fei', 'aria-hidden': 'true' }, tileAt(d.id).char);
    document.body.append(d.ghost);
    (d.k ? inputEl(d.k) : app.querySelector('.zi[data-t="' + d.id + '"]'))?.classList.add('tuo');
  }
  d.ghost.style.left = e.clientX + 'px';
  d.ghost.style.top = e.clientY + 'px';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el?.closest?.('[data-cell]');
  const ok = cell?.querySelector('button.ch[data-k]:not(:disabled)') && poolOf(cell.dataset.cell) === panOf(d.id);
  const over = ok ? cell : el?.closest?.('.pan') || null;
  if (over !== d.over) {
    d.over?.classList.remove('dao');
    over?.classList.add('dao');
    d.over = over;
  }
  e.preventDefault();
}
function onDragEnd(e) {
  const d = S.drag;
  if (!d || e.pointerId !== d.pid) return;
  S.drag = null;
  if (!d.ghost) return;
  d.ghost.remove();
  app.querySelectorAll('.tuo, .dao').forEach((el) => el.classList.remove('tuo', 'dao'));
  S.dragEnd = Date.now() + 350;
  if (e.type === 'pointercancel') return;
  const to = d.over?.dataset?.cell;
  if (to) { seat(to, d.id); setCur(to); }
  else if (d.k) unseat(d.k);                   // 从笺上拖出去：收回盘中
}
window.addEventListener('pointermove', onDragMove, { passive: false });
window.addEventListener('pointerup', onDragEnd);
window.addEventListener('pointercancel', onDragEnd);

// 字角注平仄：平 ○ 仄 ● ，两读的字 ◐
function tonePu(tones) {
  const ping = tones?.includes('平');
  const ze = tones?.includes('仄');
  if (!ping && !ze) return null;
  return h('i', { class: 'pu ' + (ping && ze ? 'zhong' : ping ? 'ping' : 'ze'), title: ping && ze ? '平仄两读' : ping ? '平' : '仄' });
}
const toneWord = (tones) => (tones?.length ? '，' + (tones.length > 1 ? '平仄两读' : tones[0] + '声') : '');
function panName(ps, x) {
  if (S.view.form.kind === 'shi' && ps.length === 4 && ps.every((q) => q.ju.length === 2)) return ['首联', '颔联', '颈联', '尾联'][x];
  return '第' + cn(x + 1) + '盘';
}
// 一行摆几枚：能整除就排成齐整的几行（七绝二十八字正好四行七枚），否则各行尽量匀
function panCols(n) {
  const cap = window.innerWidth < 640 ? 7 : 10;
  if (n <= cap) return n;
  for (let c = cap; c >= cap / 2; c--) if (n % c === 0) return c;
  return Math.ceil(n / Math.ceil(n / cap));
}
function gotoPan(x) {
  const keys = blankKeys().filter((k) => poolOf(k) === x);
  S.pan = x;
  S.cur = keys.find((k) => !S.inputs.get(k)) || keys[0] || S.cur;
  paintPan();
  markCur();
}
function panBody(v) {
  const ps = v.play.pools;
  const p = S.pan = Math.min(S.pan, ps.length - 1);
  const used = new Set(S.tiles.values());
  const left = ps[p].tiles.filter((_, t) => !used.has(p + '.' + t)).length;
  const full = (x) => blankKeys().filter((k) => poolOf(k) === x).every((k) => S.inputs.get(k));
  return [
    h('h3', {}, '字盘', h('small', {}, left ? '余' + cn(left) + '枚' : '盘已空')),
    ps.length > 1 ? h('div', { class: 'pan-ye' }, ps.map((q, x) => h('button', {
      class: 'btn qing' + (x === p ? ' on' : '') + (full(x) ? ' man' : ''), type: 'button', 'aria-pressed': String(x === p),
      title: '第' + q.ju.map((j) => cn(j + 1)).join('、') + '句', onclick: () => gotoPan(x),
    }, panName(ps, x)))) : null,
    h('div', { class: 'pan-zi', style: '--k:' + panCols(ps[p].tiles.length) }, ps[p].tiles.map((tile, t) => {
      const id = p + '.' + t;
      if (used.has(id)) return h('span', { class: 'zi kong', 'aria-hidden': 'true' });
      return h('button', {
        class: 'zi', type: 'button', 'data-t': id, 'aria-label': tile.char + toneWord(tile.tones),
        onclick: () => { if (Date.now() >= S.dragEnd) tapTile(id); },
      }, tonePu(tile.tones), tile.char);
    })),
    h('p', { class: 'pan-note' }, '点字落格，也可拖放；点笺上已落的字，收回盘中。' + (v.play.patternShown ? '字角的圈点是它的平仄，须与笺上的谱相合。' : '')),
  ];
}
function panBox(v) {
  if (!v.play.pools) return null;
  const el = h('section', { class: 'pan', 'aria-label': '字盘' }, panBody(v));
  el.addEventListener('pointerdown', onDragStart);
  return el;
}
// 分了几盘时，把眼下这一盘所管的句标出来
function tintCols() {
  app.querySelectorAll('.col.zai').forEach((el) => el.classList.remove('zai'));
  const ps = pools();
  if (!ps || ps.length < 2 || locked()) return;
  for (const j of ps[Math.min(S.pan, ps.length - 1)].ju) app.querySelector('.jian-wrap [data-col="' + j + '"]')?.classList.add('zai');
}
function paintPan() {
  const el = app.querySelector('.pan');
  if (!el || !pools()) return;
  const held = el.contains(document.activeElement);
  fill(el, panBody(S.view));
  if (held) el.querySelector('.zi[data-t]')?.focus({ preventScroll: true });
  tintCols();
}

// ── 查韵 ──────────────────────────────────────────────
// 查单字的平仄与韵部；自赋档还可点韵部名翻同韵的常用字。不改对局，不计次。

const sheng = (s) => (s && s.length === 1 ? s + '声' : s || '');
const yunName = (name) => name.replace(/^入声/, '');  // 平水韵的入声韵名自带「入声」，前面已写过声了
function yunOut(v) {
  const y = S.yun;
  const canBrowse = v.play.mode === 'fu';
  const out = [];
  if (y.err) out.push(h('p', { class: 'yun-note err' }, y.err));
  const chars = y.res?.chars || [];
  if (chars.length) {
    out.push(h('ul', {}, chars.map((c) => {
      const rs = c.readings || [];
      const body = c.known
        ? rs.map((r) => h('span', { class: 'du' }, h('em', {}, r.tone), r.sheng === r.tone ? null : sheng(r.sheng),
          r.rhyme ? [r.sheng === r.tone ? null : ' · ', canBrowse
            ? h('button', { class: 'yun-bu', type: 'button', title: '翻检同韵的常用字', onclick: () => browse(r.rhyme, r.tone) }, yunName(r.rhyme))
            : yunName(r.rhyme)] : null,
          r.pinyin ? h('small', {}, r.pinyin) : null))
        : h('span', { class: 'du wei' }, '未收于' + y.res.book,
          rs.length ? '，依今音作' + [...new Set(rs.map((r) => r.tone))].join('或') : null);
      return h('li', {}, h('b', {}, c.char), h('span', {}, body));
    })));
  }
  if (y.rhyme) {
    if (!y.rhyme.rhymes.length) out.push(h('p', { class: 'yun-note' }, '查无此韵。'));
    for (const r of y.rhyme.rhymes) {
      out.push(h('div', { class: 'yun-zi' },
        h('h4', {}, yunName(r.name) + ' · ' + r.tone, h('small', {}, '常用' + cn([...r.common].length) + '字' + (r.more ? '，另有僻字' + cn(r.more) : ''))),
        h('p', {}, r.common)));
    }
  }
  return out;
}
function paintYun() {
  const el = app.querySelector('.yun-out');
  if (el && S.view?.play) fill(el, yunOut(S.view));
}
async function yunAsk(query, apply) {
  const y = S.yun;
  const seq = ++y.seq;
  try {
    const res = await api('GET', '/api/games/' + gid + '/lookup?' + query);
    if (seq !== y.seq) return;
    y.err = '';
    apply(res);
  } catch (err) {
    if (seq !== y.seq) return;
    y.err = err.message;
  }
  paintYun();
}
function lookup() {
  const y = S.yun;
  const chars = [...y.q].filter(isHan).slice(0, 8).join('');
  if (!chars) {
    Object.assign(y, { res: null, rhyme: null, err: '先写下要查的字。' });
    return paintYun();
  }
  return yunAsk('chars=' + encodeURIComponent(chars), (res) => { y.res = res; y.rhyme = null; });
}
const browse = (name, tone) => yunAsk('rhyme=' + encodeURIComponent(name) + '&tone=' + encodeURIComponent(tone), (res) => { S.yun.rhyme = res; });
function toggleYun() {
  const y = S.yun;
  y.open = !y.open;
  // 打开时顺手查当前格里的字
  const ch = y.open && !y.q && S.cur ? S.inputs.get(S.cur) : '';
  if (ch) y.q = ch;
  render();
  if (!y.open) return;
  app.querySelector('.yun-q')?.focus();
  if (ch) lookup();
}
function yunPanel(v) {
  const y = S.yun;
  if (!y.open) return null;
  const q = h('input', {
    class: 'yun-q', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
    placeholder: '要查的字，至多八个', 'aria-label': '要查的字',
    oninput: (e) => { y.q = e.target.value; },
    // 输入法组字时的回车是上屏，不是查
    onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); lookup(); } },
  });
  q.value = y.q;
  return h('section', { class: 'yun' },
    h('h3', {}, '查韵', h('small', {}, rhymeName(v))),
    h('div', { class: 'yun-wen' }, q, btn('查', lookup)),
    h('p', { class: 'yun-note' }, v.play.mode === 'fu' ? '点韵部名，可翻检同韵的常用字。' : '此档只查单字；同韵的字，到自赋档方可翻检。'),
    h('div', { class: 'yun-out', 'aria-live': 'polite' }, yunOut(v)));
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
  const marks = issueMarks(p.mode === 'fu' ? p.report : off ? p.prosody : null);
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
        if (p.pools) {
          ch = h('button', { class: 'ch', type: 'button', 'data-k': k, disabled: off, 'aria-label': slotLabel(k, val) }, val);
        } else {
          ch = h('input', {
            class: 'ch', type: 'text', 'data-k': k, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
            enterkeyhint: 'next', disabled: off, 'aria-label': '第' + cn(j + 1) + '句第' + cn(i + 1) + '字',
          });
          ch.value = val;
        }
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
  for (const type of ['beforeinput', 'input', 'compositionstart', 'compositionend']) el.addEventListener(type, onBoardInput);
  el.addEventListener('keydown', onBoardKey);
  el.addEventListener('focusin', onBoardFocus);
  if (p.pools) {
    el.addEventListener('click', onSlotClick);
    el.addEventListener('pointerdown', onDragStart);
  }
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
    out.push(item('fb-hit', '字合'));
    if (!p.pools) out.push(item('fb-rhyme', '韵合'), item('fb-tone', '平仄合'));
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
  // 自赋档边写边校；填字、补句档交卷之后才给玩家版本的格律
  const lv = p.mode === 'fu' ? p.report : locked() ? p.prosody : null;
  if (lv) {
    const { issues, ok, complete } = lv;
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
    if (v.form.kind !== 'free' && !p.pools) out.push(btn('示律', () => act('hint', { type: 'pattern' }), '', { disabled: p.patternShown, title: '标出每字的平仄与韵脚' }));
    out.push(btn('揭字', hintChar, '', { title: '揭开选中的那一格' }));
  }
  if (hasGloss || p.hints.glosses > 0) out.push(btn('句意', hintGloss, '', { disabled: !hasGloss, title: '问选中那一句的大意' }));
  if (left.imagery > 0 || p.hints.imagery.length) out.push(btn(['意象', left.imagery ? h('small', {}, ' 余' + cn(left.imagery)) : null], () => act('hint', { type: 'imagery' }), '', { disabled: !left.imagery, title: '讨一个原作用到的意象' }));
  if (out.length) out.push(h('span', { class: 'sep' }));
  out.push(btn('交卷', (e) => twoStep(e.currentTarget, submitLabel(), () => act('submit', draftBody(), { checked: true })), 'zhu'));
  // 只可由难改易：列出比眼下容易的各档，近的在前
  const lower = v.modes.slice(0, v.modes.findIndex((m) => m.id === p.mode)).filter((m) => MODE[m.id]).reverse();
  const down = lower.map((m) => btn(MODE[m.id].name, (e) => twoStep(e.currentTarget, '降档会清空已填，确定？', () => act('mode', { mode: m.id })), 'qing', { title: '改作' + MODE[m.id].name }));
  const yun = btn('查韵', toggleYun, 'qing' + (S.yun.open ? ' on' : ''), { title: '查一个字的平仄与韵部，不计次', 'aria-expanded': String(S.yun.open) });
  return [h('div', { class: 'an' }, out), h('div', { class: 'an' }, yun, down.length ? [h('span', { class: 'sep' }), h('span', { class: 'gai' }, '改作'), down] : null)];
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
  const list = v.modes.filter((m) => MODE[m.id]);
  const qian = (m) => h('button', { class: 'qian', type: 'button', onclick: () => pick(m.id) },
    h('b', {}, MODE[m.id].name), h('span', {}, MODE[m.id].desc(m.blanks, v)), h('em', {}, ORD[list.indexOf(m)]));
  // 两大档各一匣；竖排自右向左，易的在右
  const groups = Object.keys(GROUP).map((g) => [g, list.filter((m) => (m.group || 'xie') === g)]).filter(([, ms]) => ms.length);
  return h('section', { class: 'ze' }, yuwei('择题'),
    h('div', { class: 'dang-row' }, groups.map(([g, ms]) => h('div', { class: 'dang' },
      h('h3', {}, GROUP[g].name, h('small', {}, GROUP[g].note)),
      h('div', { class: 'qian-row' }, ms.map(qian))))),
    h('p', { class: 'zhu-note' }, '谜底是一首' + v.form.name + '。' + (list.some((m) => m.id === 'ze') ? '初来不妨自「择字」起；' : '') + '择定之后，只可由难改易。'));
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
    off ? null : panBox(v),
    !off && p.mode !== 'fu' ? h('div', { class: 'ceng', 'aria-live': 'polite' }) : null,
    legend(v), off ? null : [tools(v), yunPanel(v)], h('div', { class: 'pang-slot' }, pang(v)));
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
  // 两方印：「合原」按得分自动给（填字、补句），「诗品」由评点人给（补句、自赋）。
  // 补句档的评点若没带品第，就只留合原一方。
  const pinYin = (grade, label) => h('figure', { class: 'pin-yin' }, grade ? seal(grade, 'luo') : seal('待评', 'kong'), h('figcaption', {}, label));
  const seals = [];
  if (p.mode !== 'fu') seals.push(pinYin(p.score?.grade, '合原'));
  if (p.mode === 'fu' || (p.mode === 'ju' && (!p.review || p.review.grade))) seals.push(pinYin(p.review?.grade, '诗品'));
  const hintCount = p.hints.chars + p.hints.glosses + p.hints.imagery.length + (p.hints.pattern && p.mode !== 'fu' ? 1 : 0);
  const rows = [];
  if (p.score) rows.push(['合字', p.score.hit + ' / ' + p.score.total], ['试笔', cn(p.checks) + '次']);
  rows.push(['提示', hintCount ? cn(hintCount) + '次' : '未用']);
  if (p.score) rows.push(['得分', String(p.score.points)]);
  if (p.mode !== 'fu' && p.prosody) {
    const errs = p.prosody.issues.filter((it) => it.level === 'error').length;
    rows.push(['格律', errs ? cn(errs) + '处未合' : p.prosody.complete === false ? '落笔处皆合' : '合律']);
  }
  return h('section', { class: 'juan' }, yuwei('品第'),
    h('div', { class: 'pin' }, seals,
      h('dl', {}, rows.map(([a, b]) => [h('dt', {}, a), h('dd', {}, b)]))),
    p.mode === 'ju' ? h('p', { class: 'pin-note' }, '合原，只计与原作相合的字；诗品，是评点人就君所补之句另评。') : null,
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
      if (mine.fb === 'hit' || mine.input === c.char) cls.push('fb-hit');  // 交卷时已按繁简同字判过
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
    games.length ? h('ul', { class: 'mu' }, games.map((g) => {
      // 卷首小印：有诗品盖诗品，否则盖合原
      const gr = g.grades || {};
      const mark = gr.pin ? ['诗品', gr.pin] : gr.yuan ? ['合原', gr.yuan] : null;
      return h('li', {}, h('a', { href: '/g/' + g.id },
        h('span', { class: 'p' }, mark ? h('span', { class: 'yin xiao', title: mark.join(' · '), 'aria-label': mark.join(' ') }, mark[1]) : null),
        h('span', { class: 't' }, g.title, h('small', {}, g.form.name + (MODE[g.mode] ? ' · ' + MODE[g.mode].name : ''))),
        h('span', { class: 'z pai' + (g.status === 'new' ? ' zhu' : '') }, STATUS[g.status] || g.status),
        h('span', { class: 'd' }, String(g.createdAt).slice(0, 10).replace(/-/g, '.')),
        h('span', { class: 's' }, (g.subjects || []).join('　'))));
    }))
      : h('div', { class: 'kong-ye' }, '案上尚无一卷。', h('br'), '回到对话里，说一句', h('q', {}, '来一局推敲'), '，再报上你想写的人与事。'));
}

function render() {
  const keep = document.activeElement?.dataset?.k;
  const y = window.scrollY;
  app.replaceChildren(mei(), gid ? renderGame() : renderHome(S.games || []));
  markCur();
  tintCols();
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
