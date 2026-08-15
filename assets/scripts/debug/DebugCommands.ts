import { ConfigService } from "../config/ConfigService";
import { EventBus } from "../core/EventBus";
import { GameEventPayloadMap, GameEvents } from "../core/GameEvents";
import { RuntimeStateStore } from "../data/RuntimeStateStore";
import { SessionProgressService } from "../systems/session/SessionProgressService";
import { DebugOverrideStore } from "./DebugOverrideStore";

export type DebugSpawnItemType = "coin" | "chest" | "rare";

export class DebugCommands {
  public constructor(
    private readonly configService: ConfigService,
    private readonly stateStore: RuntimeStateStore,
    private readonly sessionProgress: SessionProgressService,
    private readonly debugOverrides: DebugOverrideStore,
    private readonly eventBus: EventBus<GameEventPayloadMap>,
  ) {}

  public addCoin(amount = 100): number {
    return this.sessionProgress.addCoins(amount);
  }

  public addDiamond(amount = 10): number {
    return this.sessionProgress.addDiamonds(amount);
  }

  public setTimeScale(value: number): void {
    this.debugOverrides.patch({ timeScale: value });
  }

  public setPusherSpeedScale(value: number): void {
    this.debugOverrides.patch({ pusherSpeedScale: value });
  }

  public setCoinValueScale(value: number): void {
    this.debugOverrides.patch({ coinValueScale: value });
  }

  public setRewardMultiplier(value: number): void {
    this.debugOverrides.patch({ rewardMultiplier: value });
  }

  public setBonusChargeScale(value: number): void {
    this.debugOverrides.patch({ bonusChargeScale: value });
  }

  public setStartingCoinAmount(value: number | null): void {
    this.debugOverrides.patch({ startingCoinAmount: value });
  }

  public applyPreset(presetId: string): boolean {
    const applied = this.debugOverrides.applyPreset(presetId);
    if (applied) {
      this.sessionProgress.setCurrentPresetId(presetId);
    }
    return applied;
  }

  public resetOverrides(): void {
    this.debugOverrides.reset();
    this.sessionProgress.setCurrentPresetId(this.configService.getConfig().debug.defaultPresetId);
  }

  public toggleAutoDrop(): boolean {
    return this.sessionProgress.toggleAutoDrop();
  }

  public forceBonus(bonusId = "debug-bonus"): void {
    this.eventBus.emit(GameEvents.DEBUG_FORCE_BONUS_REQUESTED, { bonusId });
  }

  public spawnDebugItem(itemType: DebugSpawnItemType, count = 1): void {
    this.eventBus.emit(GameEvents.DEBUG_SPAWN_ITEM_REQUESTED, {
      itemType,
      count: Math.max(1, Math.round(count)),
    });
  }

  public clearLowValueDrops(): void {
    this.eventBus.emit(GameEvents.DEBUG_CLEAR_LOW_VALUE_DROPS_REQUESTED, {});
  }

  public resetSession(): void {
    this.eventBus.emit(GameEvents.DEBUG_RESET_SESSION_REQUESTED, {
      presetId: this.stateStore.getState().runtimeFlags.currentPresetId,
    });
  }
}
