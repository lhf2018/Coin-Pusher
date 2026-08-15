import { _decorator, Component, EventKeyboard, input, Input, KeyCode } from "cc";
import { GameDirector } from "../core/GameDirector";

const { ccclass } = _decorator;

@ccclass("DebugPanel")
export class DebugPanel extends Component {
  public onEnable(): void {
    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
  }

  public onDisable(): void {
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
  }

  private onKeyDown(event: EventKeyboard): void {
    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    switch (event.keyCode) {
      case KeyCode.F1:
        this.togglePanel();
        break;
      case KeyCode.DIGIT_1:
        this.applyPreset("default");
        break;
      case KeyCode.DIGIT_2:
        this.applyPreset("fast_loop");
        break;
      case KeyCode.DIGIT_3:
        this.applyPreset("rich_mode");
        break;
      case KeyCode.DIGIT_4:
        this.applyPreset("bonus_test");
        break;
      case KeyCode.DIGIT_5:
        this.applyPreset("stress_physics");
        break;
      case KeyCode.KEY_G:
        director.debug.addCoin(100);
        this.logSnapshot("Added 100 coins.");
        break;
      case KeyCode.KEY_H:
        director.debug.addCoin(1000);
        this.logSnapshot("Added 1000 coins.");
        break;
      case KeyCode.KEY_J:
        this.adjustPusherSpeed(-0.25);
        break;
      case KeyCode.KEY_K:
        this.adjustPusherSpeed(0.25);
        break;
      case KeyCode.KEY_U:
        this.adjustCoinScale(-0.25);
        break;
      case KeyCode.KEY_I:
        this.adjustCoinScale(0.25);
        break;
      case KeyCode.KEY_B:
        director.debug.forceBonus("manual-debug");
        this.logSnapshot("Forced a bonus trigger.");
        break;
      case KeyCode.KEY_M:
        this.toggleAutoDrop();
        break;
      case KeyCode.KEY_C:
        this.purchaseUpgrade("coinValue", "Purchased coin value upgrade.");
        break;
      case KeyCode.KEY_P:
        this.purchaseUpgrade("pusher", "Purchased pusher upgrade.");
        break;
      case KeyCode.KEY_O:
        this.purchaseUpgrade("autoDrop", "Purchased auto-drop upgrade.");
        break;
      case KeyCode.KEY_L:
        director.debug.resetOverrides();
        this.logSnapshot("Reset debug overrides.");
        break;
      case KeyCode.KEY_R:
        director.debug.resetSession();
        this.logSnapshot("Session reset requested.");
        break;
      default:
        break;
    }
  }

  private togglePanel(): void {
    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    const nextVisible = !director.stateStore.getState().runtimeFlags.debugPanelVisible;
    director.progress.setDebugPanelVisible(nextVisible);
    console.info(nextVisible ? "[DebugPanel] Opened." : "[DebugPanel] Closed.");
    this.logSnapshot("Debug panel toggled.");
  }

  private applyPreset(presetId: string): void {
    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    if (!director.debug.applyPreset(presetId)) {
      console.warn(`[DebugPanel] Missing preset: ${presetId}`);
      return;
    }

    this.logSnapshot(`Applied preset: ${presetId}`);
  }

  private adjustPusherSpeed(delta: number): void {
    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    const nextValue = director.overrides.getState().pusherSpeedScale + delta;
    director.debug.setPusherSpeedScale(nextValue);
    this.logSnapshot(`Adjusted pusher speed scale to ${nextValue.toFixed(2)}.`);
  }

  private adjustCoinScale(delta: number): void {
    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    const nextValue = director.overrides.getState().coinValueScale + delta;
    director.debug.setCoinValueScale(nextValue);
    this.logSnapshot(`Adjusted coin value scale to ${nextValue.toFixed(2)}.`);
  }

  private toggleAutoDrop(): void {
    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    const enabled = director.toggleAutoDrop();
    this.logSnapshot(enabled ? "Enabled auto-drop." : "Disabled auto-drop.");
  }

  private purchaseUpgrade(
    kind: "coinValue" | "pusher" | "autoDrop",
    successMessage: string,
  ): void {
    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    if (!director.purchaseUpgrade(kind)) {
      this.logSnapshot(`Upgrade failed: ${kind}.`);
      return;
    }

    this.logSnapshot(successMessage);
  }

  private logSnapshot(prefix: string): void {
    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    console.info(`[DebugPanel] ${prefix} ${director.getDebugSummary()}`);
  }
}
