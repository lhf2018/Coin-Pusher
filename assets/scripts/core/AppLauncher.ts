import { _decorator, Component } from "cc";
import { GameDirector } from "./GameDirector";
import { CoinDropController } from "../gameplay/drop/CoinDropController";
import { DebugPanel } from "../debug/DebugPanel";

const { ccclass } = _decorator;

@ccclass("AppLauncher")
export class AppLauncher extends Component {
  public onLoad(): void {
    if (!this.node.getComponent(GameDirector)) {
      this.node.addComponent(GameDirector);
    }

    if (!this.node.getComponent(DebugPanel)) {
      this.node.addComponent(DebugPanel);
    }

    if (!this.node.getComponent(CoinDropController)) {
      this.node.addComponent(CoinDropController);
    }

    console.info("[AppLauncher] Prototype bootstrap components attached.");
  }
}
