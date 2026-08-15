import { AppConfig } from "../config/AppConfig";
import { RuntimePlayerState } from "./RuntimeState";

export type UpgradeSelectorKey = "coinValue" | "pusher" | "autoDrop";

export function getCoinBalance(state: Readonly<RuntimePlayerState>): number {
  return state.wallet.coin;
}

export function canAffordDrop(
  config: AppConfig,
  state: Readonly<RuntimePlayerState>,
  dropCount = 1,
): boolean {
  return state.wallet.coin >= config.economy.baseDropCost * Math.max(1, dropCount);
}

export function getCoinValueUpgradeCost(
  config: AppConfig,
  state: Readonly<RuntimePlayerState>,
): number {
  const level = state.upgrades.coinValueLevel;
  return Math.max(
    1,
    Math.round(
      config.economy.coinValueUpgradeBaseCost *
        Math.pow(config.economy.coinValueUpgradeGrowth, level),
    ),
  );
}

export function getCoinRewardPreview(
  config: AppConfig,
  state: Readonly<RuntimePlayerState>,
): number {
  const levelScale = 1 + state.upgrades.coinValueLevel * config.economy.coinValueUpgradeStep;
  return Math.max(1, Math.round(config.economy.baseCoinReward * levelScale));
}

export function getUpgradeCost(
  config: AppConfig,
  state: Readonly<RuntimePlayerState>,
  key: UpgradeSelectorKey,
): number {
  if (key === "coinValue") {
    return getCoinValueUpgradeCost(config, state);
  }

  const level = key === "pusher" ? state.upgrades.pusherLevel : state.upgrades.autoDropLevel;
  const baseCost =
    key === "pusher"
      ? config.economy.pusherUpgradeBaseCost
      : config.economy.autoDropUpgradeBaseCost;
  const growth =
    key === "pusher" ? config.economy.pusherUpgradeGrowth : config.economy.autoDropUpgradeGrowth;

  return Math.max(1, Math.round(baseCost * Math.pow(growth, level)));
}

export function getPusherSpeedLevelScale(
  config: AppConfig,
  state: Readonly<RuntimePlayerState>,
): number {
  return 1 + state.upgrades.pusherLevel * config.machine.pusherUpgradeStep;
}

export function getAutoDropCadenceScale(
  config: AppConfig,
  state: Readonly<RuntimePlayerState>,
): number {
  return 1 + state.upgrades.autoDropLevel * config.machine.autoDropUpgradeStep;
}
