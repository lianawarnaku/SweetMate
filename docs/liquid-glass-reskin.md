# SweetMate Liquid Glass mapping

The appearance system resolves two independent preferences: `appearanceMode`
(`light` or `dark`) and the existing accent scheme (`mono`, `brown`,
`pinkWhite`, or `blueWhite`). Legacy token names remain aliases of the new
material tokens so every existing screen participates in mode changes.

| Previous treatment | Liquid Glass treatment |
| --- | --- |
| `colors.background` | Mode-specific canvas behind translucent material |
| `colors.card` / `Surface` | `surface` / guarded `GlassSurface` |
| Elevated modal card | `GlassSheet` using `surfaceElevated` and a top accent wash |
| Primary `GlassButton` | `AccentButton` with the resolved two-stop accent gradient |
| Neutral modal action | Elevated interactive glass button |
| Destructive modal action | Constant-red destructive glass material |
| Selected tab bubble | Mode-aware secondary glass highlight |
| Custom blurred tab shell | Guarded elevated glass tab shell |
| `foreground` / `mutedForeground` | `textPrimary` / `textSecondary` |
| `border` | Hairline `divider` / bright `glassRim` |

## Material tiers

1. iOS Liquid Glass uses `GlassView` only when both Expo runtime checks pass.
2. Older iOS, Android, and web use `BlurView`, a theme-accent top gradient,
   and a hairline rim.
3. Reduce Transparency replaces blur with the resolved opaque surface.

The shared `Surface`, popup surface, button, and tab-bar paths all route
through these guards. Screen-specific colors continue to read `useTheme()`,
whose legacy aliases now resolve from the same mode-aware token object.
