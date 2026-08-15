import { ConfigService } from "../../config/ConfigService";
import { RuntimeStateStore } from "../../data/RuntimeStateStore";
import {
  getAutoDropCadenceScale,
  getCoinRewardPreview,
  getCoinValueUpgradeCost,
  getPusherSpeedLevelScale,
  getUpgradeCost,
} from "../../data/StateSelectors";
import { DebugMetrics } from "../../debug/DebugMetrics";
import { SessionProgressService } from "../session/SessionProgressService";

export class UpgradeSystem {
  public constructor(
    private readonly stateStore: RuntimeStateStore,
    private readonly progressService: SessionProgressService,
    private readonly configService: ConfigService,
    private readonly debugMetrics: DebugMetrics,
  ) {}

  public getCoinValueUpgradeLevel(): number {
    return this.stateStore.getState().upgrades.coinValueLevel;
  }

  public getNextCoinValueUpgradeCost(): number {
    return getCoinValueUpgradeCost(this.configService.getConfig(), this.stateStore.getState());
  }

  public getPusherUpgradeLevel(): number {
    return this.stateStore.getState().upgrades.pusherLevel;
  }

  public getAutoDropUpgradeLevel(): number {
    return this.stateStore.getState().upgrades.autoDropLevel;
  }

  public getNextPusherUpgradeCost(): number {
    return getUpgradeCost(this.configService.getConfig(), this.stateStore.getState(), "pusher");
  }

  public getNextAutoDropUpgradeCost(): number {
    return getUpgradeCost(this.configService.getConfig(), this.stateStore.getState(), "autoDrop");
  }

  public getCoinRewardPreview(): number {
    return getCoinRewardPreview(this.configService.getConfig(), this.stateStore.getState());
  }

  public getPusherSpeedLevelScale(): number {
    return getPusherSpeedLevelScale(this.configService.getConfig(), this.stateStore.getState());
  }

  public getAutoDropCadenceScale(): number {
    return getAutoDropCadenceScale(this.configService.getConfig(), this.stateStore.getState());
  }

  public purchaseCoinValueUpgrade(): boolean {
    const cost = this.getNextCoinValueUpgradeCost();
    if (!this.progressService.spendCoins(cost)) {
      return false;
    }

    this.stateStore.update((state) => ({
      ...state,
      upgrades: {
        ...state.upgrades,
        coinValueLevel: state.upgrades.coinValueLevel + 1,
      },
    }));
    this.debugMetrics.recordUpgradePurchase();
    return true;
  }

  public purchasePusherUpgrade(): boolean {
    const cost = this.getNextPusherUpgradeCost();
    if (!this.progressService.spendCoins(cost)) {
      return false;
    }

    this.stateStore.update((state) => ({
      ...state,
      upgrades: {
        ...state.upgrades,
        pusherLevel: state.upgrades.pusherLevel + 1,
      },
    }));
    this.debugMetrics.recordUpgradePurchase();
    return true;
  }

  public purchaseAutoDropUpgrade(): boolean {
    const cost = this.getNextAutoDropUpgradeCost();
    if (!this.progressService.spendCoins(cost)) {
      return false;
    }

    this.stateStore.update((state) => ({
      ...state,
      upgrades: {
        ...state.upgrades,
        autoDropLevel: state.upgrades.autoDropLevel + 1,
      },
    }));
    this.debugMetrics.recordUpgradePurchase();
    return true;
  }
}
