import { RuntimePlayerState } from "../data/RuntimeState";
import { DebugOverrideState } from "../debug/DebugPresets";

export const GameEvents = {
  COIN_DROP_REQUESTED: "game:coinDropRequested",
  REWARD_RESOLVED: "game:rewardResolved",
  BONUS_TRIGGERED: "game:bonusTriggered",
  AUTO_DROP_TOGGLED: "game:autoDropToggled",
  UPGRADE_PURCHASED: "game:upgradePurchased",
  STATE_CHANGED: "game:stateChanged",
  DEBUG_OVERRIDE_CHANGED: "debug:overrideChanged",
  DEBUG_FORCE_BONUS_REQUESTED: "debug:forceBonusRequested",
  DEBUG_SPAWN_ITEM_REQUESTED: "debug:spawnItemRequested",
  DEBUG_CLEAR_LOW_VALUE_DROPS_REQUESTED: "debug:clearLowValueDropsRequested",
  DEBUG_RESET_SESSION_REQUESTED: "debug:resetSessionRequested",
  SESSION_RESET: "session:reset",
} as const;

export type UpgradeKind = "coinValue" | "pusher" | "autoDrop";

export interface GameEventPayloadMap {
  [GameEvents.COIN_DROP_REQUESTED]: {
    dropCount: number;
    totalCost: number;
  };
  [GameEvents.REWARD_RESOLVED]: {
    reward: number;
  };
  [GameEvents.BONUS_TRIGGERED]: {
    bonusId: string;
  };
  [GameEvents.AUTO_DROP_TOGGLED]: {
    enabled: boolean;
  };
  [GameEvents.UPGRADE_PURCHASED]: {
    kind: UpgradeKind;
    level: number;
    cost: number;
  };
  [GameEvents.STATE_CHANGED]: {
    state: Readonly<RuntimePlayerState>;
  };
  [GameEvents.DEBUG_OVERRIDE_CHANGED]: {
    overrides: Readonly<DebugOverrideState>;
  };
  [GameEvents.DEBUG_FORCE_BONUS_REQUESTED]: {
    bonusId: string;
  };
  [GameEvents.DEBUG_SPAWN_ITEM_REQUESTED]: {
    itemType: string;
    count: number;
  };
  [GameEvents.DEBUG_CLEAR_LOW_VALUE_DROPS_REQUESTED]: Record<string, never>;
  [GameEvents.DEBUG_RESET_SESSION_REQUESTED]: {
    presetId: string;
  };
  [GameEvents.SESSION_RESET]: {
    sessionId: string;
  };
}
