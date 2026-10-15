(function () {
  'use strict';

  const D = window.PRECIOS;
  const app = document.getElementById('app');
  if (!D) {
    app.innerHTML = '<div class="error"><h2>Sin datos</h2><p class="meta">No se encontró <code>precios.js</code>. ' +
      'Ejecuta <code>actualizar.bat</code> en la carpeta del proyecto y recarga esta página.</p></div>';
    return;
  }

  // ---------- Universo de commodities ----------
  const FAMILIAS = Object.assign({ energia: 'Energía', metales: 'Metales', agro: 'Agropecuarios' }, D.familias || {});
  const ORDEN_FAMILIA = Object.keys(FAMILIAS);
  const PALETA = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
  // El color identifica al commodity dentro de su grupo (familia prioritaria o sección secundaria),
  // que es el alcance de cada comparativo; nunca depende del ranking.
  const COMMODITIES = (() => {
    const base = D.commodities || [];
    const cuenta = {};
    return base.map(c => {
      const grupo = c.prioridad === 2 ? 'secundarios' : c.familia;
      const i = cuenta[grupo] = (cuenta[grupo] ?? -1) + 1;
      return { ...c, grupo, color: PALETA[i % PALETA.length] };
    });
  })();
  const GRUPOS = [...ORDEN_FAMILIA.map(f => ({ key: f, nombre: FAMILIAS[f] })), { key: 'secundarios', nombre: 'Secundarios' }];

  // Tipos de referencia. Dentro de cada panel el color identifica el tipo, igual en todos los paneles.
  const TIPOS = Object.assign({
    benchmark: 'Benchmark internacional', referencia_mx: 'Referencia México',
    indice_inegi: 'Índice de precios México / INEGI', domestico: 'Precio doméstico',
  }, D.tipos || {});
  const TIPO_CORTO = { benchmark: 'Benchmark', referencia_mx: 'Referencia MX', indice_inegi: 'INPP INEGI', domestico: 'Doméstico' };
  const ORDEN_TIPO = ['benchmark', 'referencia_mx', 'domestico', 'indice_inegi'];
  const COLOR_TIPO = { benchmark: ['var(--s1)', 'var(--s3)'], domestico: ['var(--s2)'], referencia_mx: ['var(--s4)'], indice_inegi: ['var(--s3)', 'var(--s5)'] };
  const esPrecio = s => s.tipo !== 'indice_inegi';

  // ---------- Estado ----------
  // Un solo periodo (en meses) para todo: semáforo, máx./mín. y gráficas.
  const estado = { periodo: '3', moneda: 'MXN', vista: 'precio', familia: 'energia' };
  try { Object.assign(estado, JSON.parse(localStorage.getItem('commodities.filtros') || '{}')); } catch (e) {}
  if (!GRUPOS.some(g => g.key === estado.familia)) estado.familia = 'energia';
  const HORIZONTES = {
    '3':  { largo: '3 meses',  corto: '3M' }, '6':  { largo: '6 meses', corto: '6M' }, '12': { largo: '12 meses', corto: '1A' },
    '36': { largo: '3 años',   corto: '3A' }, '60': { largo: '5 años',  corto: '5A' },
  };
  if (!HORIZONTES[estado.periodo]) estado.periodo = '3';
  delete estado.horizonte;
  const hz = () => HORIZONTES[estado.periodo];
  const guardar = () => { try { localStorage.setItem('commodities.filtros', JSON.stringify(estado)); } catch (e) {} };

  // ---------- Utilidades ----------
  const aFecha = s => new Date(s + 'T12:00:00');
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fFecha = d => `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
  const fMes = t => { const d = new Date(t); return `${MESES[d.getMonth()]} ${d.getFullYear()}`; };
  const decimales = v => { const a = Math.abs(v); return a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3; };
  const fNum = (v, dec) => v == null || isNaN(v) ? '—' :
    v.toLocaleString('es-MX', { minimumFractionDigits: dec ?? decimales(v), maximumFractionDigits: dec ?? decimales(v) });
  const fPct = v => v == null || isNaN(v) ? '—' : (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '') + fNum(Math.abs(v), 1) + '%';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Último punto con fecha <= t (búsqueda binaria); si no existe, el primero.
  function valorEn(puntos, t) {
    let lo = 0, hi = puntos.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (puntos[m][0] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return puntos[Math.max(r, 0)];
  }
  function masCercano(puntos, t) {
    let lo = 0, hi = puntos.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (puntos[m][0] < t) lo = m; else hi = m; }
    return Math.abs(puntos[lo][0] - t) <= Math.abs(puntos[hi][0] - t) ? puntos[lo] : puntos[hi];
  }

  // Fecha de actualización: ninguna fecha de datos puede mostrarse posterior a ella.
  const tActualizado = aFecha(D.actualizado.slice(0, 10)).getTime();
  const acotar = t => Math.min(t, tActualizado);

  // Los datos semanales se guardan con el viernes de su semana. El último punto se mueve a su
  // fecha de corte real (la semana en curso aún no termina), para no mostrar fechas futuras.
  function aPuntos(s) {
    const raw = s.puntos.map(([f, v]) => [aFecha(f).getTime(), v]);
    const corte = s.corte ? acotar(aFecha(s.corte).getTime()) : null;
    if (raw.length && s.frecuencia !== 'mensual') {
      const ult = raw[raw.length - 1];
      ult[0] = acotar(corte != null ? Math.min(ult[0], corte) : ult[0]);
    }
    return { raw, tCorte: corte != null ? corte : raw.length ? raw[raw.length - 1][0] : null };
  }

  const fxDatos = aPuntos(D.tipo_cambio);
  const FX = fxDatos.raw;
  const fxEn = t => valorEn(FX, t)[1];

  const TODAS = D.series.map(s => ({ ...s, ...aPuntos(s), pendiente: s.estado === 'pendiente' || !s.puntos.length }))
                        .filter(s => COMMODITIES.some(c => c.key === s.commodity));
  const SERIES = TODAS.filter(s => !s.pendiente);
  const fechaMax = Math.max(...SERIES.map(s => s.raw[s.raw.length - 1][0]), FX[FX.length - 1][0]);
  const corteMax = Math.max(...SERIES.map(s => s.tCorte));

  const fCorte = s => s.frecuencia === 'mensual' ? fMes(s.tCorte) : fFecha(new Date(s.tCorte));
  const rezagada = s => s.frecuencia === 'mensual' || s.tCorte < corteMax;
  // Viernes de la semana de t: permite empatar la semana en curso aunque cada serie tenga distinto corte.
  const semanaDe = t => { const d = new Date(t); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7) - (d.getDay() === 6 ? 7 : 0)); return d.toDateString(); };
  const fSemana = t => new Date(t).getDay() === 5 ? `Semana al ${fFecha(new Date(t))}` : `Dato al ${fFecha(new Date(t))} · semana en curso`;

  // Convierte una serie a la moneda elegida y a unidad métrica.
  function enMoneda(s, moneda) {
    const conv = s.conversion || {};
    const div = conv.divisor || 1;
    if (!s.moneda) {  // índices sin moneda
      return { unidad: s.unidad, esIndice: true, puntos: s.raw.map(([t, v]) => [t, v]) };
    }
    const unidad = `${moneda}/${conv.unidad || s.unidad.split('/').pop()}`;
    const puntos = s.raw.map(([t, v]) => {
      let x = v / div;
      if (s.moneda === 'USD' && moneda === 'MXN') x *= fxEn(t);
      if (s.moneda === 'MXN' && moneda === 'USD') x /= fxEn(t);
      return [t, x];
    });
    return { unidad, esIndice: false, puntos };
  }

  // Recorta al periodo elegido, contado desde el último dato de toda la base. Las series mensuales
  // conservan el mes previo al inicio para que la gráfica no arranque vacía.
  const recortar = puntos => {
    const d = new Date(fechaMax); d.setMonth(d.getMonth() - +estado.periodo);
    const desde = d.getTime();
    const i = puntos.findIndex(p => p[0] >= desde);
    if (i < 0) return puntos.slice(-1);
    return puntos.slice(i > 0 && puntos[i][0] - desde > 20 * 864e5 ? i - 1 : i);
  };
  const aIndice = puntos => puntos.length ? puntos.map(([t, v]) => [t, v / puntos[0][1] * 100]) : puntos;
  const etiquetaPeriodo = () => hz().largo;
  // Selector de periodo: se pinta en el semáforo y en el detalle; ambos mueven el mismo estado.
  const selectorPeriodo = (cls = '') => `<div class="seg seg-sm ${cls}" data-f="periodo" aria-label="Periodo">${Object.entries(HORIZONTES)
    .map(([v, o]) => `<button data-v="${v}" aria-pressed="${estado.periodo === v}" title="${o.largo}">${o.corto}</button>`).join('')}</div>`;

  // ---------- Métricas, alertas y riesgo de costo ----------

  // Variación a N meses desde el último dato de la serie (null si no hay historia suficiente).
  function variacion(puntos, meses) {
    const [tU, vU] = puntos[puntos.length - 1];
    const ref = new Date(tU); ref.setMonth(ref.getMonth() - meses);
    if (puntos[0][0] > ref.getTime() + 7 * 864e5) return null;
    return (vU / valorEn(puntos, ref.getTime())[1] - 1) * 100;
  }
  // Volatilidad anualizada de los rendimientos logarítmicos: 26 semanas o 12 meses.
  function volatilidad(puntos, mensual) {
    const n = mensual ? 12 : 26;
    const p = puntos.slice(-(n + 1));
    if (p.length < n * 0.8) return null;
    const r = []; for (let i = 1; i < p.length; i++) r.push(Math.log(p[i][1] / p[i - 1][1]));
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
    return sd * Math.sqrt(mensual ? 12 : 52) * 100;
  }

  const ALERTAS = [
    { key: 'af', nombre: 'Alza fuerte',    regla: '> +10%',      test: v => v > 10 },
    { key: 'am', nombre: 'Alza moderada',  regla: '+5% a +10%',  test: v => v >= 5 },
    { key: 'es', nombre: 'Estable',        regla: '−5% a +5%',   test: v => v > -5 },
    { key: 'bm', nombre: 'Baja moderada',  regla: '−5% a −10%',  test: v => v >= -10 },
    { key: 'bf', nombre: 'Baja fuerte',    regla: '< −10%',      test: () => true },
  ];
  const alertaDe = v3 => v3 == null ? null : ALERTAS.find(a => a.test(v3));

  // Riesgo de costo: se clasifica solo con la variación del benchmark en el periodo elegido (3, 6 o 12 meses).
  //  Alto > +10% · Moderado de 0% a +10% · Bajo < 0% (precio a la baja).
  // La tendencia de 1 mes, la volatilidad y la relevancia se muestran como contexto; no cambian el nivel.
  const UMBRAL_ALTO = 10;
  function riesgoCosto(m, c) {
    const vh = m.vh, v1 = m.v1, h = hz().corto;
    if (vh == null) return { nivel: null, puntos: 0, factores: ['sin historia suficiente'] };
    const nivel = vh > UMBRAL_ALTO ? 'Alto' : vh >= 0 ? 'Moderado' : 'Bajo';
    const f = [vh >= 0 ? `alza ${h} ${fNum(vh, 1)}%` : `baja ${h} ${fNum(Math.abs(vh), 1)}%`];
    if (v1 != null) {
      if (vh >= 0) f.push(v1 > 0 ? 'sigue subiendo en el último mes' : 'bajó en el último mes');
      else f.push(v1 > 0 ? 'repuntó en el último mes' : 'sigue bajando en el último mes');
    }
    if (m.vol != null) f.push(`volatilidad ${m.vol > 35 ? 'alta' : m.vol > 20 ? 'media' : 'baja'} (${fNum(m.vol, 0)}%)`);
    f.push(`insumo de relevancia ${c.relevancia || 'media'}${c.sectores ? ': ' + c.sectores : ''}`);
    return { nivel, puntos: vh, factores: f };
  }

  // Métricas del benchmark principal de cada commodity, en la moneda elegida.
  function metricas(c, moneda) {
    const s = SERIES.find(x => x.commodity === c.key && x.tipo === 'benchmark');
    if (!s) return null;
    const conv = enMoneda(s, moneda);
    const p = conv.puntos;
    const per = recortar(p);
    const m = {
      c, s, unidad: conv.unidad, actual: p[p.length - 1][1],
      v1: variacion(p, 1), v3: variacion(p, 3), v6: variacion(p, 6), v12: variacion(p, 12),
      max: per.length ? Math.max(...per.map(q => q[1])) : null,
      min: per.length ? Math.min(...per.map(q => q[1])) : null,
      vol: volatilidad(p, s.frecuencia === 'mensual'), periodo: per,
    };
    m.vh = variacion(p, +estado.periodo);   // variación en el periodo elegido (semáforo)
    m.alerta = alertaDe(m.v3);
    m.riesgo = riesgoCosto(m, c);
    return m;
  }

  // ---------- Gráfica de líneas (SVG) ----------
  function ticksY(min, max, n) {
    const paso0 = (max - min) / n || 1;
    const mag = Math.pow(10, Math.floor(Math.log10(paso0)));
    const paso = [1, 2, 2.5, 5, 10].map(k => k * mag).find(p => p >= paso0);
    const r = [];
    for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9; v += paso) r.push(+v.toFixed(10));
    return r;
  }
  function ticksX(t0, t1) {
    const dias = (t1 - t0) / 864e5, r = [];
    const d = new Date(t0); d.setDate(1); d.setHours(12, 0, 0, 0);
    const salto = dias > 1100 ? 12 : dias > 500 ? 6 : dias > 200 ? 3 : 1;
    if (salto === 12) d.setMonth(0);
    else d.setMonth(Math.floor(d.getMonth() / salto) * salto);
    while (d.getTime() <= t1) {
      if (d.getTime() >= t0) r.push({ t: d.getTime(), lbl: salto === 12 ? String(d.getFullYear()) : `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` });
      d.setMonth(d.getMonth() + salto);
    }
    return r;
  }

  let idGrafica = 0;
  const OCULTAS = {};
  const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // op: alto, fmt, unidad, titulo, ref (línea de referencia), area (bajo la 1a serie), extremos, animar
  function graficaLineas(el, todas, op) {
    op = Object.assign({ alto: 300, fmt: v => fNum(v), unidad: '', ref: null, area: true, extremos: true, animar: false }, op);
    todas = todas.filter(s => s.puntos.length);
    // Las series ocultas desde la leyenda se recuerdan por gráfica al cambiar filtros.
    el._ocultas = OCULTAS[el.id] = OCULTAS[el.id] || new Set();
    el.innerHTML = '';
    if (!todas.length) { el.innerHTML = '<div class="vacio">Sin datos en este periodo</div>'; return; }
    const uid = 'g' + (++idGrafica);
    const visibles = todas.filter(s => !el._ocultas.has(s.nombre));
    const series = visibles.length ? visibles : todas;

    // Leyenda: también resume el cambio de cada serie en el periodo mostrado.
    if (todas.length > 1) {
      const leg = document.createElement('div');
      leg.className = 'legend';
      leg.innerHTML = todas.map((s, i) => {
        const ch = (s.puntos[s.puntos.length - 1][1] / s.puntos[0][1] - 1) * 100;
        const off = el._ocultas.has(s.nombre);
        return `<button type="button" data-i="${i}" aria-pressed="${!off}" title="Clic para ${off ? 'mostrar' : 'ocultar'}">
          <i style="background:${s.color}"></i><span class="ln">${esc(s.nombre)}</span><b>${fPct(ch)}</b></button>`;
      }).join('');
      el.appendChild(leg);
      leg.querySelectorAll('button').forEach(b => {
        const s = todas[+b.dataset.i];
        b.addEventListener('click', () => {
          if (el._ocultas.has(s.nombre)) el._ocultas.delete(s.nombre);
          else if (visibles.length > 1) el._ocultas.add(s.nombre);
          graficaLineas(el, todas, Object.assign({}, op, { animar: false }));
        });
        b.addEventListener('mouseenter', () => resaltar(s.nombre));
        b.addEventListener('mouseleave', () => resaltar(null));
        b.addEventListener('focus', () => resaltar(s.nombre));
        b.addEventListener('blur', () => resaltar(null));
      });
    }

    const cont = document.createElement('div');
    cont.className = 'chart';
    el.appendChild(cont);

    const W = Math.max(cont.clientWidth, 280), H = op.alto;
    const etiquetasFin = series.length <= 5;
    const todos = series.flatMap(s => s.puntos);
    const t0 = Math.min(...todos.map(p => p[0])), t1 = Math.max(...todos.map(p => p[0]));
    let yMin = Math.min(...todos.map(p => p[1])), yMax = Math.max(...todos.map(p => p[1]));
    if (op.ref != null) { yMin = Math.min(yMin, op.ref); yMax = Math.max(yMax, op.ref); }
    const pad = (yMax - yMin) * 0.12 || Math.abs(yMax) * 0.05 || 1;
    yMin -= pad; yMax += pad;
    const ty = ticksY(yMin, yMax, 4);
    const m = { l: Math.max(...ty.map(v => op.fmt(v).length)) * 6.4 + 10, r: etiquetasFin ? 70 : 16, t: 16, b: 28 };
    const x = t => m.l + (t - t0) / ((t1 - t0) || 1) * (W - m.l - m.r);
    const y = v => m.t + (1 - (v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
    const base = H - m.b;

    const trazo = s => {
      const p = s.puntos;
      if (!s.mensual) return p.map((q, i) => (i ? 'L' : 'M') + x(q[0]).toFixed(1) + ',' + y(q[1]).toFixed(1)).join('');
      // Mensual: escalón, cada valor se sostiene hasta el siguiente mes publicado.
      let d = `M${x(p[0][0]).toFixed(1)},${y(p[0][1]).toFixed(1)}`;
      for (let i = 1; i < p.length; i++) d += `H${x(p[i][0]).toFixed(1)}V${y(p[i][1]).toFixed(1)}`;
      return d;
    };

    let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(op.titulo || 'Gráfica')}"><defs>`;
    series.forEach((s, i) => {
      svg += `<linearGradient id="${uid}a${i}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${s.color}" stop-opacity="0.22"/><stop offset="100%" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
    });
    svg += `<clipPath id="${uid}c"><rect x="${m.l}" y="0" width="${W - m.l - m.r + 6}" height="${H}"/></clipPath></defs>`;

    ty.forEach(v => {
      svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/>`;
      svg += `<text x="${m.l - 10}" y="${y(v) + 4}" text-anchor="end">${op.fmt(v)}</text>`;
    });
    ticksX(t0, t1).forEach(k => {
      svg += `<text x="${x(k.t)}" y="${H - 8}" text-anchor="middle">${k.lbl}</text>`;
    });
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${base}" y2="${base}" stroke="var(--axis)"/>`;
    if (op.ref != null) {
      svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(op.ref)}" y2="${y(op.ref)}" stroke="var(--ink-2)" stroke-opacity=".45" stroke-width="1"/>`;
      svg += `<text x="${W - m.r}" y="${y(op.ref) - 6}" text-anchor="end" class="reflbl">Inicio = ${op.ref}</text>`;
    }

    const anim = op.animar && !sinMovimiento ? ' class="draw"' : '';
    svg += `<g clip-path="url(#${uid}c)">`;
    // Área solo bajo la primera serie visible: con varias áreas se enturbia la lectura.
    if (op.area && series.length <= 3) {
      const s = series[0], p = s.puntos;
      svg += `<path class="area" data-n="${esc(s.nombre)}" d="${trazo(s)}L${x(p[p.length - 1][0]).toFixed(1)},${base}L${x(p[0][0]).toFixed(1)},${base}Z" fill="url(#${uid}a0)"/>`;
    }
    series.forEach(s => {
      svg += `<g class="serie" data-n="${esc(s.nombre)}"><path${anim} pathLength="1" d="${trazo(s)}" fill="none" stroke="${s.color}" stroke-width="${series.length > 3 ? 1.75 : 2.25}" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (s.mensual && s.puntos.length <= 14) {
        s.puntos.forEach(p => { svg += `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="2.5" fill="${s.color}" stroke="var(--surface)" stroke-width="1.5"/>`; });
      }
      svg += '</g>';
    });
    svg += '</g>';

    // Máximo y mínimo del periodo en la serie principal.
    if (op.extremos && series.length <= 3) {
      const p = series[0].puntos;
      const iMax = p.reduce((a, q, i) => q[1] > p[a][1] ? i : a, 0);
      const iMin = p.reduce((a, q, i) => q[1] < p[a][1] ? i : a, 0);
      [[iMax, 'Máx', -10], [iMin, 'Mín', 18]].forEach(([i, lbl, dy]) => {
        if (i >= p.length - 2 || (iMax === iMin)) return;   // el último punto ya tiene etiqueta
        const cx = x(p[i][0]), cy = y(p[i][1]);
        const anchor = cx < m.l + 40 ? 'start' : cx > W - m.r - 40 ? 'end' : 'middle';
        svg += `<g class="ext"><circle cx="${cx}" cy="${cy}" r="3" fill="var(--surface)" stroke="${series[0].color}" stroke-width="1.5"/>
          <text x="${cx}" y="${cy + dy}" text-anchor="${anchor}">${lbl} ${op.fmt(p[i][1])}</text></g>`;
      });
    }

    if (etiquetasFin) {
      const fin = series.map(s => { const p = s.puntos[s.puntos.length - 1]; return { s, p, yy: y(p[1]) }; })
                        .sort((a, b) => a.yy - b.yy);
      for (let i = 1; i < fin.length; i++) if (fin[i].yy - fin[i - 1].yy < 20) fin[i].yy = fin[i - 1].yy + 20;
      fin.forEach(f => {
        const cx = x(f.p[0]), txt = op.fmt(f.p[1]), w = txt.length * 6.6 + 12;
        svg += `<g class="serie-fin" data-n="${esc(f.s.nombre)}"><circle cx="${cx}" cy="${y(f.p[1])}" r="4" fill="${f.s.color}" stroke="var(--surface)" stroke-width="2"/>
          <rect x="${cx + 8}" y="${f.yy - 9}" width="${w}" height="18" rx="5" fill="var(--surface)" stroke="${f.s.color}" stroke-width="1"/>
          <text class="endlbl" x="${cx + 8 + w / 2}" y="${f.yy + 4}" text-anchor="middle">${txt}</text></g>`;
      });
    }

    svg += `<g class="hover" style="display:none"><line class="vl" y1="${m.t}" y2="${base}" stroke="var(--ink-2)" stroke-opacity=".5" stroke-width="1"/>` +
      series.map(s => `<circle r="5" fill="${s.color}" stroke="var(--surface)" stroke-width="2.5"/>`).join('') + '</g>';
    svg += `<rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" tabindex="0" aria-label="Explorar valores con las flechas"/>`;
    svg += '</svg>';
    cont.innerHTML = svg + '<div class="tip"></div>';

    const svgEl = cont.querySelector('svg');
    function resaltar(nombre) {
      svgEl.querySelectorAll('.serie, .serie-fin, .area').forEach(g => {
        g.style.opacity = !nombre || g.dataset.n === nombre ? '' : '0.15';
      });
    }

    const hit = cont.querySelector('.hit'), g = cont.querySelector('.hover'), tip = cont.querySelector('.tip');
    const vl = g.querySelector('.vl'), dots = g.querySelectorAll('circle');
    const fechasRef = series.reduce((a, s) => s.puntos.length > a.length ? s.puntos : a, []).map(p => p[0]);
    let idx = fechasRef.length - 1;

    function mostrar(t) {
      g.style.display = '';
      const tx = x(t);
      vl.setAttribute('x1', tx); vl.setAttribute('x2', tx);
      let filas = '';
      series.forEach((s, i) => {
        // Una serie mensual muestra el último mes publicado, no el mes siguiente más cercano.
        const p = s.mensual ? valorEn(s.puntos, t) : masCercano(s.puntos, t);
        dots[i].setAttribute('cx', x(p[0])); dots[i].setAttribute('cy', y(p[1]));
        const mes = s.mensual ? ` <em>${fMes(p[0])}</em>` : '';
        const ch = (p[1] / s.puntos[0][1] - 1) * 100;
        filas += `<div class="r"><span><i style="background:${s.color}"></i>${esc(s.nombre)}${mes}</span>
          <b>${op.fmt(p[1])}</b><small>${fPct(ch)}</small></div>`;
      });
      tip.innerHTML = `<div class="f"><b>${fSemana(t)}</b>${op.unidad ? '<span>' + esc(op.unidad) + '</span>' : ''}</div>` +
        filas + '<div class="pie">Cambio vs. inicio del periodo</div>';
      tip.style.display = 'block';
      const tw = tip.offsetWidth;
      tip.style.left = (tx + 16 + tw > W ? Math.max(tx - tw - 16, 0) : tx + 16) + 'px';
      tip.style.top = m.t + 'px';
    }
    const ocultar = () => { g.style.display = 'none'; tip.style.display = 'none'; };
    hit.addEventListener('mousemove', e => {
      const r = hit.getBoundingClientRect();
      const t = t0 + (e.clientX - r.left) / r.width * (t1 - t0);
      const p = masCercano(fechasRef.map(f => [f]), t);
      idx = fechasRef.indexOf(p[0]);
      mostrar(p[0]);
    });
    hit.addEventListener('mouseleave', ocultar);
    hit.addEventListener('blur', ocultar);
    hit.addEventListener('focus', () => mostrar(fechasRef[idx]));
    hit.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') idx = Math.max(0, idx - 1);
      else if (e.key === 'ArrowRight') idx = Math.min(fechasRef.length - 1, idx + 1);
      else return;
      e.preventDefault(); mostrar(fechasRef[idx]);
    });
  }

  // ---------- Alertas de mercado ----------
  const badgeAlerta = a => a ? `<span class="al al-${a.key}"><i aria-hidden="true"></i>${a.nombre}</span>` : '<span class="al">Sin datos</span>';
  const badgeRiesgo = r => r.nivel ? `<span class="rg rg-${r.nivel.toLowerCase()}"><i aria-hidden="true"></i>${r.nivel}</span>` : '<span class="rg">—</span>';

  // Franja compacta bajo el semáforo: mayor incremento y mayor caída en el periodo del semáforo.
  function destacados(ms) {
    const con = ms.filter(m => m.vh != null);
    const mayor = con.reduce((a, m) => !a || m.vh > a.vh ? m : a, null);
    const menor = con.reduce((a, m) => !a || m.vh < a.vh ? m : a, null);
    const item = (m, tit) => m ? `<button class="dest" data-ir="${m.c.key}"><span class="dest-t">${tit}</span>
      <b>${esc(m.c.nombre)}</b><span class="dest-v">${fPct(m.vh)}</span>
      <span class="dest-s">${hz().largo} · ${fNum(m.actual)} ${esc(m.unidad)}</span></button>` : '';
    return `<div class="destacados">${item(mayor, 'Mayor incremento')}${item(menor, 'Mayor caída')}</div>`;
  }

  // ---------- Semáforo de riesgo de costo ----------
  const NIVELES = [
    { nivel: 'Alto',     desc: h => `Crecimiento fuerte: subieron más de 10% en los últimos ${h}. Mayor presión sobre costos.` },
    { nivel: 'Moderado', desc: h => `Crecimiento moderado: subieron entre 0% y 10% en los últimos ${h}.` },
    { nivel: 'Bajo',     desc: h => `A la baja: su precio bajó en los últimos ${h}. Sin presión de costo.` },
  ];
  function semaforo(ms, moneda) {
    const h = hz().largo;
    const chips = l => l.length ? l.map(m => `<button class="chip" data-ir="${m.c.key}" title="${esc(m.riesgo.factores.join(' · '))}">
      ${esc(m.c.nombre)} <b>${fPct(m.vh)}</b></button>`).join('') : '<span class="nada">Ninguno</span>';
    const bloques = NIVELES.map(n => {
      // Lo que más se mueve primero: mayores alzas en Alto/Moderado, mayores caídas en Bajo.
      const l = ms.filter(m => m.riesgo.nivel === n.nivel).sort((a, b) => Math.abs(b.vh) - Math.abs(a.vh));
      const k = n.nivel.toLowerCase();
      return `<div class="sem sem-${k}"><div class="sem-top"><span class="sem-luz" aria-hidden="true"></span>
        <div><div class="sem-tit">Riesgo de costo</div><div class="sem-niv">${n.nivel}</div></div>
        <div class="sem-n"><b>${l.length}</b><span>de ${ms.length}</span></div></div>
        <p class="sem-desc">${n.desc(h)}</p><div class="chips">${chips(l)}</div></div>`;
    }).join('');
    return `<div class="sem-head"><h2>Semáforo de riesgo de costo <span class="sem-h">· últimos ${h}</span></h2>
        <div class="sem-acc"><span class="sem-plbl no-print">Periodo</span>${selectorPeriodo('no-print')}
        <button class="btn no-print" id="exportar-pdf" title="Exporta el semáforo y el monitor de precios, con el semáforo a 3 meses">Exportar PDF</button></div></div>
      <section class="semaforo" aria-label="Semáforo de riesgo de costo">${bloques}</section>
      ${destacados(ms)}
      <p class="sem-lbl">Riesgo de costo de los ${ms.length} commodities prioritarios según su variación de precio en los últimos ${h}, en ${moneda}:
        Alto &gt; +10%, Moderado de 0% a +10%, Bajo &lt; 0%. <span class="no-print">Clic en un commodity para ver su detalle ·
        <a href="#metodologia">nota metodológica</a>.</span></p>`;
  }

  // ---------- Tabla de monitoreo ----------
  function sparkline(m) {
    const p = m.periodo;
    if (p.length < 2) return '';
    const W = 72, H = 24, t0 = p[0][0], t1 = p[p.length - 1][0];
    const lo = m.min, hi = m.max;
    const x = t => 1 + (t - t0) / ((t1 - t0) || 1) * (W - 2), y = v => 2 + (1 - (v - lo) / ((hi - lo) || 1)) * (H - 4);
    const d = p.map((q, i) => (i ? 'L' : 'M') + x(q[0]).toFixed(1) + ',' + y(q[1]).toFixed(1)).join('');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${m.c.color}" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="${x(t1)}" cy="${y(p[p.length - 1][1])}" r="2" fill="${m.c.color}"/></svg>`;
  }
  // La columna del periodo del semáforo se resalta; data-l da la etiqueta en la vista de tarjetas (celular).
  const celdaPct = (v, l, k) => `<td class="num${v == null ? ' vacia' : ''}${k === estado.periodo ? ' hz' : ''}" data-l="${l}">${fPct(v)}</td>`;

  // Filtro y orden de las tablas: búsqueda (desde el buscador del encabezado), nivel de riesgo y columna.
  const FILTRO = { q: '', riesgo: 'todos', col: null, dir: -1 };
  const normal = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const coincide = (m, q) => !q || normal(`${m.c.nombre} ${m.s.mercado} ${FAMILIAS[m.c.familia]} ${m.c.sectores || ''}`).includes(normal(q));
  const COLUMNAS = {
    nombre: { lbl: 'Commodity', val: m => normal(m.c.nombre), texto: true },
    riesgo: { lbl: 'Riesgo de costo', val: m => m.vh },
    v1: { lbl: '1 mes', val: m => m.v1 }, v3: { lbl: '3 meses', val: m => m.v3 },
    v6: { lbl: '6 meses', val: m => m.v6 }, v12: { lbl: '12 meses', val: m => m.v12 },
  };
  function filtrarOrdenar(ms) {
    let l = ms.filter(m => coincide(m, FILTRO.q) && (FILTRO.riesgo === 'todos' || m.riesgo.nivel === FILTRO.riesgo));
    if (FILTRO.col) {
      const f = COLUMNAS[FILTRO.col].val;
      l = l.slice().sort((a, b) => {
        const x = f(a), y = f(b);
        if (x == null) return 1; if (y == null) return -1;
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * FILTRO.dir;
      });
    }
    return l;
  }
  const thOrden = (k, extra = '') => {
    const activo = FILTRO.col === k;
    const flecha = activo ? (FILTRO.dir > 0 ? '▲' : '▼') : '↕';
    return `<th class="${extra}${k === 'v' + estado.periodo ? ' hz' : ''}" aria-sort="${activo ? (FILTRO.dir > 0 ? 'ascending' : 'descending') : 'none'}">
      <button class="ord" data-sort="${k}">${COLUMNAS[k].lbl}<span aria-hidden="true">${flecha}</span></button></th>`;
  };

  function filaMonitor(m) {
    return `<tr data-ir="${m.c.key}" tabindex="0">
      <td class="com"><span class="sw" style="background:${m.c.color}"></span><span><b>${esc(m.c.nombre)}</b><small>${esc(m.s.mercado)}${FILTRO.col ? ' · ' + esc(FAMILIAS[m.c.familia]) : ''}</small></span></td>
      <td class="rgcel" data-l="Riesgo ${hz().corto}">${badgeRiesgo(m.riesgo)}<small>${esc(m.riesgo.factores.slice(0, 2).join(' · '))}</small></td>
      <td class="num precio" data-l="Precio actual"><b>${fNum(m.actual)}</b><small class="solo-movil">${esc(m.unidad)}</small></td>
      <td class="uni" data-l="Unidad">${esc(m.unidad)}</td>
      <td class="fte" data-l="Fuente">${esc((m.s.fuente_nombre || '').replace(' vía Yahoo Finance', ''))}<small>${rezagada(m.s) ? 'Último dato disponible: ' : 'Corte: '}${fCorte(m.s)}</small></td>
      ${celdaPct(m.v1, '1 mes', '1')}${celdaPct(m.v3, '3 meses', '3')}${celdaPct(m.v6, '6 meses', '6')}${celdaPct(m.v12, '12 meses', '12')}
      <td class="num" data-l="Máx. periodo">${fNum(m.max)}</td><td class="num" data-l="Mín. periodo">${fNum(m.min)}</td>
      <td class="spk">${sparkline(m)}</td></tr>`;
  }

  function tablaMonitoreo(ms) {
    const l = filtrarOrdenar(ms);
    let filas;
    if (!l.length) filas = '<tr class="sin"><td colspan="12">Ningún commodity coincide con el filtro.</td></tr>';
    else if (FILTRO.col) filas = l.map(filaMonitor).join('');   // ordenada: lista continua
    else filas = ORDEN_FAMILIA.map(f => {
      const g = l.filter(m => m.c.familia === f);
      return g.length ? `<tr class="fam"><th colspan="12" scope="rowgroup">${esc(FAMILIAS[f])}</th></tr>` + g.map(filaMonitor).join('') : '';
    }).join('');
    return `<div class="tabla-wrap"><table class="monitor">
      <thead><tr>${thOrden('nombre')}${thOrden('riesgo')}<th class="num">Precio actual</th><th>Unidad (moneda)</th>
      <th>Fuente · fecha de corte</th>${thOrden('v1', 'num ')}${thOrden('v3', 'num ')}${thOrden('v6', 'num ')}${thOrden('v12', 'num ')}
      <th class="num">Máx. periodo</th><th class="num">Mín. periodo</th><th>Tendencia</th></tr></thead>
      <tbody>${filas}</tbody></table></div>`;
  }

  // Barra de filtros de la tabla: nivel de riesgo, conteo y limpiar.
  function barraFiltros(ms) {
    const n = filtrarOrdenar(ms).length;
    const cuenta = nv => ms.filter(m => coincide(m, FILTRO.q) && (nv === 'todos' || m.riesgo.nivel === nv)).length;
    const btn = (v, l, cls = '') => `<button data-tf="${v}" aria-pressed="${FILTRO.riesgo === v}">${cls ? `<i class="${cls}" aria-hidden="true"></i>` : ''}${l} <span>${cuenta(v)}</span></button>`;
    const activo = FILTRO.q || FILTRO.riesgo !== 'todos' || FILTRO.col;
    return `<div class="tf-bar no-print">
      <div class="tf-chips" role="group" aria-label="Filtrar por riesgo">${btn('todos', 'Todos')}${btn('Alto', 'Alto', 'tf-alto')}${btn('Moderado', 'Moderado', 'tf-moderado')}${btn('Bajo', 'Bajo', 'tf-bajo')}</div>
      <span class="tf-info">${FILTRO.q ? `Búsqueda: “${esc(FILTRO.q)}” · ` : ''}${n} de ${ms.length}${activo ? ' · <button class="tf-limpiar" data-tf-limpiar>Quitar filtros</button>' : ''}</span></div>`;
  }

  // ---------- Ficha por serie ----------
  const FICHAS_ABIERTAS = new Set(COMMODITIES.map(c => c.key));
  function ficha(c, moneda) {
    const ss = TODAS.filter(s => s.commodity === c.key)
      .sort((a, b) => ORDEN_TIPO.indexOf(a.tipo) - ORDEN_TIPO.indexOf(b.tipo));
    const filas = ss.map(s => {
      const cab = `<div class="fs-cab"><span class="tipo t-${s.tipo}">${esc(TIPOS[s.tipo])}</span><span class="fs-mer">${esc(s.mercado)}</span></div>`;
      if (s.pendiente) {
        return `<li class="pend">${cab}<div class="fs-val"><span class="badge-pend">Pendiente</span></div>
          <div class="fs-det">Fuente: ${esc(s.fuente_nombre || '—')} · Unidad: ${esc(s.unidad)}<br>${esc(s.pendiente_motivo || 'Sin datos disponibles')}</div></li>`;
      }
      const conv = enMoneda(s, moneda);
      const ult = conv.puntos[conv.puntos.length - 1];
      const convertida = s.moneda && (s.moneda !== moneda || (s.conversion && s.conversion.divisor !== 1));
      const unidad = conv.esIndice ? 'índice, nivel publicado' : conv.unidad;
      return `<li>${cab}<div class="fs-val"><b>${conv.esIndice ? fNum(ult[1], 2) : fNum(ult[1])}</b><small>${esc(unidad)}</small></div>
        <div class="fs-det">Fuente: ${esc(s.fuente_nombre || s.nombre)} · Unidad original: ${esc(s.unidad)}${convertida ? ` (${fNum(s.raw[s.raw.length - 1][1])})` : ''}<br>
        ${rezagada(s) ? '<b>Último dato disponible:</b>' : 'Fecha de corte:'} ${fCorte(s)}${s.frecuencia === 'mensual' ? ' · mensual' : ' · semanal'}</div></li>`;
    }).join('');
    return `<details class="ficha" data-k="${c.key}"${FICHAS_ABIERTAS.has(c.key) ? ' open' : ''}><summary>Ficha de series · ${ss.length}</summary><ul>${filas}</ul></details>`;
  }

  // ---------- Render ----------
  const SECUNDARIA_ABIERTA = { v: false };
  function render(animar) {
    document.querySelectorAll('.seg').forEach(seg => {
      seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === estado[seg.dataset.f])));
    });
    const moneda = estado.moneda;
    const fxUlt = FX[FX.length - 1];
    document.getElementById('meta').innerHTML =
      `USD/MXN <b>${fNum(fxUlt[1], 2)}</b> al ${fFecha(new Date(fxUlt[0]))} · Actualizado <b>${fFecha(new Date(tActualizado))}</b> ${esc(D.actualizado.slice(11))}`;

    const todas = COMMODITIES.map(c => metricas(c, moneda)).filter(Boolean);
    const prio = todas.filter(m => m.c.prioridad !== 2), secu = todas.filter(m => m.c.prioridad === 2);
    const porFamilia = l => ORDEN_FAMILIA.map(f => ({ nombre: FAMILIAS[f], ms: l.filter(m => m.c.familia === f) }));
    const grupo = GRUPOS.find(g => g.key === estado.familia);
    const delGrupo = COMMODITIES.filter(c => c.grupo === estado.familia);

    ULT.prio = prio; ULT.secu = secu;
    let html = `<div class="impresion-cab solo-print">Reporte generado el ${fFecha(new Date())} · datos actualizados al ${fFecha(new Date(tActualizado))} · en ${moneda}</div>`;
    html += semaforo(prio, moneda);
    html += `<section class="card" id="monitor"><div class="card-head"><h2>Monitor de precios por familia</h2>
      <span class="sub">Máx. y mín. en ${etiquetaPeriodo()} · en ${moneda} · clic en un encabezado para ordenar, en una fila para ver el detalle</span></div>
      <div id="tf-prio">${barraFiltros(prio)}</div><div id="tm-prio">${tablaMonitoreo(prio)}</div>
      <details class="secundaria no-print"${SECUNDARIA_ABIERTA.v || (FILTRO.q && filtrarOrdenar(secu).length) ? ' open' : ''}><summary>Sección secundaria · ${secu.length} commodities
        <span>${secu.map(m => esc(m.c.nombre)).join(' · ')}</span></summary>
        <div id="tm-secu">${tablaMonitoreo(secu)}</div>
        <p class="nota">Los commodities secundarios no entran en el semáforo de riesgo. Zinc, níquel y fertilizantes son promedios mensuales del Banco Mundial.</p>
      </details></section>`;

    const pestanas = GRUPOS.map(g => {
      const ms = todas.filter(m => m.c.grupo === g.key);
      const altos = ms.filter(m => m.riesgo.nivel === 'Alto').length;
      return `<button role="tab" data-v="${g.key}" aria-selected="${g.key === estado.familia}">${esc(g.nombre)}<span class="cnt">${ms.length}</span>
        ${altos ? `<span class="tab-rg" title="${altos} con riesgo de costo alto"><i aria-hidden="true"></i>${altos} alto</span>` : ''}</button>`;
    }).join('');
    html += `<div class="det-head" id="detalle"><h2 class="seccion">Detalle por familia</h2>
        <div class="det-acc">${selectorPeriodo()}<div class="seg seg-sm" data-f="vista" aria-label="Vista">${[['precio', 'Precio'], ['indice', 'Índice base 100']].map(([v, l]) =>
          `<button data-v="${v}" aria-pressed="${estado.vista === v}">${l}</button>`).join('')}</div></div></div>
      <div class="tabs" role="tablist" data-f="familia" aria-label="Familia">${pestanas}</div>`;

    html += '<section class="grid2">';
    delGrupo.forEach(c => {
      html += `<div class="card" id="panel-${c.key}"><div class="card-head"><h2><span class="sw" style="background:${c.color}"></span>${c.nombre}</h2>
        <span class="sub" id="sub-${c.key}"></span></div>
        <div class="bloque" id="b-precio-${c.key}"><div class="bloque-tit" id="t-precio-${c.key}"></div><div id="g-${c.key}"></div></div>
        <div class="bloque" id="b-indice-${c.key}"><div class="bloque-tit">${esc(TIPOS.indice_inegi)} · INPP, base 100 al inicio del periodo</div><div id="gi-${c.key}"></div></div>
        <div class="nota" id="nota-${c.key}"></div>${ficha(c, moneda)}</div>`;
    });
    html += '</section>';

    html += `<section class="card metodologia" id="metodologia"><div class="card-head"><h2>Nota metodológica</h2></div>
      <p>Las series provienen de fuentes con <b>distintas unidades, monedas, frecuencias y fechas de corte</b>, así que no son directamente comparables en nivel.
      Por eso la comparación de tendencia se hace con <b>índices base 100</b>: cada serie se divide entre su propio valor al inicio del periodo elegido.</p>
      <ul>
        <li><b>${esc(TIPOS.benchmark)}:</b> futuros de mercado (CME, CBOT, COMEX, NYMEX, ICE) y promedios mensuales del Banco Mundial (LME y fertilizantes).
          Se convierten a unidades métricas y, en MXN, con el tipo de cambio de la misma semana.</li>
        <li><b>${esc(TIPOS.referencia_mx)}:</b> precios de referencia oficiales en México (por ejemplo, el IPGN del gas natural).</li>
        <li><b>${esc(TIPOS.domestico)}:</b> precios observados en México en pesos, por ejemplo el diésel al público según la CNE.</li>
        <li><b>${esc(TIPOS.indice_inegi)}:</b> el INPP es un índice de precios al productor, mensual, sin unidades monetarias y publicado con alrededor de un mes de rezago.
          Mide variación, no nivel de precio, así que se grafica aparte de los precios y se lee solo como tendencia.</li>
      </ul>
      <p><b>Variaciones.</b> Se calculan sobre el benchmark principal de cada commodity, medidas desde su último dato disponible.
        En MXN la variación incluye el efecto del tipo de cambio, que es el relevante para un costo en pesos; en USD refleja solo el precio internacional.</p>
      <p><b>Riesgo de costo.</b> Se clasifica únicamente con la variación de precio de los últimos 3 meses:
        <b>Alto</b> si subió más de 10% (crecimiento fuerte), <b>Moderado</b> si subió entre 0% y 10% y <b>Bajo</b> si bajó.
        La tendencia del último mes, la volatilidad y la relevancia como insumo se muestran como contexto en cada commodity, pero no cambian su nivel.
        Es una señal de monitoreo, no un pronóstico.</p>
      <p>Los datos semanales corresponden al cierre de cada semana. En la semana en curso se muestra el último dato disponible con su fecha real, que nunca es posterior a la actualización.
      Cuando una serie tiene un corte distinto al de las demás, se indica como “Último dato disponible” con su fecha. Las series marcadas como <span class="badge-pend">Pendiente</span>
      están previstas, pero todavía no tienen fuente verificada ni datos; no se muestra ningún valor estimado para ellas.</p></section>`;

    html += `<section class="card"><div class="card-head"><h2>Últimas 12 semanas · ${esc(grupo.nombre)}</h2>
      <button class="btn" id="descargar">Descargar histórico completo (CSV)</button></div><div class="tabla-wrap" id="tabla"></div></section>`;
    app.innerHTML = html;

    document.getElementById('descargar').addEventListener('click', descargarCsv);
    document.getElementById('exportar-pdf').addEventListener('click', exportarPdf);
    conectarControles(app);
    app.querySelectorAll('details.ficha').forEach(d => d.addEventListener('toggle', () =>
      d.open ? FICHAS_ABIERTAS.add(d.dataset.k) : FICHAS_ABIERTAS.delete(d.dataset.k)));
    app.querySelector('details.secundaria').addEventListener('toggle', e => { SECUNDARIA_ABIERTA.v = e.target.open; });


    // Paneles por commodity: los precios y los índices INPP se grafican por separado en la vista Precio.
    delGrupo.forEach(c => {
      const ss = SERIES.filter(s => s.commodity === c.key).sort((a, b) => ORDEN_TIPO.indexOf(a.tipo) - ORDEN_TIPO.indexOf(b.tipo));
      const usados = {};
      const aSerie = (s, indice) => {
        const conv = enMoneda(s, moneda);
        const paleta = COLOR_TIPO[s.tipo];
        const color = paleta[(usados[s.tipo] = (usados[s.tipo] ?? -1) + 1) % paleta.length];
        return {
          nombre: `${TIPO_CORTO[s.tipo]} · ${s.mercado}`, color, mensual: s.frecuencia === 'mensual', unidad: conv.unidad,
          puntos: indice ? aIndice(recortar(conv.puntos)) : recortar(conv.puntos),
        };
      };
      const precios = ss.filter(esPrecio), indices = ss.filter(s => !esPrecio(s));
      const notas = [];
      const bPrecio = document.getElementById('b-precio-' + c.key), bIndice = document.getElementById('b-indice-' + c.key);
      const fmtIdx = v => fNum(v, 0);

      if (estado.vista === 'indice') {
        document.getElementById('sub-' + c.key).textContent = 'Índice base 100';
        document.getElementById('t-precio-' + c.key).textContent = 'Todas las referencias · base 100 al inicio del periodo';
        bIndice.hidden = true;
        graficaLineas(document.getElementById('g-' + c.key), ss.map(s => aSerie(s, true)),
          { fmt: fmtIdx, titulo: c.nombre, unidad: 'Índice base 100', ref: 100, animar });
      } else {
        const unidades = [...new Set(precios.map(s => enMoneda(s, moneda).unidad))];
        const idxPrecios = unidades.length > 1;
        document.getElementById('sub-' + c.key).textContent = idxPrecios ? 'Precios en base 100' : unidades[0];
        document.getElementById('t-precio-' + c.key).textContent =
          precios.map(s => TIPOS[s.tipo]).filter((v, i, a) => a.indexOf(v) === i).join(' y ') + (idxPrecios ? ' · base 100' : ` · ${unidades[0]}`);
        if (idxPrecios) notas.push('Los precios tienen unidades distintas, por eso se comparan en base 100.');
        graficaLineas(document.getElementById('g-' + c.key), precios.map(s => aSerie(s, idxPrecios)), {
          fmt: idxPrecios ? fmtIdx : (v => fNum(v)), titulo: c.nombre, unidad: idxPrecios ? 'Índice base 100' : unidades[0],
          ref: idxPrecios ? 100 : null, animar,
        });
        bIndice.hidden = !indices.length;
        if (indices.length) {
          graficaLineas(document.getElementById('gi-' + c.key), indices.map(s => aSerie(s, true)), {
            alto: 170, fmt: fmtIdx, titulo: c.nombre + ' INPP', unidad: 'Índice base 100', ref: 100, extremos: false, animar,
          });
        }
      }
      if (!precios.length) bPrecio.hidden = true;
      TODAS.filter(s => s.commodity === c.key && s.conversion && s.conversion.nota && !s.pendiente)
        .forEach(s => notas.push(`${s.nombre}: ${s.conversion.nota}.`));
      document.getElementById('nota-' + c.key).textContent = notas.join(' ');
    });

    renderTabla(moneda, delGrupo);
  }

  function renderTabla(moneda, delGrupo) {
    const fechas = FX.slice(-12).map(p => p[0]).reverse();
    const cols = SERIES.filter(s => delGrupo.some(c => c.key === s.commodity))
      .sort((a, b) => ORDEN_TIPO.indexOf(a.tipo) - ORDEN_TIPO.indexOf(b.tipo) ||
        delGrupo.findIndex(c => c.key === a.commodity) - delGrupo.findIndex(c => c.key === b.commodity))
      .map(s => ({ s, ...enMoneda(s, moneda) }));
    let h = '<table><thead><tr><th>Semana</th><th>USD/MXN</th>' +
      cols.map(c => `<th><span class="tipo t-${c.s.tipo}">${TIPO_CORTO[c.s.tipo]}</span><br>${esc(c.s.nombre)}<br>${esc(c.esIndice ? 'Índice' : c.unidad)}</th>`).join('') +
      '</tr></thead><tbody>';
    fechas.forEach(t => {
      const lbl = new Date(t).getDay() === 5 ? fFecha(new Date(t)) : `${fFecha(new Date(t))} (en curso)`;
      h += `<tr><td>${lbl}</td><td>${fNum(fxEn(t), 2)}</td>` + cols.map(c => {
        // Las series mensuales repiten el último mes publicado hasta que sale el siguiente.
        const p = c.s.frecuencia === 'mensual' ? (c.puntos[0][0] <= t ? valorEn(c.puntos, t) : null)
                                               : c.puntos.find(q => semanaDe(q[0]) === semanaDe(t));
        return `<td>${p ? fNum(p[1]) : '—'}</td>`;
      }).join('') + '</tr>';
    });
    document.getElementById('tabla').innerHTML = h + '</tbody></table>' +
      '<p class="nota">Las series mensuales (INPP y Banco Mundial) muestran el último mes publicado en cada semana. “—” indica que la serie no tiene dato para esa semana.</p>';
  }

  function descargarCsv() {
    const fechas = [...new Set([...FX.map(p => p[0]), ...SERIES.flatMap(s => s.raw.map(p => p[0]))])].sort((a, b) => a - b);
    const iso = t => new Date(t).toISOString().slice(0, 10);
    const mapas = SERIES.map(s => new Map(s.raw.map(p => [p[0], p[1]])));
    const fxMap = new Map(FX);
    let csv = 'fecha,USD/MXN,' + SERIES.map(s => `"${s.nombre} (${s.unidad})"`).join(',') + '\n';
    fechas.forEach(t => {
      csv += iso(t) + ',' + (fxMap.get(t) ?? '') + ',' + mapas.map(mp => mp.get(t) ?? '').join(',') + '\n';
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `commodities_${iso(fechaMax)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Navegación, filtros de tabla, buscador y PDF ----------
  const ULT = { prio: [], secu: [] };
  function irA(key) {
    const c = COMMODITIES.find(k => k.key === key);
    if (c && c.grupo !== estado.familia) { estado.familia = c.grupo; guardar(); render(true); }
    const el = document.getElementById('panel-' + key);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Re-dibuja solo las tablas del monitor (al buscar, filtrar u ordenar), sin tocar el resto de la página.
  function refrescarTablas() {
    const tf = document.getElementById('tf-prio');
    if (!tf) return;
    tf.innerHTML = barraFiltros(ULT.prio);
    document.getElementById('tm-prio').innerHTML = tablaMonitoreo(ULT.prio);
    document.getElementById('tm-secu').innerHTML = tablaMonitoreo(ULT.secu);
    const det = document.querySelector('details.secundaria');
    if (FILTRO.q && filtrarOrdenar(ULT.secu).length) det.open = true;
  }
  app.addEventListener('click', e => {
    const ord = e.target.closest('[data-sort]');
    if (ord) {
      const k = ord.dataset.sort;
      if (FILTRO.col === k) FILTRO.dir = -FILTRO.dir;
      else { FILTRO.col = k; FILTRO.dir = COLUMNAS[k].texto ? 1 : -1; }
      return refrescarTablas();
    }
    const tf = e.target.closest('[data-tf]');
    if (tf) { FILTRO.riesgo = tf.dataset.tf; return refrescarTablas(); }
    if (e.target.closest('[data-tf-limpiar]')) {
      Object.assign(FILTRO, { q: '', riesgo: 'todos', col: null, dir: -1 });
      buscador.value = '';
      return refrescarTablas();
    }
    const ir = e.target.closest('[data-ir]');
    if (ir) irA(ir.dataset.ir);
  });
  app.addEventListener('keydown', e => {
    const tr = e.target.closest('tr[data-ir]');
    if (tr && e.key === 'Enter') irA(tr.dataset.ir);
  });

  // Buscador del encabezado: filtra la tabla al escribir; Enter o una sugerencia llevan al detalle.
  const buscador = document.getElementById('buscador');
  const sugerencias = document.getElementById('sugerencias');
  let iSug = -1;
  function pintarSugerencias() {
    const q = buscador.value.trim();
    const l = q ? [...ULT.prio, ...ULT.secu].filter(m => coincide(m, q)).slice(0, 8) : [];
    iSug = l.length ? 0 : -1;
    sugerencias.innerHTML = l.map((m, i) => `<li role="option" data-k="${m.c.key}" aria-selected="${i === iSug}">
      <span class="sw" style="background:${m.c.color}"></span><span class="sg-n">${esc(m.c.nombre)}<small>${esc(FAMILIAS[m.c.familia])} · ${esc(m.s.mercado)}</small></span>
      ${badgeRiesgo(m.riesgo)}</li>`).join('') || (q ? '<li class="sg-vacio">Sin resultados</li>' : '');
    sugerencias.hidden = !q;
  }
  function elegir(key) {
    sugerencias.hidden = true;
    buscador.blur();
    irA(key);
  }
  buscador.addEventListener('input', () => {
    FILTRO.q = buscador.value.trim();
    refrescarTablas();
    pintarSugerencias();
  });
  buscador.addEventListener('keydown', e => {
    const items = [...sugerencias.querySelectorAll('li[data-k]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      iSug = (iSug + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.setAttribute('aria-selected', String(i === iSug)));
    } else if (e.key === 'Enter' && items[iSug]) {
      e.preventDefault(); elegir(items[iSug].dataset.k);
    } else if (e.key === 'Escape') {
      buscador.value = ''; FILTRO.q = ''; refrescarTablas(); sugerencias.hidden = true;
    }
  });
  sugerencias.addEventListener('mousedown', e => { const li = e.target.closest('li[data-k]'); if (li) { e.preventDefault(); elegir(li.dataset.k); } });
  buscador.addEventListener('blur', () => setTimeout(() => { sugerencias.hidden = true; }, 150));
  buscador.addEventListener('focus', () => { if (buscador.value.trim()) pintarSugerencias(); });

  // PDF: imprime el semáforo y el monitor de precios, siempre con el semáforo a 3 meses y sin filtros de tabla.
  let previoImpresion = null;
  function prepararImpresion() {
    if (previoImpresion) return;
    previoImpresion = { periodo: estado.periodo, filtro: { ...FILTRO } };
    estado.periodo = '3';
    Object.assign(FILTRO, { q: '', riesgo: 'todos', col: null, dir: -1 });
    document.body.classList.add('imprimiendo');
    render(false);
  }
  function restaurarImpresion() {
    if (!previoImpresion) return;
    estado.periodo = previoImpresion.periodo;
    Object.assign(FILTRO, previoImpresion.filtro);
    previoImpresion = null;
    document.body.classList.remove('imprimiendo');
    render(false);
  }
  function exportarPdf() {
    prepararImpresion();
    setTimeout(() => { window.print(); }, 50);
  }
  window.addEventListener('beforeprint', prepararImpresion);   // también con Ctrl+P
  window.addEventListener('afterprint', restaurarImpresion);

  // Controles (periodo, moneda, vista, familia): cada botón se conecta directamente después de cada
  // render, sin depender de que el clic llegue hasta document (en el visor de claude.ai la página corre en un marco).
  function cambiar(f, v) {
    if (!(f in estado) || estado[f] === v) return;
    estado[f] = v;
    guardar();
    const y = window.scrollY;
    render(true);
    window.scrollTo(0, y);   // cambiar de periodo o de pestaña no debe mover la página
    if (f === 'periodo' || f === 'moneda') animarSemaforo();
  }
  function conectarControles(raiz) {
    raiz.querySelectorAll('[data-f]').forEach(cont => {
      cont.querySelectorAll('button[data-v]').forEach(b => {
        if (b._conectado) return;
        b._conectado = true;
        b.addEventListener('click', e => { e.preventDefault(); cambiar(cont.dataset.f, b.dataset.v); });
      });
    });
  }
  // Señal visual de que el semáforo se recalculó: destello de los bloques y conteo animado de los números.
  function animarSemaforo() {
    document.querySelectorAll('.sem').forEach((s, i) => {
      s.classList.remove('sem-cambio'); void s.offsetWidth; s.classList.add('sem-cambio');
      s.style.animationDelay = (i * 60) + 'ms';
    });
    if (sinMovimiento) return;
    document.querySelectorAll('.sem-n b').forEach(el => {
      const fin = +el.textContent, t0 = performance.now();
      const paso = t => { const k = Math.min(1, (t - t0) / 450); el.textContent = Math.round(fin * k); if (k < 1) requestAnimationFrame(paso); };
      el.textContent = '0'; requestAnimationFrame(paso);
    });
  }
  conectarControles(document.querySelector('header'));

  // Si algo falla, se avisa en la página en lugar de quedarse sin responder.
  window.addEventListener('error', e => {
    let av = document.getElementById('aviso-error');
    if (!av) { av = document.createElement('div'); av.id = 'aviso-error'; av.className = 'aviso-error'; document.body.prepend(av); }
    av.textContent = 'Ocurrió un error al actualizar la vista: ' + (e.message || e.error) + '. Recarga la página (Ctrl+F5).';
  });

  // Solo se re-dibuja al cambiar el ancho (el visor puede cambiar la altura del marco a cada momento).
  let tRes, anchoPrevio = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === anchoPrevio) return;
    anchoPrevio = window.innerWidth;
    clearTimeout(tRes); tRes = setTimeout(() => render(false), 150);
  });
  render(true);
})();
