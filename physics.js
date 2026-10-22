import RAPIER from './vendor/rapier.mjs';
export {RAPIER};
export const STEP=1/120;
export async function initPhysics(){await RAPIER.init();}
export function makeWorld(set){
  const world=new RAPIER.World({x:0,y:-4.6,z:0});world.timestep=STEP;
  world.numSolverIterations=8;
  for(const mesh of set){
    const points=new Float32Array(mesh.positions);
    const indices=Uint32Array.from({length:points.length/3},(_,i)=>i);
    // Identical vertices and triangles to the rendered set; no proxy boxes.
    world.createCollider(RAPIER.ColliderDesc.trimesh(points,indices).setFriction(.5).setRestitution(.1));
  }
  return world;
}
export function hull(points){
  const desc=RAPIER.ColliderDesc.convexHull(new Float32Array(points));
  // Zero-volume triangles cannot form a solid hull. Give ONLY these pieces a
  // 0.4mm thickness along their geometric normal rather than an oversized box.
  if(desc)return desc;
  const a=points.slice(0,3);let normal=null;
  for(let i=3;i<points.length-3;i+=3){
    const u=points.slice(i,i+3).map((x,j)=>x-a[j]),v=points.slice(i+3,i+6).map((x,j)=>x-a[j]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const length=Math.hypot(...n);if(length>1e-10){normal=n.map(x=>x/length);break;}
  }
  if(!normal)throw new Error('Degenerate shard: no usable surface');
  const thick=[];
  for(let i=0;i<points.length;i+=3)for(const sign of [-1,1])for(let j=0;j<3;j++)thick.push(points[i+j]+normal[j]*.0002*sign);
  const result=RAPIER.ColliderDesc.convexHull(new Float32Array(thick));
  if(!result)throw new Error('Could not build shard hull');return result;
}
export function createBody(world,points,position,mass,rotation){
  const desc=RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x,position.y,position.z)
    .setCcdEnabled(true).setLinearDamping(.15).setAngularDamping(.25);
  if(rotation)desc.setRotation(rotation);
  const body=world.createRigidBody(desc);
  const collider=world.createCollider(hull(points).setMass(mass).setFriction(.5).setRestitution(.12),body);
  return {body,collider};
}
// A force-limited damped spring at the picked point. The vase stays dynamic;
// contacts remain enabled, and releasing adds no velocity or angular impulse.
export function pull(body,localPoint,target,dt=STEP){
  const q=body.rotation(),p=body.translation(),v=body.linvel(),w=body.angvel();
  const x=localPoint.x,y=localPoint.y,z=localPoint.z;
  const tx=2*(q.y*z-q.z*y),ty=2*(q.z*x-q.x*z),tz=2*(q.x*y-q.y*x);
  const r={x:x+q.w*tx+q.y*tz-q.z*ty,y:y+q.w*ty+q.z*tx-q.x*tz,z:z+q.w*tz+q.x*ty-q.y*tx};
  const point={x:p.x+r.x,y:p.y+r.y,z:p.z+r.z};
  const velocity={x:v.x+w.y*r.z-w.z*r.y,y:v.y+w.z*r.x-w.x*r.z,z:v.z+w.x*r.y-w.y*r.x};
  const force={x:100*(target.x-point.x)-9*velocity.x,y:100*(target.y-point.y)-9*velocity.y,z:100*(target.z-point.z)-9*velocity.z};
  const scale=Math.min(1,14/Math.hypot(force.x,force.y,force.z))*dt;
  body.applyImpulseAtPoint({x:force.x*scale,y:force.y*scale,z:force.z*scale},point,true);
}
