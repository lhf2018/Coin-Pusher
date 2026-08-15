import { _decorator, Component } from "cc";
import { AppConfig } from "../config/AppConfig";
import { ConfigService } from "../config/ConfigService";
import { EventBus } from "./EventBus";
import { GameEventPayloadMap, GameEvents, UpgradeKind } from "./GameEvents";
import { createInitialRuntimePlayerState } from "../data/SessionStateFactory";
import { RuntimeStateStore } from "../data/RuntimeStateStore";
import { canAffordDrop } from "../data/StateSelectors";
import { DebugCommands } from "../debug/DebugCommands";
import { DebugMetrics } from "../debug/DebugMetrics";
import { DebugOverrideStore } from "../debug/DebugOverrideStore";
import { SessionProgressService } from "../systems/session/SessionProgressService";
import { UpgradeSystem } from "../systems/upgrade/UpgradeSystem";

const { ccclass } = _decorator;

@ccclass("GameDirector")
export class GameDirector extends Component {
  public static instance: GameDirector | null = null;

  private configService!: ConfigService;
  private runtimeStateStore!: RuntimeStateStore;
  private debugOverrideStore!: DebugOverrideStore;
  private debugMetrics!: DebugMetrics;
  private eventBus!: EventBus<GameEventPayloadMap>;
  private sessionProgress!: SessionProgressService;
  private upgradeSystem!: UpgradeSystem;
  private debugCommands!: DebugCommands;

  public get config(): AppConfig {
    return this.configService.getConfig();
  }

  public get stateStore(): RuntimeStateStore {
    return this.runtimeStateStore;
  }

  public get overrides(): DebugOverrideStore {
    return this.debugOverrideStore;
  }

  public get metrics(): DebugMetrics {
    return this.debugMetrics;
  }

  public get bus(): EventBus<GameEventPayloadMap> {
    return this.eventBus;
  }

  public get progress(): SessionProgressService {
    return this.sessionProgress;
  }

  public get upgrades(): UpgradeSystem {
    return this.upgradeSystem;
  }

  public get debug(): DebugCommands {
    return this.debugCommands;
  }

  public onLoad(): void {
    if (GameDirector.instance && GameDirector.instance !== this) {
      this.destroy();
      return;
    }

    GameDirector.instance = this;
    this.bootstrap();
  }

  public onDestroy(): void {
    if (GameDirector.instance === this) {
      GameDirector.instance = null;
    }

    if (this.eventBus) {
      this.eventBus.clear();
    }

    if (this.debugMetrics) {
      this.debugMetrics.recordSessionEnd();
    }
  }

  public requestCoinDrop(dropCount = 1): boolean {
    const safeDropCount = Math.max(1, Math.round(dropCount));
    if (!canAffordDrop(this.config, this.runtimeStateStore.getState(), safeDropCount)) {
      return false;
    }

    const totalCost = this.config.economy.baseDropCost * safeDropCount;
    if (!this.sessionProgress.spendCoins(totalCost)) {
      return false;
    }

    this.debugMetrics.recordCoinDrop(safeDropCount);
    this.eventBus.emit(GameEvents.COIN_DROP_REQUESTED, {
      dropCount: safeDropCount,
      totalCost,
    });
    return true;
  }

  public resolvePrototypeReward(baseReward?: number): number {
    const rewardBase = baseReward ?? this.upgradeSystem.getCoinRewardPreview();
    const resolvedReward = this.debugOverrideStore.resolveReward(
      rewardBase * this.config.economy.baseRewardMultiplier,
    );

    this.sessionProgress.addCoins(resolvedReward);
    this.debugMetrics.recordReward(resolvedReward);

    const bonusTriggered = this.sessionProgress.addBonusCharge(
      this.debugOverrideStore.resolveBonusCharge(this.config.bonus.baseChargePerReward),
      this.config.bonus.chargeThreshold,
    );
    if (bonusTriggered) {
      this.triggerBonus("charge-bonus");
    }

    this.eventBus.emit(GameEvents.REWARD_RESOLVED, {
      reward: resolvedReward,
    });

    return resolvedReward;
  }

  public triggerBonus(bonusId: string): void {
    this.sessionProgress.setActiveBonus(bonusId);
    this.debugMetrics.recordBonusTrigger();
    this.eventBus.emit(GameEvents.BONUS_TRIGGERED, { bonusId });
  }

  public clearActiveBonus(): void {
    this.sessionProgress.setActiveBonus(null);
  }

  public setAutoDropEnabled(enabled: boolean): boolean {
    this.sessionProgress.setAutoDropEnabled(enabled);
    this.eventBus.emit(GameEvents.AUTO_DROP_TOGGLED, { enabled });
    return enabled;
  }

  public toggleAutoDrop(): boolean {
    const enabled = this.sessionProgress.toggleAutoDrop();
    this.eventBus.emit(GameEvents.AUTO_DROP_TOGGLED, { enabled });
    return enabled;
  }

  public purchaseUpgrade(kind: UpgradeKind): boolean {
    const cost =
      kind === "coinValue"
        ? this.upgradeSystem.getNextCoinValueUpgradeCost()
        : kind === "pusher"
          ? this.upgradeSystem.getNextPusherUpgradeCost()
          : this.upgradeSystem.getNextAutoDropUpgradeCost();

    const purchased =
      kind === "coinValue"
        ? this.upgradeSystem.purchaseCoinValueUpgrade()
        : kind === "pusher"
          ? this.upgradeSystem.purchasePusherUpgrade()
          : this.upgradeSystem.purchaseAutoDropUpgrade();

    if (!purchased) {
      return false;
    }

    const level =
      kind === "coinValue"
        ? this.upgradeSystem.getCoinValueUpgradeLevel()
        : kind === "pusher"
          ? this.upgradeSystem.getPusherUpgradeLevel()
          : this.upgradeSystem.getAutoDropUpgradeLevel();

    this.eventBus.emit(GameEvents.UPGRADE_PURCHASED, {
      kind,
      level,
      cost,
    });
    return true;
  }

  public getResolvedPusherSpeed(): number {
    const upgradedBaseSpeed =
      this.config.machine.basePusherSpeed * this.upgradeSystem.getPusherSpeedLevelScale();
    return this.debugOverrideStore.resolvePusherSpeed(upgradedBaseSpeed);
  }

  public getResolvedReturnSpeed(): number {
    const upgradedBaseSpeed =
      this.config.machine.baseReturnSpeed * this.upgradeSystem.getPusherSpeedLevelScale();
    return this.debugOverrideStore.resolvePusherSpeed(upgradedBaseSpeed);
  }

  public getResolvedAutoDropIntervalMs(): number {
    const scaledBaseInterval =
      this.config.machine.baseAutoDropIntervalMs / this.upgradeSystem.getAutoDropCadenceScale();
    return this.debugOverrideStore.resolveAutoDropInterval(scaledBaseInterval);
  }

  public getResolvedDropIntervalMs(): number {
    return this.debugOverrideStore.resolveDropInterval(this.config.machine.baseDropIntervalMs);
  }

  public resetSession(): void {
    const currentState = this.runtimeStateStore.getState();
    const nextState = createInitialRuntimePlayerState(
      this.config,
      this.debugOverrideStore.resolveStartingCoinAmount(this.config.economy.startingCoinAmount),
    );
    nextState.runtimeFlags.currentPresetId = currentState.runtimeFlags.currentPresetId;
    nextState.runtimeFlags.debugPanelVisible = currentState.runtimeFlags.debugPanelVisible;
    nextState.runtimeFlags.compactDebugBarVisible = currentState.runtimeFlags.compactDebugBarVisible;
    this.sessionProgress.resetSession(nextState);
    this.debugMetrics.reset();
    this.debugMetrics.recordSessionStart();
    this.eventBus.emit(GameEvents.SESSION_RESET, {
      sessionId: nextState.sessionId,
    });
  }

  public getDebugSummary(): string {
    const state = this.runtimeStateStore.getState();
    const overrides = this.debugOverrideStore.getState();
    const metrics = this.debugMetrics.getSnapshot();

    return [
      `[Session ${state.sessionId}]`,
      `coin=${state.wallet.coin}`,
      `diamond=${state.wallet.diamond}`,
      `preset=${state.runtimeFlags.currentPresetId}`,
      `autoDrop=${state.runtimeFlags.autoDropEnabled ? "on" : "off"}`,
      `pusherScale=${overrides.pusherSpeedScale.toFixed(2)}`,
      `coinScale=${overrides.coinValueScale.toFixed(2)}`,
      `rewardMult=${overrides.rewardMultiplier.toFixed(2)}`,
      `coinLv=${state.upgrades.coinValueLevel}`,
      `pusherLv=${state.upgrades.pusherLevel}`,
      `autoLv=${state.upgrades.autoDropLevel}`,
      `drops=${metrics.coinDrops}`,
      `rewards=${metrics.rewardAmount}`,
      `bonus=${state.bonus.triggerCount}`,
    ].join(" ");
  }

  private bootstrap(): void {
    this.configService = new ConfigService();
    this.debugOverrideStore = new DebugOverrideStore();
    this.runtimeStateStore = new RuntimeStateStore(
      createInitialRuntimePlayerState(
        this.configService.getConfig(),
        this.debugOverrideStore.resolveStartingCoinAmount(
          this.configService.getConfig().economy.startingCoinAmount,
        ),
      ),
    );
    this.debugMetrics = new DebugMetrics();
    this.debugMetrics.recordSessionStart();
    this.eventBus = new EventBus<GameEventPayloadMap>();
    this.sessionProgress = new SessionProgressService(this.runtimeStateStore);
    this.upgradeSystem = new UpgradeSystem(
      this.runtimeStateStore,
      this.sessionProgress,
      this.configService,
      this.debugMetrics,
    );
    this.debugCommands = new DebugCommands(
      this.configService,
      this.runtimeStateStore,
      this.sessionProgress,
      this.debugOverrideStore,
      this.eventBus,
    );

    this.runtimeStateStore.subscribe((state) => {
      this.eventBus.emit(GameEvents.STATE_CHANGED, { state });
    });
    this.debugOverrideStore.subscribe((overrides) => {
      this.eventBus.emit(GameEvents.DEBUG_OVERRIDE_CHANGED, { overrides });
    });
    this.bindDebugEvents();
    console.info("[GameDirector] Bootstrapped prototype services.");
  }

  private bindDebugEvents(): void {
    this.eventBus.on(GameEvents.DEBUG_FORCE_BONUS_REQUESTED, ({ bonusId }) => {
      this.triggerBonus(bonusId);
    });

    this.eventBus.on(GameEvents.DEBUG_RESET_SESSION_REQUESTED, () => {
      this.resetSession();
    });

    this.eventBus.on(GameEvents.DEBUG_SPAWN_ITEM_REQUESTED, ({ itemType, count }) => {
      const total = this.sessionProgress.addInventoryItem(itemType, count);
      console.info(`[DebugSpawn] itemType=${itemType} count=${count} inventory=${total}`);
    });

    this.eventBus.on(GameEvents.DEBUG_CLEAR_LOW_VALUE_DROPS_REQUESTED, () => {
      this.sessionProgress.clearInventoryItem("coin");
      console.info("[DebugSpawn] cleared low value coin drops.");
    });
  }
}
