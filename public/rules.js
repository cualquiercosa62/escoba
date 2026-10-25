/* Escoba de 15 rules. Shared by the server (Node) and the browser. */
(function(){
const SUITS={o:'Oros',c:'Copas',e:'Espadas',b:'Bastos'};
const RNAME={1:'As',10:'Sota',11:'Caballo',12:'Rey'};
const val=c=>{const r=+c.slice(1);return r<=7?r:r-2};
// Points for "los 70": best card of each suit. Sota, Caballo and Rey (negras) are worth 0.
const P70={1:5.5,2:2,3:3,4:4,5:5,6:6,7:7};
// The card that counts for each suit (null when the suit is missing).
function best70(cs){const r={};for(const su of 'ocbe'){const x=cs.filter(c=>c[0]===su).sort((a,b)=>(P70[+b.slice(1)]||0)-(P70[+a.slice(1)]||0));r[su]=x[0]||null}return r}
function setenta(cs){let t=0;for(const su of 'ocbe'){const x=cs.filter(c=>c[0]===su);if(!x.length)return null;t+=Math.max(...x.map(c=>P70[+c.slice(1)]||0))}return t}
const label=c=>{const r=+c.slice(1);return (RNAME[r]||r)+' de '+SUITS[c[0]]};
function fullDeck(){const d=[];for(const s of 'ocbe')for(const r of [1,2,3,4,5,6,7,10,11,12])d.push(s+r);for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]]}return d}
const nm=(s,p)=>s.players[p]?.name||'Someone';
function addLog(s,t){s.log=[t,...(s.log||[])].slice(0,40)}
function dealHands(s){const n=s.order.length,per=Math.min(3,Math.floor(s.deck.length/n));for(const p of s.order)s.hands[p]=s.deck.splice(0,per);if(per<3&&s.deck.length){s.table.push(...s.deck.splice(0));}}
function newRound(s){
  const n=s.order.length;
  s.deck=fullDeck();s.table=s.deck.splice(0,4);s.hands={};s.captures={};s.escobas={};
  s.order.forEach(p=>{s.captures[p]=[];s.escobas[p]=0});
  dealHands(s);
  s.lastCapturer=null;s.lastDrop=null;s.lastCapture=null;s.mistakes=[];s.revealed=null;s.last=null;s.turnIdx=(s.dealerIdx+1)%n;s.round=(s.round||0)+1;s.status='playing';s.roundResult=null;
  const dealer=s.order[s.dealerIdx],first=s.order[s.turnIdx];
  addLog(s,`Round ${s.round}: ${nm(s,dealer)} deals.`);
  const sum=s.table.reduce((a,c)=>a+val(c),0);
  if(sum===15||sum===30){
    // The first player to play gets the opening table for free.
    const k=sum/15,took=[...s.table];s.captures[first].push(...took);s.escobas[first]+=k;s.table=[];s.lastCapturer=first;
    addLog(s,`The four table cards add to ${sum}: ${nm(s,first)} gets them for ${k} escoba${k>1?'s':''}.`);
    s.flash={pid:first,at:Date.now()};
    s.last={kind:'opening',pid:first,card:null,take:took,escoba:true,count:k};
  }
}
function scoreRound(s){
  const rows=s.order.map(p=>{const cs=s.captures[p]||[];return{pid:p,cards:cs.length,oros:cs.filter(c=>c[0]==='o').length,setenta:setenta(cs),best70:best70(cs),velo:cs.includes('o7'),escobas:s.escobas[p]||0,pts:0}});
  const award=k=>{const m=Math.max(...rows.map(r=>r[k]));const top=rows.filter(r=>r[k]===m);if(m>0&&top.length===1){top[0].pts++;top[0]['w_'+k]=true}};
  award('cards');award('oros');
  {const ok=rows.filter(r=>r.setenta!==null);if(ok.length){const m=Math.max(...ok.map(r=>r.setenta));const top=ok.filter(r=>r.setenta===m);if(top.length===1){top[0].pts++;top[0].w_setenta=true}}}
  rows.forEach(r=>{if(r.velo)r.pts++;r.pts+=r.escobas;if(r.oros===10)r.pts++});
  // Wrong captures nobody challenged cost points once the cards are counted.
  const pen=(s.opts&&s.opts.penalty)||0;
  rows.forEach(r=>{r.mistakes=(s.mistakes||[]).filter(m=>m.by===r.pid).length;r.penalty=r.mistakes*pen;r.pts-=r.penalty});
  return rows;
}
function endRound(s){
  s.lastDrop=null;s.lastCapture=null;
  if(s.table.length){
    const p=s.lastCapturer||s.order[s.dealerIdx];
    s.captures[p].push(...s.table);addLog(s,`${nm(s,p)} picks up the last ${s.table.length} card${s.table.length>1?'s':''} on the table.`);s.table=[];
  }
  const rows=scoreRound(s);rows.forEach(r=>s.scores[r.pid]=(s.scores[r.pid]||0)+r.pts);
  s.roundResult=rows;s.revealed=(s.mistakes||[]).map(m=>({by:m.by,card:m.card,take:m.take}));
  const tot=s.order.map(p=>s.scores[p]);const m=Math.max(...tot);
  if(m>=s.target&&tot.filter(x=>x===m).length===1){s.status='gameover';s.winner=s.order[tot.indexOf(m)];addLog(s,`${nm(s,s.winner)} wins the game with ${m} points!`)}
  else{s.status='roundover';addLog(s,`Round ${s.round} scored.`)}
}
function play(s,p,card,take){
  if(s.status!=='playing'||s.order[s.turnIdx]!==p)return 'Not your turn.';
  const hand=s.hands[p]||[];const hi=hand.indexOf(card);if(hi<0)return 'That card is not in your hand.';
  if(take.some(c=>!s.table.includes(c)))return 'The table changed. Pick again.';
  // Captures are not checked here: a wrong one stands unless another player challenges it.
  hand.splice(hi,1);let esc=false;s.lastDrop=null;s.lastCapture=null;
  if(take.length){
    s.lastCapture={by:p,card,take,ok:val(card)+take.reduce((a,c)=>a+val(c),0)===15,prev:s.lastCapturer};
    if(!s.lastCapture.ok){s.mistakes=s.mistakes||[];s.mistakes.push({by:p,card,take})}
    s.table=s.table.filter(c=>!take.includes(c));s.captures[p].push(card,...take);s.lastCapturer=p;
    let msg=`${nm(s,p)} played the ${label(card)} and took ${take.map(label).join(', ')}.`;
    if(!s.table.length){esc=true;s.escobas[p]++;msg+=' Escoba!';s.flash={pid:p,at:Date.now()}}
    s.lastCapture.escoba=esc;
    addLog(s,msg);
  }else{s.table.push(card);s.lastDrop={by:p,card};addLog(s,`${nm(s,p)} laid down the ${label(card)}.`)}
  s.last={kind:take.length?'capture':'drop',pid:p,card,take,escoba:esc};
  s.turnIdx=(s.turnIdx+1)%s.order.length;
  if(s.order.every(q=>!(s.hands[q]||[]).length)){
    if(s.deck.length){dealHands(s);addLog(s,`New hand dealt. ${s.deck.length} cards left in the deck.`)}
    else{s.status='lastcall';addLog(s,'All cards are played. Last chance to steal or challenge.')}
  }
  return null;
}
// Someone thinks the last capture did not add up to 15.
function challenge(s,p){
  if(s.status!=='playing'&&s.status!=='lastcall')return 'Not now.';
  if(!s.order.includes(p))return 'Only players can challenge.';
  const c=s.lastCapture;
  if(!c||c.by===p||c.ok)return 'NOCHALLENGE';
  const back=[c.card,...c.take],pile=s.captures[c.by];
  for(const x of back){const i=pile.lastIndexOf(x);if(i>=0)pile.splice(i,1)}
  s.table.push(...back);
  if(c.escoba)s.escobas[c.by]=Math.max(0,s.escobas[c.by]-1);
  s.lastCapturer=c.prev;s.lastCapture=null;
  if(s.mistakes)s.mistakes.pop(); // the caught mistake is always the latest one
  addLog(s,`${nm(s,p)} challenged ${nm(s,c.by)}: those cards did not add up to 15. They go back on the table.`);
  s.last={kind:'challenge',pid:p,from:c.by,card:null,take:back,escoba:false};
  return null;
}
function countCards(s,p){
  if(s.status!=='lastcall')return 'Not yet.';
  if(!s.order.includes(p))return 'Only players can do that.';
  endRound(s);return null;
}
// Another player spotted a 15 that the last player laid down by mistake.
function steal(s,p,take){
  if(s.status!=='playing'&&s.status!=='lastcall')return 'Not now.';
  if(!s.order.includes(p))return 'Only players can steal.';
  const d=s.lastDrop,NO='NOSTEAL';
  if(!d||d.by===p||!take.includes(d.card)||take.some(c=>!s.table.includes(c))||take.reduce((a,c)=>a+val(c),0)!==15)return NO;
  s.table=s.table.filter(c=>!take.includes(c));s.captures[p].push(...take);s.lastCapturer=p;s.lastDrop=null;
  let esc=false,msg=`${nm(s,p)} stole from ${nm(s,d.by)}: ${take.map(label).join(', ')}.`;
  if(!s.table.length){esc=true;s.escobas[p]++;msg+=' Escoba!';s.flash={pid:p,at:Date.now()}}
  addLog(s,msg);
  s.last={kind:'steal',pid:p,from:d.by,card:null,take,escoba:esc};
  return null;
}
function findCapture(hand,table){
  for(const h of hand){const need=15-val(h);const n=table.length;
    for(let m=1;m<(1<<n);m++){let t=0,pick=[];for(let i=0;i<n;i++)if(m&(1<<i)){t+=val(table[i]);pick.push(table[i])}if(t===need)return{hand:h,take:pick}}}
  return null;
}

const Escoba={SUITS,RNAME,val,label,fullDeck,nm,addLog,dealHands,newRound,scoreRound,endRound,play,steal,challenge,countCards,findCapture,setenta,best70,P70};
if(typeof module!=='undefined')module.exports=Escoba;else window.Escoba=Escoba;
})();
