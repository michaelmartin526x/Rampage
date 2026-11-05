import * as THREE from './vendor/three.module.js';

export function createTidepool(renderer) {
  const uniforms = { aspect:{value:1}, phase:{value:0} };
  const material = new THREE.ShaderMaterial({
    uniforms, depthTest:false, depthWrite:false,
    vertexShader: `
      varying vec2 point;
      void main() {
        point = position.xy;
        gl_Position = vec4(point, 0., 1.);
      }`,
    fragmentShader: `
      varying vec2 point;
      uniform float aspect, phase;
      const float vignetteStrength = 1.0;
      const vec3 ink = vec3(17.,28.,59.) / 255.;
      const vec3 ribbonA = vec3(14.,45.,78.) / 255.;
      const vec3 ribbonB = vec3(34.,67.,119.) / 255.;
      const vec3 glint = vec3(13.,20.,48.) / 255.;

      // Twist only near each eddy, so broad ribbons survive between the curls.
      vec2 eddy(vec2 p, vec2 center, float strength) {
        vec2 d = p - center;
        float angle = strength / (1. + 2.8 * dot(d,d));
        float c = cos(angle), s = sin(angle);
        return center + mat2(c,s,-s,c) * d;
      }

      void main() {
        vec2 p = point * vec2(max(aspect,1.), max(1./aspect,1.));
        p = eddy(p, vec2(-.52,.16 + .12*sin(phase)), 5.3 + .55*cos(phase));
        p = eddy(p, vec2(.76,-.29), -3.8 + .42*sin(phase));
        float field = 2.9*p.y + 1.35*p.x + .72*sin(2.5*p.x + phase);
        float band = sin(field*2. + phase);
        vec3 col = mix(ink, ribbonA, smoothstep(-.83,-.34,band));
        col = mix(col, ribbonB, smoothstep(.13,.26,band));
        col = mix(col, glint, .86*smoothstep(.83,.99,band));
        col += .045*cos(19.*field)*smoothstep(-.85,-.22,band);
        col *= 1. - .5*vignetteStrength*dot(point,point);
        gl_FragColor = vec4(col,1.);
      }`
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 3,-1,0, -1,3,0],3));
  const mesh = new THREE.Mesh(geometry,material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.Camera();
  return function drawTidepool(aspect,phase) {
    uniforms.aspect.value = aspect;
    uniforms.phase.value = phase;
    renderer.render(scene,camera);
  };
}
