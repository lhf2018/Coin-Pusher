import { _decorator, Component, EventKeyboard, input, Input, KeyCode } from "cc";
import { GameDirector } from "../../core/GameDirector";

const { ccclass, property } = _decorator;

@ccclass("CoinDropController")
export class CoinDropController extends Component {
  @property
  public simulateRewardDelaySeconds = 0.25;

  @property
  public prototypeInstantSettlement = true;

  public onEnable(): void {
    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
  }

  public onDisable(): void {
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
  }

  private onKeyDown(event: EventKeyboard): void {
    if (event.keyCode !== KeyCode.SPACE) {
      return;
    }

    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    const accepted = director.requestCoinDrop();
    if (!accepted || !this.prototypeInstantSettlement) {
      return;
    }

    this.scheduleOnce(() => {
      director.resolvePrototypeReward();
    }, this.simulateRewardDelaySeconds);
  }
}
