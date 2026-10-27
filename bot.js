// Computer players for Escoba. They play, steal missed 15s, challenge wrong captures,
// and count the cards at the end of a round. They never make wrong captures themselves.
const E = require('./public/rules.js');
const { val } = E;

const LEVELS = {
  // miss: chance of not seeing a capture on its own turn
  // steal / challenge: chance of catching someone else's mistake
  easy: { miss: 0.3, steal: 0.25, challenge: 0.35, smart: false },
  hard: { miss: 0, steal: 0.8, challenge: 0.95, smart: true },
};

const isBot = (s, p) => !!(s.players[p] && s.players[p].bot);
const rand = (a, b) => a + Math.random() * (b - a);

// Every way to make 15 with one hand card and some table cards.
function allCaptures(hand, table) {
  const out = [], n = table.length;
  for (const h of hand) {
    const need = 15 - val(h);
    for (let m = 1; m < (1 << n); m++) {
      let t = 0; const pick = [];
      for (let i = 0; i < n; i++) if (m & (1 << i)) { t += val(table[i]); pick.push(table[i]); }
      if (t === need) out.push({ hand: h, take: pick });
    }
  }
  return out;
}
// Ways to make 15 from table cards that include one specific card (for steals).
function stealsFor(card, table) {
  const rest = table.filter(c => c !== card);
  return allCaptures([card], rest).map(c => [card, ...c.take]);
}

function cardWorth(c) {
  let w = 1;
  if (c === 'o7') w += 6;
  if (c.slice(1) === '7') w += 2;
  if (c.slice(1) === '6') w += 1;
  if (c.slice(1) === '1') w += 1;
  if (c[0] === 'o') w += 1;
  return w;
}

function chooseCapture(caps, table, smart) {
  if (!smart) return caps[Math.floor(Math.random() * caps.length)];
  let best = null, bestScore = -1;
  for (const c of caps) {
    const all = [c.hand, ...c.take];
    let sc = all.reduce((a, x) => a + cardWorth(x), 0);
    const left = table.length - c.take.length;
    if (left === 0) sc += 20; // escoba
    else {
      const rest = table.filter(x => !c.take.includes(x)).reduce((a, x) => a + val(x), 0);
      if (rest >= 5 && rest <= 14) sc -= 3; // leaves an easy escoba for the next player
    }
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  return best;
}

function chooseDrop(hand, table, smart) {
  if (!smart) return hand[Math.floor(Math.random() * hand.length)];
  const base = table.reduce((a, x) => a + val(x), 0);
  let best = null, bestScore = Infinity;
  for (const h of hand) {
    const total = base + val(h);
    let risk = cardWorth(h) * 2;
    if (total >= 5 && total <= 14) risk += 10; // next player could sweep the table
    if (risk < bestScore) { bestScore = risk; best = h; }
  }
  return best;
}

// Decide what one computer player wants to do right now, if anything.
function planFor(s, bot) {
  const lv = LEVELS[s.players[bot].level] || LEVELS.easy;
  const live = s.status === 'playing' || s.status === 'lastcall';
  if (!live) return null;
  const c = s.lastCapture;
  if (c && !c.ok && c.by !== bot) return { kind: 'challenge', chance: lv.challenge, delay: rand(1800, 3200) };
  const d = s.lastDrop;
  if (d && d.by !== bot) {
    const st = stealsFor(d.card, s.table);
    if (st.length) {
      const pick = st.sort((a, b) => b.length - a.length)[0];
      return { kind: 'steal', take: pick, chance: lv.steal, delay: rand(2200, 3800) };
    }
  }
  return null;
}

function turnMove(s, bot) {
  const lv = LEVELS[s.players[bot].level] || LEVELS.easy;
  const hand = s.hands[bot] || [];
  const caps = allCaptures(hand, s.table);
  if (caps.length && Math.random() >= lv.miss) {
    const c = chooseCapture(caps, s.table, lv.smart);
    return { card: c.hand, take: c.take };
  }
  return { card: chooseDrop(hand, s.table, lv.smart), take: [] };
}

// Called after every change to a table. Schedules at most one computer action.
function makeScheduler(commit) {
  const timers = new Map();   // code -> timeout
  const rolled = new Map();   // code -> key of the reaction already decided

  function schedule(code, s) {
    clearTimeout(timers.get(code));
    timers.delete(code);
    if (!s || !s.order) return;
    const bots = s.order.filter(p => isBot(s, p));
    if (!bots.length) return;

    // End of the round: count the cards if nobody else does.
    if (s.status === 'lastcall') {
      timers.set(code, setTimeout(() => commit(code, bots[0], g => E.countCards(g, bots[0])), 9000));
      return;
    }
    if (s.status !== 'playing') return;

    // Reactions to someone else's mistake, decided once per move.
    const key = `${s.rev}`;
    if (rolled.get(code) !== key) {
      rolled.set(code, key);
      for (const b of bots) {
        const p = planFor(s, b);
        if (p && Math.random() < p.chance) {
          timers.set(code, setTimeout(() => commit(code, b, g =>
            p.kind === 'challenge' ? E.challenge(g, b) : E.steal(g, b, p.take)), p.delay));
          return;
        }
      }
    }

    // The computer's own turn.
    const turn = s.order[s.turnIdx];
    if (isBot(s, turn)) {
      timers.set(code, setTimeout(() => commit(code, turn, g => {
        const m = turnMove(g, turn);
        return E.play(g, turn, m.card, m.take);
      }), rand(1500, 2600)));
    }
  }
  return { schedule, isBot };
}

module.exports = { makeScheduler, isBot, LEVELS };
