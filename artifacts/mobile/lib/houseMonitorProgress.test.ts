import { strict as assert } from "node:assert";
import {
  getHouseMonitorProgress,
  houseMonitorGridSquares,
} from "./houseMonitorProgress.ts";

function approximately(actual: number, expected: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

for (const [total, expected] of [
  [0, 1],
  [1, 1],
  [2, 1],
  [3, 1],
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
    `grid must use the largest capped square for ${total} chores`,
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

const twoChores = getHouseMonitorProgress(2, 1);
assert.equal(twoChores.gridSquares, 1);
assert.equal(twoChores.filledSquares, 1);
assert.equal(twoChores.overflowChores, 1);
assert.equal(twoChores.roofCompletionRatio, 0);
assert.equal(getHouseMonitorProgress(2, 2).roofCompletionRatio, 1);
const threeChores = getHouseMonitorProgress(3, 2);
assert.equal(threeChores.gridSquares, 1);
assert.equal(threeChores.filledSquares, 1);
assert.equal(threeChores.overflowChores, 2);
assert.equal(threeChores.completedOverflowChores, 1);
assert.equal(
  threeChores.roofCompletionRatio,
  0.5,
  "one of two chores left after the single body box fills half the roof",
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

for (const total of [1, 4, 9, 16, 25]) {
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
  0,
  "one chore uses exactly one box without unused padding",
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
      Number.isInteger(Math.sqrt(progress.gridSquares)),
      "every body must contain a square number of boxes",
    );
    if (total > 0) {
      assert.ok(
        progress.gridSquares <= total,
        "the body cannot invent extra chore boxes",
      );
      if (progress.gridSquares < 25)
        assert.ok(
          (Math.sqrt(progress.gridSquares) + 1) ** 2 > total,
          "body must use the largest complete square that fits",
        );
    }
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

const manyChores = getHouseMonitorProgress(1000, 500);
assert.equal(manyChores.gridSquares, 25);
assert.equal(manyChores.overflowChores, 975);
assert.equal(manyChores.completedOverflowChores, 475);
approximately(
  manyChores.roofCompletionRatio,
  475 / 975,
  "any chores above the cap stay represented in the roof",
);

console.log("House Monitor progress tests passed");
