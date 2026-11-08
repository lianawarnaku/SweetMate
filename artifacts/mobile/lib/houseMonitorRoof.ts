export const HOUSE_MONITOR_ROOF_WIDTH = 112;
export const HOUSE_MONITOR_ROOF_HEIGHT = 52;
export const HOUSE_MONITOR_ROOF_RADIUS = 4;

const width = HOUSE_MONITOR_ROOF_WIDTH;
const height = HOUSE_MONITOR_ROOF_HEIGHT;
const radius = HOUSE_MONITOR_ROOF_RADIUS;
const halfWidth = width / 2;
const slopeLength = Math.hypot(halfWidth, height);
const normalX = height / slopeLength;
const normalY = halfWidth / slopeLength;
const topCenterY = radius / normalY;
const bottomCenterX = (radius * (1 + normalY)) / normalX;
const bottomCenterY = height - radius;
const topTangentY = topCenterY - radius * normalY;
const bottomTangentY = bottomCenterY - radius * normalY;
const topTangentX = halfWidth - radius * normalX;
const bottomTangentX = bottomCenterX - radius * normalX;

/** One symmetric outline shared by the roof tint, fill clip, and border. */
export const HOUSE_MONITOR_ROOF_PATH = [
  `M ${topTangentX} ${topTangentY}`,
  `A ${radius} ${radius} 0 0 1 ${width - topTangentX} ${topTangentY}`,
  `L ${width - bottomTangentX} ${bottomTangentY}`,
  `A ${radius} ${radius} 0 0 1 ${width - bottomCenterX} ${height}`,
  `L ${bottomCenterX} ${height}`,
  `A ${radius} ${radius} 0 0 1 ${bottomTangentX} ${bottomTangentY}`,
  "Z",
].join(" ");

// Integral of a circle's half-width, used once while preparing the lookup.
function circleIntegral(offset: number): number {
  const y = Math.max(-radius, Math.min(radius, offset));
  return (
    (y * Math.sqrt(Math.max(0, radius * radius - y * y)) +
      radius * radius * Math.asin(y / radius)) /
    2
  );
}

function topArea(y: number): number {
  return 2 * (circleIntegral(y - topCenterY) - circleIntegral(-radius));
}

const topArcArea = topArea(topTangentY);
function straightArea(y: number): number {
  return (width / (2 * height)) * (y * y - topTangentY * topTangentY);
}
const straightSidesArea = straightArea(bottomTangentY);
function bottomArea(y: number): number {
  return (
    (width - 2 * bottomCenterX) * (y - bottomTangentY) +
    2 *
      (circleIntegral(y - bottomCenterY) -
        circleIntegral(bottomTangentY - bottomCenterY))
  );
}
const totalArea = topArcArea + straightSidesArea + bottomArea(height);

function areaAbove(y: number): number {
  if (y <= topCenterY - radius) return 0;
  if (y < topTangentY) return topArea(y);
  if (y < bottomTangentY) return topArcArea + straightArea(y);
  return topArcArea + straightSidesArea + bottomArea(y);
}

// Exact area samples at uniform fill heights keep interpolation error small,
// including near rounded tips. Each animation frame needs only eight comparisons.
const LOOKUP_STEPS = 256;
const filledAreaLookup = Array.from({ length: LOOKUP_STEPS + 1 }, (_, index) =>
  Math.max(
    0,
    Math.min(1, 1 - areaAbove(height * (1 - index / LOOKUP_STEPS)) / totalArea),
  ),
);

/** Bottom-up height whose visible rounded-roof area matches chore progress. */
export function houseMonitorRoofFillHeightFraction(areaFraction: number): number {
  "worklet";
  const area = Number.isFinite(areaFraction)
    ? Math.min(1, Math.max(0, areaFraction))
    : 0;
  if (area === 0 || area === 1) return area;
  let low = 0;
  let high = LOOKUP_STEPS;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (filledAreaLookup[middle] < area) low = middle;
    else high = middle;
  }
  const fraction =
    (area - filledAreaLookup[low]) /
    (filledAreaLookup[high] - filledAreaLookup[low]);
  return (low + fraction) / LOOKUP_STEPS;
}
