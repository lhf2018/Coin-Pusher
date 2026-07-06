import { DebugOverrides, DebugPreset, RuntimeState, SessionTask } from "./types";

export const TABLE = {
  width: 9,
  depth: 11.5,
  wallHeight: 1.5,
  floorY: 0,
  frontEdgeZ: 5.1,
  backZ: -4.5,
  spawnY: 2.8,
};

export const DEFAULT_DEBUG_OVERRIDES: DebugOverrides = {
  timeScale: 1,
  pusherSpeedScale: 1,
  dropRateScale: 1,
  coinValueScale: 1,
  rewardMultiplier: 1,
  bonusChargeScale: 1,
  startingCoins: null,
};

export const DEBUG_LIMITS = {
  timeScale: { min: 0.5, max: 4, step: 0.1 },
  pusherSpeedScale: { min: 0.5, max: 3, step: 0.05 },
  dropRateScale: { min: 0.5, max: 5, step: 0.1 },
  coinValueScale: { min: 0.1, max: 100, step: 0.1 },
  rewardMultiplier: { min: 0.1, max: 20, step: 0.1 },
  bonusChargeScale: { min: 0.1, max: 10, step: 0.1 },
  startingCoins: { min: 0, max: 500000, step: 100 },
} as const;

export const DEBUG_PRESETS: DebugPreset[] = [
  {
    id: "default",
    label: "Default",
    description: "Normal prototype loop.",
    overrides: { ...DEFAULT_DEBUG_OVERRIDES },
  },
  {
    id: "fast_loop",
    label: "Fast Loop",
    description: "Faster push cadence and drop rhythm.",
    overrides: {
      ...DEFAULT_DEBUG_OVERRIDES,
      timeScale: 1.35,
      pusherSpeedScale: 1.6,
      dropRateScale: 2,
      startingCoins: 1500,
    },
  },
  {
    id: "rich_mode",
    label: "Rich Mode",
    description: "Higher coin value for economy tuning.",
    overrides: {
      ...DEFAULT_DEBUG_OVERRIDES,
      coinValueScale: 6,
      rewardMultiplier: 3,
      startingCoins: 50000,
    },
  },
  {
    id: "bonus_test",
    label: "Bonus Test",
    description: "Rapid bonus charge for spectacle checks.",
    overrides: {
      ...DEFAULT_DEBUG_OVERRIDES,
      rewardMultiplier: 1.6,
      bonusChargeScale: 4,
      startingCoins: 3000,
    },
  },
  {
    id: "stress_physics",
    label: "Stress Physics",
    description: "Higher density for rigid body budget testing.",
    overrides: {
      ...DEFAULT_DEBUG_OVERRIDES,
      timeScale: 1.2,
      pusherSpeedScale: 2.1,
      dropRateScale: 4.2,
      startingCoins: 10000,
    },
  },
];

export const BASE_CONFIG = {
  startingCoins: 600,
  startingDiamonds: 3,
  startingFragments: 0,
  baseDropCost: 1,
  baseCoinReward: 5,
  baseBonusCharge: 12,
  bonusThreshold: 100,
  basePusherSpeed: 1.25,
  pusherAmplitude: 1.05,
  spawnRadiusX: 3.2,
  dropIntervalMs: 320,
  autoDropIntervalMs: 190,
};

export function createDefaultTasks(): SessionTask[] {
  return [
    {
      id: "drop-30",
      title: "投币 30 次",
      goal: 30,
      progress: 0,
      reward: 80,
      claimed: false,
      metric: "drops",
    },
    {
      id: "bonus-2",
      title: "触发 2 次 Bonus",
      goal: 2,
      progress: 0,
      reward: 200,
      claimed: false,
      metric: "bonus",
    },
    {
      id: "earn-1500",
      title: "赚到 1500 金币",
      goal: 1500,
      progress: 0,
      reward: 150,
      claimed: false,
      metric: "earnings",
    },
  ];
}

export function createInitialState(
  overrides: DebugOverrides = DEFAULT_DEBUG_OVERRIDES,
): RuntimeState {
  return {
    coins: overrides.startingCoins ?? BASE_CONFIG.startingCoins,
    diamonds: BASE_CONFIG.startingDiamonds,
    fragments: BASE_CONFIG.startingFragments,
    bonusCharge: 0,
    bonusThreshold: BASE_CONFIG.bonusThreshold,
    feverTimeLeft: 0,
    activeBonus: null,
    drops: 0,
    totalEarnings: 0,
    autoDropEnabled: false,
    upgrades: {
      coinValue: 0,
      autoDrop: 0,
      pusherSpeed: 0,
    },
    debugVisible: true,
    currentPresetId: "default",
    tasks: createDefaultTasks(),
    messages: ["原型已启动，按 Space 投币，F1 切调试面板。"],
  };
}
