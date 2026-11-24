// CGC core: parsing, interval building, conditional-growth model. No network access, no storage.
const CGC = (() => {
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === '\t' || c === ';') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = '';
        if (row.some(v => v.trim() !== '')) rows.push(row);
        row = [];
      } else f += c;
    }
    row.push(f); if (row.some(v => v.trim() !== '')) rows.push(row);
    if (!rows.length) return { header: [], data: [] };
    const header = rows[0].map(h => h.trim());
    return { header, data: rows.slice(1).map(r => Object.fromEntries(header.map((h, j) => [h, (r[j] ?? '').trim()]))) };
  }

  function guessColumns(header) {
    const find = res => header.find(h => res.some(re => re.test(h))) || '';
    return {
      id: find([/^(student[ _]?)?id$/i, /student/i, /research[ _]?id/i, /\bid\b/i]),
      year: find([/school[ _]?year/i, /^year$/i, /year/i, /^sy$/i]),
      grade: find([/^grade$/i, /grade/i, /^gr$/i]),
      level: find([/overall/i, /proficiency/i, /^level$/i, /level/i, /wida/i, /access/i, /elp/i])
    };
  }

  // "2022-23", "2022-2023", "SY2023", "2023" -> 2023 (spring/end year)
  function normYear(v) {
    const s = String(v).trim();
    let m = s.match(/(\d{4})\s*[-\/–]\s*(\d{2,4})/);
    if (m) { const a = +m[1], b = m[2].length === 2 ? Math.floor(a / 100) * 100 + +m[2] : +m[2]; return b; }
    m = s.match(/(\d{4})/); return m ? +m[1] : NaN;
  }
  function normGrade(v) {
    const s = String(v).trim().toUpperCase();
    if (/^(K|KG|KN|KINDER|KINDERGARTEN|0K)$/.test(s)) return 0;
    if (/^(PK|P|PREK|PRE-K|PRE K|-1)$/.test(s)) return -1;
    const m = s.match(/-?\d+/); if (!m) return NaN;
    const g = +m[0]; return g >= -1 && g <= 12 ? g : NaN;
  }
  function normLevel(v) {
    const x = parseFloat(String(v).replace(',', '.'));
    return x >= 1 && x <= 6 ? x : NaN;
  }

  function buildRecords(data, cols) {
    const recs = [], skipped = { missing: 0, dup: 0 }, seen = new Set();
    for (const r of data) {
      const id = String(r[cols.id] ?? '').trim(), y = normYear(r[cols.year]), g = normGrade(r[cols.grade]), l = normLevel(r[cols.level]);
      if (!id || isNaN(y) || isNaN(g) || isNaN(l)) { skipped.missing++; continue; }
      const k = id + '|' + y; if (seen.has(k)) { skipped.dup++; continue; }
      seen.add(k); recs.push({ id, year: y, grade: g, level: l });
    }
    return { recs, skipped };
  }

  function buildIntervals(recs) {
    const by = new Map();
    for (const r of recs) { if (!by.has(r.id)) by.set(r.id, []); by.get(r.id).push(r); }
    const iv = [];
    for (const [id, arr] of by) {
      arr.sort((a, b) => a.year - b.year);
      for (let i = 1; i < arr.length; i++) {
        const a = arr[i - 1], b = arr[i];
        if (b.year - a.year !== 1) continue;
        iv.push({ id, grade: b.grade, year: b.year, prev: a.level, cur: b.level, delta: b.level - a.level });
      }
    }
    return { iv, students: by };
  }

  // Least squares via Cholesky on X'X (tiny ridge for safety). Returns beta.
  function ols(X, y) {
    const n = X.length, p = X[0].length, A = Array.from({ length: p }, () => new Float64Array(p)), b = new Float64Array(p);
    for (let i = 0; i < n; i++) { const xi = X[i]; for (let j = 0; j < p; j++) { b[j] += xi[j] * y[i]; for (let k = 0; k <= j; k++) A[j][k] += xi[j] * xi[k]; } }
    for (let j = 0; j < p; j++) { A[j][j] += 1e-9; for (let k = 0; k < j; k++) A[k][j] = A[j][k]; }
    const L = Array.from({ length: p }, () => new Float64Array(p));
    for (let j = 0; j < p; j++) {
      let s = A[j][j]; for (let k = 0; k < j; k++) s -= L[j][k] ** 2;
      if (s <= 1e-12) throw new Error('The model could not be estimated: some grades or years have too few students. Try a larger file.');
      L[j][j] = Math.sqrt(s);
      for (let i = j + 1; i < p; i++) { let t = A[i][j]; for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k]; L[i][j] = t / L[j][j]; }
    }
    const z = new Float64Array(p); for (let i = 0; i < p; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * z[k]; z[i] = s / L[i][i]; }
    const beta = new Float64Array(p); for (let i = p - 1; i >= 0; i--) { let s = z[i]; for (let k = i + 1; k < p; k++) s -= L[k][i] * beta[k]; beta[i] = s / L[i][i]; }
    return beta;
  }

  // delta ~ C(grade) + prev + prev^2 + C(year)
  function fit(iv) {
    const grades = [...new Set(iv.map(r => r.grade))].sort((a, b) => a - b);
    const years = [...new Set(iv.map(r => r.year))].sort((a, b) => a - b);
    const names = ['Intercept', ...grades.slice(1).map(g => 'Grade ' + gl(g)), 'Prior level', 'Prior level²', ...years.slice(1).map(y => 'Year ' + yl(y))];
    const row = r => [1, ...grades.slice(1).map(g => +(r.grade === g)), r.prev, r.prev * r.prev, ...years.slice(1).map(y => +(r.year === y))];
    const X = iv.map(row), y = iv.map(r => r.delta);
    if (iv.length < names.length + 10) throw new Error('Too few year-to-year changes (' + iv.length + ') to estimate the model.');
    const beta = ols(X, y);
    const my = y.reduce((a, b) => a + b, 0) / y.length;
    let sse = 0, sst = 0;
    iv.forEach((r, i) => { r.expected = X[i].reduce((s, x, j) => s + x * beta[j], 0); r.resid = r.delta - r.expected; sse += r.resid ** 2; sst += (r.delta - my) ** 2; });
    const sigma = Math.sqrt(sse / (iv.length - names.length));
    return { beta: [...beta], names, grades, years, r2: 1 - sse / sst, sigma, n: iv.length, p: names.length };
  }

  function byGrade(iv) {
    const m = new Map();
    for (const r of iv) { if (!m.has(r.grade)) m.set(r.grade, []); m.get(r.grade).push(r); }
    return [...m].sort((a, b) => a[0] - b[0]).map(([g, a]) => {
      const d = a.map(r => r.delta), mean = d.reduce((s, x) => s + x, 0) / d.length;
      const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, d.length - 1));
      return { grade: g, n: a.length, mean, se: sd / Math.sqrt(d.length), below: a.filter(r => r.delta < 0.30).length / a.length, prev: a.reduce((s, r) => s + r.prev, 0) / a.length };
    });
  }

  function summarize(iv, students, sigma, cutSD) {
    const by = new Map();
    for (const r of iv) { if (!by.has(r.id)) by.set(r.id, []); by.get(r.id).push(r); }
    const out = [];
    for (const [id, a] of by) {
      a.sort((x, y) => x.year - y.year);
      const last = a[a.length - 1], mean = a.reduce((s, r) => s + r.resid, 0) / a.length;
      const recs = students.get(id), latest = recs[recs.length - 1];
      out.push({ id, grade: latest.grade, year: latest.year, level: latest.level, k: a.length, lastDelta: last.delta, lastExp: last.expected, lastResid: last.resid, meanResid: mean, z: mean / (sigma / Math.sqrt(a.length)), flag: mean <= cutSD * sigma });
    }
    return out.sort((x, y) => x.meanResid - y.meanResid);
  }

  function gl(g) { return g === 0 ? 'K' : g === -1 ? 'PK' : String(g); }
  function yl(y) { return (y - 1) + '–' + String(y).slice(2); }

  // Synthetic demo data (not real students), seeded.
  function demo(seed = 7) {
    let s = seed >>> 0; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const nrm = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const rows = ['student_id,school_year,grade,overall_level'];
    for (let i = 1; i <= 320; i++) {
      const g0 = Math.floor(rnd() * 7), y0 = 2019 + Math.floor(rnd() * 3), len = 2 + Math.floor(rnd() * 5), slow = rnd() < 0.15 ? 0.45 : 1;
      let lv = Math.min(4.5, Math.max(1, 1.4 + 0.35 * g0 + 0.6 * nrm()));
      for (let t = 0; t < len && g0 + t <= 8; t++) {
        const obs = Math.min(6, Math.max(1, lv + 0.18 * nrm()));
        rows.push(`S${String(i).padStart(4, '0')},${y0 + t - 1}-${String(y0 + t).slice(2)},${g0 + t === 0 ? 'K' : g0 + t},${obs.toFixed(1)}`);
        const gain = slow * Math.max(0, (0.95 - 0.07 * (g0 + t)) * (1 - (lv - 1) / 5.5)) + 0.12 * nrm();
        lv = Math.min(6, Math.max(1, lv + gain));
      }
    }
    return rows.join('\n');
  }

  return { parseCSV, guessColumns, buildRecords, buildIntervals, fit, byGrade, summarize, demo, gl, yl, normYear, normGrade };
})();
if (typeof module !== 'undefined') module.exports = CGC;
