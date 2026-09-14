# SweetMate Liquid Glass mapping

The appearance system resolves two independent preferences: `appearanceMode`
(`light` or `dark`) and the existing accent scheme (`mono`, `brown`,
`pinkWhite`, or `blueWhite`). Legacy token names remain aliases of the new
material tokens so every existing screen participates in mode changes.

| Previous treatment | Liquid Glass treatment |
| --- | --- |
| `colors.background` | Mode-specific canvas behind translucent material |
| `colors.card` / `Surface` | `surface` / guarded `GlassSurface` |
| Elevated modal card | `GlassSheet` using a dense `surfaceModal` tint over background blur |
| Primary `GlassButton` | `AccentButton` with a flat theme action fill |
| Neutral modal action | Neutral filled button without a reflective overlay |
| Destructive modal action | Red filled action with a readable foreground |
| Selected tab bubble | Mode-aware secondary glass highlight |
| Custom blurred tab shell | Guarded elevated glass tab shell |
| `foreground` / `mutedForeground` | `textPrimary` / `textSecondary` |
| `border` | Subtle hairline `divider` |

## Material tiers

1. Non-interactive cards and navigation can use native iOS glass when both
   runtime checks pass, with a neutral tint rather than a white accent wash.
2. Popup sheets always use background blur plus a 96%-opaque modal tint.
   Web sheets use a background-only CSS backdrop filter so foreground text
   remains crisp. Regular web cards use their translucent fill without blur.
3. Reduce Transparency replaces the material with a fully opaque surface.
4. Buttons use flat fills without native interactive glass, gradients, bright
   top rims, or glow shadows. Web keyboard focus rings remain; hover and press
   no longer add white outlines.

Shopping, borrowing, expense details, household switching, account sheets,
and shared action/confirmation dialogs all select the modal surface tier.
Full-screen forms retain their opaque page background.
