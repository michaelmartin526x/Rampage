// Reused from GoldCherry_CC presentation/motion.js.
export const wrap = (value, length) => ((value % length) + length) % length;

// Integrate smoothstep velocity: no speed or acceleration jumps at either join.
const rampIntegral=q=>q*q*q-.5*q*q*q*q;
const smoothstep=q=>q*q*(3-2*q);
const acceleration=.09,deceleration=.16,cruiseEnd=1-deceleration;
const travel=1-(acceleration+deceleration)/2;
export function reelProgress(t){
  t=Math.max(0,Math.min(1,t));
  if(t<acceleration)return acceleration*rampIntegral(t/acceleration)/travel;
  if(t<cruiseEnd)return (acceleration/2+t-acceleration)/travel;
  const q=(t-cruiseEnd)/deceleration;
  return (acceleration/2+cruiseEnd-acceleration+deceleration*(q-rampIntegral(q)))/travel;
}
export function reelVelocity(t){
  t=Math.max(0,Math.min(1,t));
  if(t<acceleration)return smoothstep(t/acceleration)/travel;
  if(t<cruiseEnd)return 1/travel;
  return (1-smoothstep((t-cruiseEnd)/deceleration))/travel;
}

