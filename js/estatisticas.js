// Estatísticas da lateral. Cada uma lê os números de um jogo (ver espn.js) para um lado: 'pal' ou 'adv'.
// tipo 'soma': contagem por jogo; os indicadores mostram média e total.
// tipo 'media': percentual que a ESPN já entrega por jogo (posse); agrega por média simples.
// tipo 'razao': num/den × escala (100 por padrão, para %); nos agregados soma-se num e den antes de dividir.
// Campos opcionais: secao ('minhas' vai para "Minhas métricas"), casas (decimais por jogo),
// semValor (texto quando o jogo não tem valor, como divisão por zero), descricao (linha sob o título).

const stat = nome => (j, lado) => j.stats[lado][nome] ?? null;
const gols = (j, lado) => j.gols[lado];

const ESTATISTICAS = [
  { id: 'gols', nome: 'Gols', grupo: 'Ataque', tipo: 'soma', valor: gols },
  { id: 'finalizacoes', nome: 'Finalizações', grupo: 'Ataque', tipo: 'soma', valor: stat('totalShots') },
  { id: 'nogol', nome: 'Finalizações no gol', grupo: 'Ataque', tipo: 'soma', valor: stat('shotsOnTarget') },
  { id: 'precisao', nome: 'Precisão das finalizações', grupo: 'Ataque', tipo: 'razao', unidade: '%', num: stat('shotsOnTarget'), den: stat('totalShots') },
  { id: 'escanteios', nome: 'Escanteios', grupo: 'Ataque', tipo: 'soma', valor: stat('wonCorners') },

  { id: 'posse', nome: 'Posse de bola', grupo: 'Passe', tipo: 'media', unidade: '%', valor: stat('possessionPct') },
  { id: 'passes', nome: 'Passes', grupo: 'Passe', tipo: 'soma', valor: stat('totalPasses') },
  { id: 'acerto', nome: 'Acerto de passes', grupo: 'Passe', tipo: 'razao', unidade: '%', num: stat('accuratePasses'), den: stat('totalPasses') },

  { id: 'desarmes', nome: 'Desarmes', grupo: 'Defesa', tipo: 'soma', valor: stat('effectiveTackles') },
  { id: 'interceptacoes', nome: 'Interceptações', grupo: 'Defesa', tipo: 'soma', valor: stat('interceptions') },
  { id: 'defesas', nome: 'Defesas do goleiro', grupo: 'Defesa', tipo: 'soma', valor: stat('saves') },
  { id: 'faltas', nome: 'Faltas cometidas', grupo: 'Defesa', tipo: 'soma', valor: stat('foulsCommitted') },
  { id: 'amarelos', nome: 'Cartões amarelos', grupo: 'Defesa', tipo: 'soma', valor: stat('yellowCards') },

  // ---------- Minhas métricas ----------
  // Para criar outra, copie um bloco abaixo e troque id, nome e as funções. Números por lado:
  //   gols, ou stat('<nome>') com um destes nomes da ESPN:
  //   totalShots, shotsOnTarget, blockedShots, wonCorners, offsides, possessionPct,
  //   totalPasses, accuratePasses, totalCrosses, accurateCrosses, totalLongBalls, accurateLongBalls,
  //   totalTackles, effectiveTackles, interceptions, totalClearance, effectiveClearance, saves,
  //   foulsCommitted, yellowCards, redCards, penaltyKickShots, penaltyKickGoals
  {
    id: 'fin_por_gol', nome: 'Finalizações por gol', secao: 'minhas',
    tipo: 'razao', escala: 1, casas: 1, num: stat('totalShots'), den: gols, semValor: 'sem gol',
    descricao: 'Quantas finalizações foram precisas para cada gol; quanto menor, mais eficiente. Jogo sem gol não tem barra. Gols contra a favor contam como gol.',
  },
];

const EST = Object.fromEntries(ESTATISTICAS.map(e => [e.id, e]));

function valorJogo(est, jogo, lado) {
  if (est.tipo !== 'razao') return est.valor(jogo, lado);
  const n = est.num(jogo, lado);
  const d = est.den(jogo, lado);
  return n != null && d ? (n / d) * (est.escala ?? 100) : null;
}

// Média por jogo (soma, media) ou razão agregada (razao). Na razão, jogo com denominador zero
// entra na soma: as finalizações de um jogo sem gol contam em "finalizações por gol".
function agregar(est, jogos, lado) {
  if (est.tipo === 'razao') {
    let n = 0, d = 0;
    for (const j of jogos) {
      const a = est.num(j, lado), b = est.den(j, lado);
      if (a != null && b != null) { n += a; d += b; }
    }
    return d ? (n / d) * (est.escala ?? 100) : null;
  }
  const vs = jogos.map(j => est.valor(j, lado)).filter(v => v != null);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
}

function somar(est, jogos, lado) {
  const vs = jogos.map(j => est.valor(j, lado)).filter(v => v != null);
  return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
}
