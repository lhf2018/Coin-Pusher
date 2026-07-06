export const GameEvents = {
  COIN_DROP_REQUESTED: "game:coinDropRequested",
  REWARD_RESOLVED: "game:rewardResolved",
  BONUS_TRIGGERED: "game:bonusTriggered",
  DEBUG_FORCE_BONUS_REQUESTED: "debug:forceBonusRequested",
  DEBUG_SPAWN_ITEM_REQUESTED: "debug:spawnItemRequested",
  DEBUG_CLEAR_LOW_VALUE_DROPS_REQUESTED: "debug:clearLowValueDropsRequested",
  DEBUG_RESET_SESSION_REQUESTED: "debug:resetSessionRequested",
  SESSION_RESET: "session:reset",
} as const;
