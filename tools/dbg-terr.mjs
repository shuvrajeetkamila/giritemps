import { TerrainField } from '../src/world/Terrain.js';
const f = new TerrainField(1337);
for (const [x,z] of [[0,0],[0,3000],[0,2500],[0,-2000],[3000,0],[-3000,2000]]) {
  console.log(`(${x},${z}) h=${f.heightAt(x,z).toFixed(0)}`);
}
let min=1e9,max=-1e9;
for (let i=0;i<4000;i++){ const x=(Math.random()-0.5)*40000, z=(Math.random()-0.5)*40000; const h=f.heightAt(x,z); min=Math.min(min,h); max=Math.max(max,h); }
console.log('world range', min.toFixed(0), max.toFixed(0));
