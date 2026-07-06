export interface DebugOverrideState {
  timeScale: number;
  pusherSpeedScale: number;
  dropIntervalScale: number;
  autoDropRateScale: number;
  coinValueScale: number;
  rewardMultiplier: number;
  bonusChargeScale: number;
  startingCoinAmount: number | null;
}

export interface DebugPreset {
  id: string;
  label: string;
  description: string;
  overrides: DebugOverrideState;
}

export const DEFAULT_DEBUG_OVERRIDE_STATE: DebugOverrideState = {
  timeScale: 1,
  pusherSpeedScale: 1,
  dropIntervalScale: 1,
  autoDropRateScale: 1,
  coinValueScale: 1,
  rewardMultiplier: 1,
  bonusChargeScale: 1,
  startingCoinAmount: null,
};

export const DEBUG_SAFETY_LIMITS = {
  timeScale: { min: 0.5, max: 4 },
  pusherSpeedScale: { min: 0.5, max: 3 },
  dropIntervalScale: { min: 0.5, max: 5 },
  autoDropRateScale: { min: 0.5, max: 5 },
  coinValueScale: { min: 0.1, max: 100 },
  rewardMultiplier: { min: 0.1, max: 20 },
  bonusChargeScale: { min: 0.1, max: 10 },
  startingCoinAmount: { min: 0, max: 100000000 },
} as const;

export const DEBUG_PRESETS: Record<string, DebugPreset> = {
  default: {
    id: "default",
    label: "Default",
    description: "Normal prototype values.",
    overrides: {
      ...DEFAULT_DEBUG_OVERRIDE_STATE,
    },
  },
  fast_loop: {
    id: "fast_loop",
    label: "Fast Loop",
    description: "Speeds up the pusher and drop cadence for loop validation.",
    overrides: {
      ...DEFAULT_DEBUG_OVERRIDE_STATE,
      timeScale: 1.5,
      pusherSpeedScale: 1.75,
      dropIntervalScale: 2,
      autoDropRateScale: 2,
      startingCoinAmount: 1000,
    },
  },
  rich_mode: {
    id: "rich_mode",
    label: "Rich Mode",
    description: "Boosts coin scale to validate economy pacing.",
    overrides: {
      ...DEFAULT_DEBUG_OVERRIDE_STATE,
      coinValueScale: 5,
      rewardMultiplier: 4,
      startingCoinAmount: 50000,
    },
  },
  bonus_test: {
    id: "bonus_test",
    label: "Bonus Test",
    description: "Raises charge speed to force more frequent bonus triggers.",
    overrides: {
      ...DEFAULT_DEBUG_OVERRIDE_STATE,
      bonusChargeScale: 4,
      rewardMultiplier: 1.5,
      startingCoinAmount: 2000,
    },
  },
  stress_physics: {
    id: "stress_physics",
    label: "Stress Physics",
    description: "Higher rhythm values for testing drop density and spikes.",
    overrides: {
      ...DEFAULT_DEBUG_OVERRIDE_STATE,
      timeScale: 1.2,
      pusherSpeedScale: 2,
      dropIntervalScale: 4,
      autoDropRateScale: 4,
      startingCoinAmount: 10000,
    },
  },
};
