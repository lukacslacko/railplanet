// Camera-local quaternion orbit. The camera keeps its own up/right frame, so
// crossing a geographic pole never changes the meaning of a screen-space drag.
export function normalize(q) {
  const length = Math.hypot(...q);
  if (!Number.isFinite(length) || length < 1e-12) return [0, 0, 0, 1];
  return q.map(value => value / length);
}
export function multiply(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return normalize([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}
export function axisAngle(axis, angle) {
  const length = Math.hypot(...axis);
  if (length < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2) / length;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
export function rotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty,
    v[1] + w * ty + z * tx - x * tz,
    v[2] + w * tz + x * ty - y * tx];
}
export function frame(q) {
  q = normalize(q);
  return {right: rotate(q, [1, 0, 0]), up: rotate(q, [0, 1, 0]), outward: rotate(q, [0, 0, 1])};
}
export function turn(q, dx, dy, sensitivity = .006) {
  const angle = Math.hypot(dx, dy) * sensitivity;
  if (angle < 1e-12) return q.slice();
  return multiply(q, axisAngle([-dy, -dx, 0], angle));
}
export function distance(a, b) {
  const dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
  return 2 * Math.acos(Math.min(1, Math.abs(dot)));
}
export function interpolate(a, b, amount) {
  let dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
  if (dot < 0) { b = b.map(value => -value); dot = -dot; }
  if (dot > .9995) return normalize(a.map((value, i) => value + (b[i] - value) * amount));
  const angle = Math.acos(Math.min(1, dot)), sine = Math.sin(angle);
  const wa = Math.sin((1 - amount) * angle) / sine, wb = Math.sin(amount * angle) / sine;
  return normalize(a.map((value, i) => value * wa + b[i] * wb));
}
export function lookAtDirection(q, direction) {
  const length = Math.hypot(...direction);
  if (length < 1e-12) return q.slice();
  const b = direction.map(value => value / length), {outward: a, up} = frame(q);
  const dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
  const delta = dot < -.999999 ? axisAngle(up, Math.PI) : normalize([
    a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0], 1 + dot,
  ]);
  return multiply(delta, q);
}
export function home() {
  return multiply(axisAngle([0, 1, 0], .58), axisAngle([1, 0, 0], -.24));
}
