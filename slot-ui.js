import {loadSymbolEffects} from './symbol-effects.js';
import {SlotEngine,matrixFromStops} from './slot-engine.js?refill=1';
import {MATH} from './math-data.js';
import {reelProgress,wrap} from './reel-motion.js';
export const engine=new SlotEngine();
export const credits=units=>(units/100).toFixed(2);
const panel=document.querySelector('#slot-panel'),grid=document.querySelector('#reel-grid');
const spin=document.querySelector('#spin');
const preview=document.querySelector('#preview-feature'),entry=document.querySelector('#feature-entry');
let symbolEffects;
const symbolsReady=loadSymbolEffects(document.querySelector('#reel-window'),[...Object.keys(MATH.pay),'S1','W1']).then(e=>{symbolEffects=e;draw(matrixFromStops([5,8,12,19]));});
let busy=false,ready=false,autoRunning=false,autoTimer,presentedWin=0;
const auto=document.querySelector('#autoplay'),settings=document.querySelector('#settings-dialog');
let bigWinPromise;
const getBigWin=()=>bigWinPromise??=import('./big-win.js?room=2').then(({createBigWin})=>createBigWin(document.querySelector('#game'))).catch(error=>{bigWinPromise=null;console.error('Big-win unavailable',error);return null;});
export async function celebrate(amount){
  if(!document.querySelector('#win-effects').checked||amount<engine.stake*2)return;
  busy=true;updateAccount();
  try{const effect=await getBigWin();if(effect)await effect.play(amount,engine.stake);}finally{busy=false;updateAccount();}
}
export async function enableControls(){await symbolsReady;ready=true;updateAccount();}
function stopAuto(){clearTimeout(autoTimer);autoRunning=false;updateAccount();}
function scheduleAuto(){
  clearTimeout(autoTimer);
  if(!autoRunning)return;
  if(engine.state!=='BASE'||engine.credit<engine.stake||document.hidden){stopAuto();return;}
  autoTimer=setTimeout(()=>play(false,true),650);
}
const columns=Array.from({length:4},()=>{
  const column=document.createElement('div');column.className='reel-column';
  const track=document.createElement('div');track.className='reel-track';column.append(track);grid.append(column);return track;
});
const labels={L1:'Low 1',L2:'Low 2',L3:'Low 3',M1:'Medium 1',M2:'Medium 2',L4:'Low 4',H1:'High',S1:'Scatter',W1:'Wild'};
function paint(column,symbols,settled=false){
  column.replaceChildren(...symbols.map(symbol=>{
    const cell=document.createElement('div');cell.className='reel-symbol';cell.dataset.symbol=symbol;
    const img=document.createElement('img');
    img.alt=labels[symbol];
    if(settled && symbol==='W1' && symbolEffects){
      const viewport=document.createElement('span');
      Object.assign(viewport.style,{display:'block',width:'100%',height:'100%',overflow:'hidden'});
      img.src='./assets/symbol-spine/Wild-idle-frames.webp';
      Object.assign(img.style,{display:'block',width:'900%',maxWidth:'none',height:'100%'});
      viewport.append(img);
      cell.append(viewport);
      img.animate([{transform:'translateX(0)'},{transform:'translateX(-100%)'}],
        {duration:750,iterations:Infinity,easing:'steps(9,end)'});
    }else{
      if(symbolEffects)img.src=symbolEffects.images[symbol];
      cell.append(img);
    }
    return cell;
  }));
}
// The upper row previews the committed refill for each reel.
function paintStopped(track,column,c,record=engine.record){
  const strip=record?.reels[c]??MATH.reelSets.A[c],stop=record?.stops[c]??[5,8,12,19][c];
  paint(track,[record?.current?.above?.[c]??strip[wrap(stop-2,strip.length)],...column,strip[wrap(stop+3,strip.length)]],true);
  track.children[0].setAttribute('aria-hidden','true');track.children[5].setAttribute('aria-hidden','true');
  track.style.transform='translateY(-16.6666667%)';
}
function draw(matrix){columns.forEach((track,c)=>paintStopped(track,matrix[c],c));}
draw(matrixFromStops([5,8,12,19]));
export function updateAccount(){
  document.querySelector('#balance').textContent=credits(engine.credit);
  document.querySelector('#last-win').textContent=credits(engine.state==='SPINNING'?presentedWin:engine.lastWin);
  spin.disabled=!ready||busy||engine.state!=='BASE'||engine.credit<engine.stake;
  preview.disabled=!ready||busy||engine.state!=='BASE'||autoRunning;
  auto.disabled=!ready||(!autoRunning&&(busy||engine.state!=='BASE'||engine.credit<engine.stake));
  auto.setAttribute('aria-pressed',String(autoRunning));auto.setAttribute('aria-label',autoRunning?'Stop autoplay':'Autoplay');
  document.querySelector('#test-big-win').disabled=!ready||busy||engine.state!=='BASE'||autoRunning;
}
function animate(record){
  const start=performance.now(),durations=[1050,1250,1450,1650],steps=[24,28,32,36],last=[-1,-1,-1,-1];
  return new Promise(resolve=>{
    function frame(now){
      columns.forEach((track,c)=>{
        const t=Math.min(1,(now-start)/durations[c]),distance=steps[c]*reelProgress(t);
        const whole=Math.floor(distance),fraction=distance-whole;
        if(t===1){if(last[c]!==Infinity){paintStopped(track,record.matrix[c],c,record);last[c]=Infinity;}return;}
        const strip=record.reels[c],center=record.stops[c]+steps[c]-whole;
        if(last[c]!==whole){paint(track,Array.from({length:7},(_,r)=>center+r-3===record.stops[c]-2 ? (record.current.above?.[c] ?? strip[wrap(center+r-3,strip.length)]) : strip[wrap(center+r-3,strip.length)]));last[c]=whole;}
        track.style.transform=`translateY(${(fraction-2)*100/7}%)`;
      });
      if(now-start<durations[3])requestAnimationFrame(frame);else resolve();
    }requestAnimationFrame(frame);
  });
}
async function play(isPreview,automatic=false){
  if(!ready||busy)return;
  if(!automatic)stopAuto();
  const record=engine.spin(isPreview);if(!record)return;
  presentedWin=0;
  busy=true;
  updateAccount();
  await animate(record);
  while(record.current.result.wins.length){
    const current=record.current;
    for(const win of current.result.wins){
      grid.querySelectorAll('.line-win').forEach(cell=>cell.classList.remove('line-win'));
      for(const [c,r] of win.positions)columns[c].children[r+1].classList.add('line-win');
      presentedWin+=win.amount;

      document.querySelector('#last-win').textContent=credits(presentedWin);
      await symbolEffects.line(MATH.lines[win.line].map((r,c)=>columns[c].children[r+1]),win.direction==='right',win.positions.map(([c,r])=>columns[c].children[r+1]));
    }
    grid.querySelectorAll('.line-win').forEach(cell=>cell.classList.remove('line-win'));
    const next=engine.cascade();
    await breakSymbols(next.removed);
    draw(next.matrix);
    const upperMoves=columns.flatMap((_,c)=>{
      const count=next.removed.filter(([col])=>col===c).length;
      return count?[{c,from:-1-count,to:-1}]:[];
    });
    await Promise.all([...next.moves,...upperMoves].filter(move=>move.from!==move.to).map(({c,from,to})=>{
      const cell=columns[c].children[to+1];
      return cell.animate([{transform:`translateY(${(from-to)*100}%)`},{transform:'translateY(0)'}],{duration:260,easing:'cubic-bezier(.3,.05,.65,1)',fill:'none'}).finished;
    }));
  }
  engine.finishSpin();

  if(engine.state==='ENTRY'){
    stopAuto();
    document.querySelector('#entry-copy').textContent=`${engine.feature.awards.length} rooms unlocked. Smash every vase and collect your mystery prizes.${isPreview?' Preview only — balance unchanged.':''}`;
    entry.hidden=false;document.querySelector('#enter-feature').focus();
  }else await celebrate(record.totalUnits);
  busy=false;updateAccount();scheduleAuto();
}
// Authored Spine flash/smoke plays once for the union of winning cells.
async function breakSymbols(positions){
  await symbolEffects.break(positions.map(([c,r])=>columns[c].children[r+1]));
}
spin.addEventListener('click',()=>play(false));preview.addEventListener('click',()=>{settings.close();play(true);});
auto.addEventListener('click',()=>{
  if(autoRunning){stopAuto();return;}
  if(!ready||busy||engine.state!=='BASE')return;
  autoRunning=true;updateAccount();play(false,true);
});
document.querySelector('#settings').addEventListener('click',()=>{stopAuto();settings.showModal();});
document.querySelector('#test-big-win').addEventListener('click',()=>{if(ready&&!busy&&engine.state==='BASE')celebrate(engine.stake*50);});
window.addEventListener('keydown',e=>{
  if(e.code!=='Space'||e.repeat||settings.open)return;
  if(autoRunning){e.preventDefault();stopAuto();return;}
  if(e.target?.isContentEditable||e.target?.closest('input,textarea,select,summary,button:not(#spin)'))return;
  e.preventDefault();if(autoRunning){stopAuto();return;}if(!spin.disabled)play(false);
});
window.addEventListener('blur',stopAuto);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAuto();});
export function startRoom(){
  if(!engine.startRoom())return;
  entry.hidden=true;panel.hidden=true;document.querySelector('#game').classList.add('bonus-active');
  document.querySelector('#room-label').textContent=`ROOM ${engine.feature.room+1} / ${engine.feature.awards.length}`;
  document.dispatchEvent(new Event('rampage-room'));
}
document.querySelector('#enter-feature').addEventListener('click',startRoom);
export function returnToSlot(){
  if(!engine.returnToBase())return;
  document.querySelector('#game').classList.remove('bonus-active');panel.hidden=false;

  updateAccount();spin.focus();
}

document.querySelector('#test-winlines').addEventListener('click',async()=>{
  if(!ready||busy||engine.state!=='BASE')return;
  stopAuto();settings.close();busy=true;updateAccount();
  try{for(const line of [1,4,5])for(const reverse of [false,true])
    await symbolEffects.line(MATH.lines[line].map((r,c)=>columns[c].children[r+1]),reverse);
  }finally{busy=false;updateAccount();}
});
