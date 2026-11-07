import {loadHitEffects} from './hit-effects.js?scale=2';
import {createTidepool} from './tidepool.js';
import * as THREE from './vendor/three.module.js';
import {createPrizeRound} from './prizes.js';
import {presentPrizeReveal} from './prize-reveal.js';
import {engine,credits,startRoom,returnToSlot,enableControls,celebrate} from './slot-ui.js?three-picks=1';
import {RAPIER, STEP, initPhysics, makeWorld, createBody, pull} from './physics.js';
const canvas=document.querySelector('#game > canvas'), hint=document.querySelector('#hint');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,stencil:true});
const drawTidepool=createTidepool(renderer);
const game=canvas.parentElement;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let lastBackdropFrame=-Infinity, backdropPhase=0;
const roomContextRecovery=renderer.getContext().getExtension('WEBGL_lose_context');
canvas.addEventListener('webglcontextlost',event=>{
  event.preventDefault();
  setTimeout(()=>roomContextRecovery?.restoreContext(),250);
});
canvas.addEventListener('webglcontextrestored',()=>{lastBackdropFrame=-Infinity;});
renderer.setPixelRatio(1);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.25;
const scene=new THREE.Scene();scene.background=new THREE.Color('#17120d');
const camera=new THREE.PerspectiveCamera(50,720/1280,.01,100);
// Converted from the approved Blender camera: (x,y,z) -> (x,z,-y).
camera.position.set(-.00085,-.00056,2.077);camera.lookAt(-.00085,-.00056,-.459);
scene.add(new THREE.HemisphereLight(0xffedd0,0x2b202b,2.1));
const key=new THREE.DirectionalLight(0xffd9a0,3);key.position.set(-1,2,3);scene.add(key);
const fill=new THREE.PointLight(0xbde9ff,3,4);fill.position.set(.3,.1,.8);scene.add(fill);
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
let world,events,source,templates,vases=[],debris=[],drag=null,broken=0,accumulator=0,last=performance.now();
let pending=new Set(),byCollider=new Map(),debugVisible=false,debugLines=null;
const colors=[0x3a8b86,0xb95232,0xe6c697,0x8e9d62,0x547e99];
const ROOM_PICKS=3;
let prizeRound,revealTimer,hitEffects;
const prizeTray=document.querySelector('#prize-boxes'), results=document.querySelector('#results');
function updatePrizes(){
  prizeTray.replaceChildren(...prizeRound.collected.map(()=>{
    const box=document.createElement('span');box.className='mystery-box';box.textContent='?';box.setAttribute('aria-label','Collected mystery prize');return box;
  }));
  document.querySelector('#prize-count').textContent=`${prizeRound.collected.length} collected`;
}
async function revealPrizes(){
  if(!engine.finishRoom())return;
  const complete=engine.state==='COMPLETE',button=document.querySelector('#play-again');
  const tray=document.querySelector('#revealed-prizes'),values=document.querySelector('#prize-values'),total=document.querySelector('#prize-total');
  const previousTotal=engine.feature.collected-prizeRound.total;
  document.querySelector('#result-title').textContent='OPENING YOUR HAUL';
  tray.replaceChildren(...prizeRound.collected.map(()=>{const tile=document.createElement('span');tile.className='revealed-prize sealed';tile.textContent='?';return tile;}));
  values.textContent='Let’s see what you found…';total.textContent=`£${previousTotal/100}`;
  button.disabled=true;button.textContent='REVEALING…';results.hidden=false;
  await presentPrizeReveal(prizeRound.collected,previousTotal,step=>{
    tray.querySelectorAll('.revealing').forEach(tile=>tile.classList.remove('revealing'));
    if(step.prize){
      const tile=tray.children[step.index];tile.className=`revealed-prize ${step.prize.type} revealing`;
      tile.textContent=(step.prize.type==='cash'?'£':'×')+step.prize.value;
    }
    values.textContent=step.text;total.textContent=`£${step.total/100}`;
    if(step.final){
      document.querySelector('#result-title').textContent=complete?'RAMPAGE COMPLETE':'ROOM CLEARED';
      total.animate([{transform:'scale(.85)',opacity:.3},{transform:'scale(1.12)',opacity:1},{transform:'scale(1)',opacity:1}],{duration:500});
    }
  });
  // Only celebrate once the cash, additive multipliers and final equation have been shown.
  if(complete)await celebrate(engine.feature.total);
  button.textContent=complete?'BACK TO REELS':'NEXT ROOM';button.disabled=false;button.focus();
}

const materials=colors.map(color=>new THREE.MeshStandardMaterial({color,roughness:.32,metalness:.12}));
// One extra draw for the held object; no full-screen outline pass.
const selectionMaterial=new THREE.ShaderMaterial({
  uniforms:{resolution:{value:new THREE.Vector2(720,1280)},width:{value:4}},
  vertexShader:`uniform vec2 resolution; uniform float width;
    void main(){
      vec4 clip=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      vec4 outward=projectionMatrix*vec4(normalMatrix*normalize(position),0.0);
      vec2 direction=outward.xy*resolution;
      clip.xy+=direction/max(length(direction),0.0001)*width*2.0/resolution*clip.w;
      gl_Position=clip;
    }`,
  fragmentShader:'void main(){gl_FragColor=vec4(1.0,0.83,0.30,1.0);}',
  side:THREE.DoubleSide,depthWrite:false,toneMapped:false,
  stencilWrite:true,stencilRef:1,stencilFunc:THREE.NotEqualStencilFunc,
  stencilFail:THREE.KeepStencilOp,stencilZFail:THREE.KeepStencilOp,stencilZPass:THREE.KeepStencilOp,
});
let selectionOutline=null;
function showSelection(v){
  const marked=v.mesh.material.clone();marked.stencilWrite=true;marked.stencilRef=1;
  marked.stencilFunc=THREE.AlwaysStencilFunc;marked.stencilZPass=THREE.ReplaceStencilOp;
  v.mesh.material=marked;v.mesh.renderOrder=1;
  selectionOutline=new THREE.Mesh(v.mesh.geometry,selectionMaterial);selectionOutline.renderOrder=2;
  selectionOutline.raycast=()=>{};v.mesh.add(selectionOutline);
}
function clearSelection(){
  if(selectionOutline){const mesh=selectionOutline.parent;if(mesh){mesh.material.dispose();mesh.material=materials[mesh.userData.vase.index%materials.length];mesh.renderOrder=0;}selectionOutline.removeFromParent();}
  selectionOutline=null;
}
function geometry(data){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(data.uv,2));g.computeVertexNormals();g.computeBoundingBox();return g;}
function endGrab(){clearSelection();if(!drag)return;const id=drag.id;drag=null;if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}
function reset(){
  clearTimeout(revealTimer);hitEffects?.clear();results.hidden=true;prizeRound=createPrizeRound(ROOM_PICKS,Math.random,engine.feature?.awards[engine.feature.room]??10000);updatePrizes();
  endGrab();for(const v of vases)scene.remove(v.mesh);for(const d of debris)scene.remove(d.mesh);
  world?.free();events?.free();world=makeWorld(source.collisions);events=new RAPIER.EventQueue(true);
  vases=[];debris=[];pending.clear();byCollider.clear();broken=0;accumulator=0;
  templates.forEach((t,i)=>{
    const mesh=new THREE.Mesh(t.intact,materials[i%materials.length]);mesh.position.fromArray(source.vases[i].position);scene.add(mesh);
    const {body,collider}=createBody(world,t.intact.attributes.position.array,mesh.position,.5);
    collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);collider.setContactForceEventThreshold(8);
    const v={mesh,body,collider,index:i,broken:false,armed:false,previousVelocity:new THREE.Vector3(),previousAngular:new THREE.Vector3()};
    mesh.userData.vase=v;byCollider.set(collider.handle,v);vases.push(v);
  });
  document.querySelector('#smash').disabled=false;
  document.querySelector('#score').textContent=`0 / ${ROOM_PICKS}`;hint.textContent='Break three! Choose your vases, swing and release.';
}
function removeDebris(d){scene.remove(d.mesh);world.removeRigidBody(d.body);}
function shatter(v){
  if(v.broken||broken>=ROOM_PICKS)return;
  if(drag?.v===v)endGrab();
  v.broken=true;broken++;byCollider.delete(v.collider.handle);
  if(v.impact)hitEffects?.play(v.impact.point,v.impact.normal);
  const position=new THREE.Vector3().copy(v.body.translation()),rotation=new THREE.Quaternion().copy(v.body.rotation());
  // Carry forward the incident rigid-body motion, without a random explosion.
  const velocity=v.previousVelocity.clone(),angular=v.previousAngular.clone();
  scene.remove(v.mesh);world.removeRigidBody(v.body);
  for(const part of templates[v.index].parts){
    const offset=part.center.clone().applyQuaternion(rotation);
    const mesh=new THREE.Mesh(part.geometry,materials[v.index%materials.length]);mesh.position.copy(position).add(offset);mesh.quaternion.copy(rotation);scene.add(mesh);
    const {body}=createBody(world,part.geometry.attributes.position.array,mesh.position,.5/templates[v.index].parts.length,rotation);
    body.setLinvel(velocity.clone().add(new THREE.Vector3().crossVectors(angular,offset)),true);
    body.setAngvel(angular,true);debris.push({mesh,body});
  }
  // Remove old pieces, never freeze them in midair to save physics work.
  while(debris.length>source.vases.length*source.vaseTemplate.fragments.length)removeDebris(debris.shift());
  document.querySelector('#score').textContent=`${broken} / ${ROOM_PICKS}`;
  hint.textContent=`${ROOM_PICKS-broken} more to break!`;
  // Three concealed pick slots share the room's existing payout budget.
  if(prizeRound.collect(broken-1)){updatePrizes();hint.textContent=`Mystery prize found! ${ROOM_PICKS-broken} more to break.`;}
  if(broken===ROOM_PICKS){
    endGrab();hint.textContent='Three smashed! Opening your mystery prizes�';
    document.querySelector('#smash').disabled=true;
    revealTimer=setTimeout(revealPrizes,1100);
  }
}
function aim(e){const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);}
function targetFromPointer(e){aim(e);return raycaster.ray.intersectPlane(drag.plane,new THREE.Vector3());}
canvas.addEventListener('pointerdown',e=>{
  if(engine.state!=='ROOM'||broken>=ROOM_PICKS||!world||drag||e.button>0)return;aim(e);
  const hit=raycaster.intersectObjects(vases.filter(v=>!v.broken).map(v=>v.mesh),false)[0];if(!hit)return;
  const v=hit.object.userData.vase;v.armed=true;v.body.wakeUp();
  const localPoint=hit.point.clone().sub(new THREE.Vector3().copy(v.body.translation())).applyQuaternion(new THREE.Quaternion().copy(v.body.rotation()).invert());
  drag={v,id:e.pointerId,localPoint,target:hit.point.clone(),desiredDepth:Math.max(hit.point.z,-.22),plane:new THREE.Plane(new THREE.Vector3(0,0,1),-hit.point.z)};
  showSelection(v);
  canvas.setPointerCapture(e.pointerId);hint.textContent='Swing it! Scroll or use IN / OUT to change depth.';
});
canvas.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;const p=targetFromPointer(e);if(p)drag.target.copy(p);
});
function release(e){if(drag&&e.pointerId===drag.id)endGrab();}
canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('lostpointercapture',release);
window.addEventListener('blur',endGrab);
document.addEventListener('visibilitychange',()=>{if(document.hidden){endGrab();accumulator=0;}});
function depth(delta){if(!drag)return;drag.desiredDepth=THREE.MathUtils.clamp(drag.desiredDepth+delta,-.85,.35);}
canvas.addEventListener('wheel',e=>{if(drag){e.preventDefault();depth(-e.deltaY*.0006);}},{passive:false});
document.querySelector('#in').addEventListener('pointerdown',e=>{e.preventDefault();depth(-.08);});
document.querySelector('#out').addEventListener('pointerdown',e=>{e.preventDefault();depth(.08);});
document.querySelector('#reset').addEventListener('click',()=>{if(engine.state==='ROOM')reset();});
document.addEventListener('rampage-room',()=>{
  const gl=renderer.getContext();
  if(gl.isContextLost())roomContextRecovery?.restoreContext();
  reset();
});
document.querySelector('#play-again').addEventListener('click',()=>{results.hidden=true;if(engine.state==='COMPLETE')returnToSlot();else startRoom();});
document.querySelector('#smash').addEventListener('click',()=>{
  if(engine.state!=='ROOM'||broken>=ROOM_PICKS)return;
  const v=vases.find(v=>!v.broken&&v!==drag?.v);if(!v)return;
  // Explicit test button: a measured sideways impulse, with no repositioning.
  v.armed=true;v.body.applyImpulse({x:v.body.translation().x>0?.9:-.9,y:.35,z:0},true);
});
document.querySelector('#colliders').addEventListener('click',e=>{debugVisible=!debugVisible;e.target.setAttribute('aria-pressed',String(debugVisible));});
function updateDebug(){
  if(debugLines){scene.remove(debugLines);debugLines.geometry.dispose();debugLines.material.dispose();debugLines=null;}
  if(!debugVisible||!world)return;
  const {vertices,colors}=world.debugRender();const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(vertices,3));g.setAttribute('color',new THREE.BufferAttribute(colors,4));
  debugLines=new THREE.LineSegments(g,new THREE.LineBasicMaterial({vertexColors:true,depthTest:false,transparent:true,opacity:.65}));scene.add(debugLines);
}
function physicsStep(){
  for(const v of vases)if(!v.broken){v.previousVelocity.copy(v.body.linvel());v.previousAngular.copy(v.body.angvel());}
  if(drag){
    // Ease the picked point into the open area. The dynamic body follows the
    // spring, retaining collisions throughout selection and release.
    const z=drag.target.z+THREE.MathUtils.clamp(drag.desiredDepth-drag.target.z,-.75*STEP,.75*STEP);
    drag.plane.constant=-z;
    raycaster.setFromCamera(pointer,camera);
    raycaster.ray.intersectPlane(drag.plane,drag.target);
    pull(drag.v.body,drag.localPoint,drag.target);
  }
  world.step(events);
  events.drainContactForceEvents(e=>{
    for(const handle of [e.collider1(),e.collider2()]){
      const v=byCollider.get(handle);
      if(v&&!v.broken&&v.armed&&v.previousVelocity.length()>1&&e.totalForceMagnitude()>18&&!pending.has(v)){
        const other=world.getCollider(handle===e.collider1()?e.collider2():e.collider1());
        let impact=null;
        world.contactPair(v.collider,other,manifold=>{
          if(impact||!manifold.numSolverContacts())return;
          const point=new THREE.Vector3().copy(manifold.solverContactPoint(0));
          const normal=new THREE.Vector3().copy(manifold.normal());
          if(normal.dot(new THREE.Vector3().copy(v.body.translation()).sub(point))<0)normal.negate();
          impact={point,normal};
        });
        // CCD can report an impact after its solver contact has disappeared.
        // Keep the break feedback by projecting onto the collider we struck.
        if(!impact){
          const center=new THREE.Vector3().copy(v.body.translation());
          const projected=other?.projectPoint(center,false);
          const point=projected?new THREE.Vector3().copy(projected.point):center.clone();
          const normal=center.clone().sub(point);
          if(normal.lengthSq()<1e-10)normal.copy(v.previousVelocity).negate();
          normal.normalize();impact={point,normal};
        }
        v.impact=impact;pending.add(v);
      }
    }
  });
  for(const v of pending)shatter(v);pending.clear();
}
let sampleTime=performance.now(),sampleFrames=0,physicsMs=0;
function animate(now){requestAnimationFrame(animate);const dt=Math.min((now-last)/1000,.05);last=now;
  if(world&&engine.state==='ROOM'){accumulator+=dt;while(accumulator>=STEP){const start=performance.now();physicsStep();physicsMs+=performance.now()-start;accumulator-=STEP;}
    for(const v of vases)if(!v.broken){v.mesh.position.copy(v.body.translation());v.mesh.quaternion.copy(v.body.rotation());}
    if(drag&&!drag.forward&&drag.v.body.translation().z>-.36){drag.forward=true;hint.textContent='Selected — swing and release!';}
    for(let i=debris.length-1;i>=0;i--){const d=debris[i];if(d.body.translation().y < -3){removeDebris(d);debris.splice(i,1);}else{d.mesh.position.copy(d.body.translation());d.mesh.quaternion.copy(d.body.rotation());}}
  }
  if(game.classList.contains('bonus-active')){
    if(canvas.height!==1280)renderer.setSize(720,1280,false);
    lastBackdropFrame=-Infinity;
    if(engine.state==='ROOM'){hitEffects?.update(dt);updateDebug();renderer.render(scene,camera);}
  }else if(!document.hidden && (lastBackdropFrame===-Infinity || (!reducedMotion.matches && now-lastBackdropFrame>=1000/24))){
    if(canvas.height!==640)renderer.setSize(360,640,false);
    if(Number.isFinite(lastBackdropFrame))backdropPhase=(backdropPhase+Math.min(now-lastBackdropFrame,150)*.00016)%(2*Math.PI);
    drawTidepool(360/640,backdropPhase);
    lastBackdropFrame=now;
  }
  sampleFrames++;if(now-sampleTime>=1000){
    const fps=sampleFrames*1000/(now-sampleTime);
    document.querySelector("#performance").textContent=`${Math.round(fps)} FPS · ${(physicsMs/sampleFrames).toFixed(1)} ms physics · ${debris.length} shards · ${renderer.info.render.calls} draws`;
    sampleTime=now;sampleFrames=0;physicsMs=0;
  }
}
requestAnimationFrame(animate);
try{
  await initPhysics();const response=await fetch('./assets/scene.json');if(!response.ok)throw new Error('Scene download failed');source=await response.json();
  source.vases=source.placements.map(position=>({...source.vaseTemplate,position}));
  const texture=await new THREE.TextureLoader().loadAsync('./assets/Scene01CompleteMap.webp');texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  for(const s of source.set){const material=s.name==='Scene01'?new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}):new THREE.MeshStandardMaterial({color:0x281c0d,roughness:.5});scene.add(new THREE.Mesh(geometry(s),material));}
  const unitResponse=await fetch('./assets/unit.json');
  if(!unitResponse.ok)throw new Error('Shelf unit download failed');
  const unit=await unitResponse.json(),unitGeometry=geometry(unit);
  for(const group of unit.groups)unitGeometry.addGroup(group.start,group.count,group.materialIndex);
  const unitMaterials=[0x55738b,0x344a62,0x65869b,0x2b4056,0x425f79,0x8196a5].map(color=>new THREE.MeshStandardMaterial({color,roughness:.55,metalness:.12}));
  scene.add(new THREE.Mesh(unitGeometry,unitMaterials));
  source.collisions.push(unit);
  const v=source.vaseTemplate;
  const sharedTemplate={intact:geometry(v.intact),parts:v.fragments.map(f=>{
    const g=geometry(f),center=g.boundingBox.getCenter(new THREE.Vector3());g.translate(-center.x,-center.y,-center.z);return {geometry:g,center};
  })};
  templates=source.placements.map(()=>sharedTemplate);
  const bounds=new THREE.Box3();
  for(const s of source.set){const g=geometry(s);bounds.union(g.boundingBox);g.dispose();}
  const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
  const distance=Math.max(size.y,size.x/camera.aspect)*1.005/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));
  camera.position.set(center.x,center.y,bounds.max.z+distance);camera.lookAt(center);
  hitEffects=await loadHitEffects(scene,camera);
  reset();await enableControls();document.querySelector('#loading').classList.add('hidden');for(const id of ['reset','in','out','smash','colliders'])document.querySelector('#'+id).disabled=false;
}catch(error){console.error(error);document.querySelector('#loading').textContent='Could not load the set. Reload to retry.';}
