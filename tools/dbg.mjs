import * as THREE from 'three';
// verify quaternion derivative semantics
const q = new THREE.Quaternion();
const w = new THREE.Quaternion(0,0,-0.1,0); // angular.z = -0.1 (roll right?)
const dq = w.clone().premultiply(q);
console.log('premultiply dq:', dq.x.toFixed(4), dq.y.toFixed(4), dq.z.toFixed(4), dq.w.toFixed(4));
const q2 = q.clone(); q2.x += dq.x; q2.y += dq.y; q2.z += dq.z; q2.w += dq.w; q2.normalize();
const right = new THREE.Vector3(1,0,0).applyQuaternion(q2);
const up = new THREE.Vector3(0,1,0).applyQuaternion(q2);
console.log('right.y', right.y.toFixed(4), 'up.y', up.y.toFixed(4), '=> bodyRoll(atan2(-right.y,|up.y|))', Math.atan2(-right.y, Math.abs(up.y)).toFixed(4));
// pitch: angular.x = -0.1 should pitch nose up
const w2 = new THREE.Quaternion(-0.1,0,0,0);
const dq2 = w2.clone().premultiply(new THREE.Quaternion());
const q3 = new THREE.Quaternion(dq2.x, dq2.y, dq2.z, 1+dq2.w).normalize();
const fwd = new THREE.Vector3(0,0,1).applyQuaternion(q3);
console.log('pitch -0.1 -> fwd.y', fwd.y.toFixed(4), '(positive = nose up)');
// yaw: angular.y = +0.1 should yaw nose right
const w3 = new THREE.Quaternion(0,0.1,0,0);
const dq3 = w3.clone().premultiply(new THREE.Quaternion());
const q4 = new THREE.Quaternion(dq3.x, dq3.y, dq3.z, 1+dq3.w).normalize();
const fwd4 = new THREE.Vector3(0,0,1).applyQuaternion(q4);
console.log('yaw +0.1 -> fwd.x', fwd4.x.toFixed(4), '(positive = nose right/east)');
