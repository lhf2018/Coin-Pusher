import { _decorator, Component, EventKeyboard, input, Input, KeyCode } from "cc";
import { GameDirector } from "../../core/GameDirector";
import { GameEvents } from "../../core/GameEvents";

const { ccclass, property } = _decorator;

@ccclass("CoinDropController")
export class CoinDropController extends Component {
  @property
  public simulateRewardDelaySeconds = 0.25;

  @property
  public prototypeInstantSettlement = true;

  @property
  public autoDropOnStart = false;

  private autoDropElapsedMs = 0;
  private settlementGeneration = 0;
  private removeDropRequestedListener: (() => void) | null = null;
  private removeSessionResetListener: (() => void) | null = null;

  public onLoad(): void {
    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    this.removeDropRequestedListener = director.bus.on(
      GameEvents.COIN_DROP_REQUESTED,
      ({ dropCount }) => {
        if (!this.prototypeInstantSettlement) {
          return;
        }

        for (let index = 0; index < dropCount; index += 1) {
          this.scheduleRewardSettlement();
        }
      },
    );
    this.removeSessionResetListener = director.bus.on(GameEvents.SESSION_RESET, () => {
      this.autoDropElapsedMs = 0;
      this.invalidateScheduledSettlements();
    });
  }

  public start(): void {
    if (!this.autoDropOnStart) {
      return;
    }

    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    director.setAutoDropEnabled(true);
  }

  public onEnable(): void {
    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
  }

  public onDisable(): void {
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    this.invalidateScheduledSettlements();
  }

  public onDestroy(): void {
    this.removeDropRequestedListener?.();
    this.removeSessionResetListener?.();
    this.removeDropRequestedListener = null;
    this.removeSessionResetListener = null;
  }

  public update(deltaTime: number): void {
    const director = GameDirector.instance;
    if (!director || !director.stateStore.getState().runtimeFlags.autoDropEnabled) {
      this.autoDropElapsedMs = 0;
      return;
    }

    this.autoDropElapsedMs += deltaTime * 1000;
    const intervalMs = director.getResolvedAutoDropIntervalMs();

    while (this.autoDropElapsedMs >= intervalMs) {
      this.autoDropElapsedMs -= intervalMs;
      if (!director.requestCoinDrop()) {
        director.setAutoDropEnabled(false);
        this.autoDropElapsedMs = 0;
        return;
      }
    }
  }

  private onKeyDown(event: EventKeyboard): void {
    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    switch (event.keyCode) {
      case KeyCode.SPACE:
        director.requestCoinDrop();
        break;
      case KeyCode.KEY_M:
        director.toggleAutoDrop();
        break;
      default:
        break;
    }
  }

  private scheduleRewardSettlement(): void {
    const generation = this.settlementGeneration;
    this.scheduleOnce(() => {
      const director = GameDirector.instance;
      if (!director || generation !== this.settlementGeneration) {
        return;
      }

      director.resolvePrototypeReward();
    }, this.simulateRewardDelaySeconds);
  }

  private invalidateScheduledSettlements(): void {
    this.settlementGeneration += 1;
    this.unscheduleAllCallbacks();
  }
}
