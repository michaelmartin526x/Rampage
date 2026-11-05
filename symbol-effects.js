import * as THREE from 'three';
import * as spine from 'spine-threejs';

// One shared context, idle symbols cached as images; render only during breaks.
export async function loadSymbolEffects(root,symbols){
  const assets=new spine.AssetManager('assets/symbol-spine/');
  await assets.loadTextureAtlasAsync('Symbols.atlas');
  const reader=new spine.SkeletonJson(new spine.AtlasAttachmentLoader(assets.require('Symbols.atlas')));
  const data=Object.fromEntries(await Promise.all(symbols.map(async symbol=>{
    await assets.loadJsonAsync(`${symbol}.json`);
    return [symbol,reader.readSkeletonData(assets.require(`${symbol}.json`))];
  })));
  const lineAssets=new spine.AssetManager('assets/winline/');
  await lineAssets.loadTextureAtlasAsync('Winline.atlas');
  await lineAssets.loadJsonAsync('Winlines.json');
  const lineData=new spine.SkeletonJson(new spine.AtlasAttachmentLoader(lineAssets.require('Winline.atlas'))).readSkeletonData(lineAssets.require('Winlines.json'));
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(1);renderer.setClearColor(0,0);
  renderer.domElement.className='symbol-effects';
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-90,90,79,-79,.1,100);
  camera.position.z=20;
  const create=symbol=>new spine.SkeletonMesh({skeletonData:data[symbol],twoColorTint:false,
    materialFactory:p=>new THREE.MeshBasicMaterial({...p,depthTest:false,depthWrite:false,transparent:true,toneMapped:false})});
  const images={};
  renderer.setSize(360,316,false);
  for(const symbol of symbols){
    const mesh=create(symbol);scene.add(mesh);mesh.state.setAnimation(0,'idle',false);mesh.update(0);
    renderer.render(scene,camera);images[symbol]=renderer.domElement.toDataURL();
    scene.remove(mesh);mesh.dispose();
  }
  root.appendChild(renderer.domElement);renderer.domElement.hidden=true;
  return {images,async line(cells,reverse,winningCells=cells){
    const mesh=new spine.SkeletonMesh({skeletonData:lineData,twoColorTint:false,
      materialFactory:p=>new THREE.MeshBasicMaterial({...p,depthTest:false,depthWrite:false,transparent:true,toneMapped:false,side:THREE.DoubleSide})});
    scene.add(mesh);
    const highlights=winningCells.map(cell=>{
      const symbol=create(cell.dataset.symbol);symbol.renderOrder=10;scene.add(symbol);
      symbol.state.setAnimation(0,'win',false);cell.style.visibility='hidden';
      return {symbol,cell};
    });
    const entry=mesh.state.setAnimation(0,'Loop',true);
    // The final sequence key is at .5s; all 30 frames take one second.
    entry.animationEnd=1;
    const layout=()=>{
      const rect=root.getBoundingClientRect(),a=cells[0].getBoundingClientRect(),b=cells[3].getBoundingClientRect();
      renderer.setSize(rect.width,rect.height,false);
      camera.left=0;camera.right=rect.width;camera.top=rect.height;camera.bottom=0;camera.updateProjectionMatrix();
      const ax=a.x+a.width/2,bx=b.x+b.width/2,ay=a.y+a.height/2,by=b.y+b.height/2;
      mesh.position.set((ax+bx)/2-rect.x,rect.height-((ay+by)/2-rect.y),0);
      for(const {symbol,cell} of highlights){
        const box=cell.getBoundingClientRect();symbol.position.set(box.x-rect.x+box.width/2,rect.height-(box.y-rect.y+box.height/2),1);
        symbol.scale.set(box.width/180,box.height/158,1);
      }
      mesh.rotation.z=Math.atan2(ay-by,bx-ax);
      renderer.domElement.dataset.orientation=Math.abs(ay-by)<1?'horizontal':'diagonal';
      renderer.domElement.dataset.direction=reverse?'right':'left';
      mesh.scale.set((reverse?-1:1)*Math.hypot(bx-ax,by-ay)*4/3/720,a.height/158,1);
    };
    layout();const observer=new ResizeObserver(layout);observer.observe(root);
    renderer.domElement.classList.add('winline-effect');renderer.domElement.hidden=false;
    try{await new Promise(resolve=>{
      let elapsed=0,last=performance.now();
      const tick=now=>{const dt=Math.min(.05,(now-last)/1000);last=now;const previous=elapsed;elapsed+=dt;mesh.update(dt);
        // Play the highlight with the line, then hold just before the flash/break.
        for(const {symbol} of highlights)symbol.update(Math.max(0,Math.min(elapsed,.4)-Math.min(previous,.4)));
        renderer.render(scene,camera);
        if(elapsed>=1)resolve();else requestAnimationFrame(tick);
      };requestAnimationFrame(tick);
    });}finally{observer.disconnect();renderer.domElement.hidden=true;renderer.domElement.classList.remove('winline-effect');scene.remove(mesh);mesh.dispose();
      for(const {symbol,cell} of highlights){scene.remove(symbol);symbol.dispose();cell.style.visibility='';}
    }
  },async break(cells){
    const meshes=cells.map(cell=>{const mesh=create(cell.dataset.symbol);scene.add(mesh);const entry=mesh.state.setAnimation(0,'win',false);entry.trackTime=.4;mesh.update(0);cell.style.visibility='hidden';return {mesh,cell};});
    const layout=()=>{
      const rect=root.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);
      camera.left=0;camera.right=rect.width;camera.top=rect.height;camera.bottom=0;camera.updateProjectionMatrix();
      for(const {mesh,cell} of meshes){const box=cell.getBoundingClientRect();mesh.position.set(box.x-rect.x+box.width/2,rect.height-(box.y-rect.y+box.height/2),0);mesh.scale.set(box.width/180,box.height/158,1);}
    };
    layout();const observer=new ResizeObserver(layout);observer.observe(root);renderer.domElement.hidden=false;
    try{await new Promise(resolve=>{
      let elapsed=0,last=performance.now();
      const tick=now=>{const dt=Math.min(.05,(now-last)/1000);last=now;elapsed+=dt;
        for(const {mesh} of meshes)mesh.update(dt);renderer.render(scene,camera);
        if(elapsed>=.65)resolve();else requestAnimationFrame(tick);
      };requestAnimationFrame(tick);
    });}finally{observer.disconnect();renderer.domElement.hidden=true;for(const {mesh} of meshes){scene.remove(mesh);mesh.dispose();}}
  }};
}
