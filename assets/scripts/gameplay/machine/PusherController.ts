import { _decorator, Component, Vec3 } from "cc";
import { GameDirector } from "../../core/GameDirector";

const { ccclass, property } = _decorator;

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function lerp(start: number, end: number, value: number): number {
  return start + (end - start) * value;
}

@ccclass("PusherController")
export class PusherController extends Component {
  @property
  public travelDistanceOverride = 0;

  private readonly origin = new Vec3();
  private phaseTime = 0;

  public start(): void {
    const currentPosition = this.node.position;
    this.origin.set(currentPosition.x, currentPosition.y, currentPosition.z);
  }

  public update(deltaTime: number): void {
    const director = GameDirector.instance;
    if (!director) {
      return;
    }

    const config = director.config.machine;
    const travelDistance =
      this.travelDistanceOverride > 0 ? this.travelDistanceOverride : config.travelDistance;
    const forwardDuration = travelDistance / Math.max(0.01, director.getResolvedPusherSpeed());
    const holdDuration = config.holdDurationSeconds;
    const returnDuration = travelDistance / Math.max(0.01, director.getResolvedReturnSpeed());
    const cycleDuration = Math.max(0.01, forwardDuration + holdDuration + returnDuration);

    this.phaseTime =
      (this.phaseTime + deltaTime * director.overrides.resolveTimeScale(config.timeScale)) %
      cycleDuration;

    let zOffset = 0;
    let yOffset = 0;

    if (this.phaseTime < forwardDuration) {
      const progress = easeOutCubic(this.phaseTime / Math.max(0.01, forwardDuration));
      zOffset = travelDistance * progress;
    } else if (this.phaseTime < forwardDuration + holdDuration) {
      zOffset = travelDistance;
    } else {
      const progress =
        (this.phaseTime - forwardDuration - holdDuration) / Math.max(0.01, returnDuration);
      zOffset = lerp(travelDistance, 0, progress);
      yOffset = Math.sin(progress * Math.PI) * config.returnLiftOffset;
    }

    this.node.setPosition(this.origin.x, this.origin.y + yOffset, this.origin.z + zOffset);
  }
}
