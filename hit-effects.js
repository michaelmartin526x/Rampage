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
  const sound=fetch('assets/hit-fx/smash.mp3').then(r=>{if(!r.ok)throw new Error('Smash audio download failed');return r.arrayBuffer();});
  async function unlock(){
    audioContext??=new AudioContext();
    await audioContext.resume();
    buffer??=await audioContext.decodeAudioData((await sound).slice(0));
  }
  const unlockAudio=()=>{unlock().catch(console.warn);};
  document.addEventListener('pointerdown',unlockAudio,{capture:true});
  document.addEventListener('keydown',unlockAudio,{capture:true});
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
