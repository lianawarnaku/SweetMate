import { strict as assert } from "node:assert";
import {
  HOUSE_MONITOR_ROOF_WIDTH as width,
  HOUSE_MONITOR_ROOF_HEIGHT as height,
  HOUSE_MONITOR_ROOF_RADIUS as radius,
  HOUSE_MONITOR_ROOF_PATH as path,
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
assert.ok(Math.abs(arcCenters[0].x - width / 2) < 1e-10);
assert.ok(Math.abs(arcCenters[1].x + arcCenters[2].x - width) < 1e-10);
assert.ok(Math.abs(arcCenters[1].y - arcCenters[2].y) < 1e-10);
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
assert.ok(totalArea > 0 && totalArea < (width * height) / 2);
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
