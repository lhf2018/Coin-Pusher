import { AppConfig } from "../config/AppConfig";
import { RuntimePlayerState } from "./RuntimeState";

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
