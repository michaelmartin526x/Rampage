import * as THREE from './vendor/three.module.js';
import {RAPIER, STEP, createBody} from './physics.js';

// The caller initializes Rapier once; this world is independent of the bonus.
export async function createSmashBackground(renderer, template) {
  const scene = new THREE.Scene();
  const texture = await new THREE.TextureLoader().loadAsync('./assets/base/Game_Background.png');
  texture.colorSpace = THREE.SRGBColorSpace;
  scene.background = texture;
  const camera = new THREE.PerspectiveCamera(53, 9 / 16, .1, 60);
  camera.position.z = 12;
  const world = new RAPIER.World({x:0, y:-1.8, z:0});
  world.timestep = STEP;
  const events = new RAPIER.EventQueue(true);
  // A scaled 3D cube, with its front face at z = -1.
  const wall = world.createCollider(RAPIER.ColliderDesc.cuboid(3.5, 6, .25)
    .setTranslation(0, 0, -1.25).setRestitution(.25));
  const boxGeometry = new THREE.BoxGeometry(7, 12, .5);
  const boxMaterial = new THREE.MeshBasicMaterial({color:0x63eaff, wireframe:true});
  const box = new THREE.Mesh(boxGeometry, boxMaterial);
  box.position.z = -1.25; box.visible = false; scene.add(box);
  scene.add(new THREE.HemisphereLight(0xdceeff, 0x13224d, 3));
  const light = new THREE.DirectionalLight(0xffead1, 4);
  light.position.set(-3, 5, 8); scene.add(light);
  const rim = new THREE.PointLight(0x70baff, 35, 20);
  rim.position.set(3, 1, 4); scene.add(rim);
  function geometry(source) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(source.positions.map(n => n * 5.76), 3));
    g.computeVertexNormals(); g.computeBoundingBox();
    return g;
  }
  const intact = geometry(template.intact);
  const fragments = template.fragments.map(source => {
    const g = geometry(source), center = g.boundingBox.getCenter(new THREE.Vector3());
    g.translate(-center.x, -center.y, -center.z);
    return {geometry:g, center};
  });
  const colors = [0x123875, 0x193c80, 0x204887, 0x152f69, 0x1b4080];
  const objects = [], byCollider = new Map();
  let elapsed = 0, nextLaunch = 0, accumulator = 0, launched = 0, impacts = 0, volleys = 0, pairImpacts = 0;
  const impactPositions = [];
  const projected = new THREE.Vector3();
  function screenY(position) { return projected.copy(position).project(camera).y; }
  function add(g, position, rotation, material, shard = false) {
    const {body, collider} = createBody(world, g.attributes.position.array, position, shard ? .035 : 1, rotation);
    collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const mesh = new THREE.Mesh(g, material); scene.add(mesh);
    const item = {body, collider, mesh, shard, born:elapsed};
    objects.push(item); byCollider.set(collider.handle, item);
    return item;
  }
  function remove(item) {
    byCollider.delete(item.collider.handle); world.removeRigidBody(item.body);
    scene.remove(item.mesh); item.mesh.material.dispose();
    objects.splice(objects.indexOf(item), 1);
  }
  function launch(side, band, paired) {
    const duration = paired ? 1.1 : 1.4;
    const targetX = paired ? 0 : side * (-.6 - Math.random() * 1.3);
    const targetY = band * (paired ? 3.5 : 4.1);
    const start = new THREE.Vector3(side * 5.2, targetY - .4, 3.5);
    const material = new THREE.MeshStandardMaterial({color:colors[launched % colors.length], roughness:.6, metalness:.08, transparent:true});
    const item = add(intact, start, new THREE.Quaternion().setFromEuler(new THREE.Euler(.3, .2, side * .7)), material);
    // Ballistic aim keeps the impact comfortably inside the outer 30% bands.
    item.body.setLinearDamping(0);
    item.body.setLinvel({x:(targetX-start.x)/duration, y:(.4 + .9*duration*duration)/duration, z:((paired ? .8 : -.5)-start.z)/duration}, true);
    item.body.setAngvel({x:1.2, y:side * 2, z:side * 1.4}, true);
    launched++;
  }
  function volley() {
    const band = volleys % 2 ? -1 : 1;
    const paired = volleys % 3 === 2;
    launch(volleys % 2 ? 1 : -1, band, paired);
    if (paired) launch(volleys % 2 ? -1 : 1, band, true);
    volleys++;
  }
  function fracture(item) {
    const position = new THREE.Vector3().copy(item.body.translation());
    impactPositions.push(screenY(position));
    if (impactPositions.length > 100) impactPositions.shift();
    const rotation = new THREE.Quaternion().copy(item.body.rotation());
    const velocity = new THREE.Vector3().copy(item.body.linvel());
    const spin = new THREE.Vector3().copy(item.body.angvel());
    const material = item.mesh.material;
    for (const part of fragments) {
      const offset = part.center.clone().applyQuaternion(rotation);
      const p = position.clone().add(offset);
      // Keep even the deepest fragment on the front side of the collider.
      const g = part.geometry;
      const radius = g.boundingSphere?.radius ?? (g.computeBoundingSphere(), g.boundingSphere.radius);
      p.z = Math.max(p.z, -1 + radius + .015);
      const shard = add(g, p, rotation, material.clone(), true);
      const v = velocity.clone().add(new THREE.Vector3().crossVectors(spin, offset));
      v.add(offset.clone().multiplyScalar(4)); v.z = Math.abs(v.z) * .4 + 1.1;
      shard.body.setLinvel(v, true);
      shard.body.setAngvel({x:spin.x + offset.y * 9, y:spin.y - offset.x * 9, z:spin.z + 1}, true);
    }
    remove(item); impacts++;
  }
  return {
    speed:.25,
    setColliderVisible(value) { box.visible = value; },
    get stats() { return {launched, impacts, pairImpacts, bodies:objects.length, impactPositions:[...impactPositions]}; },
    draw(aspect, dt = 0) {
      camera.aspect = aspect; camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      accumulator += Math.min(dt, .15) * this.speed;
      while (accumulator >= STEP) {
        elapsed += STEP;
        if (elapsed >= nextLaunch) { volley(); nextLaunch = elapsed + 1.7; }
        world.step(events);
        const hits = new Set();
        events.drainCollisionEvents((a, b, started) => {
          if (!started) return;
          const item = byCollider.get(a === wall.handle ? b : b === wall.handle ? a : -1);
          if (item && !item.shard && Math.abs(screenY(item.body.translation())) >= .4) hits.add(item);
          const first = byCollider.get(a), second = byCollider.get(b);
          if (first && second && !first.shard && !second.shard &&
              [first, second].every(v => Math.abs(screenY(v.body.translation())) >= .4)) {
            hits.add(first); hits.add(second); pairImpacts++;
          }
        });
        for (const item of hits) fracture(item);
        for (const item of [...objects]) {
          const age = elapsed - item.born;
          if (age > (item.shard ? 3.5 : 5) || item.body.translation().y < -10) remove(item);
          else {
            // Fade fragments as they approach the reel area instead of filling it with debris.
            const bandFade = THREE.MathUtils.clamp((Math.abs(screenY(item.body.translation()))-.4)/.12, 0, 1);
            item.mesh.material.opacity = item.shard ? Math.min(1, (3.5-age)/.8)*bandFade : 1;
          }
        }
        accumulator -= STEP;
      }
      for (const item of objects) {
        item.mesh.position.copy(item.body.translation()); item.mesh.quaternion.copy(item.body.rotation());
      }
      renderer.render(scene, camera);
    },
    dispose() {
      for (const item of [...objects]) remove(item);
      intact.dispose(); fragments.forEach(p => p.geometry.dispose());
      boxGeometry.dispose(); boxMaterial.dispose(); texture.dispose(); events.free(); world.free();
    }
  };
}
