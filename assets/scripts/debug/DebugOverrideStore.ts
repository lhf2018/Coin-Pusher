import {
  DEBUG_PRESETS,
  DEBUG_SAFETY_LIMITS,
  DEFAULT_DEBUG_OVERRIDE_STATE,
  DebugOverrideState,
} from "./DebugPresets";

export type DebugOverrideListener = (state: Readonly<DebugOverrideState>) => void;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeState(state: Partial<DebugOverrideState>): DebugOverrideState {
  return {
    timeScale: clamp(
      state.timeScale ?? DEFAULT_DEBUG_OVERRIDE_STATE.timeScale,
      DEBUG_SAFETY_LIMITS.timeScale.min,
      DEBUG_SAFETY_LIMITS.timeScale.max,
    ),
    pusherSpeedScale: clamp(
      state.pusherSpeedScale ?? DEFAULT_DEBUG_OVERRIDE_STATE.pusherSpeedScale,
      DEBUG_SAFETY_LIMITS.pusherSpeedScale.min,
      DEBUG_SAFETY_LIMITS.pusherSpeedScale.max,
    ),
    dropIntervalScale: clamp(
      state.dropIntervalScale ?? DEFAULT_DEBUG_OVERRIDE_STATE.dropIntervalScale,
      DEBUG_SAFETY_LIMITS.dropIntervalScale.min,
      DEBUG_SAFETY_LIMITS.dropIntervalScale.max,
    ),
    autoDropRateScale: clamp(
      state.autoDropRateScale ?? DEFAULT_DEBUG_OVERRIDE_STATE.autoDropRateScale,
      DEBUG_SAFETY_LIMITS.autoDropRateScale.min,
      DEBUG_SAFETY_LIMITS.autoDropRateScale.max,
    ),
    coinValueScale: clamp(
      state.coinValueScale ?? DEFAULT_DEBUG_OVERRIDE_STATE.coinValueScale,
      DEBUG_SAFETY_LIMITS.coinValueScale.min,
      DEBUG_SAFETY_LIMITS.coinValueScale.max,
    ),
    rewardMultiplier: clamp(
      state.rewardMultiplier ?? DEFAULT_DEBUG_OVERRIDE_STATE.rewardMultiplier,
      DEBUG_SAFETY_LIMITS.rewardMultiplier.min,
      DEBUG_SAFETY_LIMITS.rewardMultiplier.max,
    ),
    bonusChargeScale: clamp(
      state.bonusChargeScale ?? DEFAULT_DEBUG_OVERRIDE_STATE.bonusChargeScale,
      DEBUG_SAFETY_LIMITS.bonusChargeScale.min,
      DEBUG_SAFETY_LIMITS.bonusChargeScale.max,
    ),
    startingCoinAmount:
      state.startingCoinAmount == null
        ? null
        : clamp(
            Math.round(state.startingCoinAmount),
            DEBUG_SAFETY_LIMITS.startingCoinAmount.min,
            DEBUG_SAFETY_LIMITS.startingCoinAmount.max,
          ),
  };
}

export class DebugOverrideStore {
  private state: DebugOverrideState;
  private readonly listeners = new Set<DebugOverrideListener>();

  public constructor(initialState: Partial<DebugOverrideState> = DEFAULT_DEBUG_OVERRIDE_STATE) {
    this.state = sanitizeState(initialState);
  }

  public getState(): Readonly<DebugOverrideState> {
    return this.state;
  }

  public subscribe(listener: DebugOverrideListener): () => void {
    this.listeners.add(listener);
    listener(this.state);

    return () => {
      this.listeners.delete(listener);
    };
  }

  public patch(partialState: Partial<DebugOverrideState>): void {
    this.state = sanitizeState({
      ...this.state,
      ...partialState,
    });
    this.emit();
  }

  public reset(): void {
    this.state = sanitizeState(DEFAULT_DEBUG_OVERRIDE_STATE);
    this.emit();
  }

  public applyPreset(presetId: string): boolean {
    const preset = DEBUG_PRESETS[presetId];
    if (!preset) {
      return false;
    }

    this.state = sanitizeState(preset.overrides);
    this.emit();
    return true;
  }

  public resolveTimeScale(baseTimeScale: number): number {
    return clamp(
      baseTimeScale * this.state.timeScale,
      DEBUG_SAFETY_LIMITS.timeScale.min,
      DEBUG_SAFETY_LIMITS.timeScale.max,
    );
  }

  public resolvePusherSpeed(baseSpeed: number): number {
    return clamp(
      baseSpeed * this.state.pusherSpeedScale,
      DEBUG_SAFETY_LIMITS.pusherSpeedScale.min,
      baseSpeed * DEBUG_SAFETY_LIMITS.pusherSpeedScale.max,
    );
  }

  public resolveDropInterval(baseIntervalMs: number): number {
    return Math.max(50, Math.round(baseIntervalMs / this.state.dropIntervalScale));
  }

  public resolveAutoDropInterval(baseIntervalMs: number): number {
    return Math.max(50, Math.round(baseIntervalMs / this.state.autoDropRateScale));
  }

  public resolveReward(baseReward: number): number {
    return Math.max(
      1,
      Math.round(baseReward * this.state.coinValueScale * this.state.rewardMultiplier),
    );
  }

  public resolveBonusCharge(baseCharge: number): number {
    return Math.max(1, Math.round(baseCharge * this.state.bonusChargeScale));
  }

  public resolveStartingCoinAmount(baseStartingAmount: number): number {
    if (this.state.startingCoinAmount == null) {
      return Math.max(0, Math.round(baseStartingAmount));
    }

    return Math.max(0, Math.round(this.state.startingCoinAmount));
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
