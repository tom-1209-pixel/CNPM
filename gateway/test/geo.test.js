import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, bearingDegrees, isInside, isAccurateEnough } from '../public/js/geo.js';

const origin = { lat: 10.7769, lng: 106.7009 };

test('distanceMeters: cùng điểm là 0', () => {
  assert.equal(distanceMeters(origin, origin), 0);
});

test('distanceMeters: 0.001 độ vĩ ≈ 111 m', () => {
  const d = distanceMeters(origin, { lat: origin.lat + 0.001, lng: origin.lng });
  assert.ok(Math.abs(d - 111.2) < 1, `d = ${d}`);
});

test('distanceMeters: đối xứng', () => {
  const b = { lat: 10.7775, lng: 106.702 };
  assert.ok(Math.abs(distanceMeters(origin, b) - distanceMeters(b, origin)) < 1e-9);
});

test('bearingDegrees: bắc, đông, nam, tây', () => {
  const at = (dLat, dLng) => bearingDegrees(origin, { lat: origin.lat + dLat, lng: origin.lng + dLng });
  assert.ok(Math.abs(at(0.001, 0) - 0) < 0.01);
  assert.ok(Math.abs(at(0, 0.001) - 90) < 0.1);
  assert.ok(Math.abs(at(-0.001, 0) - 180) < 0.01);
  assert.ok(Math.abs(at(0, -0.001) - 270) < 0.1);
});

test('bearingDegrees luôn nằm trong [0, 360)', () => {
  const b = bearingDegrees(origin, { lat: origin.lat + 0.001, lng: origin.lng - 0.0001 });
  assert.ok(b >= 0 && b < 360);
});

test('isInside: trong, đúng biên và ngoài bán kính', () => {
  const poi = { ...origin, radius: 30 };
  assert.equal(isInside({ lat: origin.lat + 0.0001, lng: origin.lng }, poi), true); // ≈ 11 m
  assert.equal(isInside({ lat: origin.lat + 0.001, lng: origin.lng }, poi), false); // ≈ 111 m
  assert.equal(isInside(origin, { ...origin, radius: 0 }), true);
});

test('isAccurateEnough: chỉ nhận sai số ≤ 50 m', () => {
  assert.equal(isAccurateEnough(5), true);
  assert.equal(isAccurateEnough(50), true);
  assert.equal(isAccurateEnough(50.1), false);
  assert.equal(isAccurateEnough(undefined), false);
  assert.equal(isAccurateEnough(NaN), false);
});
