// Busca na API pública (não documentada) da ESPN, cache dos jogos encerrados e jogo ao vivo.
// Sem chave e com CORS aberto: a página chama a ESPN direto do navegador.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const TIME_ID = '2029'; // Palmeiras na ESPN
const TEMPORADA = new Date().getFullYear();
const CACHE_JOGO = 'palmeiras:jogo:v1:';
const PARALELO = 6;

// Ordem em que aparecem na lateral; ligas fora da lista usam o nome da ESPN
const COMPETICOES = {
  'bra.1': 'Brasileirão',
  'conmebol.libertadores': 'Libertadores',
  'bra.copa_do_brazil': 'Copa do Brasil',
  'bra.camp.paulista': 'Paulistão',
};

// No Brasileirão a ESPN põe o nome da temporada no lugar da fase; esses ficam sem fase
const FASES = {
  'League Phase': 'Fase de liga',
  'Group Stage': 'Fase de grupos',
  'Fifth Round': '5ª fase',
  'Round of 16': 'Oitavas de final',
  'Quarterfinals': 'Quartas de final',
  'Semifinals': 'Semifinal',
  'Finals': 'Final',
  'Final': 'Final',
};

async function buscar(url, tentativas = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ESPN respondeu ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tentativas - 1) throw e;
      await new Promise(ok => setTimeout(ok, 1000 * 2 ** i));
    }
  }
}

function numero(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function faseDe(evento) {
  return FASES[(evento?.seasonType?.name || '').trim()] || '';
}

// Resumo da ESPN -> jogo no formato da página
function extrairJogo(resumo, fase = '') {
  const h = resumo.header;
  const comp = h.competitions[0];
  const pal = comp.competitors.find(c => c.team.id === TIME_ID);
  const adv = comp.competitors.find(c => c.team.id !== TIME_ID);
  const stats = { pal: {}, adv: {} };
  for (const t of resumo.boxscore?.teams || []) {
    const lado = t.team.id === TIME_ID ? 'pal' : 'adv';
    for (const s of t.statistics || []) stats[lado][s.name] = numero(s.displayValue);
  }
  const tipo = comp.status?.type || {};
  return {
    id: h.id,
    data: comp.date,
    liga: h.league?.slug,
    ligaNome: h.league?.name,
    fase,
    mando: pal.homeAway,
    adversario: { nome: adv.team.displayName, sigla: adv.team.abbreviation },
    gols: { pal: numero(pal.score), adv: numero(adv.score) },
    penaltis: pal.shootoutScore != null ? { pal: numero(pal.shootoutScore), adv: numero(adv.shootoutScore) } : null,
    estado: tipo.state, // 'pre' | 'in' | 'post'
    completo: !!tipo.completed, // 'post' sem completo = adiado ou cancelado
    detalhe: tipo.shortDetail || '',
    stats,
  };
}

// ---------- Cache (jogo encerrado não muda; a página funciona sem ele) ----------

function lerJogo(id) {
  try {
    return JSON.parse(localStorage.getItem(CACHE_JOGO + id));
  } catch (e) {
    return null;
  }
}

function gravarJogo(jogo) {
  if (!jogo.completo) return;
  try {
    localStorage.setItem(CACHE_JOGO + jogo.id, JSON.stringify(jogo));
  } catch (e) {}
}

// ---------- Carga ----------

async function emParalelo(tarefas, n) {
  let proxima = 0;
  const trabalhador = async () => {
    while (proxima < tarefas.length) await tarefas[proxima++]();
  };
  await Promise.all(Array.from({ length: Math.min(n, tarefas.length) }, trabalhador));
}

function resumoJogo(liga, id, fase) {
  return buscar(`${ESPN}/${liga}/summary?event=${id}`).then(r => extrairJogo(r, fase));
}

// Todos os jogos encerrados da temporada, de todas as competições, em ordem cronológica
async function carregarTemporada(temporada, aoProgredir) {
  const agenda = await buscar(`${ESPN}/all/teams/${TIME_ID}/schedule?season=${temporada}`);
  const eventos = (agenda.events || [])
    .filter(e => e.competitions?.[0]?.status?.type?.completed)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const jogos = new Array(eventos.length);
  let feitos = 0;
  aoProgredir?.(0, eventos.length);
  await emParalelo(eventos.map((e, i) => async () => {
    let jogo = lerJogo(e.id);
    if (!jogo) {
      jogo = await resumoJogo(e.league.slug, e.id, faseDe(e));
      gravarJogo(jogo);
    }
    jogos[i] = jogo;
    aoProgredir?.(++feitos, eventos.length);
  }), PARALELO);
  return jogos;
}

// Próximo jogo pela agenda de jogos futuros. O endpoint do time (/teams/2029) também tem
// nextEvent, mas não manda o cabeçalho CORS, então o navegador não consegue lê-lo.
async function proximoEvento(ignorar) {
  const d = await buscar(`${ESPN}/all/teams/${TIME_ID}/schedule?fixture=true`);
  return (d.events || [])
    .filter(e => e.competitions?.[0]?.status?.type?.state !== 'post' && !ignorar(e.id))
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
}
