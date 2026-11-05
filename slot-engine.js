import {MATH} from './math-data.js';
// Adapted from GoldCherry_CC: strip-window resolution, highest line awards,
// integer accounting and guarded engine/presentation transitions.
export function matrixFromStops(stops,reels=MATH.reelSets.A){
  return stops.map((stop,c)=>Array.from({length:4},(_,r)=>reels[c][(stop+r-1+reels[c].length)%reels[c].length]));
}
export function evaluate(matrix){
  const wins=[];
  MATH.lines.forEach((rows,line)=>{
    for(const reverse of [false,true]){
      const positions=rows.map((r,c)=>[c,r]);if(reverse)positions.reverse();
      let best=null;
      for(const [symbol,pay] of Object.entries(MATH.pay)){
        let count=0;while(count<4&&[symbol,'W1'].includes(matrix[positions[count][0]][positions[count][1]]))count++;
        if(count<3)continue;
        // The supplied reverse paytable contains only three-of-a-kind entries.
        count=reverse?3:count;
        const amount=pay[count];
        if(!best||count===4&&best.count!==4||count===best.count&&amount>best.amount)best={line,direction:reverse?'right':'left',symbol,count,amount,positions:positions.slice(0,count)};
      }
      if(best)wins.push(best);
      // A full-line match pays once, including matches completed by wilds.
      if(best?.count===4)break;
    }
  });
  return {wins,lineUnits:wins.reduce((sum,w)=>sum+w.amount,0),scatters:matrix.flat().filter(s=>s==='S1').length};
}
function drawRefill(strip,random){
  return strip[Math.floor(random()*strip.length)];
}
export function collapse(matrix,wins,random=Math.random,reels=MATH.reelSets.A,above=null){
  const removed=[...new Set(wins.flatMap(win=>win.positions.map(([c,r])=>`${c}:${r}`)))].map(key=>key.split(':').map(Number));
  const moves=[];
  const nextAbove=above?.slice();
  const next=matrix.map((column,c)=>{
    const rows=new Set(removed.filter(([col])=>col===c).map(([,r])=>r));
    const survivors=column.map((symbol,from)=>({symbol,from})).filter((_,r)=>!rows.has(r));
    const missing=4-survivors.length;
    // Independent draws retain each reel's original symbol frequencies.
    const incoming=Array.from({length:missing},(_,r)=>({
      symbol:above && r===missing-1 ? above[c] : drawRefill(reels[c],random),
      from:r-missing
    }));
    if(above && missing)nextAbove[c]=drawRefill(reels[c],random);
    return [...incoming,...survivors].map(({symbol,from},to)=>{moves.push({c,from,to});return symbol;});
  });
  return {matrix:next,removed,moves,above:nextAbove};
}
export const FEATURE_AWARDS=[[50,560],[100,340],[200,100]];
export const FEATURE_MEAN=FEATURE_AWARDS.reduce((sum,[value,weight])=>sum+value*weight,0)/1000;
// Room count is independent of total. This is configurable prototype math.
export function makeFeature(random=Math.random){
  let roll=random()*1000;
  const multiplier=FEATURE_AWARDS.find(([,weight])=>(roll-=weight)<0)[0];
  const total=multiplier*100;
  // Two larger rooms, with whole-pound budgets independent of prize presentation.
  const firstShare=random()<.5?.5:.4;
  const first=total*firstShare;
  const awards=random()<.5?[first,total-first]:[total-first,first];
  return {multiplier,total,awards,room:0,collected:0};
}
export class SlotEngine{
  constructor(random=Math.random){this.random=random;this.credit=100000;this.stake=100;this.state='BASE';this.lastWin=0;this.feature=null;this.preview=false;}
  spin(preview=false){
    if(this.state!=='BASE'||(!preview&&this.credit<this.stake))return null;
    let roll=this.random()*Object.values(MATH.weights).reduce((a,b)=>a+b,0);const mode=preview?'F':Object.entries(MATH.weights).find(([,weight])=>(roll-=weight)<0)[0];
    const reels=MATH.reelSets[mode],stops=reels.map(strip=>preview?0:Math.floor(this.random()*strip.length));
    const matrix=matrixFromStops(stops,reels),result=evaluate(matrix);
    this.preview=preview;this.lastWin=0;this.state='SPINNING';
    this.record={mode,reels,stops,matrix,result,current:{matrix,result,above:reels.map(strip=>drawRefill(strip,this.random))},totalUnits:result.lineUnits,winningGrids:result.wins.length?1:0,featureTriggered:result.scatters>=4};
    if(!preview)this.credit-=this.stake;
    return this.record;
  }
  finishSpin(){
    if(this.state!=='SPINNING'||this.record.current.result.wins.length)return false;
    this.lastWin=this.record.totalUnits;
    if(!this.preview)this.credit+=this.lastWin;
    if(this.record.featureTriggered){this.feature=makeFeature(this.random);this.state='ENTRY';}
    else this.state='BASE';
    return true;
  }
  cascade(){
    if(this.state!=='SPINNING'||!this.record.current.result.wins.length)return null;
    const previous=this.record.current;
    const next=collapse(previous.matrix,previous.result.wins,this.random,this.record.reels,previous.above);
    next.result=evaluate(next.matrix);this.record.current=next;
    this.record.totalUnits+=next.result.lineUnits;
    if(next.result.wins.length)this.record.winningGrids++;
    this.record.featureTriggered ||= next.result.scatters>=4;
    return next;
  }
  startRoom(){if(!['ENTRY','BETWEEN'].includes(this.state))return false;this.state='ROOM';return true;}
  finishRoom(){
    if(this.state!=='ROOM')return false;
    this.feature.collected+=this.feature.awards[this.feature.room];this.feature.room++;
    this.state=this.feature.room===this.feature.awards.length?'COMPLETE':'BETWEEN';
    if(this.state==='COMPLETE'){
      this.lastWin+=this.feature.total;
      if(!this.preview)this.credit+=this.feature.total;
    }
    return true;
  }
  returnToBase(){if(this.state!=='COMPLETE')return false;this.feature=null;this.state='BASE';return true;}
}
