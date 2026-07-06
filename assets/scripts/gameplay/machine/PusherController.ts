import { _decorator, Component, Vec3 } from "cc";
import { GameDirector } from "../../core/GameDirector";

const { ccclass, property } = _decorator;

@ccclass("PusherController")
export class PusherController extends Component {
  @property
  public travelDistance = 0.4;

  private readonly origin = new Vec3();
  private elapsed = 0;

  public start(): void {
    const currentPosition = this.node.position;
    this.origin.set(currentPosition.x, currentPosition.y, currentPosition.z);
  }

  public update(deltaTime: number): void {
    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    this.elapsed += deltaTime * director.overrides.resolveTimeScale(director.config.machine.timeScale);
    const speed = director.overrides.resolvePusherSpeed(director.config.machine.basePusherSpeed);
    const offset = Math.sin(this.elapsed * speed) * this.travelDistance;
    this.node.setPosition(this.origin.x, this.origin.y, this.origin.z + offset);
  }
}
