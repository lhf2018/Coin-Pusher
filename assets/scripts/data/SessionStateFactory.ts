import { AppConfig } from "../config/AppConfig";
import { RuntimePlayerState } from "./RuntimeState";

function createSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createInitialRuntimePlayerState(
  config: AppConfig,
  startingCoinAmount: number,
): RuntimePlayerState {
  return {
    sessionId: createSessionId(),
    startTime: Date.now(),
    wallet: {
      coin: Math.max(0, Math.round(startingCoinAmount)),
      diamond: config.economy.startingDiamondAmount,
      eventToken: config.economy.eventTokenAmount,
    },
    upgrades: {
      coinValueLevel: 0,
      rewardLevel: 0,
      autoDropLevel: 0,
      pusherLevel: 0,
    },
    inventory: {},
    skills: {
      owned: {},
      cooldownUntil: {},
    },
    collections: {
      unlockedItems: [],
      unlockedThemes: [],
      fragmentCount: {},
    },
    tasks: {
      session: {},
      achievement: {},
      claimed: [],
    },
    guide: {
      currentStep: "intro",
      completedSteps: [],
    },
    bonus: {
      currentCharge: 0,
      triggerCount: 0,
      activeBonusId: null,
    },
    runtimeFlags: {
      tutorialGuaranteedDropUsed: false,
      autoDropEnabled: false,
      currentPresetId: config.debug.defaultPresetId,
      debugPanelVisible: false,
      compactDebugBarVisible: false,
    },
    settings: {
      bgmVolume: 0.8,
      sfxVolume: 1,
      vibration: true,
    },
  };
}
