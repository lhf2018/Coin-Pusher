export interface DebugConfig {
  enabled: boolean;
  showDebugButton: boolean;
  showPerformanceStats: boolean;
  allowQuickResourceButtons: boolean;
  allowGuaranteedDrop: boolean;
  defaultPresetId: string;
}

export interface MachineConfig {
  basePusherSpeed: number;
  baseReturnSpeed: number;
  holdDurationSeconds: number;
  timeScale: number;
  baseDropIntervalMs: number;
  baseAutoDropIntervalMs: number;
  maxActiveRigidBodies: number;
}

export interface EconomyConfig {
  startingCoinAmount: number;
  startingDiamondAmount: number;
  eventTokenAmount: number;
  baseDropCost: number;
  baseCoinReward: number;
  baseRewardMultiplier: number;
  coinValueUpgradeBaseCost: number;
  coinValueUpgradeGrowth: number;
  coinValueUpgradeStep: number;
}

export interface BonusConfig {
  baseChargePerReward: number;
  chargeThreshold: number;
  rewardMultiplier: number;
}

export interface AppConfig {
  debug: DebugConfig;
  machine: MachineConfig;
  economy: EconomyConfig;
  bonus: BonusConfig;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  debug: {
    enabled: true,
    showDebugButton: true,
    showPerformanceStats: true,
    allowQuickResourceButtons: true,
    allowGuaranteedDrop: true,
    defaultPresetId: "default",
  },
  machine: {
    basePusherSpeed: 1.4,
    baseReturnSpeed: 1.1,
    holdDurationSeconds: 0.2,
    timeScale: 1,
    baseDropIntervalMs: 300,
    baseAutoDropIntervalMs: 180,
    maxActiveRigidBodies: 100,
  },
  economy: {
    startingCoinAmount: 500,
    startingDiamondAmount: 0,
    eventTokenAmount: 0,
    baseDropCost: 1,
    baseCoinReward: 5,
    baseRewardMultiplier: 1,
    coinValueUpgradeBaseCost: 20,
    coinValueUpgradeGrowth: 1.35,
    coinValueUpgradeStep: 0.25,
  },
  bonus: {
    baseChargePerReward: 10,
    chargeThreshold: 100,
    rewardMultiplier: 2,
  },
};
