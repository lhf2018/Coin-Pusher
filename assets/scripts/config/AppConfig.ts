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
  returnLiftOffset: number;
  travelDistance: number;
  timeScale: number;
  baseDropIntervalMs: number;
  baseAutoDropIntervalMs: number;
  maxActiveRigidBodies: number;
  pusherUpgradeStep: number;
  autoDropUpgradeStep: number;
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
  pusherUpgradeBaseCost: number;
  pusherUpgradeGrowth: number;
  autoDropUpgradeBaseCost: number;
  autoDropUpgradeGrowth: number;
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
    returnLiftOffset: 0.04,
    travelDistance: 0.65,
    timeScale: 1,
    baseDropIntervalMs: 300,
    baseAutoDropIntervalMs: 180,
    maxActiveRigidBodies: 100,
    pusherUpgradeStep: 0.12,
    autoDropUpgradeStep: 0.08,
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
    pusherUpgradeBaseCost: 60,
    pusherUpgradeGrowth: 1.45,
    autoDropUpgradeBaseCost: 80,
    autoDropUpgradeGrowth: 1.5,
  },
  bonus: {
    baseChargePerReward: 10,
    chargeThreshold: 100,
    rewardMultiplier: 2,
  },
};
