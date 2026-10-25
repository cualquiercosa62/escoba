/* Escoba de 15 rules. Shared by the server (Node) and the browser. */
(function(){
const SUITS={o:'Oros',c:'Copas',e:'Espadas',b:'Bastos'};
const RNAME={1:'As',10:'Sota',11:'Caballo',12:'Rey'};
const val=c=>{const r=+c.slice(1);return r<=7?r:r-2};
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
  s.lastCapturer=null;s.turnIdx=(s.dealerIdx+1)%n;s.round=(s.round||0)+1;s.status='playing';s.roundResult=null;
  const dealer=s.order[s.dealerIdx];
  addLog(s,`Round ${s.round}: ${nm(s,dealer)} deals.`);
  const sum=s.table.reduce((a,c)=>a+val(c),0);
  if(sum===15||sum===30){
    const k=sum/15;s.captures[dealer].push(...s.table);s.escobas[dealer]+=k;s.table=[];s.lastCapturer=dealer;
    addLog(s,`The four table cards add to ${sum}: ${nm(s,dealer)} sweeps them for ${k} escoba${k>1?'s':''}.`);
    s.flash={pid:dealer,at:Date.now()};
  }
}
function scoreRound(s){
  const rows=s.order.map(p=>{const cs=s.captures[p]||[];return{pid:p,cards:cs.length,oros:cs.filter(c=>c[0]==='o').length,sevens:cs.filter(c=>c.slice(1)==='7').length,velo:cs.includes('o7'),escobas:s.escobas[p]||0,pts:0}});
  const award=k=>{const m=Math.max(...rows.map(r=>r[k]));const top=rows.filter(r=>r[k]===m);if(m>0&&top.length===1){top[0].pts++;top[0]['w_'+k]=true}};
  award('cards');award('oros');award('sevens');
  rows.forEach(r=>{if(r.velo)r.pts++;r.pts+=r.escobas;if(r.oros===10)r.pts++});
  return rows;
}
function endRound(s){
  if(s.table.length){
    const p=s.lastCapturer||s.order[s.dealerIdx];
    s.captures[p].push(...s.table);addLog(s,`${nm(s,p)} picks up the last ${s.table.length} card${s.table.length>1?'s':''} on the table.`);s.table=[];
  }
  const rows=scoreRound(s);rows.forEach(r=>s.scores[r.pid]=(s.scores[r.pid]||0)+r.pts);
  s.roundResult=rows;
  const tot=s.order.map(p=>s.scores[p]);const m=Math.max(...tot);
  if(m>=s.target&&tot.filter(x=>x===m).length===1){s.status='gameover';s.winner=s.order[tot.indexOf(m)];addLog(s,`${nm(s,s.winner)} wins the game with ${m} points!`)}
  else{s.status='roundover';addLog(s,`Round ${s.round} scored.`)}
}
function play(s,p,card,take){
  if(s.status!=='playing'||s.order[s.turnIdx]!==p)return 'Not your turn.';
  const hand=s.hands[p]||[];const hi=hand.indexOf(card);if(hi<0)return 'That card is not in your hand.';
  if(take.some(c=>!s.table.includes(c)))return 'The table changed. Pick again.';
  hand.splice(hi,1);let esc=false;
  if(take.length){
    const sum=val(card)+take.reduce((a,c)=>a+val(c),0);if(sum!==15)return 'Those cards do not add up to 15.';
    s.table=s.table.filter(c=>!take.includes(c));s.captures[p].push(card,...take);s.lastCapturer=p;
    let msg=`${nm(s,p)} played the ${label(card)} and took ${take.map(label).join(', ')}.`;
    if(!s.table.length){esc=true;s.escobas[p]++;msg+=' Escoba!';s.flash={pid:p,at:Date.now()}}
    addLog(s,msg);
  }else{s.table.push(card);addLog(s,`${nm(s,p)} laid down the ${label(card)}.`)}
  s.last={pid:p,card,take,escoba:esc};
  s.turnIdx=(s.turnIdx+1)%s.order.length;
  if(s.order.every(q=>!(s.hands[q]||[]).length)){
    if(s.deck.length){dealHands(s);addLog(s,`New hand dealt. ${s.deck.length} cards left in the deck.`)}
    else endRound(s);
  }
  return null;
}
function findCapture(hand,table){
  for(const h of hand){const need=15-val(h);const n=table.length;
    for(let m=1;m<(1<<n);m++){let t=0,pick=[];for(let i=0;i<n;i++)if(m&(1<<i)){t+=val(table[i]);pick.push(table[i])}if(t===need)return{hand:h,take:pick}}}
  return null;
}

const Escoba={SUITS,RNAME,val,label,fullDeck,nm,addLog,dealHands,newRound,scoreRound,endRound,play,findCapture};
if(typeof module!=='undefined')module.exports=Escoba;else window.Escoba=Escoba;
})();
