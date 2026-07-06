export interface WalletState {
  coin: number;
  diamond: number;
  eventToken: number;
}

export interface UpgradeState {
  coinValueLevel: number;
  rewardLevel: number;
  autoDropLevel: number;
  pusherLevel: number;
}

export interface SkillState {
  owned: Record<string, number>;
  cooldownUntil: Record<string, number>;
}

export interface CollectionState {
  unlockedItems: string[];
  unlockedThemes: string[];
  fragmentCount: Record<string, number>;
}

export interface TaskState {
  session: Record<string, number>;
  achievement: Record<string, number>;
  claimed: string[];
}

export interface GuideState {
  currentStep: string;
  completedSteps: string[];
}

export interface BonusState {
  currentCharge: number;
  triggerCount: number;
  activeBonusId: string | null;
}

export interface RuntimeFlags {
  tutorialGuaranteedDropUsed: boolean;
  autoDropEnabled: boolean;
  currentPresetId: string;
  debugPanelVisible: boolean;
  compactDebugBarVisible: boolean;
}

export interface SettingsState {
  bgmVolume: number;
  sfxVolume: number;
  vibration: boolean;
}

export interface RuntimePlayerState {
  sessionId: string;
  startTime: number;
  wallet: WalletState;
  upgrades: UpgradeState;
  inventory: Record<string, number>;
  skills: SkillState;
  collections: CollectionState;
  tasks: TaskState;
  guide: GuideState;
  bonus: BonusState;
  runtimeFlags: RuntimeFlags;
  settings: SettingsState;
}
