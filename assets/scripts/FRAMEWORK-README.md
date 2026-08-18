# Local Framework Notes

This folder contains the local gameplay framework skeleton for the coin pusher project.

It is not the running Vite prototype. The playable app lives in `src/` — see the repo `README.md` and `prototype-dev-notes.md`.

## Entry Flow

- `core/AppLauncher.ts`
  Attaches the root runtime components.
- `core/GameDirector.ts`
  Owns config, runtime state, debug overrides, event bus, upgrade flow, and session reset.

## Runtime Layers

- `config/`
  Static game configuration and tuning values.
- `data/`
  Runtime state shape, store, selectors, and initial-state factory.
- `systems/`
  Stateful domain services such as session progress and upgrades.
- `gameplay/`
  Runtime-facing components for coin dropping and pusher movement.
- `debug/`
  Debug presets, override store, metrics, hotkeys, and commands.

## Current Local Controls

- `Space`
  Manual coin drop.
- `M`
  Toggle auto-drop.
- `F1`
  Toggle debug panel visibility flag.
- `1`..`5`
  Apply debug presets.
- `G` / `H`
  Add 100 / 1000 coins.
- `J` / `K`
  Adjust pusher speed scale.
- `U` / `I`
  Adjust coin value scale.
- `C` / `P` / `O`
  Purchase coin-value / pusher / auto-drop upgrades.
- `B`
  Force a bonus trigger.
- `L`
  Reset debug overrides.
- `R`
  Reset the session.

## What This Framework Already Covers

- Typed event routing via `EventBus` and `GameEvents`
- Runtime state store with subscription support
- Auto-drop loop and delayed reward settlement
- Pusher forward / hold / return cycle
- Upgrade cost and level scaling
- Session reset and debug override persistence

## What Still Needs Scene Integration

- Real node bindings for HUD and debug UI
- Actual rigid-body coin spawning and collection
- Bonus presentation and reward effects
- Saving and loading runtime state
