// Whole-pound demo prizes; multiplier tokens add together within each room.
export function prizeSummary(tokens){
  const cash=tokens.filter(p=>p.type==='cash').reduce((sum,p)=>sum+p.value,0);
  const multipliers=tokens.filter(p=>p.type==='multiplier').map(p=>p.value);
  const multiplier=multipliers.length?multipliers.reduce((a,b)=>a+b,0):1;
  return {cash,multipliers,multiplier,total:cash*multiplier*100};
}
export function prizeEquation(tokens){
  const {multipliers,total}=prizeSummary(tokens);
  const cash=tokens.filter(p=>p.type==='cash').map(p=>'£'+p.value).join(' + ');
  return (multipliers.length?'('+cash+') × ('+multipliers.join(' + ')+')':cash)+' = £'+total/100;
}
export function createPrizeRound(count, random=Math.random, totalUnits=10000){
  if(!Number.isInteger(totalUnits)||totalUnits<=0||totalUnits%100||count<2)throw new Error('Room prizes require whole pounds and at least two objects');
  const pounds=totalUnits/100;
  const plans=[[],[2],[3],[5],[3,2],[2,2],[2,3,5],[50]].filter(plan=>{
    const factor=plan.length?plan.reduce((a,b)=>a+b,0):1;
    return plan.length<count&&pounds%factor===0&&pounds/factor>=Math.max(1,2-plan.length);
  });
  const plan=plans[Math.floor(random()*plans.length)];
  const factor=plan.length?plan.reduce((a,b)=>a+b,0):1;
  const cashTotal=pounds/factor;
  const minCash=Math.max(1,2-plan.length),maxCash=Math.min(count-plan.length,cashTotal);
  const cashCount=minCash+Math.floor(random()*(maxCash-minCash+1));
  const amounts=Array(cashCount).fill(1);
  for(let left=cashTotal-cashCount;left>0;left--)amounts[Math.floor(random()*cashCount)]++;
  const tokens=[...amounts.map(value=>({type:'cash',value})),...plan.map(value=>({type:'multiplier',value}))];
  const indices=Array.from({length:count},(_,i)=>i);
  for(let i=count-1;i>0;i--){const j=Math.floor(random()*(i+1));[indices[i],indices[j]]=[indices[j],indices[i]];}
  const hidden=new Map(tokens.map((token,i)=>[indices[i],token]));
  const collected=[];
  return {
    collected,
    collect(index){if(!hidden.has(index))return false;collected.push(hidden.get(index));hidden.delete(index);return true;},
    get total(){return prizeSummary(collected).total;},
  };
}
