import { strict as assert } from "node:assert";
import {
  getHouseMonitorProgress,
  houseMonitorGridSquares,
  roofFillHeightFraction,
} from "./houseMonitorProgress.ts";

function approximately(actual: number, expected: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

for (const [total, expected] of [
  [0, 4],
  [1, 4],
  [3, 4],
  [4, 4],
  [5, 4],
  [8, 4],
  [9, 9],
  [15, 9],
  [16, 16],
  [24, 16],
  [25, 25],
  [26, 25],
  [1000, 25],
]) {
  assert.equal(
    houseMonitorGridSquares(total),
    expected,
    `existing grid size must remain unchanged for ${total} chores`,
  );
}

const oneOfFive = getHouseMonitorProgress(5, 1);
assert.equal(oneOfFive.completionRatio, 0.2);
assert.equal(oneOfFive.completionPercentage, 20);
assert.equal(
  getHouseMonitorProgress(201, 200).completionPercentage,
  99,
  "rounding must never announce 100% with unfinished chores",
);
assert.equal(getHouseMonitorProgress(201, 201).completionPercentage, 100);
assert.equal(getHouseMonitorProgress(0, 0).completionPercentage, 0);
assert.equal(
  oneOfFive.filledSquares,
  1,
  "20% of five chores must fill exactly one square, not all four",
);
assert.equal(oneOfFive.incompleteSquares, 3);
assert.equal(
  oneOfFive.roofCompletionRatio,
  0,
  "the roof must wait until the body squares are filled",
);

const bodyFull = getHouseMonitorProgress(8, 4);
assert.equal(bodyFull.filledSquares, 4);
assert.equal(bodyFull.completedOverflowChores, 0);
assert.equal(bodyFull.roofCompletionRatio, 0);
const firstRoofTask = getHouseMonitorProgress(8, 5);
assert.equal(firstRoofTask.filledSquares, 4);
assert.equal(
  firstRoofTask.roofCompletionRatio,
  0.25,
  "one of four leftover chores must fill one quarter of roof area",
);
assert.equal(getHouseMonitorProgress(8, 6).roofCompletionRatio, 0.5);
assert.equal(getHouseMonitorProgress(8, 8).roofCompletionRatio, 1);

const cappedBody = getHouseMonitorProgress(30, 25);
assert.equal(cappedBody.gridSquares, 25);
assert.equal(cappedBody.filledSquares, 25);
assert.equal(cappedBody.overflowChores, 5);
assert.equal(cappedBody.roofCompletionRatio, 0);
assert.equal(getHouseMonitorProgress(30, 26).roofCompletionRatio, 0.2);
assert.equal(getHouseMonitorProgress(30, 30).roofCompletionRatio, 1);
const undone = getHouseMonitorProgress(30, 24);
assert.equal(
  undone.filledSquares,
  24,
  "undoing across the roof/body boundary must clear one body square",
);
assert.equal(
  undone.roofCompletionRatio,
  0,
  "undoing back below a full body must empty the roof",
);
assert.equal(
  getHouseMonitorProgress(30, 29).roofCompletionRatio,
  0.8,
  "undoing the final chore must reduce roof progress",
);

for (const total of [1, 2, 3, 4, 9, 16, 25]) {
  const beforeDone = getHouseMonitorProgress(total, total - 1);
  assert.equal(
    beforeDone.roofCompletionRatio,
    0,
    "when no overflow exists, roof must remain faint until every chore is complete",
  );
  const done = getHouseMonitorProgress(total, total);
  assert.equal(
    done.roofCompletionRatio,
    1,
    "user-selected completion behavior makes the roof solid at 100%",
  );
  assert.equal(done.filledSquares, total);
}
const padded = getHouseMonitorProgress(1, 1);
assert.equal(
  padded.unusedSquares,
  3,
  "unused grid capacity is separate from unfinished task boxes",
);
assert.equal(padded.incompleteSquares, 0);
assert.equal(
  getHouseMonitorProgress(0, 0).roofCompletionRatio,
  0,
  "an empty household must not imply completed work",
);

assert.deepEqual(
  getHouseMonitorProgress(5, 999),
  getHouseMonitorProgress(5, 5),
  "completed count cannot exceed total",
);
assert.deepEqual(getHouseMonitorProgress(5, -2), getHouseMonitorProgress(5, 0));
assert.deepEqual(
  getHouseMonitorProgress(5.9, 1.9),
  getHouseMonitorProgress(5, 1),
  "fractional counts represent only whole chores",
);
for (const invalid of [NaN, Infinity, -Infinity, -3]) {
  assert.deepEqual(
    getHouseMonitorProgress(invalid, 9),
    getHouseMonitorProgress(0, 0),
  );
  assert.deepEqual(
    getHouseMonitorProgress(5, invalid),
    getHouseMonitorProgress(5, 0),
  );
}
assert.equal(
  getHouseMonitorProgress(Number.MAX_VALUE, Number.MAX_VALUE).totalChores,
  Number.MAX_SAFE_INTEGER,
);
assert.equal(
  getHouseMonitorProgress(Number.MAX_VALUE, Number.MAX_VALUE).completionRatio,
  1,
);

for (let total = 0; total <= 150; total += 1) {
  let previousRoof = 0;
  for (let completed = 0; completed <= total; completed += 1) {
    const progress = getHouseMonitorProgress(total, completed);
    assert.equal(
      progress.filledSquares + progress.completedOverflowChores,
      completed,
      "every completion must be represented exactly once",
    );
    assert.equal(
      progress.filledSquares,
      Math.min(completed, progress.gridSquares),
      "body progress must advance one square per chore",
    );
    assert.equal(
      progress.filledSquares +
        progress.incompleteSquares +
        progress.unusedSquares,
      progress.gridSquares,
    );
    assert.equal(
      progress.overflowChores + Math.min(total, progress.gridSquares),
      total,
    );
    assert.ok(
      progress.gridSquares <= 25,
      "chores must never expand the body beyond the existing cap",
    );
    assert.ok(
      progress.roofCompletionRatio >= previousRoof &&
        progress.roofCompletionRatio <= 1,
    );
    if (completed < progress.gridSquares && completed !== total)
      assert.equal(progress.roofCompletionRatio, 0);
    previousRoof = progress.roofCompletionRatio;
  }
}

for (const area of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
  const height = roofFillHeightFraction(area);
  approximately(
    2 * height - height * height,
    area,
    "roof geometry must show proportional filled area",
  );
}
assert.ok(
  roofFillHeightFraction(0.5) < 0.3,
  "half of roof area must not be drawn as half of its height",
);
assert.equal(roofFillHeightFraction(-1), 0);
assert.equal(roofFillHeightFraction(2), 1);
for (const invalid of [NaN, Infinity, -Infinity])
  assert.equal(roofFillHeightFraction(invalid), 0);

console.log("House Monitor progress tests passed");
