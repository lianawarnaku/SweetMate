import {
  glass,
  interaction,
  motion,
  radii,
  spacing,
  typography,
} from "../constants/designTokens.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(spacing.xs < spacing.sm && spacing.sm < spacing.lg, "spacing must increase predictably");
assert(radii.control < radii.card, "cards must feel softer than controls");
assert(interaction.minimumTouchTarget >= 44, "touch targets must meet the mobile minimum");
assert(typography.display.fontSize > typography.title.fontSize, "type hierarchy must remain visible");
assert(motion.quick < motion.standard && motion.standard < motion.deliberate, "motion speeds must be ordered");
assert(glass.subtle.blurIntensity < glass.card.blurIntensity, "subtle glass must stay behind cards");
assert(glass.card.blurIntensity < glass.elevated.blurIntensity, "elevated glass must read above cards");
assert(glass.elevated.blurIntensity < glass.modal.blurIntensity, "modals must have the strongest separation");

console.log("design token tests passed");
