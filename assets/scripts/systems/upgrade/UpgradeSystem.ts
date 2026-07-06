import { ConfigService } from "../../config/ConfigService";
import { RuntimeStateStore } from "../../data/RuntimeStateStore";
import { getCoinRewardPreview, getCoinValueUpgradeCost } from "../../data/StateSelectors";
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

  public getCoinRewardPreview(): number {
    return getCoinRewardPreview(this.configService.getConfig(), this.stateStore.getState());
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
}
