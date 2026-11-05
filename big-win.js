import * as THREE from 'three';
import * as spine from 'spine-threejs';
import { FBXLoader } from './vendor/loaders/FBXLoader.js';

// Temporary low threshold for visual testing; production baseline is 20x.
export const BIG_WIN_THRESHOLD=2;
export function createBigWin(root){
  let assetsPromise,active=false,sharedRenderer;
  const load=()=>assetsPromise??=Promise.all([
    new FBXLoader().loadAsync('assets/bigwin/Coin.fbx'),
    new THREE.TextureLoader().loadAsync('assets/bigwin/Reflection_Map.webp'),
    (async()=>{
      const manager=new spine.AssetManager('assets/bigwin/');
      await manager.loadTextureAtlasAsync('wins.atlas');await manager.loadJsonAsync('wins.json');
      return new spine.SkeletonJson(new spine.AtlasAttachmentLoader(manager.require('wins.atlas'))).readSkeletonData(manager.require('wins.json'));
    })()
  ]).catch(error=>{assetsPromise=null;throw error;});
  return {preload(){load().catch(error=>console.warn('Big-win preload:',error.message));},async play(amountCents,stakeCents,{force=false}={}){
    if(active||!force&&amountCents<stakeCents*BIG_WIN_THRESHOLD)return false;
    active=true;
    let overlay,renderer,frame,observer,numberTexture,numberMaterial,numberGeometry,banner,gold;
    try{
      const [model,environment,data]=await Promise.race([load(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Big-win asset timeout')),8000))]);
      overlay=document.createElement('button');overlay.className='big-win-overlay';overlay.type='button';overlay.setAttribute('aria-label','Big win. Click to finish counting.');root.appendChild(overlay);
      renderer=sharedRenderer??=new THREE.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(1);renderer.autoClear=false;renderer.toneMapping=THREE.ACESFilmicToneMapping;overlay.appendChild(renderer.domElement);
      const coins=new THREE.Scene(),front=new THREE.Scene();front.visible=false;front.scale.setScalar(2);coins.environment=environment;environment.mapping=THREE.EquirectangularReflectionMapping;environment.colorSpace=THREE.SRGBColorSpace;
      const camera=new THREE.PerspectiveCamera(38,1,.1,100);camera.position.z=22;
      const bannerCamera=new THREE.OrthographicCamera(-700,700,700,-700,.1,100);bannerCamera.position.z=20;
      coins.add(new THREE.HemisphereLight(0xfff5d9,0x5e3309,3));
      for(const [x,y,power] of [[-8,8,6],[8,2,4]]){const light=new THREE.PointLight(0xffffff,power,50,0);light.position.set(x,y,10);coins.add(light);}
      gold=new THREE.MeshStandardMaterial({color:0xffc83f,metalness:1,roughness:.2,envMap:environment,envMapIntensity:1.8});
      const template=model.clone(true);template.traverse(child=>{if(child.isMesh)child.material=gold;});
      const bounds=new THREE.Box3().setFromObject(template),centre=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
      template.position.sub(centre);const normalized=new THREE.Group();normalized.add(template);normalized.scale.setScalar(1.1/Math.max(size.x,size.y,size.z));
      const particles=Array.from({length:48},(_,i)=>{
        const group=new THREE.Group();group.add(normalized.clone(true));group.visible=false;coins.add(group);
        return {group,delay:i*.035,vx:(Math.random()-.5)*12,vy:12+Math.random()*7,z:-4+Math.random()*7,rx:Math.random()*6,ry:Math.random()*6,spin:3+Math.random()*5};
      });
      banner=new spine.SkeletonMesh({skeletonData:data,twoColorTint:false,materialFactory:parameters=>new THREE.MeshBasicMaterial({...parameters,depthTest:false,depthWrite:false,transparent:true,toneMapped:false})});banner.visible=false;front.add(banner);
      const introDuration=data.findAnimation('0_win_intro').duration;
      let outroQueued=false,outroStarted=false,outroComplete=false,completedHold=0;
      banner.state.data.setMix('0_win_intro','0_win_loop',.12);
      banner.state.data.setMix('0_win_loop','0_win_outro',.16);
      banner.state.addListener({
        start(entry){if(entry.animation.name==='0_win_outro')outroStarted=true;},
        complete(entry){if(entry.animation.name==='0_win_outro')outroComplete=true;}
      });
      // Never expose the full-size setup pose, including during initial GPU preparation.
      banner.state.clearTracks();
      banner.skeleton.setBonesToSetupPose?.();banner.skeleton.setSlotsToSetupPose?.();
      const introEntry=banner.state.setAnimation(0,'0_win_intro',false);
      introEntry.trackTime=0;introEntry.animationLast=-1;introEntry.trackLast=-1;
      for(const slot of banner.skeleton.slots)if(slot.attachment?.sequence)slot.sequenceIndex=0;
      banner.update(0);banner.update(0);
      banner.state.addAnimation(0,'0_win_loop',true,0);
      const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const context=canvas.getContext('2d');
      numberTexture=new THREE.CanvasTexture(canvas);numberTexture.colorSpace=THREE.SRGBColorSpace;
      numberMaterial=new THREE.MeshBasicMaterial({map:numberTexture,toneMapped:false,transparent:true,depthTest:false,depthWrite:false});numberGeometry=new THREE.PlaneGeometry(880,220);
      const number=new THREE.Mesh(numberGeometry,numberMaterial);number.renderOrder=100;front.add(number);
      const meter=banner.skeleton.findBone('x_meter')?.pose,meterSlot=banner.skeleton.findSlot('x_meter');
      const resize=()=>{const w=overlay.clientWidth,h=overlay.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();bannerCamera.top=700*h/w;bannerCamera.bottom=-bannerCamera.top;bannerCamera.updateProjectionMatrix();};
      observer=new ResizeObserver(resize);observer.observe(overlay);resize();
      // Prime the canvas with the authored intro at exactly t=0 before starting its clock.
      if(meter){number.position.set(meter.worldX,meter.worldY,2);number.scale.set(Math.hypot(meter.a,meter.c),Math.hypot(meter.b,meter.d),1);}
      banner.visible=true;
      // Cross actual browser/render boundaries while hidden, not just synchronous update(0).
      // Keep the authored clock frozen until geometry and GPU state are ready.
      for(let warmup=0;warmup<2;warmup++){
        await new Promise(resolve=>{frame=requestAnimationFrame(resolve);});
        banner.update(0);
        renderer.clear();renderer.render(coins,camera);renderer.clearDepth();renderer.render(front,bannerCamera);
      }
      // Validate the applied (rendered) bones, not just the authored local pose.
      const introBones=['big_win_bone','x_meter'].map(name=>banner.skeleton.findBone(name));
      if(introBones.some(bone=>Math.abs(bone.appliedPose.scaleX)>.001||Math.abs(bone.appliedPose.scaleY)>.001))throw new Error('Intro opening pose was not applied');
      front.visible=true;
      let skip=false,lastAmount=-1,animationTime=0;overlay.addEventListener('click',()=>{skip=true;});
      const start=performance.now();let last=start;
      await new Promise((resolve,reject)=>{
        const tick=now=>{try{
          const dt=Math.min(.05,(now-last)/1000);last=now;animationTime+=dt;const t=animationTime;
          const progress=skip?1:Math.min(1,Math.max(0,t/3.3));
          const shown=Math.round(amountCents*(1-(1-progress)**2));
          if(shown!==lastAmount){lastAmount=shown;context.clearRect(0,0,1024,256);context.textAlign='center';context.textBaseline='middle';context.font='900 160px Arial';context.lineWidth=10;context.strokeStyle='#3b1700';context.fillStyle='#fff8c8';const text=(shown/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});context.strokeText(text,512,128,960);context.fillText(text,512,128,960);numberTexture.needsUpdate=true;overlay.setAttribute('aria-label',`Big win ${(shown/100).toFixed(2)}. Click to finish counting.`);}
          if(!outroQueued&&t>introDuration+.3&&(skip||t>introDuration+4)){
            outroQueued=true;
            // Finish the current authored loop cycle before mixing into the outro.
            banner.state.addAnimation(0,'0_win_outro',false,0);
          }
          overlay.dataset.phase=outroStarted?'outro':t<introDuration?'intro':'loop';
          banner.update(dt);
          if(meter){number.position.set(meter.worldX,meter.worldY,2);number.scale.set(Math.hypot(meter.a,meter.c),Math.hypot(meter.b,meter.d),1);number.rotation.z=Math.atan2(meter.c,meter.a);numberMaterial.opacity=(meterSlot?.pose?.color?.a??1)*(banner.skeleton.color?.a??1);}
          for(const p of particles){const age=t-p.delay;p.group.visible=age>=0&&age<3.5;p.group.position.set(p.vx*age,-11+p.vy*age-5*age*age,p.z);p.group.rotation.set(p.rx+age*p.spin,p.ry+age*p.spin*.8,age*.6);}
          renderer.clear();renderer.render(coins,camera);renderer.clearDepth();renderer.render(front,bannerCamera);
          if(outroComplete){completedHold+=dt;if(completedHold>=.12){resolve();return;}}frame=requestAnimationFrame(tick);
        }catch(error){reject(error);}};frame=requestAnimationFrame(tick);
      });
      return true;
    }catch(error){console.error('Big-win presentation skipped; award unchanged.',error);return false;}
    finally{cancelAnimationFrame(frame);observer?.disconnect();banner?.dispose?.();gold?.dispose();numberTexture?.dispose();numberMaterial?.dispose();numberGeometry?.dispose();renderer?.domElement.remove();renderer?.renderLists.dispose();overlay?.remove();active=false;}
  }};
}
