import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import {
  HOUSE_MONITOR_BODY_SIZE as bodySize,
  HOUSE_MONITOR_ROOF_WIDTH as width,
  HOUSE_MONITOR_ROOF_HEIGHT as height,
  HOUSE_MONITOR_ROOF_RADIUS as radius,
  HOUSE_MONITOR_ROOF_PATH as path,
  HOUSE_MONITOR_ROOF_TRANSFORM as transform,
  houseMonitorRoofFillHeightFraction,
} from "./houseMonitorRoof.ts";

type Point = { x: number; y: number };

// Independently tessellate the actual SVG path so the area check catches
// mismatches between the displayed outline and the animation's lookup table.
const tokens = path.match(/[MLAZ]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!;
const outline: Point[] = [];
const arcCenters: Point[] = [];
let cursor = 0;
const number = () => Number(tokens[cursor++]);
while (cursor < tokens.length) {
  const command = tokens[cursor++];
  if (command === "M" || command === "L") {
    outline.push({ x: number(), y: number() });
  } else if (command === "A") {
    assert.equal(number(), radius);
    assert.equal(number(), radius);
    assert.equal(number(), 0, "circular corners need no axis rotation");
    assert.equal(number(), 0, "corners must use the smaller arc");
    assert.equal(number(), 1, "all corners must follow the same sweep");
    const end = { x: number(), y: number() };
    const start = outline[outline.length - 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const chord = Math.hypot(dx, dy);
    const distance = Math.sqrt(radius * radius - (chord * chord) / 4);
    const center = {
      x: (start.x + end.x) / 2 - (dy / chord) * distance,
      y: (start.y + end.y) / 2 + (dx / chord) * distance,
    };
    arcCenters.push(center);
    const from = Math.atan2(start.y - center.y, start.x - center.x);
    let to = Math.atan2(end.y - center.y, end.x - center.x);
    while (to < from) to += 2 * Math.PI;
    assert.ok(to - from < Math.PI);
    for (let sample = 1; sample <= 1024; sample += 1) {
      const angle = from + ((to - from) * sample) / 1024;
      outline.push({
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      });
    }
  } else {
    assert.equal(command, "Z");
  }
}
assert.equal(arcCenters.length, 3, "all three roof corners must be rounded");
assert.equal(radius, 4);
assert.ok(Math.abs(arcCenters[0].x - bodySize / 2) < 1e-10);
assert.ok(Math.abs(arcCenters[1].x + arcCenters[2].x - bodySize) < 1e-10);
assert.ok(Math.abs(arcCenters[1].y - arcCenters[2].y) < 1e-10);

const matrix = transform.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
assert.equal(matrix.length, 6);
assert.ok(matrix[0] > 1, "rounding must not shrink the visible roof width");
assert.deepEqual([matrix[1], matrix[2]], [0, 0]);
assert.ok(matrix[3] > 1);
for (const point of outline) {
  point.x = matrix[0] * point.x + matrix[4];
  point.y = matrix[3] * point.y + matrix[5];
}
const left = Math.min(...outline.map((point) => point.x));
const right = Math.max(...outline.map((point) => point.x));
const top = Math.min(...outline.map((point) => point.y));
const bottom = Math.max(...outline.map((point) => point.y));
assert.ok(Math.abs(left - 1) < 1e-4, "left outline must reach its 1px stroke inset");
assert.ok(Math.abs(right - (width - 1)) < 1e-4);
assert.ok(Math.abs((left + right) / 2 - width / 2) < 1e-10);
assert.ok(
  Math.abs(right - left + 2 - width) < 1e-4,
  "the non-scaling 2px border must span the full roof canvas",
);
assert.ok(Math.abs(top - 1) < 1e-4);
assert.ok(Math.abs(bottom - (height - 1)) < 1e-4);
assert.ok(width > bodySize, "the roof must visibly overhang the body");

// Independent opening-reference check: sample its outer shoulder cubic rather
// than reusing the production derivative calculation.
const openingSource = readFileSync(
  new URL("../components/HouseLoader.tsx", import.meta.url),
  "utf8",
);
assert.ok(openingSource.includes("c5.4 5.3 1.7 14.5-5.9 14.5"));
assert.ok(openingSource.includes("M128 35"));
assert.ok(openingSource.includes("width: 58 * SCALE"));
assert.ok(openingSource.includes("left: 64 * SCALE"));
assert.ok(openingSource.includes("left: 134 * SCALE"));
let openingRight = 0;
for (let sample = 0; sample <= 10000; sample += 1) {
  const t = sample / 10000;
  const x =
    (1 - t) ** 3 * 222.2 +
    3 * (1 - t) ** 2 * t * 227.6 +
    3 * (1 - t) * t * t * 223.9 +
    t ** 3 * 216.3;
  openingRight = Math.max(openingRight, x);
}
const openingBodyWidth = 134 + 58 - 64;
assert.equal(bodySize, 112);
assert.ok(
  Math.abs(width / bodySize - (2 * openingRight - 256) / openingBodyWidth) < 1e-7,
);
assert.ok(Math.abs(height / bodySize - (134.8 - 35) / openingBodyWidth) < 1e-10);
for (const point of outline) {
  assert.ok(point.x >= 0 && point.x <= width);
  assert.ok(point.y >= 0 && point.y <= height + 1e-10);
}

function polygonArea(points: Point[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    twiceArea += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(twiceArea) / 2;
}

function areaBelow(cut: number): number {
  const clipped: Point[] = [];
  let previous = outline[outline.length - 1];
  for (const point of outline) {
    const previousInside = previous.y >= cut;
    const inside = point.y >= cut;
    if (inside !== previousInside) {
      const proportion = (cut - previous.y) / (point.y - previous.y);
      clipped.push({
        x: previous.x + proportion * (point.x - previous.x),
        y: cut,
      });
    }
    if (inside) clipped.push(point);
    previous = point;
  }
  return polygonArea(clipped);
}

const totalArea = polygonArea(outline);
assert.ok(totalArea > 0 && totalArea < width * height);
assert.equal(houseMonitorRoofFillHeightFraction(0), 0);
assert.equal(houseMonitorRoofFillHeightFraction(1), 1);
assert.equal(houseMonitorRoofFillHeightFraction(-1), 0);
assert.equal(houseMonitorRoofFillHeightFraction(2), 1);
for (const invalid of [NaN, Infinity, -Infinity])
  assert.equal(houseMonitorRoofFillHeightFraction(invalid), 0);

let previousHeight = 0;
for (let completed = 0; completed <= 1000; completed += 1) {
  const progress = completed / 1000;
  const fillHeight = houseMonitorRoofFillHeightFraction(progress);
  assert.ok(fillHeight >= previousHeight && fillHeight <= 1);
  const visibleArea = areaBelow(height * (1 - fillHeight)) / totalArea;
  assert.ok(
    Math.abs(visibleArea - progress) < 0.001,
    `rounded roof area must match progress within 0.1%: ${progress}, ${visibleArea}`,
  );
  previousHeight = fillHeight;
}
assert.ok(
  houseMonitorRoofFillHeightFraction(0.5) < 0.35,
  "half the roof area must not appear as half its height",
);
console.log("House Monitor rounded roof tests passed");
