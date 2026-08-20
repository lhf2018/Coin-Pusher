import * as THREE from "three";
import type { PhysicsBody } from "./physics/RapierWorld";

export type DropItemType = "coin" | "chest" | "rare";
export type CoinFaceStyle = "copper" | "gold" | "prism";
export type BonusType = "coinRain" | "fever" | "chestDrop";
export type SlotType = "normal" | "bonus" | "chest" | "highValue";

export interface UpgradeState {
  coinValue: number;
  autoDrop: number;
  pusherSpeed: number;
}

export interface DebugOverrides {
  timeScale: number;
  pusherSpeedScale: number;
  dropRateScale: number;
  coinValueScale: number;
  rewardMultiplier: number;
  bonusChargeScale: number;
  startingCoins: number | null;
}

export interface DebugPreset {
  id: string;
  label: string;
  description: string;
  overrides: DebugOverrides;
}

export interface SessionTask {
  id: string;
  title: string;
  goal: number;
  progress: number;
  reward: number;
  claimed: boolean;
  metric: "drops" | "bonus" | "earnings";
}

export interface RuntimeState {
  coins: number;
  diamonds: number;
  fragments: number;
  bonusCharge: number;
  bonusThreshold: number;
  feverTimeLeft: number;
  activeBonus: BonusType | null;
  drops: number;
  totalEarnings: number;
  autoDropEnabled: boolean;
  upgrades: UpgradeState;
  debugVisible: boolean;
  currentPresetId: string;
  tasks: SessionTask[];
  messages: string[];
}

export interface DropItem {
  id: string;
  type: DropItemType;
  body: PhysicsBody;
  mesh: THREE.Object3D;
  baseReward: number;
  spawnTime: number;
  collected: boolean;
  /** When set, body pose is driven by the coin-tower lift instead of physics. */
  towerLift?: {
    x: number;
    z: number;
    startY: number;
    targetY: number;
  };
}

export interface ScheduledAction {
  id: string;
  fireAt: number;
  run: () => void;
}
