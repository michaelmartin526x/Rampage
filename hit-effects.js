import * as THREE from 'three';
import * as spine from 'spine-threejs';

// Shares the room renderer: no additional WebGL context or physics bodies.
export async function loadHitEffects(scene,camera){
  const assets=new spine.AssetManager('assets/hit-fx/');
  await assets.loadTextureAtlasAsync('HitFX.atlas');
  await assets.loadJsonAsync('Hit_FX.json');
  const data=new spine.SkeletonJson(new spine.AtlasAttachmentLoader(assets.require('HitFX.atlas'))).readSkeletonData(assets.require('Hit_FX.json'));
  const active=[];
  let audioContext,buffer;
  try{
    const Context=window.AudioContext||window.webkitAudioContext;
    audioContext=new Context();
    const response=await fetch('assets/hit-fx/smash.mp3');
    if(!response.ok)throw new Error('Smash audio download failed');
    buffer=await audioContext.decodeAudioData(await response.arrayBuffer());
  }catch(error){console.warn('Smash audio unavailable',error);}
  function unlockAudio(){
    if(!audioContext||audioContext.state==='running')return;
    // Resume and start a silent buffer synchronously inside the tap gesture.
    audioContext.resume().catch(console.warn);
    const warmup=audioContext.createBufferSource();warmup.buffer=audioContext.createBuffer(1,1,22050);
    warmup.connect(audioContext.destination);warmup.onended=()=>warmup.disconnect();warmup.start();
  }
  for(const event of ['pointerdown','touchend','click','keydown'])document.addEventListener(event,unlockAudio,{capture:true,passive:true});
  function clear(){for(const hit of active){hit.root.removeFromParent();hit.mesh.dispose();}active.length=0;}
  return {clear,play(point,normal){
    const mesh=new spine.SkeletonMesh({skeletonData:data,twoColorTint:false,
      materialFactory:p=>new THREE.MeshBasicMaterial({...p,transparent:true,depthWrite:false,depthTest:false,toneMapped:false,side:THREE.DoubleSide})});
    const root=new THREE.Group();root.position.copy(point);root.quaternion.copy(camera.quaternion);
    // Artwork grows along local +Y from the bottom centre. Project the
    // surface normal into the camera plane so floor/side impacts face outward.
    const direction=normal.clone().applyQuaternion(camera.quaternion.clone().invert());
    root.rotateZ(Math.hypot(direction.x,direction.y)>.05?Math.atan2(direction.y,direction.x)-Math.PI/2:0);
    mesh.scale.setScalar(.63/256);mesh.position.y=.315;mesh.renderOrder=20;
    root.add(mesh);scene.add(root);mesh.state.setAnimation(0,'Hit_01',false);mesh.update(0);
    active.push({root,mesh,time:0});
    if(buffer&&audioContext?.state==='running'){
      const source=audioContext.createBufferSource(),gain=audioContext.createGain();
      source.buffer=buffer;gain.gain.value=.65;source.connect(gain);gain.connect(audioContext.destination);
      source.onended=()=>{source.disconnect();gain.disconnect();};source.start();
    }
  },update(dt){
    for(let i=active.length-1;i>=0;i--){const hit=active[i];hit.time+=dt;hit.mesh.update(dt);
      if(hit.time>=.32){hit.root.removeFromParent();hit.mesh.dispose();active.splice(i,1);}
    }
  }};
}
