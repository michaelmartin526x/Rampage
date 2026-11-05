import {prizeSummary,prizeEquation} from './prizes.js';
export function revealSteps(tokens,previousTotal=0){
  const ordered=[...tokens.filter(p=>p.type==='cash'),...tokens.filter(p=>p.type==='multiplier')];
  const steps=[];let cash=0,multiplier=0;
  for(const [index,prize] of ordered.entries()){
    if(prize.type==='cash')cash+=prize.value;else multiplier+=prize.value;
    steps.push({index,prize,text:prize.type==='cash'?`Cash collected: £${cash}`:`Multipliers: ${ordered.slice(0,index+1).filter(p=>p.type==='multiplier').map(p=>p.value).join(' + ')} = ×${multiplier}`,total:previousTotal,delay:prize.type==='cash'?700:950});
  }
  const summary=prizeSummary(tokens);
  steps.push({text:`This room: ${prizeEquation(tokens)}`,total:previousTotal+summary.total,final:true,delay:1800});
  return steps;
}
export async function presentPrizeReveal(tokens,previousTotal,show,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
  for(const step of revealSteps(tokens,previousTotal)){show(step);await pause(step.delay);}
}
