# Rapier Migration TODO

Branch: `codex/taichi-physics-spike`

## Goal

Improve machine realism without rewriting physics from scratch.

Decision for now:

- Do not attempt a full Taichi replacement of the physics engine.
- Keep the current Taichi work as an experiment only.
- Plan the next physics migration around `Rapier`.

## Why Rapier

- `Rapier` is a complete rigid-body physics engine for JavaScript/WebAssembly.
- It is a better fit than `taichi.js` for collision, contact solving, friction, damping, CCD, and kinematic bodies.
- It lets us target better realism without building our own solver.

## In Scope

- Replace `cannon-es` runtime physics in the prototype with `Rapier`.
- Keep `Three.js` rendering, UI, economy, tasks, and debug controls as-is in the first migration phase.
- Rebuild the pusher, upper deck, lower deck, side walls, payout slots, and item bodies on top of `Rapier`.
- Re-tune contact and motion parameters for a more believable coin pusher feel.

## Out of Scope

- No backend, login, ads, or persistence work.
- No full Taichi-based physics rewrite.
- No large UI redesign as part of the engine migration.
- No new gameplay systems before the core migration is stable.

## TODO

- [x] Add `@dimforge/rapier3d-compat` and create a small physics adapter layer so the app is not tied directly to one engine.
- [x] Replace `CANNON.World` bootstrap with a `Rapier` world bootstrap.
- [x] Convert static machine geometry into `Rapier` fixed rigid bodies and colliders.
- [x] Convert the pusher into a `Rapier` kinematic body with an explicit motion update path.
- [x] Convert coin, chest, and rare item bodies into `Rapier` dynamic rigid bodies and colliders.
- [x] Re-implement mesh-to-physics synchronization on top of `Rapier` handles.
- [x] Re-implement cleanup, collection detection, and body removal on top of `Rapier`.
- [x] Recreate damping, gravity, sleep, and wake-up behavior with `Rapier` equivalents.
- [x] Enable CCD for fast drops or edge cases where items can tunnel through thin geometry.
- [x] Tune friction, restitution, mass, and damping for coins, chests, pusher, and deck surfaces.
- [ ] Verify that coins do not fall behind the pusher or pass through side walls and payout structures.
- [x] Add a visible runtime status label so the page clearly shows which physics backend is active.
- [x] Make Rapier the default runtime. Keep Taichi assist behind `?physics=taichi`. Cannon is no longer used at runtime.

## Suggested Phases

### Phase 1: Adapter and Bootstrap

- Add the dependency.
- Create a thin abstraction for world step, body creation, body removal, and transform reads.
- Keep all gameplay logic above that layer unchanged where possible.

### Phase 2: Static Structure Migration

- Move the table, walls, decks, and payout boundaries first.
- Validate the physical structure before moving dynamic items.

### Phase 3: Dynamic Item Migration

- Port coins, chests, and rare items.
- Port the pusher body and motion path.
- Restore collection flow and item cleanup.

### Phase 4: Behavior Tuning

- Tune collider size, damping, friction, and gravity.
- Fix tunneling, jitter, unstable stacking, and edge clipping.

### Phase 5: Acceptance and Cleanup

- Remove unused `cannon-es` integration once the new path is stable.
- Re-run screenshot-based and browser-based validation.

## Acceptance Criteria

- The prototype still runs locally at `http://127.0.0.1:4173/`.
- Coins, chests, and rare items collide correctly with decks, walls, and the pusher.
- The pusher moves items forward without obvious tunneling or items appearing behind it.
- The lower deck and front payout area behave more believably than the current `cannon-es` version.
- The runtime status label clearly shows whether the app is using Cannon, Taichi hybrid, or Rapier.
- The migration does not break debug controls, reward flow, or task progression.

## Notes

- The current Taichi branch work remains useful as an experiment and reference for GPU-assisted behavior.
- For the production direction of this prototype, `Rapier` is the preferred next step.
