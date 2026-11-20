// 推敲 · 雅乐引擎（纯 Web Audio API，零依赖）
// 以物理建模丝弦（古琴、古筝）、竹管气声（洞箫）、玉磬与庭院混响合奏三阕原创古风曲目。

const STORAGE_KEY = 'tuiqiao.bgm.v1';

export const TRACKS = [
  {
    id: 'yuexia',
    name: '月下推敲',
    sub: '古琴 · 洞箫 · 玉磬',
    desc: 'D宫羽交替，疏朗清越，如月下独步吟哦',
    bpm: 64,
    bars: 32,
    breeze: 0.016,
  },
  {
    id: 'qiufeng',
    name: '秋风辞',
    sub: '古琴 · 洞箫 · 微风',
    desc: 'A羽商调，沉静苍茫，如渭水秋风黄叶',
    bpm: 58,
    bars: 24,
    breeze: 0.026,
  },
  {
    id: 'dengxia',
    name: '灯下吟',
    sub: '古筝 · 洞箫 · 丝弦',
    desc: 'C宫清调，温润流转，如灯下展卷得句',
    bpm: 70,
    bars: 24,
    breeze: 0.01,
  },
];

// ── 音高工具 ──────────────────────────────────────────

const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function midi(note) {
  if (typeof note === 'number') return note;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(note);
  if (!m) throw new Error('Invalid note: ' + note);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + NOTE_BASE[m[1]] + acc;
}

function m2f(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// ── 曲谱编创 ──────────────────────────────────────────
// 事件格式：{ bar, beat, inst, note, dur, vel, slide?, arp?, pan? }
// inst: 'qin' (古琴按音/散音) | 'qinh' (古琴泛音) | 'zheng' (古筝) | 'xiao' (洞箫) | 'qing' (玉磬)

function arp(bar, beat, notes, { inst = 'zheng', step = 0.16, dur = 2.4, vel = 0.36, pan0 = -0.25, pan1 = 0.25 } = {}) {
  const n = Math.max(1, notes.length - 1);
  return notes.map((note, idx) => ({
    bar,
    beat: beat + idx * step,
    inst,
    note,
    dur,
    vel: vel * (0.86 + 0.14 * (idx / n)),
    pan: pan0 + (pan1 - pan0) * (idx / n),
  }));
}

function buildYuexia() {
  const ev = [];
  const add = (bar, beat, inst, note, dur, vel, extra) => ev.push({ bar, beat, inst, note, dur, vel, ...extra });
  const push = (list) => ev.push(...list);

  // ── 散起（第 0–3 小节）：月上松梢，玉磬一声，古琴泛音浮起 ──
  add(0, 0, 'qing', 'D5', 4.5, 0.30, { pan: 0.28 });
  add(0, 0.1, 'qin', 'D2', 4.5, 0.56, { pan: -0.15 });
  add(0, 1.5, 'qin', 'A2', 3.2, 0.40, { pan: -0.08 });
  add(0, 2.5, 'qinh', 'D5', 3.0, 0.34, { pan: 0.12 });
  add(0, 3.5, 'qinh', 'A5', 2.8, 0.28, { pan: 0.24 });

  add(1, 0, 'qinh', 'F#5', 3.0, 0.32, { pan: 0.18 });
  add(1, 1.5, 'qinh', 'E5', 2.5, 0.28, { pan: 0.08 });
  add(1, 2.5, 'qinh', 'D5', 3.2, 0.30, { pan: 0.0 });
  add(1, 3.0, 'qin', 'A2', 3.0, 0.34, { pan: -0.12 });

  add(2, 0, 'qin', 'A2', 4.0, 0.46, { pan: -0.16 });
  add(2, 0.5, 'qin', 'E3', 3.2, 0.34, { pan: -0.04 });
  add(2, 1.5, 'qin', 'A4', 2.4, 0.46, { slide: -2, pan: 0.06 });
  add(2, 3.0, 'qin', 'F#4', 2.2, 0.40, { pan: 0.04 });

  add(3, 0, 'qin', 'B2', 3.8, 0.42, { pan: -0.14 });
  add(3, 0.6, 'qin', 'F#3', 2.8, 0.30, { pan: -0.05 });
  add(3, 1.5, 'qin', 'E4', 2.0, 0.38, { slide: 2, pan: 0.05 });
  add(3, 2.75, 'qin', 'D4', 2.6, 0.42, { pan: 0.0 });

  // ── 起（第 4–11 小节）：驴背吟行，古琴主奏，古筝轻伴 ──
  // Bar 4 (D)
  add(4, 0, 'qin', 'D2', 4.0, 0.52, { pan: -0.18 });
  push(arp(4, 0.15, ['D3', 'A3', 'D4'], { step: 0.22, vel: 0.26, dur: 2.8 }));
  add(4, 0, 'qin', 'D4', 1.5, 0.52, { pan: 0.04 });
  add(4, 1.0, 'qin', 'E4', 1.2, 0.44, { pan: 0.06 });
  add(4, 1.5, 'qin', 'F#4', 1.4, 0.48, { pan: 0.08 });
  add(4, 2.0, 'qin', 'A4', 2.4, 0.56, { slide: -2, pan: 0.10 });
  add(4, 3.5, 'qin', 'F#4', 1.2, 0.42, { pan: 0.06 });

  // Bar 5 (A)
  add(5, 0, 'qin', 'A2', 4.0, 0.48, { pan: -0.18 });
  push(arp(5, 0.2, ['A2', 'E3', 'A3'], { step: 0.24, vel: 0.24, dur: 2.6 }));
  add(5, 0, 'qin', 'E4', 2.2, 0.50, { pan: 0.06 });
  add(5, 1.5, 'qin', 'D4', 1.2, 0.40, { pan: 0.04 });
  add(5, 2.0, 'qin', 'B3', 1.8, 0.44, { pan: -0.02 });
  add(5, 3.0, 'qin', 'A3', 2.0, 0.42, { pan: -0.04 });

  // Bar 6 (Bm)
  add(6, 0, 'qin', 'B2', 4.0, 0.48, { pan: -0.16 });
  push(arp(6, 0.2, ['B2', 'F#3', 'B3'], { step: 0.22, vel: 0.24, dur: 2.6 }));
  add(6, 0, 'qin', 'B3', 1.6, 0.48, { pan: 0.02 });
  add(6, 1.0, 'qin', 'D4', 1.2, 0.44, { pan: 0.05 });
  add(6, 1.5, 'qin', 'E4', 1.3, 0.46, { pan: 0.08 });
  add(6, 2.0, 'qin', 'F#4', 2.3, 0.54, { slide: -2, pan: 0.10 });
  add(6, 3.5, 'qin', 'A4', 1.4, 0.46, { pan: 0.12 });

  // Bar 7 (A)
  add(7, 0, 'qin', 'A2', 4.0, 0.46, { pan: -0.16 });
  add(7, 0, 'qin', 'F#4', 1.5, 0.48, { pan: 0.08 });
  add(7, 1.0, 'qin', 'E4', 3.2, 0.50, { pan: 0.04 });
  add(7, 2.5, 'zheng', 'E3', 2.0, 0.22, { pan: -0.18 });
  add(7, 3.0, 'qinh', 'A5', 2.8, 0.26, { pan: 0.22 });

  // Bar 8 (D)
  add(8, 0, 'qin', 'D2', 4.0, 0.54, { pan: -0.18 });
  push(arp(8, 0.1, ['D3', 'F#3', 'A3', 'D4'], { step: 0.15, vel: 0.28, dur: 2.8 }));
  add(8, 0, 'qin', 'D4', 1.0, 0.48, { pan: 0.04 });
  add(8, 0.5, 'qin', 'E4', 1.0, 0.44, { pan: 0.06 });
  add(8, 1.0, 'qin', 'F#4', 1.5, 0.50, { pan: 0.08 });
  add(8, 2.0, 'qin', 'A4', 1.6, 0.54, { pan: 0.10 });
  add(8, 3.0, 'qin', 'B4', 1.8, 0.54, { slide: -2, pan: 0.12 });

  // Bar 9 (F#m → A)
  add(9, 0, 'qin', 'F#2', 3.2, 0.46, { pan: -0.16 });
  add(9, 0, 'qin', 'D5', 2.2, 0.54, { pan: 0.12 });
  add(9, 1.5, 'qin', 'B4', 1.2, 0.44, { pan: 0.08 });
  add(9, 2.0, 'qin', 'A2', 2.6, 0.42, { pan: -0.14 });
  add(9, 2.0, 'qin', 'A4', 1.6, 0.48, { pan: 0.06 });
  add(9, 3.0, 'qin', 'F#4', 1.6, 0.44, { pan: 0.04 });

  // Bar 10 (Em)
  add(10, 0, 'qin', 'E2', 3.8, 0.48, { pan: -0.16 });
  push(arp(10, 0.2, ['E3', 'B3', 'E4'], { step: 0.2, vel: 0.24, dur: 2.4 }));
  add(10, 0, 'qin', 'E4', 1.4, 0.46, { pan: 0.05 });
  add(10, 1.0, 'qin', 'F#4', 1.0, 0.44, { pan: 0.07 });
  add(10, 1.5, 'qin', 'E4', 1.0, 0.40, { pan: 0.05 });
  add(10, 2.0, 'qin', 'D4', 1.6, 0.46, { pan: 0.02 });
  add(10, 3.0, 'qin', 'B3', 1.8, 0.42, { pan: -0.02 });

  // Bar 11 (D)
  add(11, 0, 'qin', 'D2', 4.5, 0.54, { pan: -0.16 });
  add(11, 0.5, 'qin', 'A2', 3.5, 0.36, { pan: -0.08 });
  add(11, 0, 'qin', 'D4', 3.6, 0.52, { pan: 0.02 });
  add(11, 2.5, 'qinh', 'A5', 2.8, 0.26, { pan: 0.20 });
  add(11, 3.25, 'qing', 'A5', 3.8, 0.20, { pan: -0.26 });

  // ── 承（第 12–19 小节）：鸟宿池边，洞箫悠然入画，古筝流水相和 ──
  // Bar 12 (D)
  add(12, 0, 'qin', 'D2', 4.2, 0.52, { pan: -0.20 });
  push(arp(12, 0, ['D3', 'A3', 'D4', 'E4', 'F#4', 'A4'], { step: 0.38, vel: 0.28, dur: 2.5 }));
  add(12, 0, 'xiao', 'A4', 1.5, 0.46, { scoop: true, pan: -0.06 });
  add(12, 1.5, 'xiao', 'B4', 0.55, 0.42, { pan: -0.04 });
  add(12, 2.0, 'xiao', 'D5', 2.1, 0.50, { pan: -0.02 });

  // Bar 13 (Bm)
  add(13, 0, 'qin', 'B2', 4.0, 0.48, { pan: -0.20 });
  push(arp(13, 0, ['B2', 'F#3', 'B3', 'D4', 'F#4'], { step: 0.45, vel: 0.26, dur: 2.5 }));
  add(13, 0, 'xiao', 'B4', 1.0, 0.44, { pan: -0.04 });
  add(13, 1.0, 'xiao', 'A4', 0.55, 0.40, { pan: -0.06 });
  add(13, 1.5, 'xiao', 'F#4', 0.55, 0.40, { pan: -0.06 });
  add(13, 2.0, 'xiao', 'E4', 2.0, 0.44, { pan: -0.08 });

  // Bar 14 (G)
  add(14, 0, 'qin', 'G2', 4.0, 0.46, { pan: -0.20 });
  push(arp(14, 0, ['G2', 'D3', 'G3', 'B3', 'D4'], { step: 0.45, vel: 0.26, dur: 2.4 }));
  add(14, 0, 'xiao', 'F#4', 1.0, 0.42, { scoop: true, pan: -0.06 });
  add(14, 1.0, 'xiao', 'A4', 1.0, 0.46, { pan: -0.04 });
  add(14, 2.0, 'xiao', 'B4', 1.5, 0.48, { pan: -0.02 });
  add(14, 3.5, 'xiao', 'A4', 0.55, 0.40, { pan: -0.04 });

  // Bar 15 (A)
  add(15, 0, 'qin', 'A2', 4.0, 0.48, { pan: -0.18 });
  add(15, 0, 'xiao', 'F#4', 1.0, 0.44, { pan: -0.06 });
  add(15, 1.0, 'xiao', 'E4', 2.6, 0.42, { pan: -0.08 });
  add(15, 2.0, 'qin', 'A3', 1.5, 0.36, { pan: 0.14 });
  add(15, 2.75, 'qin', 'B3', 1.5, 0.36, { pan: 0.14 });
  add(15, 3.5, 'qin', 'D4', 1.4, 0.40, { pan: 0.12 });

  // Bar 16 (D)
  add(16, 0, 'qin', 'D2', 4.2, 0.54, { pan: -0.20 });
  push(arp(16, 0, ['D3', 'A3', 'D4', 'F#4', 'A4'], { step: 0.18, vel: 0.30, dur: 2.8 }));
  add(16, 0, 'xiao', 'D5', 1.5, 0.50, { scoop: true, pan: -0.02 });
  add(16, 1.5, 'xiao', 'E5', 0.55, 0.48, { pan: 0.0 });
  add(16, 2.0, 'xiao', 'F#5', 1.05, 0.52, { pan: 0.02 });
  add(16, 3.0, 'xiao', 'D5', 1.05, 0.46, { pan: -0.02 });

  // Bar 17 (Bm)
  add(17, 0, 'qin', 'B2', 4.0, 0.48, { pan: -0.20 });
  push(arp(17, 0.25, ['B2', 'F#3', 'B3', 'D4'], { step: 0.5, vel: 0.25, dur: 2.4 }));
  add(17, 0, 'xiao', 'B4', 1.5, 0.46, { pan: -0.04 });
  add(17, 1.5, 'xiao', 'A4', 0.55, 0.42, { pan: -0.06 });
  add(17, 2.0, 'xiao', 'F#4', 1.05, 0.44, { pan: -0.06 });
  add(17, 3.0, 'xiao', 'A4', 1.05, 0.44, { pan: -0.04 });

  // Bar 18 (Em → A)
  add(18, 0, 'qin', 'E2', 2.4, 0.46, { pan: -0.18 });
  add(18, 2.0, 'qin', 'A2', 2.4, 0.46, { pan: -0.16 });
  add(18, 0.5, 'zheng', 'B3', 2.0, 0.24, { pan: 0.16 });
  add(18, 2.5, 'zheng', 'E4', 2.0, 0.24, { pan: 0.20 });
  add(18, 0, 'xiao', 'E4', 1.0, 0.42, { pan: -0.06 });
  add(18, 1.0, 'xiao', 'F#4', 0.55, 0.42, { pan: -0.04 });
  add(18, 1.5, 'xiao', 'A4', 0.55, 0.44, { pan: -0.02 });
  add(18, 2.0, 'xiao', 'F#4', 1.05, 0.44, { pan: -0.04 });
  add(18, 3.0, 'xiao', 'E4', 1.05, 0.40, { pan: -0.06 });

  // Bar 19 (D)
  add(19, 0, 'qin', 'D2', 4.5, 0.52, { pan: -0.18 });
  add(19, 0, 'xiao', 'D4', 3.2, 0.44, { pan: -0.06 });
  add(19, 1.5, 'qinh', 'D5', 2.6, 0.28, { pan: 0.14 });
  add(19, 2.5, 'qinh', 'F#5', 2.6, 0.26, { pan: 0.22 });
  add(19, 3.25, 'qinh', 'A5', 2.6, 0.24, { pan: 0.28 });

  // ── 转（第 20–27 小节）：推敲未定，转入羽调，琴箫对答 ──
  // Bar 20 (Bm)
  add(20, 0, 'qin', 'B2', 4.2, 0.52, { pan: -0.18 });
  add(20, 0.5, 'qin', 'F#3', 3.2, 0.34, { pan: -0.08 });
  add(20, 0, 'qin', 'B3', 1.4, 0.48, { pan: 0.08 });
  add(20, 1.0, 'qin', 'D4', 1.4, 0.48, { pan: 0.10 });
  add(20, 2.0, 'qin', 'E4', 2.0, 0.52, { slide: -2, pan: 0.12 });
  add(20, 3.5, 'qin', 'F#4', 1.4, 0.46, { pan: 0.12 });

  // Bar 21 (F#m)
  add(21, 0, 'qin', 'F#2', 4.0, 0.48, { pan: -0.18 });
  add(21, 0.6, 'qin', 'A3', 2.8, 0.30, { pan: -0.05 });
  add(21, 0, 'qin', 'A4', 1.6, 0.52, { pan: 0.12 });
  add(21, 1.0, 'qin', 'F#4', 1.4, 0.46, { pan: 0.10 });
  add(21, 2.0, 'qin', 'E4', 2.6, 0.48, { slide: 2, pan: 0.08 });

  // Bar 22 (Em) — 洞箫作答
  add(22, 0, 'qin', 'E2', 4.0, 0.48, { pan: -0.18 });
  add(22, 0.5, 'qin', 'B2', 3.2, 0.34, { pan: -0.10 });
  add(22, 0, 'xiao', 'E5', 1.5, 0.46, { scoop: true, pan: -0.06 });
  add(22, 1.5, 'xiao', 'D5', 0.55, 0.42, { pan: -0.06 });
  add(22, 2.0, 'xiao', 'B4', 1.05, 0.44, { pan: -0.08 });
  add(22, 3.0, 'xiao', 'A4', 1.05, 0.42, { pan: -0.08 });

  // Bar 23 (Bm) — 寺门一叩（玉磬轻响）
  add(23, 0, 'qin', 'B2', 4.2, 0.48, { pan: -0.18 });
  add(23, 0, 'xiao', 'F#4', 1.0, 0.42, { pan: -0.06 });
  add(23, 1.0, 'xiao', 'A4', 1.0, 0.46, { pan: -0.04 });
  add(23, 2.0, 'xiao', 'B4', 2.2, 0.46, { pan: -0.04 });
  add(23, 2.5, 'qing', 'B5', 4.2, 0.22, { pan: 0.30 });

  // Bar 24 (G)
  add(24, 0, 'qin', 'G2', 4.0, 0.48, { pan: -0.18 });
  push(arp(24, 0.2, ['G3', 'B3', 'D4'], { step: 0.3, vel: 0.25, dur: 2.5 }));
  add(24, 0, 'qin', 'G4', 0.9, 0.46, { pan: 0.08 });
  add(24, 0.5, 'qin', 'F#4', 1.0, 0.46, { pan: 0.08 });
  add(24, 1.0, 'qin', 'E4', 1.4, 0.48, { pan: 0.06 });
  add(24, 2.0, 'qin', 'D4', 1.4, 0.46, { pan: 0.04 });
  add(24, 3.0, 'qin', 'E4', 1.6, 0.46, { pan: 0.06 });

  // Bar 25 (A)
  add(25, 0, 'qin', 'A2', 4.0, 0.50, { pan: -0.18 });
  add(25, 0, 'qin', 'F#4', 1.8, 0.50, { slide: -2, pan: 0.10 });
  add(25, 1.5, 'qin', 'A4', 1.2, 0.48, { pan: 0.10 });
  add(25, 2.0, 'qin', 'B4', 1.4, 0.50, { pan: 0.12 });
  add(25, 3.0, 'qin', 'A4', 1.6, 0.46, { pan: 0.10 });
  add(25, 2.0, 'xiao', 'A4', 1.0, 0.34, { pan: -0.10 });
  add(25, 3.0, 'xiao', 'B4', 1.1, 0.38, { pan: -0.08 });

  // Bar 26 (Em → A)
  add(26, 0, 'qin', 'E2', 2.4, 0.46, { pan: -0.18 });
  add(26, 2.0, 'qin', 'A2', 2.4, 0.46, { pan: -0.16 });
  push(arp(26, 0.25, ['A3', 'B3', 'D4', 'E4'], { step: 0.45, vel: 0.24, dur: 2.4 }));
  add(26, 0, 'xiao', 'D5', 1.05, 0.46, { pan: -0.04 });
  add(26, 1.0, 'xiao', 'B4', 1.05, 0.44, { pan: -0.06 });
  add(26, 2.0, 'xiao', 'A4', 1.05, 0.44, { pan: -0.06 });
  add(26, 3.0, 'xiao', 'F#4', 1.05, 0.42, { pan: -0.08 });

  // Bar 27 (A 留气)
  add(27, 0, 'qin', 'A2', 4.2, 0.48, { pan: -0.18 });
  add(27, 0.6, 'qin', 'E3', 3.4, 0.34, { pan: -0.08 });
  add(27, 0, 'xiao', 'E4', 2.5, 0.42, { pan: -0.06 });
  add(27, 2.5, 'xiao', 'F#4', 1.6, 0.44, { pan: -0.04 });

  // ── 合（第 28–31 小节）：月下归扉，豁然清朗，余韵渐散 ──
  // Bar 28 (D)
  add(28, 0, 'qin', 'D2', 4.2, 0.54, { pan: -0.18 });
  push(arp(28, 0.1, ['D3', 'A3', 'D4', 'F#4'], { step: 0.24, vel: 0.28, dur: 3.0 }));
  add(28, 0, 'xiao', 'A4', 1.5, 0.46, { pan: -0.04 });
  add(28, 1.5, 'xiao', 'F#4', 0.55, 0.42, { pan: -0.06 });
  add(28, 2.0, 'xiao', 'E4', 1.05, 0.42, { pan: -0.06 });
  add(28, 3.0, 'xiao', 'D4', 1.2, 0.42, { pan: -0.08 });

  // Bar 29 (Bm → A)
  add(29, 0, 'qin', 'B2', 2.4, 0.46, { pan: -0.16 });
  add(29, 2.0, 'qin', 'A2', 2.6, 0.46, { pan: -0.16 });
  add(29, 0, 'qin', 'B3', 1.4, 0.46, { pan: 0.04 });
  add(29, 1.0, 'qin', 'D4', 1.4, 0.46, { pan: 0.06 });
  add(29, 2.0, 'qin', 'F#4', 1.4, 0.48, { pan: 0.08 });
  add(29, 3.0, 'qin', 'E4', 1.8, 0.44, { pan: 0.06 });

  // Bar 30 (D 归宫)
  add(30, 0, 'qin', 'D2', 5.0, 0.54, { pan: -0.18 });
  add(30, 0.4, 'qin', 'A2', 4.4, 0.38, { pan: -0.08 });
  add(30, 0, 'xiao', 'F#4', 1.5, 0.42, { pan: -0.04 });
  add(30, 1.5, 'xiao', 'E4', 0.55, 0.38, { pan: -0.06 });
  add(30, 2.0, 'xiao', 'D4', 2.4, 0.40, { pan: -0.06 });
  add(30, 2.0, 'qin', 'D4', 3.6, 0.44, { pan: 0.04 });
  add(30, 2.2, 'qing', 'D5', 4.6, 0.24, { pan: 0.26 });

  // Bar 31 (泛音留白)
  add(31, 0, 'qinh', 'A5', 3.0, 0.26, { pan: 0.22 });
  add(31, 1.25, 'qinh', 'F#5', 2.8, 0.24, { pan: 0.12 });
  add(31, 2.5, 'qinh', 'D5', 3.4, 0.26, { pan: 0.0 });

  return ev;
}

function buildQiufeng() {
  // 《秋风辞》：A 羽 / D 徵色（A, B, D, E, F#），沉静疏朗，24 小节
  const ev = [];
  const add = (bar, beat, inst, note, dur, vel, extra) => ev.push({ bar, beat, inst, note, dur, vel, ...extra });

  // 散起（0–3）
  add(0, 0, 'qin', 'A2', 4.8, 0.56, { pan: -0.14 });
  add(0, 1.5, 'qin', 'E3', 3.6, 0.38, { pan: -0.04 });
  add(0, 2.5, 'qinh', 'A5', 3.4, 0.28, { pan: 0.18 });
  add(1, 0, 'qinh', 'E5', 3.2, 0.28, { pan: 0.10 });
  add(1, 1.75, 'qin', 'B3', 2.8, 0.44, { slide: -2, pan: 0.06 });
  add(1, 3.0, 'qin', 'A3', 3.0, 0.42, { pan: 0.02 });
  add(2, 0, 'qin', 'D2', 4.4, 0.52, { pan: -0.16 });
  add(2, 1.0, 'qin', 'F#4', 2.4, 0.48, { slide: -2, pan: 0.08 });
  add(2, 2.75, 'qin', 'E4', 2.6, 0.44, { pan: 0.04 });
  add(3, 0, 'qin', 'E2', 4.2, 0.48, { pan: -0.14 });
  add(3, 1.0, 'qin', 'B3', 3.0, 0.44, { pan: 0.02 });
  add(3, 3.0, 'qing', 'E5', 4.2, 0.22, { pan: 0.26 });

  // 第一段：古琴独吟（4–11）
  add(4, 0, 'qin', 'A2', 4.2, 0.52, { pan: -0.16 });
  add(4, 0, 'qin', 'E4', 1.8, 0.50, { pan: 0.06 });
  add(4, 1.5, 'qin', 'F#4', 1.2, 0.46, { pan: 0.08 });
  add(4, 2.0, 'qin', 'A4', 2.4, 0.54, { slide: -2, pan: 0.10 });
  add(4, 3.5, 'qin', 'F#4', 1.2, 0.42, { pan: 0.08 });

  add(5, 0, 'qin', 'E2', 4.0, 0.48, { pan: -0.16 });
  add(5, 0, 'qin', 'E4', 1.6, 0.48, { pan: 0.06 });
  add(5, 1.5, 'qin', 'D4', 1.4, 0.44, { pan: 0.04 });
  add(5, 2.5, 'qin', 'B3', 2.4, 0.46, { pan: 0.0 });

  add(6, 0, 'qin', 'D2', 4.0, 0.50, { pan: -0.16 });
  add(6, 0, 'qin', 'D4', 1.5, 0.48, { pan: 0.04 });
  add(6, 1.0, 'qin', 'E4', 1.5, 0.48, { pan: 0.06 });
  add(6, 2.0, 'qin', 'F#4', 2.0, 0.52, { slide: -2, pan: 0.08 });
  add(6, 3.5, 'qin', 'E4', 1.2, 0.42, { pan: 0.06 });

  add(7, 0, 'qin', 'A2', 4.4, 0.50, { pan: -0.16 });
  add(7, 0, 'qin', 'D4', 1.4, 0.44, { pan: 0.04 });
  add(7, 1.0, 'qin', 'B3', 1.6, 0.44, { pan: 0.02 });
  add(7, 2.0, 'qin', 'A3', 3.0, 0.48, { pan: 0.0 });
  add(7, 3.25, 'qinh', 'E5', 2.8, 0.24, { pan: 0.20 });

  add(8, 0, 'qin', 'B2', 4.0, 0.48, { pan: -0.16 });
  add(8, 0, 'qin', 'B3', 1.4, 0.46, { pan: 0.02 });
  add(8, 1.0, 'qin', 'D4', 1.4, 0.46, { pan: 0.06 });
  add(8, 2.0, 'qin', 'F#4', 1.6, 0.50, { pan: 0.10 });
  add(8, 3.0, 'qin', 'A4', 1.8, 0.52, { slide: -2, pan: 0.12 });

  add(9, 0, 'qin', 'F#2', 4.0, 0.46, { pan: -0.16 });
  add(9, 0, 'qin', 'B4', 2.0, 0.52, { pan: 0.12 });
  add(9, 1.5, 'qin', 'A4', 1.4, 0.46, { pan: 0.10 });
  add(9, 2.5, 'qin', 'F#4', 2.2, 0.46, { pan: 0.06 });

  add(10, 0, 'qin', 'E2', 4.0, 0.48, { pan: -0.16 });
  add(10, 0, 'qin', 'E4', 1.4, 0.46, { pan: 0.06 });
  add(10, 1.0, 'qin', 'F#4', 1.2, 0.44, { pan: 0.08 });
  add(10, 2.0, 'qin', 'D4', 1.4, 0.44, { pan: 0.04 });
  add(10, 3.0, 'qin', 'B3', 1.8, 0.42, { pan: 0.0 });

  add(11, 0, 'qin', 'A2', 4.6, 0.52, { pan: -0.16 });
  add(11, 0.5, 'qin', 'E3', 3.6, 0.34, { pan: -0.06 });
  add(11, 0, 'qin', 'A3', 3.6, 0.48, { pan: 0.0 });

  // 第二段：洞箫秋怨，古琴沉托（12–19）
  add(12, 0, 'qin', 'A2', 4.2, 0.50, { pan: -0.18 });
  add(12, 2.0, 'qin', 'E3', 2.8, 0.36, { pan: -0.08 });
  add(12, 0, 'xiao', 'E5', 2.0, 0.48, { scoop: true, pan: -0.04 });
  add(12, 2.0, 'xiao', 'D5', 1.05, 0.44, { pan: -0.06 });
  add(12, 3.0, 'xiao', 'B4', 1.1, 0.44, { pan: -0.06 });

  add(13, 0, 'qin', 'D2', 4.0, 0.48, { pan: -0.18 });
  add(13, 1.5, 'qin', 'A3', 2.8, 0.36, { pan: 0.08 });
  add(13, 0, 'xiao', 'A4', 1.5, 0.44, { pan: -0.06 });
  add(13, 1.5, 'xiao', 'B4', 0.55, 0.42, { pan: -0.04 });
  add(13, 2.0, 'xiao', 'F#4', 2.1, 0.44, { pan: -0.08 });

  add(14, 0, 'qin', 'E2', 4.0, 0.48, { pan: -0.18 });
  add(14, 2.0, 'qin', 'B2', 2.8, 0.38, { pan: -0.10 });
  add(14, 0, 'xiao', 'E4', 1.0, 0.40, { pan: -0.08 });
  add(14, 1.0, 'xiao', 'F#4', 1.0, 0.44, { pan: -0.06 });
  add(14, 2.0, 'xiao', 'A4', 1.5, 0.46, { pan: -0.04 });
  add(14, 3.5, 'xiao', 'B4', 0.55, 0.42, { pan: -0.02 });

  add(15, 0, 'qin', 'A2', 4.2, 0.50, { pan: -0.18 });
  add(15, 0, 'xiao', 'A4', 2.8, 0.44, { pan: -0.06 });
  add(15, 2.25, 'qin', 'E4', 2.0, 0.40, { slide: -2, pan: 0.14 });
  add(15, 3.25, 'qin', 'D4', 1.6, 0.36, { pan: 0.12 });

  add(16, 0, 'qin', 'D2', 4.2, 0.52, { pan: -0.18 });
  add(16, 0.8, 'qin', 'A2', 3.4, 0.36, { pan: -0.08 });
  add(16, 0, 'xiao', 'D5', 1.5, 0.48, { scoop: true, pan: -0.02 });
  add(16, 1.5, 'xiao', 'E5', 0.55, 0.46, { pan: 0.0 });
  add(16, 2.0, 'xiao', 'F#5', 1.05, 0.50, { pan: 0.02 });
  add(16, 3.0, 'xiao', 'E5', 1.05, 0.46, { pan: 0.0 });

  add(17, 0, 'qin', 'B2', 4.0, 0.48, { pan: -0.18 });
  add(17, 1.5, 'qin', 'F#3', 2.8, 0.34, { pan: 0.06 });
  add(17, 0, 'xiao', 'D5', 1.05, 0.44, { pan: -0.04 });
  add(17, 1.0, 'xiao', 'B4', 1.05, 0.44, { pan: -0.06 });
  add(17, 2.0, 'xiao', 'A4', 2.1, 0.44, { pan: -0.06 });

  add(18, 0, 'qin', 'E2', 4.0, 0.48, { pan: -0.18 });
  add(18, 0, 'xiao', 'F#4', 1.5, 0.44, { pan: -0.06 });
  add(18, 1.5, 'xiao', 'E4', 0.55, 0.40, { pan: -0.08 });
  add(18, 2.0, 'xiao', 'D4', 1.05, 0.40, { pan: -0.08 });
  add(18, 3.0, 'xiao', 'B3', 1.15, 0.38, { pan: -0.08 });

  add(19, 0, 'qin', 'A2', 4.4, 0.50, { pan: -0.18 });
  add(19, 0, 'xiao', 'A4', 3.0, 0.40, { pan: -0.06 });
  add(19, 2.0, 'qing', 'A5', 4.2, 0.22, { pan: 0.26 });

  // 尾声（20–23）：风止叶落，泛音归寂
  add(20, 0, 'qin', 'D2', 4.0, 0.48, { pan: -0.16 });
  add(20, 0, 'qin', 'F#4', 1.8, 0.46, { slide: -2, pan: 0.08 });
  add(20, 2.0, 'qin', 'E4', 2.2, 0.44, { pan: 0.06 });

  add(21, 0, 'qin', 'E2', 4.0, 0.46, { pan: -0.16 });
  add(21, 0, 'qin', 'D4', 1.6, 0.44, { pan: 0.04 });
  add(21, 2.0, 'qin', 'B3', 2.4, 0.42, { pan: 0.02 });

  add(22, 0, 'qin', 'A2', 5.0, 0.54, { pan: -0.16 });
  add(22, 0.5, 'qin', 'E3', 4.2, 0.36, { pan: -0.06 });
  add(22, 0, 'qin', 'A3', 4.0, 0.46, { pan: 0.04 });
  add(22, 2.0, 'qinh', 'A5', 3.2, 0.26, { pan: 0.18 });

  add(23, 0, 'qinh', 'E5', 3.0, 0.24, { pan: 0.08 });
  add(23, 1.75, 'qinh', 'A4', 3.6, 0.26, { pan: 0.0 });

  return ev;
}

function buildDengxia() {
  // 《灯下吟》：C 宫调（C, D, E, G, A），古筝流转、洞箫温润，24 小节
  const ev = [];
  const add = (bar, beat, inst, note, dur, vel, extra) => ev.push({ bar, beat, inst, note, dur, vel, ...extra });
  const push = (list) => ev.push(...list);

  // 引子（0–3）：古筝轻拂，烛影摇红
  push(arp(0, 0, ['C3', 'G3', 'C4', 'D4', 'E4', 'G4'], { step: 0.24, vel: 0.34, dur: 3.0 }));
  add(0, 0, 'qin', 'C2', 4.2, 0.48, { pan: -0.18 });
  add(1, 0, 'qin', 'A2', 4.0, 0.44, { pan: -0.18 });
  push(arp(1, 0, ['A2', 'E3', 'A3', 'C4', 'E4'], { step: 0.32, vel: 0.30, dur: 2.8 }));
  add(2, 0, 'qin', 'F2', 4.0, 0.44, { pan: -0.18 });
  push(arp(2, 0, ['F3', 'A3', 'C4', 'D4', 'G4'], { step: 0.32, vel: 0.30, dur: 2.8 }));
  add(3, 0, 'qin', 'G2', 4.0, 0.46, { pan: -0.18 });
  add(3, 0, 'zheng', 'E4', 1.6, 0.40, { pan: 0.08 });
  add(3, 1.5, 'zheng', 'D4', 2.4, 0.38, { pan: 0.04 });
  add(3, 2.75, 'qinh', 'G5', 2.8, 0.26, { pan: 0.22 });

  // 第一段（4–11）：古筝主奏，清雅流丽
  add(4, 0, 'qin', 'C2', 4.0, 0.48, { pan: -0.20 });
  add(4, 0, 'zheng', 'E4', 1.2, 0.46, { pan: 0.08 });
  add(4, 1.0, 'zheng', 'G4', 1.2, 0.48, { pan: 0.12 });
  add(4, 1.5, 'zheng', 'A4', 1.4, 0.50, { pan: 0.14 });
  add(4, 2.0, 'zheng', 'C5', 2.0, 0.52, { pan: 0.18 });
  add(4, 3.0, 'zheng', 'A4', 1.4, 0.44, { pan: 0.14 });
  add(4, 0.5, 'zheng', 'G3', 2.0, 0.24, { pan: -0.14 });
  add(4, 2.5, 'zheng', 'E3', 2.0, 0.24, { pan: -0.16 });

  add(5, 0, 'qin', 'G2', 4.0, 0.46, { pan: -0.20 });
  add(5, 0, 'zheng', 'G4', 1.8, 0.48, { pan: 0.10 });
  add(5, 1.5, 'zheng', 'E4', 1.2, 0.42, { pan: 0.06 });
  add(5, 2.0, 'zheng', 'D4', 2.2, 0.44, { pan: 0.02 });
  push(arp(5, 2.5, ['G3', 'C4', 'D4'], { step: 0.35, vel: 0.24, dur: 2.2 }));

  add(6, 0, 'qin', 'A2', 4.0, 0.46, { pan: -0.20 });
  add(6, 0, 'zheng', 'C4', 1.2, 0.44, { pan: 0.02 });
  add(6, 1.0, 'zheng', 'D4', 1.2, 0.44, { pan: 0.04 });
  add(6, 1.5, 'zheng', 'E4', 1.4, 0.46, { pan: 0.08 });
  add(6, 2.0, 'zheng', 'G4', 1.6, 0.50, { pan: 0.12 });
  add(6, 3.0, 'zheng', 'E4', 1.6, 0.44, { pan: 0.08 });
  add(6, 0.5, 'zheng', 'E3', 2.0, 0.24, { pan: -0.14 });

  add(7, 0, 'qin', 'G2', 4.0, 0.46, { pan: -0.20 });
  add(7, 0, 'zheng', 'D4', 2.6, 0.46, { pan: 0.04 });
  push(arp(7, 1.5, ['G3', 'A3', 'C4', 'D4'], { step: 0.45, vel: 0.25, dur: 2.4 }));

  add(8, 0, 'qin', 'C2', 4.0, 0.50, { pan: -0.20 });
  push(arp(8, 0, ['C3', 'G3', 'C4', 'E4'], { step: 0.16, vel: 0.28, dur: 2.6 }));
  add(8, 0, 'zheng', 'E4', 1.2, 0.48, { pan: 0.08 });
  add(8, 1.0, 'zheng', 'G4', 1.2, 0.48, { pan: 0.12 });
  add(8, 2.0, 'zheng', 'A4', 1.4, 0.52, { pan: 0.14 });
  add(8, 3.0, 'zheng', 'D5', 1.6, 0.52, { pan: 0.20 });

  add(9, 0, 'qin', 'A2', 4.0, 0.46, { pan: -0.20 });
  add(9, 0, 'zheng', 'C5', 1.8, 0.52, { pan: 0.18 });
  add(9, 1.5, 'zheng', 'A4', 1.2, 0.46, { pan: 0.14 });
  add(9, 2.0, 'zheng', 'G4', 1.4, 0.48, { pan: 0.10 });
  add(9, 3.0, 'zheng', 'E4', 1.4, 0.44, { pan: 0.08 });

  add(10, 0, 'qin', 'D2', 2.2, 0.44, { pan: -0.18 });
  add(10, 2.0, 'qin', 'G2', 2.4, 0.46, { pan: -0.18 });
  add(10, 0, 'zheng', 'D4', 1.2, 0.44, { pan: 0.04 });
  add(10, 1.0, 'zheng', 'E4', 1.2, 0.46, { pan: 0.08 });
  add(10, 2.0, 'zheng', 'G4', 1.4, 0.48, { pan: 0.10 });
  add(10, 3.0, 'zheng', 'D4', 1.4, 0.44, { pan: 0.04 });

  add(11, 0, 'qin', 'C2', 4.4, 0.50, { pan: -0.18 });
  add(11, 0, 'zheng', 'C4', 3.4, 0.48, { pan: 0.02 });
  push(arp(11, 1.0, ['G3', 'C4', 'E4', 'G4'], { step: 0.45, vel: 0.26, dur: 2.6 }));

  // 第二段（12–19）：洞箫唱和，欣然得句
  add(12, 0, 'qin', 'C2', 4.0, 0.50, { pan: -0.20 });
  push(arp(12, 0, ['C3', 'G3', 'C4', 'E4', 'G4'], { step: 0.42, vel: 0.26, dur: 2.4 }));
  add(12, 0, 'xiao', 'G4', 1.5, 0.44, { scoop: true, pan: -0.06 });
  add(12, 1.5, 'xiao', 'A4', 0.55, 0.42, { pan: -0.04 });
  add(12, 2.0, 'xiao', 'C5', 2.0, 0.48, { pan: -0.02 });

  add(13, 0, 'qin', 'A2', 4.0, 0.46, { pan: -0.20 });
  push(arp(13, 0, ['A2', 'E3', 'A3', 'C4', 'E4'], { step: 0.45, vel: 0.25, dur: 2.4 }));
  add(13, 0, 'xiao', 'D5', 1.5, 0.48, { pan: 0.0 });
  add(13, 1.5, 'xiao', 'C5', 0.55, 0.44, { pan: -0.02 });
  add(13, 2.0, 'xiao', 'A4', 1.05, 0.44, { pan: -0.04 });
  add(13, 3.0, 'xiao', 'G4', 1.05, 0.42, { pan: -0.06 });

  add(14, 0, 'qin', 'F2', 4.0, 0.46, { pan: -0.20 });
  push(arp(14, 0, ['F3', 'C4', 'D4', 'G4'], { step: 0.5, vel: 0.25, dur: 2.4 }));
  add(14, 0, 'xiao', 'A4', 1.05, 0.44, { pan: -0.04 });
  add(14, 1.0, 'xiao', 'C5', 1.05, 0.46, { pan: -0.02 });
  add(14, 2.0, 'xiao', 'D5', 1.5, 0.48, { pan: 0.0 });
  add(14, 3.5, 'xiao', 'C5', 0.55, 0.42, { pan: -0.02 });

  add(15, 0, 'qin', 'G2', 4.0, 0.46, { pan: -0.20 });
  add(15, 0, 'xiao', 'A4', 1.0, 0.44, { pan: -0.04 });
  add(15, 1.0, 'xiao', 'G4', 2.6, 0.44, { pan: -0.06 });
  add(15, 2.5, 'qinh', 'C6', 2.6, 0.22, { pan: 0.22 });

  add(16, 0, 'qin', 'C2', 4.0, 0.50, { pan: -0.20 });
  push(arp(16, 0, ['C3', 'G3', 'C4', 'D4', 'E4', 'G4'], { step: 0.16, vel: 0.30, dur: 2.8 }));
  add(16, 0, 'xiao', 'E5', 1.5, 0.50, { scoop: true, pan: 0.0 });
  add(16, 1.5, 'xiao', 'D5', 0.55, 0.46, { pan: -0.02 });
  add(16, 2.0, 'xiao', 'C5', 1.05, 0.46, { pan: -0.04 });
  add(16, 3.0, 'xiao', 'A4', 1.05, 0.44, { pan: -0.06 });

  add(17, 0, 'qin', 'A2', 4.0, 0.46, { pan: -0.20 });
  push(arp(17, 0.25, ['A2', 'E3', 'A3', 'C4'], { step: 0.5, vel: 0.25, dur: 2.4 }));
  add(17, 0, 'xiao', 'G4', 1.5, 0.44, { pan: -0.06 });
  add(17, 1.5, 'xiao', 'A4', 0.55, 0.44, { pan: -0.04 });
  add(17, 2.0, 'xiao', 'C5', 2.0, 0.46, { pan: -0.02 });

  add(18, 0, 'qin', 'D2', 2.2, 0.44, { pan: -0.18 });
  add(18, 2.0, 'qin', 'G2', 2.4, 0.46, { pan: -0.18 });
  add(18, 0, 'xiao', 'A4', 1.05, 0.44, { pan: -0.04 });
  add(18, 1.0, 'xiao', 'G4', 1.05, 0.44, { pan: -0.06 });
  add(18, 2.0, 'xiao', 'E4', 1.05, 0.42, { pan: -0.06 });
  add(18, 3.0, 'xiao', 'D4', 1.05, 0.40, { pan: -0.08 });

  add(19, 0, 'qin', 'C2', 4.4, 0.50, { pan: -0.18 });
  add(19, 0, 'xiao', 'C4', 3.2, 0.42, { pan: -0.06 });
  add(19, 2.0, 'qing', 'G5', 4.0, 0.20, { pan: 0.24 });

  // 尾声（20–23）：归灯静坐
  add(20, 0, 'qin', 'F2', 4.0, 0.46, { pan: -0.18 });
  push(arp(20, 0, ['F3', 'A3', 'C4', 'G4'], { step: 0.45, vel: 0.28, dur: 2.6 }));
  add(21, 0, 'qin', 'G2', 4.0, 0.46, { pan: -0.18 });
  add(21, 0, 'zheng', 'E4', 1.6, 0.44, { pan: 0.08 });
  add(21, 1.5, 'zheng', 'D4', 2.4, 0.42, { pan: 0.04 });
  add(22, 0, 'qin', 'C2', 5.0, 0.52, { pan: -0.18 });
  push(arp(22, 0.1, ['C3', 'G3', 'C4', 'E4', 'G4'], { step: 0.26, vel: 0.30, dur: 3.4 }));
  add(23, 0, 'qinh', 'G5', 3.0, 0.24, { pan: 0.18 });
  add(23, 1.5, 'qinh', 'C5', 3.4, 0.26, { pan: 0.0 });

  return ev;
}

const SCORES = {
  yuexia: buildYuexia(),
  qiufeng: buildQiufeng(),
  dengxia: buildDengxia(),
};

// ── 声学物理建模引擎 ──────────────────────────────────

class AcousticEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.moodFilter = null;
    this.dryGain = null;
    this.wetGain = null;
    this.reverb = null;
    this.breezeGain = null;
    this.breezeNodes = null;
    this.noiseBuf = null;
    this.stringCache = new Map();
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('此浏览器不支持 Web Audio');
    const ctx = new AC();
    this.ctx = ctx;

    // 主限幅器：柔顺防削波
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 3;
    comp.attack.value = 0.012;
    comp.release.value = 0.22;

    this.master = ctx.createGain();
    this.master.gain.value = 0.72;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // 随境微调滤波器（开局读谜面时略暖，揭晓时更清朗）
    this.moodFilter = ctx.createBiquadFilter();
    this.moodFilter.type = 'lowpass';
    this.moodFilter.frequency.value = 6400;
    this.moodFilter.Q.value = 0.4;

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.0001;
    this.musicBus.connect(this.moodFilter);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.78;
    this.sfxBus.connect(this.master);

    // 庭院回响（卷积混响）
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeCourtyardIR(ctx, 2.7);

    const sfxWet = ctx.createGain();
    sfxWet.gain.value = 0.28;
    this.sfxBus.connect(sfxWet);
    sfxWet.connect(this.reverb);

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.74;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 0.42;

    this.moodFilter.connect(this.dryGain);
    this.moodFilter.connect(this.reverb);
    this.dryGain.connect(this.master);
    this.reverb.connect(this.wetGain);
    this.wetGain.connect(this.master);

    // 预生成粉红噪声（供洞箫气声与微风底噪）
    this.noiseBuf = this._makePinkNoise(ctx, 4.0);
    this._startBreeze(ctx);

    return ctx;
  }

  _makePinkNoise(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const out = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.06;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  // 算法生成木构庭院脉冲响应：柔和早期反射 + 渐暗温暖尾音
  _makeCourtyardIR(ctx, duration) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(2, len, sr);
    const early = [0.014, 0.027, 0.041, 0.059, 0.078];
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.pow(1 - i / len, 2.35) * Math.exp(-t * 1.45);
        const w = (Math.random() * 2 - 1) * env;
        // 随时间变暗的低通，模拟木柱与青砖对高频的吸收
        const coeff = Math.max(0.06, 0.42 * Math.exp(-t * 1.1));
        lp += coeff * (w - lp);
        data[i] = lp * 0.65;
      }
      early.forEach((sec, idx) => {
        const pos = Math.floor((sec + ch * 0.0037) * sr);
        if (pos < len) data[pos] += (0.28 / (idx + 1)) * (ch === 0 ? 1 : -0.92);
      });
    }
    return buf;
  }

  _startBreeze(ctx) {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 340;
    bp.Q.value = 1.1;

    // 缓慢呼吸般的微风起伏
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.065;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 135;
    lfo.connect(lfoGain);
    lfoGain.connect(bp.frequency);

    this.breezeGain = ctx.createGain();
    this.breezeGain.gain.value = 0.0001;

    src.connect(bp);
    bp.connect(this.breezeGain);
    this.breezeGain.connect(this.musicBus);

    src.start();
    lfo.start();
    this.breezeNodes = { src, lfo, bp };
  }

  setBreezeLevel(level, tc = 0.6) {
    if (!this.ctx || !this.breezeGain) return;
    const now = this.ctx.currentTime;
    this.breezeGain.gain.cancelScheduledValues(now);
    this.breezeGain.gain.setTargetAtTime(Math.max(0.0001, level), now, tc);
  }

  setVolume(vol) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(Math.max(0.0001, vol * 0.85), now, 0.06);
  }

  setMood(mood) {
    if (!this.ctx || !this.moodFilter) return;
    const now = this.ctx.currentTime;
    const freq = mood === 'opening' || mood === 'home' ? 4200 : mood === 'revealed' ? 7600 : 6200;
    this.moodFilter.frequency.setTargetAtTime(freq, now, 0.8);
  }

  // 模态丝弦物理建模：按频率分层衰减泛音 + 轻柔木腔拨弦瞬态
  // 相比原始 Karplus-Strong，低音散音浑厚温润、绝无锯齿毛刺，且音准精准
  _getStringBuffer(midiNum, style) {
    const key = style + ':' + midiNum;
    if (this.stringCache.has(key)) return this.stringCache.get(key);

    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const freq = m2f(midiNum);
    const isQin = style === 'qin';
    const dur = isQin ? Math.min(4.6, Math.max(2.6, 260 / freq)) : Math.min(3.4, Math.max(2.0, 200 / freq));
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);

    const maxH = isQin ? 10 : 14;
    const pluckPos = isQin ? 0.27 : 0.16;
    const stiffness = isQin ? 0.00006 : 0.00014;
    const baseTau = isQin
      ? Math.min(2.6, Math.max(0.95, 195 / Math.pow(freq, 0.85)))
      : Math.min(2.1, Math.max(0.75, 155 / Math.pow(freq, 0.85)));

    const harmonics = [];
    for (let h = 1; h <= maxH; h++) {
      const fh = h * freq * Math.sqrt(1 + stiffness * h * h);
      if (fh > (isQin ? 2600 : 5000)) break;
      const pluckShape = h <= 2 ? 1.0 : (0.46 + 0.54 * Math.abs(Math.sin(Math.PI * h * pluckPos)));
      const rolloff = isQin
        ? (h === 1 ? 1.0 : h === 2 ? 0.70 : h === 3 ? 0.34 : 0.46 / Math.pow(h, 1.82))
        : (h === 1 ? 0.88 : h === 2 ? 0.76 : h === 3 ? 0.48 : 0.72 / Math.pow(h, 1.45));
      // 低音粗弦（<160Hz）大幅收敛四次以上高次谐波，消除生硬毛刺，保留丝弦温厚共鸣
      const lowWarmth = isQin && freq < 165 && h >= 4 ? Math.pow(freq / 165, (h - 3) * 0.52) : 1.0;
      const amp = rolloff * pluckShape * lowWarmth;
      if (amp < 0.003) continue;

      const decayExp = isQin ? 1.7 : 1.38;
      const tau = baseTau / (1 + (isQin ? 0.58 : 0.34) * Math.pow(h - 1, decayExp));
      const phase = (h * 0.73) % (Math.PI * 2);
      harmonics.push({ fh, amp, tau, phase, w: (2 * Math.PI * fh) / sr });
    }

    for (const p of harmonics) {
      const attSec = isQin ? (p.fh < 280 ? 0.011 : 0.0045) : 0.0035;
      const attN = Math.max(1, Math.floor(sr * attSec));
      const decMul = Math.exp(-1 / (p.tau * sr));
      let env = p.amp;
      const cosW = Math.cos(p.w);
      const sinW = Math.sin(p.w);
      let s = Math.sin(p.phase);
      let c = Math.cos(p.phase);
      for (let i = 0; i < len; i++) {
        let g = env;
        if (i < attN) g *= 0.5 - 0.5 * Math.cos((Math.PI * i) / attN);
        out[i] += s * g;
        env *= decMul;
        const ns = s * cosW + c * sinW;
        c = c * cosW - s * sinW;
        s = ns;
      }
    }

    // 柔和的指腹触弦与桐木琴腔瞬态（二阶低通塑形，绝不刺耳）
    const thumpLen = Math.floor(sr * (isQin ? 0.036 : 0.022));
    let lp1 = 0;
    let lp2 = 0;
    const thumpAlpha = isQin ? 0.075 : 0.15;
    const thumpAmp = isQin ? 0.16 : 0.13;
    for (let i = 0; i < thumpLen && i < len; i++) {
      const t = i / thumpLen;
      const n = Math.random() * 2 - 1;
      lp1 += thumpAlpha * (n - lp1);
      lp2 += thumpAlpha * (lp1 - lp2);
      const env = Math.sin(Math.PI * Math.pow(t, 0.55)) * Math.exp(-t * 3.8);
      out[i] += lp2 * env * thumpAmp * 4.2;
    }

    let maxAbs = 0.0001;
    for (let i = 0; i < len; i++) {
      const a = Math.abs(out[i]);
      if (a > maxAbs) maxAbs = a;
    }
    const norm = 0.82 / maxAbs;
    const fadeOutN = Math.min(len, Math.floor(sr * 0.15));
    for (let i = 0; i < len; i++) {
      let g = norm;
      if (i > len - fadeOutN) g *= (len - i) / fadeOutN;
      out[i] *= g;
    }

    if (this.stringCache.size > 160) {
      const first = this.stringCache.keys().next().value;
      this.stringCache.delete(first);
    }
    this.stringCache.set(key, buf);
    return buf;
  }

  _panNode(ctx, pan) {
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.8, Math.min(0.8, pan || 0));
      return p;
    }
    return ctx.createGain();
  }

  // 古琴 / 古筝演奏
  playPluck(time, note, { style = 'qin', dur = 2.6, vel = 0.45, slide = 0, pan = 0, bus = null } = {}) {
    const ctx = this.ctx;
    const m = midi(note);
    const buf = this._getStringBuffer(m, style);

    const src = ctx.createBufferSource();
    src.buffer = buf;

    // 绰 / 注 滑音（古琴标志性的左手滑按）
    if (slide) {
      const startRatio = Math.pow(2, slide / 12);
      src.playbackRate.setValueAtTime(startRatio, time);
      src.playbackRate.exponentialRampToValueAtTime(1.0, time + (style === 'qin' ? 0.19 : 0.12));
    }

    // 古琴长音微量吟揉（极轻微左手颤音）
    let vibOsc = null;
    if (style === 'qin' && dur >= 1.8 && m >= 55) {
      vibOsc = ctx.createOscillator();
      vibOsc.frequency.value = 4.3 + Math.random() * 0.4;
      const vibGain = ctx.createGain();
      vibGain.gain.setValueAtTime(0, time);
      vibGain.gain.linearRampToValueAtTime(0, time + 0.34);
      vibGain.gain.linearRampToValueAtTime(7.5, time + 0.72);
      vibGain.gain.linearRampToValueAtTime(2.0, time + dur);
      vibOsc.connect(vibGain);
      vibGain.connect(src.detune);
      vibOsc.start(time);
      vibOsc.stop(time + dur + 0.3);
    }

    // 随音高自适应温润低通：古琴低音散音绝不刺耳
    const freq = m2f(m);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = style === 'qin'
      ? Math.min(2400, Math.max(460, freq * 5.2))
      : Math.min(4600, Math.max(1200, freq * 7.5));
    tone.Q.value = 0.55;

    const env = ctx.createGain();
    const bassTame = style === 'qin' && m < 52 ? 0.78 : 1.0;
    const peak = Math.max(0.01, vel * bassTame * (style === 'qin' ? 0.56 : 0.46));
    env.gain.setValueAtTime(peak, time);
    env.gain.setValueAtTime(peak, time + Math.max(0.15, dur * 0.72));
    env.gain.exponentialRampToValueAtTime(0.0008, time + dur + 0.65);

    const panner = this._panNode(ctx, pan);
    src.connect(tone);
    tone.connect(env);
    env.connect(panner);
    panner.connect(bus || this.musicBus);

    src.start(time);
    src.stop(time + Math.min(buf.duration, dur + 0.75));
  }

  // 古琴泛音：清越如月下露珠
  playHarmonic(time, note, { dur = 3.0, vel = 0.28, pan = 0, bus = null } = {}) {
    const ctx = this.ctx;
    const freq = m2f(midi(note));

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2.001;

    const g2 = ctx.createGain();
    g2.gain.value = 0.14;

    const env = ctx.createGain();
    const peak = Math.max(0.005, vel * 0.34);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.014);
    env.gain.exponentialRampToValueAtTime(peak * 0.35, time + 0.45);
    env.gain.exponentialRampToValueAtTime(0.0005, time + dur + 0.4);

    const panner = this._panNode(ctx, pan);
    osc1.connect(env);
    osc2.connect(g2);
    g2.connect(env);
    env.connect(panner);
    panner.connect(bus || this.musicBus);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + dur + 0.5);
    osc2.stop(time + dur + 0.5);
  }

  // 洞箫：温润竹管泛音 + 轻柔气声 + 缓起吟振
  playXiao(time, note, { dur = 1.6, vel = 0.44, scoop = false, pan = 0, bus = null } = {}) {
    const ctx = this.ctx;
    const freq = m2f(midi(note));
    const attack = Math.min(0.28, Math.max(0.11, dur * 0.22));
    const release = 0.34;
    const end = time + dur + release;

    // 管体基频 + 空灵二、三次谐波
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = freq;

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.22;

    const o3 = ctx.createOscillator();
    o3.type = 'sine';
    o3.frequency.value = freq * 3;
    const g3 = ctx.createGain();
    g3.gain.value = 0.07;

    // 乐句首音微微低起上滑，贴近真人吐音
    if (scoop) {
      [o1, o2, o3].forEach((o, idx) => {
        const mult = idx + 1;
        o.frequency.setValueAtTime(freq * mult * 0.976, time);
        o.frequency.exponentialRampToValueAtTime(freq * mult, time + 0.16);
      });
    }

    // 缓入气震音（吟）
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.6 + Math.random() * 0.35;
    const vibStart = Math.min(0.32, dur * 0.35);
    const vibPeak = Math.min(dur * 0.9, Math.max(vibStart + 0.06, Math.min(0.8, dur * 0.75)));
    const vibGain = ctx.createGain();
    vibGain.gain.setValueAtTime(0, time);
    vibGain.gain.linearRampToValueAtTime(0, time + vibStart);
    vibGain.gain.linearRampToValueAtTime(11, time + vibPeak);
    vib.connect(vibGain);
    vibGain.connect(o1.detune);
    vibGain.connect(o2.detune);
    vibGain.connect(o3.detune);

    // 吹口气声（随音高跟踪的带通滤波噪声）
    const breath = ctx.createBufferSource();
    breath.buffer = this.noiseBuf;
    breath.loop = true;
    const bFilter = ctx.createBiquadFilter();
    bFilter.type = 'bandpass';
    bFilter.frequency.value = Math.min(3400, freq * 2.1);
    bFilter.Q.value = 2.4;
    const bGain = ctx.createGain();
    const bPeak = vel * 0.095;
    const bSettle = Math.min(dur * 0.88, attack + 0.18);
    bGain.gain.setValueAtTime(0.0001, time);
    bGain.gain.linearRampToValueAtTime(bPeak * 1.45, time + attack * 0.55); // 起吹气头
    bGain.gain.linearRampToValueAtTime(bPeak * 0.65, time + bSettle);
    bGain.gain.setValueAtTime(bPeak * 0.55, time + dur);
    bGain.gain.exponentialRampToValueAtTime(0.0001, end);

    const pipeLp = ctx.createBiquadFilter();
    pipeLp.type = 'lowpass';
    pipeLp.frequency.value = Math.min(2800, freq * 3.4);
    pipeLp.Q.value = 0.6;

    const env = ctx.createGain();
    const peak = Math.max(0.01, vel * 0.24);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(peak, time + attack);
    env.gain.linearRampToValueAtTime(peak * 0.88, time + dur);
    env.gain.exponentialRampToValueAtTime(0.0005, end);

    const panner = this._panNode(ctx, pan);
    o1.connect(pipeLp);
    o2.connect(g2); g2.connect(pipeLp);
    o3.connect(g3); g3.connect(pipeLp);
    pipeLp.connect(env);
    env.connect(panner);

    breath.connect(bFilter);
    bFilter.connect(bGain);
    bGain.connect(panner);
    panner.connect(bus || this.musicBus);

    o1.start(time); o2.start(time); o3.start(time); vib.start(time);
    breath.start(time, Math.random() * 2.5);
    o1.stop(end + 0.05); o2.stop(end + 0.05); o3.stop(end + 0.05);
    vib.stop(end + 0.05); breath.stop(end + 0.05);
  }

  // 玉磬 / 古寺轻钟：非谐模态泛音，余音清远
  playQing(time, note, { dur = 4.2, vel = 0.26, pan = 0.2, bus = null } = {}) {
    const ctx = this.ctx;
    const base = m2f(midi(note));
    const partials = [
      { ratio: 1.0, amp: 1.0, decay: dur },
      { ratio: 2.756, amp: 0.22, decay: dur * 0.38 },
      ...(base * 5.404 < 4500 ? [{ ratio: 5.404, amp: 0.04, decay: dur * 0.14 }] : []),
    ];
    const panner = this._panNode(ctx, pan);
    panner.connect(bus || this.musicBus);

    partials.forEach((p) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * p.ratio;
      const g = ctx.createGain();
      const peak = Math.max(0.002, vel * 0.24 * p.amp);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0003, time + p.decay);
      osc.connect(g);
      g.connect(panner);
      osc.start(time);
      osc.stop(time + p.decay + 0.08);
    });
  }

  // 落字清音（活字木块轻叩）
  playWoodTap(time, pitch = 680, vel = 0.24) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch * 1.18, time);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.72, time + 0.032);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = pitch;
    bp.Q.value = 3.2;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.35, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0005, time + 0.055);

    osc.connect(bp);
    bp.connect(g);
    g.connect(this.sfxBus);
    osc.start(time);
    osc.stop(time + 0.07);
  }

  // 盖印沉声
  playSealThud(time) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, time);
    osc.frequency.exponentialRampToValueAtTime(58, time + 0.11);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.32, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, time + 0.16);

    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(time);
    osc.stop(time + 0.18);
  }
}

// ── 控制器与前瞻调度器 ────────────────────────────────

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const track = TRACKS.some((t) => t.id === raw.track) ? raw.track : TRACKS[0].id;
    const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.max(0.05, Math.min(1, raw.volume)) : 0.72;
    const sfx = typeof raw.sfx === 'boolean' ? raw.sfx : true;
    const enabled = Boolean(raw.enabled);
    return { enabled, track, volume, sfx };
  } catch {
    return { enabled: false, track: TRACKS[0].id, volume: 0.72, sfx: true };
  }
}

class BgmController {
  constructor() {
    this.engine = new AcousticEngine();
    this.prefs = loadPrefs();
    this.playing = false;
    this.pending = false; // 上次离开时在播放，待首次交互即续播
    this.mood = 'playing';
    this.listeners = new Set();

    // 调度器状态
    this._timer = 0;
    this._nextBar = 0;
    this._nextBarTime = 0;
    this._cycle = 0;
    this._armed = false;
    this._gen = 0;
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        enabled: this.prefs.enabled,
        track: this.prefs.track,
        volume: this.prefs.volume,
        sfx: this.prefs.sfx,
      }));
    } catch { /* 无痕模式等情况忽略 */ }
  }

  _emit() {
    const snap = this.state();
    for (const fn of this.listeners) fn(snap);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  currentTrack() {
    return TRACKS.find((t) => t.id === this.prefs.track) || TRACKS[0];
  }

  state() {
    return {
      playing: this.playing,
      pending: this.pending,
      track: this.prefs.track,
      trackInfo: this.currentTrack(),
      volume: this.prefs.volume,
      sfx: this.prefs.sfx,
      mood: this.mood,
    };
  }

  async play({ user = true } = {}) {
    try {
      const ctx = this.engine.ensure();
      if (ctx.state === 'suspended') await ctx.resume();
      if (ctx.state !== 'running') {
        if (!user) { this.pending = true; this._emit(); }
        return false;
      }
      this.pending = false;
      if (user) { this.prefs.enabled = true; this._save(); }
      this.engine.setVolume(this.prefs.volume);
      this.engine.setMood(this.mood);

      const tr = this.currentTrack();
      const now = ctx.currentTime;
      this.engine.musicBus.gain.cancelScheduledValues(now);
      this.engine.musicBus.gain.setValueAtTime(Math.max(0.0001, this.engine.musicBus.gain.value), now);
      this.engine.musicBus.gain.linearRampToValueAtTime(1.0, now + 0.55);
      this.engine.setBreezeLevel(tr.breeze, 0.9);

      if (!this.playing) {
        this.playing = true;
        this._startScheduler();
      }
      this._emit();
      return true;
    } catch {
      return false;
    }
  }

  pause({ user = true } = {}) {
    this._gen += 1;
    this.pending = false;
    if (user) { this.prefs.enabled = false; this._save(); }
    if (!this.playing) { this._emit(); return; }
    this.playing = false;
    clearInterval(this._timer);
    this._timer = 0;

    if (this.engine.ctx && this.engine.musicBus) {
      const now = this.engine.ctx.currentTime;
      this.engine.musicBus.gain.cancelScheduledValues(now);
      this.engine.musicBus.gain.setValueAtTime(this.engine.musicBus.gain.value, now);
      this.engine.musicBus.gain.linearRampToValueAtTime(0.0001, now + 0.42);
      this.engine.setBreezeLevel(0.0001, 0.25);
    }
    this._emit();
  }

  toggle() {
    if (this.playing) this.pause({ user: true });
    else this.play({ user: true });
  }

  setTrack(id) {
    if (!TRACKS.some((t) => t.id === id)) return;
    const changed = this.prefs.track !== id;
    this.prefs.track = id;
    this._save();
    if (this.playing && changed) {
      // 平滑换曲：短暂淡出后起新曲
      const gen = ++this._gen;
      const ctx = this.engine.ctx;
      const now = ctx.currentTime;
      clearInterval(this._timer);
      this._timer = 0;
      this.engine.musicBus.gain.cancelScheduledValues(now);
      this.engine.musicBus.gain.setValueAtTime(this.engine.musicBus.gain.value, now);
      this.engine.musicBus.gain.linearRampToValueAtTime(0.0001, now + 0.35);
      setTimeout(() => {
        if (!this.playing || this._gen !== gen) return;
        const t2 = this.engine.ctx.currentTime;
        this.engine.musicBus.gain.cancelScheduledValues(t2);
        this.engine.musicBus.gain.linearRampToValueAtTime(1.0, t2 + 0.55);
        this.engine.setBreezeLevel(this.currentTrack().breeze, 0.8);
        this._startScheduler();
      }, 370);
    } else if (!this.playing) {
      this.play({ user: true });
    }
    this._emit();
  }

  setVolume(v) {
    this.prefs.volume = Math.max(0.05, Math.min(1, Number(v) || 0.72));
    this._save();
    this.engine.setVolume(this.prefs.volume);
    this._emit();
  }

  setSfx(on) {
    this.prefs.sfx = Boolean(on);
    this._save();
    this._emit();
  }

  setMood(mood) {
    this.mood = mood;
    this.engine.setMood(mood);
  }

  // 若玩家先前开启过雅乐，翻页后在首次点击或按键时自然续播
  armAutoResume() {
    if (this._armed || !this.prefs.enabled) return;
    this._armed = true;
    this.pending = true;
    this._emit();
    const wake = () => {
      if (!this.prefs.enabled || this.playing) return cleanup();
      this.play({ user: false }).then((ok) => { if (ok) cleanup(); });
    };
    const cleanup = () => {
      window.removeEventListener('pointerdown', wake, true);
      window.removeEventListener('keydown', wake, true);
    };
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
    // 某些环境已允许直接播放，先轻试一次
    this.play({ user: false }).then((ok) => { if (ok) cleanup(); });
  }

  _startScheduler() {
    clearInterval(this._timer);
    this._nextBar = 0;
    this._cycle = 0;
    this._nextBarTime = this.engine.ctx.currentTime + 0.14;
    this._tick();
    this._timer = setInterval(() => this._tick(), 90);
  }

  _tick() {
    if (!this.playing || !this.engine.ctx) return;
    const ctx = this.engine.ctx;
    const tr = this.currentTrack();
    const score = SCORES[tr.id] || SCORES.yuexia;
    const beatSec = 60 / tr.bpm;

    // 前瞻 0.32s 调度整小节，兼顾精准度与自然呼吸
    while (this._nextBarTime < ctx.currentTime + 0.34) {
      const bar = this._nextBar;
      const barStart = this._nextBarTime;
      // 句末（第 3、7、11、15… 小节）略作自然渐慢（气口），更具古琴韵致
      const isCadence = (bar + 1) % 4 === 0;
      const isEnding = bar === tr.bars - 1;
      const barFactor = isEnding ? 1.12 : isCadence ? 1.045 : 1.0;
      const localBeat = beatSec * barFactor;

      const events = score.filter((e) => e.bar === bar);
      for (const e of events) {
        // 微微人性化偏移（±8ms）与力度呼吸，循环第二遍起偶作极轻微的泛音装饰
        const jitter = (Math.random() - 0.5) * 0.016;
        const when = Math.max(ctx.currentTime + 0.01, barStart + e.beat * localBeat + jitter);
        const durSec = e.dur * localBeat;
        const vel = e.vel * (0.94 + Math.random() * 0.12);

        if (e.inst === 'qin') {
          this.engine.playPluck(when, e.note, { style: 'qin', dur: durSec, vel, slide: e.slide || 0, pan: e.pan });
        } else if (e.inst === 'zheng') {
          this.engine.playPluck(when, e.note, { style: 'zheng', dur: durSec, vel, slide: e.slide || 0, pan: e.pan });
        } else if (e.inst === 'qinh') {
          this.engine.playHarmonic(when, e.note, { dur: durSec, vel, pan: e.pan });
        } else if (e.inst === 'xiao') {
          this.engine.playXiao(when, e.note, { dur: durSec, vel, scoop: Boolean(e.scoop), pan: e.pan });
        } else if (e.inst === 'qing') {
          this.engine.playQing(when, e.note, { dur: durSec, vel, pan: e.pan });
        }
      }

      // 偶数循环在留白处偶添一星高音泛音，耐听而不单调
      if (this._cycle > 0 && this._cycle % 2 === 1 && bar === tr.bars - 1) {
        const spark = tr.id === 'dengxia' ? 'E6' : tr.id === 'qiufeng' ? 'A5' : 'A5';
        this.engine.playHarmonic(barStart + 2.0 * localBeat, spark, { dur: 2.8, vel: 0.16, pan: -0.18 });
      }

      this._nextBarTime += 4 * localBeat;
      this._nextBar += 1;
      if (this._nextBar >= tr.bars) {
        this._nextBar = 0;
        this._cycle += 1;
        this._nextBarTime += beatSec * 0.9; // 曲终气口，而后重起
      }
    }
  }

  // ── 落字清音（仅在开启雅乐或音频已激活且开启落字声时轻响）──
  _sfxReady() {
    if (!this.prefs.sfx) return false;
    if (!this.playing) return false; // 未开雅乐时保持静默，不突兀打扰
    const ctx = this.engine.ctx;
    if (!ctx || ctx.state !== 'running') return false;
    return true;
  }

  sfxTile() {
    if (!this._sfxReady()) return;
    const t = this.engine.ctx.currentTime + 0.005;
    this.engine.playWoodTap(t, 640 + Math.random() * 90, 0.24);
  }

  sfxUnseat() {
    if (!this._sfxReady()) return;
    const t = this.engine.ctx.currentTime + 0.005;
    this.engine.playWoodTap(t, 480 + Math.random() * 50, 0.18);
  }

  sfxHint() {
    if (!this._sfxReady()) return;
    const t = this.engine.ctx.currentTime + 0.01;
    const notes = this.prefs.track === 'dengxia' ? ['G5', 'C6'] : ['A5', 'D5'];
    this.engine.playHarmonic(t, notes[0], { dur: 1.8, vel: 0.22, pan: 0.1, bus: this.engine.sfxBus });
  }

  sfxCheck(hitRatio = 0.5) {
    if (!this._sfxReady()) return;
    const t = this.engine.ctx.currentTime + 0.01;
    const isC = this.prefs.track === 'dengxia';
    if (hitRatio >= 0.99) {
      const chord = isC ? ['C4', 'G4', 'C5', 'E5'] : ['D4', 'A4', 'D5', 'F#5'];
      chord.forEach((n, idx) => {
        this.engine.playHarmonic(t + idx * 0.07, n, { dur: 2.2, vel: 0.24, pan: -0.15 + idx * 0.1, bus: this.engine.sfxBus });
      });
    } else if (hitRatio > 0) {
      const pair = isC ? ['G4', 'C5'] : ['A4', 'D5'];
      pair.forEach((n, idx) => {
        this.engine.playPluck(t + idx * 0.08, n, { style: 'zheng', dur: 1.4, vel: 0.22, pan: idx ? 0.1 : -0.1, bus: this.engine.sfxBus });
      });
    } else {
      this.engine.playPluck(t, isC ? 'G3' : 'A3', { style: 'qin', dur: 1.3, vel: 0.24, pan: 0, bus: this.engine.sfxBus });
    }
  }

  sfxSeal() {
    if (!this._sfxReady()) return;
    const t = this.engine.ctx.currentTime + 0.01;
    this.engine.playSealThud(t);
    const chime = this.prefs.track === 'dengxia' ? 'C5' : this.prefs.track === 'qiufeng' ? 'A4' : 'D5';
    this.engine.playQing(t + 0.07, chime, { dur: 3.4, vel: 0.24, pan: 0.12, bus: this.engine.sfxBus });
  }

  sfxReveal() {
    if (!this._sfxReady()) return;
    const t = this.engine.ctx.currentTime + 0.02;
    const run = this.prefs.track === 'dengxia'
      ? ['C4', 'D4', 'E4', 'G4', 'C5']
      : ['D4', 'E4', 'F#4', 'A4', 'D5'];
    run.forEach((n, idx) => {
      this.engine.playPluck(t + idx * 0.075, n, {
        style: 'zheng', dur: 2.2, vel: 0.24, pan: -0.25 + idx * 0.12, bus: this.engine.sfxBus,
      });
    });
  }
}

export const bgm = new BgmController();
