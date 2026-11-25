# JanSetu design and motion

Goal: a calm, premium Indian fintech feel. Think "Apple-quiet", not "crypto dashboard".

## Look
- Colour: deep green #087443 and emerald #0C9F6A on clean white #F7FAF8 / #FFFFFF, text #17251E, secondary #738078. Warm amber for warnings, muted red for errors. A true dark mode uses the same hues.
- Type: Inter (Apple's San Francisco cannot be bundled on Android) on an SF-style scale: 34 large title, 28, 22, 17, 16, 15, 13, 12. Money uses tabular numerals so digits never jitter.
- Layout: 4/8 point grid, 14 to 20 px radii, hairline green-tinted borders, soft shadows, large titles that collapse into a compact bar while scrolling, bottom sheets for confirmations.
- Honesty labels: Testnet, Projected, Simulated, Unfunded. A projection is never shown as a balance.

## Motion rules (code: `src/design/motion.ts`, enforced by a test)
1. Springs are critically damped (`damping = 2*sqrt(stiffness*mass)`) with overshoot clamped. Things settle; they never bounce.
2. Timings 200 to 380 ms. Entering uses a decelerating curve, leaving an accelerating one.
3. Every animation explains a change: a sheet rising, a balance rolling to its new value digit by digit, a ring filling as a transaction moves from signing to confirmed.
4. The ring turns into a check mark only after the on-chain receipt confirms success. Failure turns it red.
5. Only loading skeletons loop, slowly and softly.
6. With the phone's "reduce motion" setting on, movement becomes a near-instant fade.
7. Haptics: light tap on press, a firm pulse only on confirmed success or failure.
