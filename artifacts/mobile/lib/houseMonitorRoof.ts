export const HOUSE_MONITOR_BODY_SIZE = 112;

// Match the opening house: its body spans x64…192, and its rounded roof's
// shoulder cubic has its maximum X at this derivative root.
const openingShoulderT = (18.2 - Math.sqrt(218.92)) / 10.4;
const t = openingShoulderT;
const openingRoofRight =
  (1 - t) ** 3 * 222.2 +
  3 * (1 - t) ** 2 * t * 227.6 +
  3 * (1 - t) * t * t * 223.9 +
  t ** 3 * 216.3;
const openingScale = HOUSE_MONITOR_BODY_SIZE / 128;
export const HOUSE_MONITOR_ROOF_WIDTH = (2 * openingRoofRight - 256) * openingScale;
export const HOUSE_MONITOR_ROOF_HEIGHT = (134.8 - 35) * openingScale;
export const HOUSE_MONITOR_ROOF_RADIUS = 4;

// Keep the existing soft-corner geometry, then fit it to the opening envelope.
const width = HOUSE_MONITOR_BODY_SIZE;
const height = 52;
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

// Leave 1px around the visible geometry for the 2px, non-scaling border.
const rawTop = topCenterY - radius;
const horizontalScale =
  (HOUSE_MONITOR_ROOF_WIDTH - 2) / (width - 2 * (bottomCenterX - radius));
const verticalScale = (HOUSE_MONITOR_ROOF_HEIGHT - 2) / (height - rawTop);
const horizontalOffset = HOUSE_MONITOR_ROOF_WIDTH / 2 - halfWidth * horizontalScale;
const verticalOffset = 1 - rawTop * verticalScale;
export const HOUSE_MONITOR_ROOF_TRANSFORM =
  `matrix(${horizontalScale} 0 0 ${verticalScale} ${horizontalOffset} ${verticalOffset})`;
const fillHeightOffset = 1 / HOUSE_MONITOR_ROOF_HEIGHT;
const fillHeightScale = (height * verticalScale) / HOUSE_MONITOR_ROOF_HEIGHT;

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
// Scaling multiplies every slice and the total by the same factor; only the
// returned fill height needs converting into the larger roof canvas.
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
  return fillHeightOffset + (fillHeightScale * (low + fraction)) / LOOKUP_STEPS;
}
