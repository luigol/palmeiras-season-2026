// Interface: filtros à esquerda (campeonatos e estatísticas), indicadores e gráfico por jogo à direita.

const PREFS = 'palmeiras:prefs';
const TEMA = 'palmeiras:tema';
const JANELA = 5;            // jogos da média móvel e do recorte "últimos"
const VIVO_MS = 30 * 1000;   // atualização durante a partida
const MOVIMENTO = !matchMedia('(prefers-reduced-motion: reduce)').matches;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const estado = {
  campeonato: 'todos',
  estatistica: 'finalizacoes',
  lado: 'pal',
  mando: 'todos',   // 'todos' | 'casa' | 'fora'
  tabela: false,
  jogos: [],        // encerrados, em ordem cronológica
  aoVivo: null,     // jogo em andamento, ou null
  proximo: null,    // próximo evento segundo a ESPN
  progresso: null,  // { feitos, total } durante a carga
  erro: null,
  atualizado: null,
};

let grafico = null;
let noGrafico = [];   // jogos na ordem das barras
let rotulos = [];     // [{ i, texto, cor }] desenhados acima das barras
let timerVivo = null;
let vigiando = false;

const $ = id => document.getElementById(id);

// ---------- Preferências ----------

function salvarPrefs() {
  try {
    const { campeonato, estatistica, lado, mando, tabela } = estado;
    localStorage.setItem(PREFS, JSON.stringify({ campeonato, estatistica, lado, mando, tabela }));
  } catch (e) {}
}

function lerPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS)) || {};
    if (typeof p.campeonato === 'string') estado.campeonato = p.campeonato;
    if (EST[p.estatistica]) estado.estatistica = p.estatistica;
    if (p.lado === 'pal' || p.lado === 'adv') estado.lado = p.lado;
    if (['todos', 'casa', 'fora'].includes(p.mando)) estado.mando = p.mando;
    estado.tabela = !!p.tabela;
  } catch (e) {}
}

// ---------- Formatação ----------

function css(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
}

function comAlfa(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function nf(v, casas) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Valor de um jogo: contagens inteiras, posse com uma casa, percentuais arredondados
function casasJogo(est) {
  return est.casas ?? (est.tipo === 'media' ? 1 : 0);
}

function partes(v, est, casas) {
  return v == null ? { num: '—', un: '' } : { num: nf(v, casas), un: est.unidade || '' };
}

function texto(v, est, casas) {
  const p = partes(v, est, casas);
  return p.num + p.un;
}

function textoJogo(v, est) {
  return v == null && est.semValor ? est.semValor : texto(v, est, casasJogo(est));
}

function fmtData(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

function fmtHora(t) {
  return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function quando(iso) {
  const d = new Date(iso);
  const dias = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 864e5);
  const dia = dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : fmtData(iso);
  return `${dia}, ${fmtHora(d)}`;
}

function competicao(j) {
  return COMPETICOES[j.liga] || j.ligaNome || j.liga;
}

function placar(j) {
  const [casa, fora] = j.mando === 'home' ? ['pal', 'adv'] : ['adv', 'pal'];
  const nome = lado => (lado === 'pal' ? 'Palmeiras' : j.adversario.nome);
  let s = `${nome(casa)} ${j.gols[casa] ?? '-'} × ${j.gols[fora] ?? '-'} ${nome(fora)}`;
  if (j.penaltis) s += ` (pên. ${j.penaltis[casa]}–${j.penaltis[fora]})`;
  return s;
}

function placarCurto(j) {
  const [casa, fora] = j.mando === 'home' ? ['pal', 'adv'] : ['adv', 'pal'];
  const sigla = lado => (lado === 'pal' ? 'PAL' : j.adversario.sigla);
  return `${sigla(casa)} ${j.gols[casa] ?? 0} × ${j.gols[fora] ?? 0} ${sigla(fora)}`;
}

function confronto(evento) {
  const cs = evento.competitions[0].competitors;
  const nome = lado => cs.find(c => c.homeAway === lado)?.team?.displayName || '?';
  return `${nome('home')} × ${nome('away')}`;
}

function contexto(j) {
  return `vs. ${j.adversario.nome} · ${fmtData(j.data)}`;
}

function variacao(atual, base, est) {
  if (atual == null || base == null) return '';
  const d = atual - base;
  if (Math.abs(d) < 0.05) return 'igual à média';
  return `${d > 0 ? '↑' : '↓'} ${nf(Math.abs(d), 1)}${est.unidade === '%' ? ' p.p.' : ''} vs. média`;
}

// ---------- Seleção ----------

function passaMando(j) {
  return estado.mando === 'todos' || (j.mando === 'home') === (estado.mando === 'casa');
}

function passaFiltros(j) {
  return passaMando(j) && (estado.campeonato === 'todos' || j.liga === estado.campeonato);
}

function jogosVisiveis() {
  return estado.jogos.filter(passaFiltros);
}

function vivoVisivel() {
  return estado.aoVivo && passaFiltros(estado.aoVivo) ? estado.aoVivo : null;
}

// As contagens respeitam o mando, para baterem com o que o gráfico mostra
function campeonatos() {
  const ligas = Object.keys(COMPETICOES);
  for (const j of estado.jogos) if (!ligas.includes(j.liga)) ligas.push(j.liga);
  const qtd = id => (estado.jogos.length
    ? estado.jogos.filter(j => passaMando(j) && (id === 'todos' || j.liga === id)).length
    : '');
  return [
    { id: 'todos', nome: 'Todos', qtd: qtd('todos') },
    ...ligas.map(id => ({ id, nome: competicao(estado.jogos.find(j => j.liga === id) || { liga: id }), qtd: qtd(id) })),
  ];
}

function itensEstatisticas(secao) {
  const itens = [];
  for (const e of ESTATISTICAS.filter(e => (e.secao || 'padrao') === secao)) {
    if (e.grupo && !itens.some(i => i.grupo === e.grupo)) itens.push({ grupo: e.grupo });
    itens.push({ id: e.id, nome: e.nome });
  }
  return itens;
}

function escolher(campo, valor) {
  estado[campo] = valor;
  salvarPrefs();
  renderizarTudo();
}

// ---------- Lateral ----------

// Recria os botões só quando a lista muda, para não perder o foco do teclado
function sincronizarBotoes(raiz, itens, ativo, aoEscolher) {
  const chave = itens.map(i => i.id || '#' + i.grupo).join('|');
  if (raiz.dataset.chave !== chave) {
    raiz.replaceChildren();
    for (const it of itens) {
      if (it.grupo) {
        const g = document.createElement('div');
        g.className = 'grupo';
        g.textContent = it.grupo;
        raiz.append(g);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opcao';
      b.dataset.id = it.id;
      const nome = document.createElement('span');
      nome.textContent = it.nome;
      const qtd = document.createElement('span');
      qtd.className = 'qtd';
      b.append(nome, qtd);
      b.addEventListener('click', () => aoEscolher(it.id));
      raiz.append(b);
    }
    raiz.dataset.chave = chave;
  }
  for (const b of raiz.querySelectorAll('.opcao')) {
    const it = itens.find(i => i.id === b.dataset.id);
    b.setAttribute('aria-pressed', String(b.dataset.id === ativo));
    b.querySelector('.qtd').textContent = it.qtd ?? '';
  }
}

// ---------- Cabeçalho e indicadores ----------

function renderizarCabecalho() {
  const est = EST[estado.estatistica];
  const js = jogosVisiveis();
  const camp = campeonatos().find(c => c.id === estado.campeonato);
  const sub = [
    estado.lado === 'pal' ? 'Palmeiras' : 'Adversários',
    estado.campeonato === 'todos' ? 'Todos os campeonatos' : camp?.nome || estado.campeonato,
  ];
  if (estado.mando !== 'todos') sub.push(estado.mando === 'casa' ? 'Em casa' : 'Fora de casa');
  if (estado.progresso && !estado.jogos.length) sub.push('carregando…');
  else sub.push(`${js.length} ${js.length === 1 ? 'jogo' : 'jogos'}`);
  if (vivoVisivel()) sub.push('1 ao vivo');
  $('titulo').textContent = est.nome;
  $('subtitulo').textContent = sub.join(' · ');
  $('descricao').textContent = est.descricao || '';
  $('descricao').hidden = !est.descricao;
  for (const grupo of document.querySelectorAll('.segmentado')) {
    for (const b of grupo.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.valor === estado[grupo.dataset.campo]));
    }
  }
}

// O jogo ao vivo fica de fora dos indicadores: números parciais distorcem as médias
function renderizarKpis() {
  const est = EST[estado.estatistica];
  const lado = estado.lado;
  const js = jogosVisiveis();
  const porJogo = js.map(j => ({ v: valorJogo(est, j, lado), j })).filter(x => x.v != null);
  const media = agregar(est, js, lado);
  const ultimos = js.slice(-JANELA);
  const mediaUlt = agregar(est, ultimos, lado);
  // empate: fica o jogo mais recente
  const max = porJogo.reduce((a, b) => (a && a.v > b.v ? a : b), null);
  const min = porJogo.reduce((a, b) => (a && a.v < b.v ? a : b), null);
  const cj = casasJogo(est);

  const tiles = [
    { rot: est.tipo === 'soma' ? 'Por jogo' : 'Média', ...partes(media, est, 1), det: js.length ? `${js.length} jogos` : '' },
    { rot: `Últimos ${JANELA}`, ...partes(mediaUlt, est, 1), det: variacao(mediaUlt, media, est) },
    est.tipo === 'soma'
      ? { rot: 'Total', ...partes(js.length ? somar(est, js, lado) : null, est, 0), det: 'soma dos jogos' }
      : { rot: 'Mínimo', ...partes(min?.v, est, cj), det: min ? contexto(min.j) : '' },
    { rot: 'Máximo', ...partes(max?.v, est, cj), det: max ? contexto(max.j) : '' },
  ];

  const raiz = $('kpis');
  raiz.replaceChildren();
  for (const t of tiles) {
    const el = document.createElement('div');
    el.className = 'kpi';
    const rot = document.createElement('div');
    rot.className = 'rot';
    rot.textContent = t.rot;
    const val = document.createElement('div');
    val.className = 'val';
    val.textContent = t.num;
    if (t.un) {
      const un = document.createElement('small');
      un.textContent = t.un;
      val.append(un);
    }
    const det = document.createElement('div');
    det.className = 'det';
    det.textContent = t.det;
    det.title = t.det;
    el.append(rot, val, det);
    raiz.append(el);
  }
}

// ---------- Gráfico ----------

// Valor do recorde e marca "ao vivo" acima das barras; o resto fica na dica e na tabela
const pluginRotulos = {
  id: 'rotulos',
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(1);
    const { ctx, scales } = chart;
    ctx.save();
    // jogo sem valor (ex.: sem gol em "finalizações por gol"): ponto discreto na base, para o vão não parecer dado faltando
    if (EST[estado.estatistica].semValor) {
      const y0 = scales.y.getPixelForValue(0);
      ctx.fillStyle = css('--muted');
      noGrafico.forEach((j, i) => {
        if (j.estado === 'in' || chart.data.datasets[1].data[i] != null) return;
        ctx.beginPath();
        ctx.arc(scales.x.getPixelForValue(i), y0 - 5, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.font = `500 11px ${css('--fonte')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const r of rotulos) {
      const el = meta.data[r.i];
      if (!el) continue;
      // perto da borda, o texto encosta na margem em vez de ser cortado
      const meia = ctx.measureText(r.texto).width / 2;
      const x = Math.min(Math.max(el.x, meia), chart.width - meia);
      ctx.fillStyle = r.cor;
      ctx.fillText(r.texto, x, Math.min(el.y, el.base) - 6);
    }
    ctx.restore();
  },
};

function criarGrafico() {
  if (grafico) grafico.destroy();
  Chart.defaults.font.family = css('--fonte');
  Chart.defaults.font.size = 12;
  Chart.defaults.color = css('--muted');

  grafico = new Chart($('grafico'), {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          type: 'line', label: 'Média móvel', data: [], order: 0,
          borderColor: css('--linha'), borderWidth: 2, borderCapStyle: 'round', borderJoinStyle: 'round',
          cubicInterpolationMode: 'monotone', spanGaps: false,
          pointRadius: 0, pointHoverRadius: 4, pointHoverBorderWidth: 2,
          pointHoverBackgroundColor: css('--linha'), pointHoverBorderColor: css('--surface'),
        },
        {
          type: 'bar', label: 'Por jogo', data: [], order: 1,
          backgroundColor: [], hoverBackgroundColor: [],
          borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24,
          categoryPercentage: 1, barPercentage: 0.78,
        },
      ],
    },
    plugins: [pluginRotulos],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: MOVIMENTO ? { duration: 450, easing: 'easeOutQuart' } : false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 22 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css('--surface'),
          borderColor: css('--border'),
          borderWidth: 1,
          titleColor: css('--ink'),
          bodyColor: css('--ink2'),
          footerColor: css('--muted'),
          titleFont: { weight: '600', size: 13 },
          bodyFont: { size: 12 },
          footerFont: { size: 11, weight: '400' },
          padding: 12,
          cornerRadius: 10,
          caretSize: 0,
          boxPadding: 6,
          usePointStyle: true,
          filter: item => item.raw != null || item.dataset.type === 'bar',
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          callbacks: {
            title: items => placar(noGrafico[items[0].dataIndex]),
            label: c => {
              const est = EST[estado.estatistica];
              if (c.dataset.type === 'line') return ` ${texto(c.raw, est, 1)}  média dos últimos ${JANELA}`;
              const j = noGrafico[c.dataIndex];
              const quem = estado.lado === 'pal' ? 'Palmeiras' : j.adversario.nome;
              return ` ${textoJogo(c.raw, est)}  ${quem}`;
            },
            footer: items => {
              const j = noGrafico[items[0].dataIndex];
              const itens = [competicao(j), j.fase, fmtData(j.data)].filter(Boolean);
              if (j.estado === 'in') itens.push(`ao vivo, ${j.detalhe}`);
              return itens.join(' · ');
            },
            labelPointStyle: c => ({ pointStyle: c.dataset.type === 'line' ? 'line' : 'rectRounded', rotation: 0 }),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: css('--grid') },
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            callback(_v, i) {
              const j = noGrafico[i];
              if (!j) return null;
              if (noGrafico.length <= 12) return j.adversario.sigla;
              return marcasDeMes(this.width).has(i) ? MESES[new Date(j.data).getMonth()] : null;
            },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: css('--grid') },
          border: { display: false },
          ticks: {
            maxTicksLimit: 6,
            precision: 0,
            callback: v => nf(v, 0) + (EST[estado.estatistica].unidade || ''),
          },
        },
      },
    },
  });
}

// Índices do primeiro jogo de cada mês, pulando o mês cujo rótulo encostaria no anterior
function marcasDeMes(largura) {
  const passo = largura / Math.max(noGrafico.length, 1);
  const marcas = new Set();
  let ultima = -Infinity;
  noGrafico.forEach((j, i) => {
    const mes = new Date(j.data).getMonth();
    const novo = i === 0 || new Date(noGrafico[i - 1].data).getMonth() !== mes;
    if (novo && (i - ultima) * passo >= 32) {
      marcas.add(i);
      ultima = i;
    }
  });
  return marcas;
}

function renderizarLegenda(cor, temMedia, temVivo, semValor) {
  const raiz = $('legenda');
  raiz.replaceChildren();
  const item = (classe, rotulo, fundo) => {
    const s = document.createElement('span');
    const chave = document.createElement('i');
    chave.className = classe;
    if (fundo) chave.style.background = fundo;
    s.append(chave, document.createTextNode(rotulo));
    raiz.append(s);
  };
  item('chave-barra', 'Por jogo', cor);
  if (temMedia) item('chave-linha', `Média dos últimos ${JANELA}`);
  if (temVivo) item('chave-barra', 'Ao vivo', comAlfa(cor, 0.4));
  if (semValor) item('chave-ponto', `Jogo ${semValor}`);
}

function atualizarGrafico() {
  if (!grafico) criarGrafico();
  const est = EST[estado.estatistica];
  const lado = estado.lado;
  const js = jogosVisiveis();
  const vivo = vivoVisivel();
  noGrafico = vivo ? [...js, vivo] : js;

  const valores = noGrafico.map(j => valorJogo(est, j, lado));
  // com poucos jogos a média móvel vira um traço solto; só aparece a partir de duas janelas
  const temMedia = js.length >= 2 * JANELA;
  const media = noGrafico.map((j, i) =>
    !temMedia || j === vivo || i < JANELA - 1 ? null : agregar(est, js.slice(i - JANELA + 1, i + 1), lado));
  const cor = css(lado === 'pal' ? '--pal' : '--adv');

  const [linha, barras] = grafico.data.datasets;
  grafico.data.labels = noGrafico.map(j => j.id);
  linha.data = media;
  barras.data = valores;
  barras.backgroundColor = noGrafico.map(j => (j === vivo ? comAlfa(cor, 0.4) : cor));
  barras.hoverBackgroundColor = noGrafico.map(j => comAlfa(cor, j === vivo ? 0.3 : 0.8));

  rotulos = [];
  const iVivo = vivo ? noGrafico.length - 1 : -1;
  let iMax = -1;
  js.forEach((j, i) => {
    if (valores[i] != null && (iMax < 0 || valores[i] >= valores[iMax])) iMax = i;
  });
  if (iMax >= 0 && (iVivo < 0 || iVivo - iMax > 2)) {
    rotulos.push({ i: iMax, texto: texto(valores[iMax], est, casasJogo(est)), cor: css('--ink2') });
  }
  if (vivo) rotulos.push({ i: iVivo, texto: 'AO VIVO', cor: css('--live') });

  const temSemValor = est.semValor && noGrafico.some((j, i) => j !== vivo && valores[i] == null);
  renderizarLegenda(cor, temMedia, !!vivo, temSemValor ? est.semValor : null);
  const m = agregar(est, js, lado);
  $('grafico').setAttribute('aria-label',
    `${est.nome} por jogo, ${js.length} jogos${m == null ? '' : `, média ${texto(m, est, 1)}`}. Os valores estão na tabela.`);
  grafico.update();
}

function recriarGrafico() {
  if (grafico) grafico.destroy();
  grafico = null;
  atualizarGrafico();
}

function renderizarVazio() {
  const v = $('vazio');
  v.replaceChildren();
  let msg = null;
  let tentar = false;
  if (estado.progresso && !estado.jogos.length) {
    const { feitos, total } = estado.progresso;
    msg = total ? `Carregando jogos… ${feitos} de ${total}` : 'Buscando a agenda do Palmeiras…';
  } else if (estado.erro && !estado.jogos.length) {
    msg = `Não foi possível falar com a ESPN (${estado.erro}).`;
    tentar = true;
  } else if (!noGrafico.length) {
    msg = 'Nenhum jogo nesta seleção ainda.';
  }
  v.hidden = !msg;
  $('grafico').style.visibility = msg ? 'hidden' : '';
  if (!msg) return;
  const p = document.createElement('span');
  p.textContent = msg;
  v.append(p);
  if (tentar) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'botao-texto';
    b.textContent = 'Tentar de novo';
    b.addEventListener('click', carregar);
    v.append(b);
  }
}

// ---------- Tabela ----------

function renderizarTabela() {
  const raiz = $('tabela');
  const botao = $('ver-tabela');
  botao.setAttribute('aria-pressed', String(estado.tabela));
  botao.textContent = estado.tabela ? 'Ocultar tabela' : 'Ver tabela';
  raiz.hidden = !estado.tabela;
  raiz.replaceChildren();
  if (!estado.tabela) return;

  const est = EST[estado.estatistica];
  const tabela = document.createElement('table');
  const cab = tabela.createTHead().insertRow();
  for (const t of ['Data', 'Competição', 'Jogo', est.nome]) {
    const th = document.createElement('th');
    th.textContent = t;
    cab.append(th);
  }
  const corpo = tabela.createTBody();
  for (const j of [...noGrafico].reverse()) {
    const tr = corpo.insertRow();
    const v = textoJogo(valorJogo(est, j, estado.lado), est);
    const celulas = [
      fmtData(j.data),
      [competicao(j), j.fase].filter(Boolean).join(' · '),
      placar(j),
      j.estado === 'in' ? `${v} (ao vivo)` : v,
    ];
    for (const c of celulas) tr.insertCell().textContent = c;
  }
  raiz.append(tabela);
}

// ---------- Topo ----------

function renderizarStatus() {
  const el = $('ao-vivo');
  el.replaceChildren();
  el.className = '';
  const v = estado.aoVivo;
  const p = estado.proximo;
  if (v) {
    el.className = 'pilula';
    const ponto = document.createElement('span');
    ponto.className = 'pulso';
    const t = document.createElement('span');
    t.textContent = `${placarCurto(v)} · ${v.detalhe}`;
    el.append(ponto, t);
  } else if (p && p.competitions?.[0]?.status?.type?.state === 'pre') {
    el.textContent = `Próximo: ${confronto(p)} · ${quando(p.date)}`;
  }
  $('atualizado').textContent = estado.atualizado ? `Atualizado às ${fmtHora(estado.atualizado)}` : '';
}

function iconeTema() {
  const escuro = temaAtual() === 'dark';
  // lua no claro, sol no escuro
  $('tema').innerHTML = escuro
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
}

function temaAtual() {
  return document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function alternarTema() {
  const t = temaAtual() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(TEMA, t); } catch (e) {}
  iconeTema();
  recriarGrafico();
}

// ---------- Geral ----------

function renderizarTudo() {
  sincronizarBotoes($('campeonatos'), campeonatos(), estado.campeonato, id => escolher('campeonato', id));
  sincronizarBotoes($('estatisticas'), itensEstatisticas('padrao'), estado.estatistica, id => escolher('estatistica', id));
  sincronizarBotoes($('minhas'), itensEstatisticas('minhas'), estado.estatistica, id => escolher('estatistica', id));
  renderizarCabecalho();
  renderizarKpis();
  atualizarGrafico();
  renderizarVazio();
  renderizarTabela();
  renderizarStatus();
}

async function carregar() {
  estado.erro = null;
  estado.progresso = { feitos: 0, total: 0 };
  renderizarTudo();
  try {
    estado.jogos = await carregarTemporada(TEMPORADA, (feitos, total) => {
      estado.progresso = { feitos, total };
      renderizarVazio();
    });
    estado.atualizado = Date.now();
    if (!campeonatos().some(c => c.id === estado.campeonato)) estado.campeonato = 'todos';
  } catch (e) {
    estado.erro = e.message || String(e);
  }
  estado.progresso = null;
  renderizarTudo();
  vigiar();
}

function incorporar(jogo) {
  gravarJogo(jogo);
  estado.jogos = [...estado.jogos.filter(j => j.id !== jogo.id), jogo].sort((a, b) => (a.data < b.data ? -1 : 1));
}

function agendar(ms) {
  clearTimeout(timerVivo);
  timerVivo = setTimeout(vigiar, ms);
}

// Jogos que a ESPN deu como adiados ou cancelados: deixam de ser "o próximo"
const descartados = new Set();

// Acompanha o próximo jogo. Até o horário marcado só consulta a agenda; depois lê o resumo
// do jogo a cada 30 s; quando ele termina, entra na temporada e o seguinte passa a ser o alvo.
async function vigiar() {
  if (vigiando || document.hidden) return;
  vigiando = true;
  clearTimeout(timerVivo);
  try {
    let alvo = estado.aoVivo;
    if (!alvo) {
      const conhecido = id => descartados.has(id) || estado.jogos.some(j => j.id === id);
      try {
        estado.proximo = await proximoEvento(conhecido);
      } catch (e) {
        agendar(60 * 1000);
        return;
      }
      const p = estado.proximo;
      const falta = p ? new Date(p.date).getTime() - Date.now() : Infinity;
      if (falta > 0) {
        // acorda no horário do jogo, conferindo a agenda pelo menos a cada 30 min
        agendar(Math.min(falta, 30 * 60 * 1000));
        renderizarStatus();
        return;
      }
      alvo = { id: p.id, liga: p.league.slug, fase: faseDe(p) };
    }
    try {
      const j = await resumoJogo(alvo.liga, alvo.id, alvo.fase);
      estado.aoVivo = j.estado === 'in' ? j : null;
      if (j.completo) incorporar(j);
      else if (j.estado === 'post') descartados.add(j.id);
      if (j.estado !== 'pre') estado.atualizado = Date.now();
      agendar(j.estado === 'in' ? VIVO_MS : 60 * 1000);
    } catch (e) {
      agendar(60 * 1000);
    }
    renderizarTudo();
  } finally {
    vigiando = false;
  }
}

function iniciar() {
  lerPrefs();
  $('ano').textContent = TEMPORADA;
  for (const grupo of document.querySelectorAll('.segmentado')) {
    for (const b of grupo.querySelectorAll('button')) {
      b.addEventListener('click', () => escolher(grupo.dataset.campo, b.dataset.valor));
    }
  }
  $('ver-tabela').addEventListener('click', () => escolher('tabela', !estado.tabela));
  $('tema').addEventListener('click', alternarTema);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { iconeTema(); recriarGrafico(); });
  document.addEventListener('visibilitychange', () => (document.hidden ? clearTimeout(timerVivo) : vigiar()));
  // a fonte da web chega depois; redesenha o canvas com ela
  document.fonts?.ready.then(recriarGrafico);
  iconeTema();
  renderizarTudo();
  carregar();
}

document.addEventListener('DOMContentLoaded', iniciar);
