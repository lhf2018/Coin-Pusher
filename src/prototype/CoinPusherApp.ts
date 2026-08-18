import * as THREE from "three";
import {
  BASE_CONFIG,
  DEBUG_LIMITS,
  DEBUG_PRESETS,
  DEFAULT_DEBUG_OVERRIDES,
  TABLE,
  createDefaultTasks,
  createInitialState,
} from "./config";
import { createUI, UIRefs } from "./ui";
import {
  BonusType,
  DebugOverrides,
  DropItem,
  DropItemType,
  RuntimeState,
  ScheduledAction,
  SessionTask,
  SlotType,
} from "./types";
import type {
  TaichiAssistResult,
  TaichiAssistSnapshotItem,
  TaichiHybridPhysics,
} from "./TaichiHybridPhysics";
import { PhysicsBody, RapierPhysicsWorld, Vec3 } from "./physics/RapierWorld";

const BONUS_ROTATION: BonusType[] = ["coinRain", "fever", "chestDrop"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatShort(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return `${Math.round(value)}`;
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function lerpNumber(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export class CoinPusherApp {
  private readonly ui: UIRefs;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(56, 1, 0.1, 120);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private readonly physics = new RapierPhysicsWorld();
  private readonly clock = new THREE.Clock();

  private state: RuntimeState = createInitialState();
  private debugOverrides: DebugOverrides = { ...DEFAULT_DEBUG_OVERRIDES };
  private readonly items: DropItem[] = [];
  private readonly cleanupBodies: PhysicsBody[] = [];
  private readonly scheduledActions: ScheduledAction[] = [];
  private readonly playfieldWidth = TABLE.width - 0.9;
  /** Single flat playfield floor under the pusher. */
  private readonly floorThickness = 0.22;
  private readonly floorY = 0.2;
  private readonly floorBackZ = -3.72;
  private readonly floorFrontZ = 4.28;
  private readonly floorDepth = this.floorFrontZ - this.floorBackZ;
  private readonly floorCenterZ = (this.floorBackZ + this.floorFrontZ) / 2;
  /**
   * Side layout (no orphan strip):
   * walls cover [back → exit line], narrow ramp opening covers [exit line → front].
   */
  private readonly sideRampOpeningWidth = 1.65;
  private readonly sideRampEndZ = this.floorFrontZ + 0.02;
  private readonly sideExitLineZ = this.sideRampEndZ - this.sideRampOpeningWidth;
  private readonly sideWallFrontZ = this.sideExitLineZ;
  /** Tiny tuck so the ramp top meets the floor without a visible gap. */
  private readonly sideWingCut = 0.06;
  private readonly sideRampOutward = 1.85;
  private readonly sideRampAngle = 0.36;
  private readonly sideWallThickness = 0.34;
  private readonly payoutGapZ = 4.5;
  private readonly collectionCenterZ = 5.1;
  private readonly collectionDepth = 1.5;
  private readonly collectionFloorY = -0.24;
  private readonly slotSplitX = 1.55;
  private readonly pusherApertureClearance = 0.02;
  private readonly pusherWidth = this.playfieldWidth - this.pusherApertureClearance * 2;
  private readonly pusherDepth = 3.72;
  private readonly pusherBodyHalfHeight = 0.28;
  private readonly pusherHoverGap = 0.01;
  private readonly pusherFaceThickness = 0.28;
  private readonly pusherRemainInside = 0.4;
  private readonly pusherTravel = 1.15;
  private readonly pusherApertureZ = this.floorBackZ + 0.42;
  private readonly pusherEndZ =
    this.pusherApertureZ -
    this.pusherFaceThickness / 2 -
    this.pusherRemainInside +
    this.pusherDepth / 2;
  private readonly pusherStartZ = this.pusherEndZ - this.pusherTravel;
  private autoDropElapsedMs = 0;
  private pusherTime = 0;
  private lastFpsSampleTime = performance.now();
  private lastFrameCount = 0;
  private frameCount = 0;
  private nextBonusIndex = 0;
  private displayedCoins = this.state.coins;
  private displayedDiamonds = this.state.diamonds;
  private displayedFragments = this.state.fragments;
  private displayedBonusCharge = this.state.bonusCharge;
  private lastCoins = this.state.coins;
  private lastDiamonds = this.state.diamonds;
  private lastFragments = this.state.fragments;

  private pusherMesh!: THREE.Group;
  private pusherBody!: PhysicsBody;
  private debugPanelBuilt = false;
  private physicsReady = false;
  private physicsBackend: "rapier" | "taichi-hybrid" | "probing" | "failed" = "probing";
  private taichiPhysics: TaichiHybridPhysics | null = null;
  private taichiPhysicsInitStarted = false;
  private taichiAdapterAvailable: boolean | null = null;
  private taichiPendingComputation: Promise<void> | null = null;
  private taichiPendingResult: TaichiAssistResult | null = null;
  private lastViewportWidth = 0;
  private lastViewportHeight = 0;
  private lastFrameAtMs = 0;
  private frameInProgress = false;

  public constructor(root: HTMLDivElement) {
    this.ui = createUI(root);
    this.configureRenderer();
    this.configureScene();
    this.buildDebugPresetBar();
    this.bindControls();
    this.buildDebugPanel();
    this.applyPreset("default", true);
    this.state.debugVisible = false;
    const debugGlobal = globalThis as typeof globalThis & {
      __coinPusherApp?: CoinPusherApp;
      __coinPusherDebugState?: () => Record<string, unknown>;
    };
    debugGlobal.__coinPusherApp = this;
    debugGlobal.__coinPusherDebugState = () => this.getDebugState();
    if (typeof window !== "undefined") {
      const debugWindow = window as Window &
        typeof globalThis & {
          __coinPusherApp?: CoinPusherApp;
          __coinPusherDebugState?: () => Record<string, unknown>;
        };
      debugWindow.__coinPusherApp = this;
      debugWindow.__coinPusherDebugState = () => this.getDebugState();
    }
    this.renderState();
  }

  public start(): void {
    requestAnimationFrame(this.loop);
    void this.bootstrapPhysics();
  }

  private async bootstrapPhysics(): Promise<void> {
    this.physicsBackend = "probing";
    this.renderState();

    try {
      await this.physics.init();
      this.physicsReady = true;
      this.createTable();
      this.createPusher();
      this.createPusherTunnel();
      this.createDecor();
      this.seedBoard();
      this.physicsBackend = "rapier";
      this.pushMessage("Rapier 物理已启用。");
      this.renderState();
    } catch (error) {
      console.error("Failed to initialize Rapier physics.", error);
      this.physicsBackend = "failed";
      this.physicsReady = false;
      this.pushMessage("Rapier 启动失败，物理模拟未启用。");
      this.renderState();
      return;
    }

    // Only probe Taichi when explicitly requested — WebGPU init can hitch/freeze the tab.
    if (this.getRequestedPhysicsMode() === "taichi") {
      void this.initializeExperimentalPhysics();
    }
    this.scheduleAction(300, () => {
      this.pushMessage("机台准备完成。按 Space 或点击投币开始。");
    });
  }

  private getRequestedPhysicsMode(): "taichi" | "rapier" | "cannon" {
    if (typeof window === "undefined") {
      return "rapier";
    }

    const params = new URLSearchParams(window.location.search);
    const requested = params.get("physics");
    if (requested === "taichi") {
      return "taichi";
    }
    if (requested === "cannon") {
      return "cannon";
    }
    return "rapier";
  }

  private async hasUsableWebGpuAdapter(): Promise<boolean> {
    if (typeof navigator === "undefined" || !("gpu" in navigator)) {
      this.taichiAdapterAvailable = false;
      return false;
    }

    try {
      const gpuNavigator = navigator as Navigator & {
        gpu: {
          requestAdapter: () => Promise<object | null>;
        };
      };
      const adapter = await gpuNavigator.gpu.requestAdapter();
      this.taichiAdapterAvailable = adapter !== null;
      return adapter !== null;
    } catch (error) {
      console.warn("WebGPU adapter probe failed.", error);
      this.taichiAdapterAvailable = false;
      return false;
    }
  }

  private async initializeExperimentalPhysics(): Promise<void> {
    if (this.taichiPhysicsInitStarted) {
      return;
    }

    const requestedMode = this.getRequestedPhysicsMode();
    if (requestedMode !== "taichi") {
      this.taichiAdapterAvailable = false;
      return;
    }

    if (!(await this.hasUsableWebGpuAdapter())) {
      if (requestedMode === "taichi") {
        this.pushMessage("WebGPU 不可用，已保持纯 Rapier 物理。");
        this.renderState();
      }
      return;
    }

    this.taichiPhysicsInitStarted = true;
    try {
      const module = await import("./TaichiHybridPhysics");
      const physics = new module.TaichiHybridPhysics(128);
      await physics.init();
      this.taichiPhysics = physics;
      this.physicsBackend = "taichi-hybrid";
      this.pushMessage("Rapier 已启用，并叠加 Taichi 辅助求解。");
      this.renderState();
    } catch (error) {
      console.error("Failed to initialize Taichi hybrid physics.", error);
      this.physicsBackend = "rapier";
      this.pushMessage("Taichi 启动失败，已回退到纯 Rapier 物理。");
      this.renderState();
    }
  }

  private configureRenderer(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.ui.viewport.append(this.renderer.domElement);

    this.camera.position.set(0, 5.95, 11.9);
    this.camera.lookAt(0, 0.18, 2.85);

    this.handleResize();
    window.addEventListener("resize", this.handleResize);
    requestAnimationFrame(() => {
      this.handleResize();
      requestAnimationFrame(this.handleResize);
    });

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => this.handleResize());
      observer.observe(this.ui.viewport);
    }
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color("#204762");
    this.scene.fog = new THREE.Fog("#204762", 22, 36);

    const hemi = new THREE.HemisphereLight("#b1e0ff", "#082238", 1.12);
    this.scene.add(hemi);

    const key = new THREE.SpotLight("#ffd59b", 154, 38, 0.34, 0.55, 1);
    key.position.set(-3.4, 11.5, 8.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 4;
    key.shadow.bias = -0.00008;
    key.shadow.normalBias = 0.02;
    key.target.position.set(0, 0.42, 1.55);
    this.scene.add(key, key.target);

    const sideKey = new THREE.SpotLight("#7fd2ff", 68, 28, 0.5, 0.7, 2);
    sideKey.position.set(5.8, 5.6, 4.6);
    sideKey.target.position.set(0, 0.34, 1.95);
    this.scene.add(sideKey, sideKey.target);

    const rim = new THREE.PointLight("#42d7ff", 22, 22, 2);
    rim.position.set(-4.6, 3.2, -0.3);
    this.scene.add(rim);

    const frontFill = new THREE.PointLight("#9cc8ff", 54, 24, 2);
    frontFill.position.set(0, 1.6, 7.8);
    this.scene.add(frontFill);

    const payoutGlow = new THREE.PointLight("#57d6ff", 12, 8, 2.2);
    payoutGlow.position.set(0, -0.18, this.collectionCenterZ + 0.22);
    this.scene.add(payoutGlow);

    const payoutWarm = new THREE.PointLight("#ffd49a", 8, 6.5, 2.2);
    payoutWarm.position.set(0, -0.12, this.collectionCenterZ - 0.02);
    this.scene.add(payoutWarm);
  }

  private createTable(): void {
    // Keep the shell below the side-exit ramps so they don't pierce the cabinet.
    const cabinet = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE.width + 0.9, 2.2, TABLE.depth + 1.1),
      new THREE.MeshStandardMaterial({
        color: "#0b1826",
        metalness: 0.44,
        roughness: 0.62,
      }),
    );
    cabinet.position.set(0, -1.72, 0.34);
    cabinet.castShadow = true;
    cabinet.receiveShadow = true;
    this.scene.add(cabinet);

    // Trim follows the playfield footprint and stops at the exit line on the sides,
    // leaving open air for the ramps.
    const rearTrimDepth = this.sideExitLineZ - this.floorBackZ + 0.35;
    const rearTrimCenterZ = (this.floorBackZ - 0.12 + this.sideExitLineZ) / 2;
    const rearTrim = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE.width + 0.22, 0.2, rearTrimDepth),
      new THREE.MeshStandardMaterial({
        color: "#173349",
        metalness: 0.82,
        roughness: 0.2,
      }),
    );
    rearTrim.position.set(0, -0.04, rearTrimCenterZ);
    rearTrim.receiveShadow = true;
    this.scene.add(rearTrim);

    const frontTrimWidth = this.playfieldWidth - this.sideWingCut * 2 + 0.2;
    const frontTrimDepth = this.floorFrontZ - this.sideExitLineZ + 0.45;
    const frontTrimCenterZ = (this.sideExitLineZ + this.floorFrontZ) / 2 + 0.08;
    const frontTrim = new THREE.Mesh(
      new THREE.BoxGeometry(frontTrimWidth, 0.2, frontTrimDepth),
      new THREE.MeshStandardMaterial({
        color: "#173349",
        metalness: 0.82,
        roughness: 0.2,
      }),
    );
    frontTrim.position.set(0, -0.04, frontTrimCenterZ);
    frontTrim.receiveShadow = true;
    this.scene.add(frontTrim);

    const floorMaterial = new THREE.MeshStandardMaterial({
      color: "#1d455f",
      emissive: "#102c3e",
      metalness: 0.68,
      roughness: 0.28,
    });

    // Rear playfield stays full width up to the shared exit line.
    const rearFloorDepth = this.sideExitLineZ - this.floorBackZ;
    const rearFloorCenterZ = (this.floorBackZ + this.sideExitLineZ) / 2;
    const frontFloorWidth = this.playfieldWidth - this.sideWingCut * 2;
    const frontFloorDepth = this.floorFrontZ - this.sideExitLineZ;
    const frontFloorCenterZ = (this.sideExitLineZ + this.floorFrontZ) / 2;

    const rearFloor = new THREE.Mesh(
      new THREE.BoxGeometry(this.playfieldWidth, this.floorThickness, rearFloorDepth),
      floorMaterial,
    );
    rearFloor.position.set(0, this.floorY, rearFloorCenterZ);
    rearFloor.castShadow = true;
    rearFloor.receiveShadow = true;
    this.scene.add(rearFloor);
    this.addStaticBody(
      vec3(this.playfieldWidth / 2, this.floorThickness / 2, rearFloorDepth / 2),
      vec3(0, this.floorY, rearFloorCenterZ),
    );

    const frontFloor = new THREE.Mesh(
      new THREE.BoxGeometry(frontFloorWidth, this.floorThickness, frontFloorDepth),
      floorMaterial,
    );
    frontFloor.position.set(0, this.floorY, frontFloorCenterZ);
    frontFloor.castShadow = true;
    frontFloor.receiveShadow = true;
    this.scene.add(frontFloor);
    this.addStaticBody(
      vec3(frontFloorWidth / 2, this.floorThickness / 2, frontFloorDepth / 2),
      vec3(0, this.floorY, frontFloorCenterZ),
    );

    const railMaterial = new THREE.MeshPhysicalMaterial({
      color: "#2a4a61",
      emissive: "#102433",
      metalness: 0.58,
      roughness: 0.36,
      clearcoat: 0.18,
      clearcoatRoughness: 0.35,
    });
    const sideTrimMaterial = new THREE.MeshPhysicalMaterial({
      color: "#9eb8c9",
      emissive: "#2a4050",
      metalness: 0.82,
      roughness: 0.22,
      clearcoat: 0.3,
      clearcoatRoughness: 0.18,
    });

    const sideWallBackZ = this.floorBackZ - 0.18;
    const sideWallDepth = this.sideExitLineZ - sideWallBackZ;
    const sideWallCenterZ = (sideWallBackZ + this.sideExitLineZ) / 2;
    const sideWallBaseY = this.getFloorSurfaceY();
    const sideWallInnerX = this.playfieldWidth / 2 + 0.02;
    for (const direction of [-1, 1] as const) {
      const sideWallCenterX = direction * (sideWallInnerX + this.sideWallThickness / 2);
      const sideWall = new THREE.Mesh(
        new THREE.BoxGeometry(this.sideWallThickness, 1.28, sideWallDepth),
        railMaterial,
      );
      sideWall.position.set(sideWallCenterX, sideWallBaseY + 0.52, sideWallCenterZ);
      sideWall.castShadow = true;
      sideWall.receiveShadow = true;
      this.scene.add(sideWall);

      this.addStaticBody(
        vec3(this.sideWallThickness / 2, 0.64, sideWallDepth / 2),
        vec3(sideWallCenterX, sideWallBaseY + 0.52, sideWallCenterZ),
      );

      const sideTrim = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 1.18, sideWallDepth),
        sideTrimMaterial,
      );
      sideTrim.position.set(
        direction * (sideWallInnerX + 0.01),
        sideWallBaseY + 0.5,
        sideWallCenterZ,
      );
      sideTrim.castShadow = true;
      sideTrim.receiveShadow = true;
      this.scene.add(sideTrim);
    }

    // Side ramps begin on the wall-end line; top edge tucked under the floor for a seamless join.
    const rampDepth = this.sideRampEndZ - this.sideExitLineZ;
    const rampCenterZ = (this.sideExitLineZ + this.sideRampEndZ) / 2;
    const floorSurfaceY = this.getFloorSurfaceY();
    const rampThickness = this.floorThickness;
    const angle = this.sideRampAngle;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const cabinetClearanceY = -0.52;
    const maxDrop = Math.max(0.2, floorSurfaceY - cabinetClearanceY);
    const safeOutward = Math.min(this.sideRampOutward, maxDrop / Math.max(0.2, sinA));
    const rampOverlap = 0.16;
    const rampHingeX = this.playfieldWidth / 2;
    const rampMaterial = floorMaterial.clone();
    rampMaterial.emissive = new THREE.Color("#123040");
    for (const direction of [-1, 1] as const) {
      const halfW = safeOutward / 2;
      const halfT = rampThickness / 2;
      // Tuck under the deck edge so the top surfaces meet without a gap.
      const edgeX = direction * (rampHingeX - rampOverlap);
      const centerX = edgeX + direction * (halfW * cosA - halfT * sinA);
      const centerY = floorSurfaceY - halfW * sinA - halfT * cosA;

      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(safeOutward, rampThickness, rampDepth),
        rampMaterial,
      );
      ramp.position.set(centerX, centerY, rampCenterZ);
      ramp.rotation.z = -direction * angle;
      ramp.castShadow = true;
      ramp.receiveShadow = true;
      this.scene.add(ramp);

      this.addStaticBody(
        vec3(halfW, halfT, rampDepth / 2),
        vec3(centerX, centerY, rampCenterZ),
        0,
        -direction * angle,
      );
    }

    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(this.playfieldWidth + 0.55, 3.8, 0.28),
      new THREE.MeshStandardMaterial({
        color: "#0f2538",
        emissive: "#0a1622",
        metalness: 0.34,
        roughness: 0.72,
      }),
    );
    backWall.position.set(0, 1.74, this.floorBackZ - 0.58);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    this.scene.add(backWall);
    this.addStaticBody(
      vec3((this.playfieldWidth + 0.55) / 2, 1.8, 0.14),
      vec3(0, 1.74, this.floorBackZ - 0.58),
    );

    const deckFrontY = this.getFloorSurfaceY();
    const cliffEdge = new THREE.Mesh(
      new THREE.BoxGeometry(frontFloorWidth - 0.08, 0.12, 0.18),
      new THREE.MeshPhysicalMaterial({
        color: "#c5d7e4",
        emissive: "#2f4a5d",
        metalness: 0.78,
        roughness: 0.22,
        clearcoat: 0.28,
        clearcoatRoughness: 0.2,
      }),
    );
    cliffEdge.position.set(0, deckFrontY - 0.02, this.floorFrontZ + 0.04);
    cliffEdge.castShadow = true;
    cliffEdge.receiveShadow = true;
    this.scene.add(cliffEdge);

    const cliffShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(frontFloorWidth - 0.12, 0.42),
      new THREE.MeshBasicMaterial({
        color: "#02060c",
        transparent: true,
        opacity: 0.72,
      }),
    );
    cliffShadow.position.set(0, deckFrontY - 0.18, this.floorFrontZ + 0.28);
    cliffShadow.rotation.x = -Math.PI / 2;
    this.scene.add(cliffShadow);

    const collectionWallMaterial = new THREE.MeshStandardMaterial({
      color: "#6f93ab",
      emissive: "#1d3648",
      metalness: 0.72,
      roughness: 0.28,
    });
    const collectionPitCenterZ = this.getCollectionPitCenterZ();
    const collectionPitDepth = this.getCollectionPitDepth();
    const collectionPitFloorY = this.getCollectionPitFloorY();

    const collectionFloor = new THREE.Mesh(
      new THREE.BoxGeometry(this.playfieldWidth - 0.18, 0.08, collectionPitDepth + 0.08),
      new THREE.MeshStandardMaterial({
        color: "#050b12",
        emissive: "#020508",
        metalness: 0.08,
        roughness: 0.96,
      }),
    );
    collectionFloor.position.set(0, collectionPitFloorY, collectionPitCenterZ + 0.04);
    collectionFloor.rotation.x = 0.04;
    collectionFloor.receiveShadow = true;
    this.scene.add(collectionFloor);
    this.addStaticBody(
      vec3((this.playfieldWidth - 0.18) / 2, 0.04, (collectionPitDepth + 0.08) / 2),
      vec3(0, collectionPitFloorY, collectionPitCenterZ + 0.04),
      0.04,
    );
    const dividerDepth = collectionPitDepth + 0.08;
    const collectionWalls = [
      { size: [0.16, 0.98, dividerDepth], position: [-(this.playfieldWidth / 2) + 0.08, collectionPitFloorY + 0.43, collectionPitCenterZ + 0.02] },
      { size: [0.16, 0.98, dividerDepth], position: [(this.playfieldWidth / 2) - 0.08, collectionPitFloorY + 0.43, collectionPitCenterZ + 0.02] },
      { size: [0.14, 0.92, dividerDepth - 0.08], position: [-this.slotSplitX, collectionPitFloorY + 0.39, collectionPitCenterZ + 0.04] },
      { size: [0.14, 0.92, dividerDepth - 0.08], position: [this.slotSplitX, collectionPitFloorY + 0.39, collectionPitCenterZ + 0.04] },
    ] as const;

    for (const wall of collectionWalls) {
      const [sx, sy, sz] = wall.size;
      const [px, py, pz] = wall.position;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), collectionWallMaterial);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.addStaticBody(
        vec3(sx / 2, sy / 2, sz / 2),
        vec3(px, py, pz),
      );
    }

    const collectionBackKick = new THREE.Mesh(
      new THREE.BoxGeometry(this.playfieldWidth - 0.16, 0.42, 0.14),
      new THREE.MeshStandardMaterial({
        color: "#152838",
        emissive: "#0a1520",
        metalness: 0.34,
        roughness: 0.7,
      }),
    );
    collectionBackKick.position.set(0, collectionPitFloorY + 0.2, collectionPitCenterZ - collectionPitDepth / 2 - 0.05);
    collectionBackKick.castShadow = true;
    collectionBackKick.receiveShadow = true;
    this.scene.add(collectionBackKick);
    this.addStaticBody(
      vec3((this.playfieldWidth - 0.16) / 2, 0.21, 0.07),
      vec3(0, collectionPitFloorY + 0.2, collectionPitCenterZ - collectionPitDepth / 2 - 0.05),
    );

    const collectionFrontLip = new THREE.Mesh(
      new THREE.BoxGeometry(this.playfieldWidth - 0.16, 0.36, 0.18),
      collectionWallMaterial,
    );
    collectionFrontLip.position.set(0, collectionPitFloorY + 0.16, collectionPitCenterZ + collectionPitDepth / 2 + 0.1);
    collectionFrontLip.castShadow = true;
    collectionFrontLip.receiveShadow = true;
    this.scene.add(collectionFrontLip);
    this.addStaticBody(
      vec3((this.playfieldWidth - 0.16) / 2, 0.18, 0.09),
      vec3(0, collectionPitFloorY + 0.16, collectionPitCenterZ + collectionPitDepth / 2 + 0.1),
    );

    this.createSlotFrame(-3.05, 2.82, "宝箱区", "#ffbe5a");
    this.createSlotFrame(0, 3.04, "Bonus", "#54f3ff");
    this.createSlotFrame(3.05, 2.82, "高价值", "#ff6f4d");
  }

  private createPusher(): void {
    this.pusherMesh = new THREE.Group();

    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(this.pusherWidth, this.pusherBodyHalfHeight * 2, this.pusherDepth),
      new THREE.MeshPhysicalMaterial({
        color: "#d7e1e8",
        emissive: "#405e72",
        metalness: 0.76,
        roughness: 0.18,
        clearcoat: 0.2,
        clearcoatRoughness: 0.16,
      }),
    );
    platform.castShadow = true;
    platform.receiveShadow = true;
    this.pusherMesh.add(platform);

    this.pusherMesh.position.set(
      0,
      this.getPusherBaseY() + this.pusherBodyHalfHeight,
      this.pusherStartZ,
    );
    this.scene.add(this.pusherMesh);

    this.pusherBody = this.physics.createKinematicBody(
      vec3(
        0,
        this.getPusherBaseY() + this.pusherBodyHalfHeight,
        this.pusherStartZ,
      ),
      0,
      [
        {
          halfExtents: vec3(this.pusherWidth / 2, this.pusherBodyHalfHeight, this.pusherDepth / 2),
          friction: 0.62,
        },
      ],
    );
  }

  private createPusherTunnel(): void {
    const clearance = this.pusherApertureClearance;
    const physicsClearance = clearance + 0.018;
    const pusherHeight = this.pusherBodyHalfHeight * 2;
    const holeWidth = this.pusherWidth + clearance * 2;
    const holeHeight = pusherHeight + clearance * 2;
    const physicsHoleWidth = this.pusherWidth + physicsClearance * 2;
    const physicsHoleHeight = pusherHeight + physicsClearance * 2;
    const faceThickness = this.pusherFaceThickness;
    const apertureZ = this.pusherApertureZ;
    const apertureInnerZ = apertureZ - faceThickness / 2;
    const startRearZ = this.pusherStartZ - this.pusherDepth / 2;
    const tunnelDepth = Math.max(1.2, apertureInnerZ - startRearZ + 0.35);
    const tunnelCenterZ = apertureInnerZ - tunnelDepth / 2;
    const holeCenterY = this.getPusherBaseY() + this.pusherBodyHalfHeight;

    const wallWidth = this.playfieldWidth + 0.55;
    const wallHeight = 3.8;
    const wallCenterY = 1.74;
    const holeOffsetY = holeCenterY - wallCenterY;

    const faceMaterial = new THREE.MeshPhysicalMaterial({
      color: "#355f7a",
      emissive: "#143044",
      metalness: 0.52,
      roughness: 0.38,
      clearcoat: 0.22,
      clearcoatRoughness: 0.28,
      side: THREE.DoubleSide,
    });
    const shellMaterial = new THREE.MeshStandardMaterial({
      color: "#1a3346",
      emissive: "#0b1822",
      metalness: 0.4,
      roughness: 0.55,
    });
    const trimMaterial = new THREE.MeshPhysicalMaterial({
      color: "#d7e6f0",
      emissive: "#3d5668",
      metalness: 0.88,
      roughness: 0.18,
      clearcoat: 0.4,
      clearcoatRoughness: 0.12,
    });
    const accentMaterial = new THREE.MeshPhysicalMaterial({
      color: "#4ec4e0",
      emissive: "#1a6f86",
      metalness: 0.55,
      roughness: 0.28,
      clearcoat: 0.25,
      clearcoatRoughness: 0.2,
    });

    const addTunnelPart = (
      size: [number, number, number],
      position: THREE.Vector3,
      material: THREE.Material,
      withPhysics = false,
    ): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
      mesh.position.copy(position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      if (withPhysics) {
        this.addStaticBody(
          vec3(size[0] / 2, size[1] / 2, size[2] / 2),
          vec3(position.x, position.y, position.z),
        );
      }
    };

    const wallShape = new THREE.Shape();
    wallShape.moveTo(-wallWidth / 2, -wallHeight / 2);
    wallShape.lineTo(wallWidth / 2, -wallHeight / 2);
    wallShape.lineTo(wallWidth / 2, wallHeight / 2);
    wallShape.lineTo(-wallWidth / 2, wallHeight / 2);
    wallShape.lineTo(-wallWidth / 2, -wallHeight / 2);

    const holePath = new THREE.Path();
    holePath.moveTo(-holeWidth / 2, -holeHeight / 2 + holeOffsetY);
    holePath.lineTo(-holeWidth / 2, holeHeight / 2 + holeOffsetY);
    holePath.lineTo(holeWidth / 2, holeHeight / 2 + holeOffsetY);
    holePath.lineTo(holeWidth / 2, -holeHeight / 2 + holeOffsetY);
    holePath.lineTo(-holeWidth / 2, -holeHeight / 2 + holeOffsetY);
    wallShape.holes.push(holePath);

    const wallGeometry = new THREE.ExtrudeGeometry(wallShape, {
      depth: faceThickness,
      bevelEnabled: false,
      curveSegments: 1,
    });
    wallGeometry.translate(0, 0, -faceThickness / 2);
    const apertureWall = new THREE.Mesh(wallGeometry, faceMaterial);
    apertureWall.position.set(0, wallCenterY, apertureZ);
    apertureWall.castShadow = true;
    apertureWall.receiveShadow = true;
    this.scene.add(apertureWall);

    const upperPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(wallWidth - 0.55, 1.55),
      new THREE.MeshPhysicalMaterial({
        color: "#2c526b",
        emissive: "#123246",
        metalness: 0.46,
        roughness: 0.42,
        clearcoat: 0.16,
        clearcoatRoughness: 0.3,
        transparent: true,
        opacity: 0.92,
      }),
    );
    upperPanel.position.set(0, holeCenterY + holeHeight / 2 + 1.05, apertureZ + faceThickness / 2 + 0.008);
    this.scene.add(upperPanel);

    const accentBar = new THREE.Mesh(
      new THREE.BoxGeometry(wallWidth - 0.7, 0.07, 0.04),
      accentMaterial,
    );
    accentBar.position.set(0, holeCenterY + holeHeight / 2 + 0.28, apertureZ + faceThickness / 2 + 0.02);
    accentBar.castShadow = true;
    this.scene.add(accentBar);

    const lipDepth = 0.06;
    const lipThickness = 0.05;
    const lipZ = apertureZ + faceThickness / 2 + lipDepth / 2 - 0.01;
    addTunnelPart(
      [holeWidth + lipThickness * 2, lipThickness, lipDepth],
      new THREE.Vector3(0, holeCenterY + holeHeight / 2 + lipThickness / 2, lipZ),
      trimMaterial,
    );
    addTunnelPart(
      [holeWidth + lipThickness * 2, lipThickness, lipDepth],
      new THREE.Vector3(0, holeCenterY - holeHeight / 2 - lipThickness / 2, lipZ),
      trimMaterial,
    );
    for (const direction of [-1, 1] as const) {
      addTunnelPart(
        [lipThickness, holeHeight, lipDepth],
        new THREE.Vector3(direction * (holeWidth / 2 + lipThickness / 2), holeCenterY, lipZ),
        trimMaterial,
      );
    }

    const sideWidth = (wallWidth - physicsHoleWidth) / 2;
    const topHeight = wallHeight / 2 - (holeOffsetY + physicsHoleHeight / 2);
    const bottomHeight = wallHeight / 2 + (holeOffsetY - physicsHoleHeight / 2);
    const sideCenterX = physicsHoleWidth / 2 + sideWidth / 2;
    const topCenterY = holeCenterY + physicsHoleHeight / 2 + topHeight / 2;
    const bottomCenterY = holeCenterY - physicsHoleHeight / 2 - bottomHeight / 2;

    this.addStaticBody(
      vec3(sideWidth / 2, wallHeight / 2, faceThickness / 2),
      vec3(-sideCenterX, wallCenterY, apertureZ),
    );
    this.addStaticBody(
      vec3(sideWidth / 2, wallHeight / 2, faceThickness / 2),
      vec3(sideCenterX, wallCenterY, apertureZ),
    );
    this.addStaticBody(
      vec3(physicsHoleWidth / 2, topHeight / 2, faceThickness / 2),
      vec3(0, topCenterY, apertureZ),
    );
    if (bottomHeight > 0.04) {
      this.addStaticBody(
        vec3(physicsHoleWidth / 2, bottomHeight / 2, faceThickness / 2),
        vec3(0, bottomCenterY, apertureZ),
      );
    }

    const shellSideWidth = Math.max(0.22, (wallWidth - holeWidth) / 2);
    addTunnelPart(
      [wallWidth, 0.22, tunnelDepth],
      new THREE.Vector3(0, holeCenterY + holeHeight / 2 + 0.14, tunnelCenterZ),
      shellMaterial,
    );
    addTunnelPart(
      [wallWidth, Math.max(0.16, bottomHeight * 0.55), tunnelDepth],
      new THREE.Vector3(0, holeCenterY - holeHeight / 2 - 0.12, tunnelCenterZ),
      shellMaterial,
    );
    for (const direction of [-1, 1] as const) {
      addTunnelPart(
        [shellSideWidth, holeHeight + 0.2, tunnelDepth],
        new THREE.Vector3(direction * (holeWidth / 2 + shellSideWidth / 2), holeCenterY, tunnelCenterZ),
        shellMaterial,
      );
    }

    addTunnelPart(
      [wallWidth + 0.08, wallHeight + 0.12, 0.24],
      new THREE.Vector3(0, wallCenterY, tunnelCenterZ - tunnelDepth / 2 - 0.08),
      shellMaterial,
      true,
    );
  }

  private createDecor(): void {
    const backPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(TABLE.width + 0.6, 3.4),
      new THREE.MeshStandardMaterial({
        color: "#29445a",
        emissive: "#173049",
        metalness: 0.2,
        roughness: 0.82,
      }),
    );
    backPanel.position.set(0, 1.9, this.floorBackZ - 0.46);
    this.scene.add(backPanel);

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: "#b7efff",
      transparent: true,
      opacity: 0.12,
      transmission: 0.94,
      roughness: 0.06,
      metalness: 0,
    });
    const frontGlass = new THREE.Mesh(new THREE.PlaneGeometry(this.playfieldWidth + 0.9, 2.85), glassMaterial);
    frontGlass.position.set(0, 1.05, this.collectionCenterZ + 0.78);
    this.scene.add(frontGlass);

    for (const direction of [-1, 1] as const) {
      const glassDepth = this.sideExitLineZ - this.floorBackZ + 0.4;
      const glassCenterZ = (this.floorBackZ + this.sideExitLineZ) / 2;
      const glassSide = new THREE.Mesh(
        new THREE.PlaneGeometry(glassDepth, 2.7),
        glassMaterial,
      );
      glassSide.position.set(direction * (this.playfieldWidth / 2 + 0.26), 1.02, glassCenterZ);
      glassSide.rotation.y = direction * (Math.PI / 2);
      this.scene.add(glassSide);
    }
  }

  private createBillboard(text: string, color: string): THREE.Object3D {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 84;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return new THREE.Object3D();
    }

    ctx.fillStyle = "rgba(5,18,28,0.84)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    const roundedContext = ctx as CanvasRenderingContext2D & {
      roundRect?: (x: number, y: number, w: number, h: number, radii: number) => void;
    };
    if (typeof roundedContext.roundRect === "function") {
      roundedContext.roundRect(6, 6, canvas.width - 12, canvas.height - 12, 18);
    } else {
      ctx.moveTo(24, 6);
      ctx.lineTo(canvas.width - 24, 6);
      ctx.quadraticCurveTo(canvas.width - 6, 6, canvas.width - 6, 24);
      ctx.lineTo(canvas.width - 6, canvas.height - 24);
      ctx.quadraticCurveTo(canvas.width - 6, canvas.height - 6, canvas.width - 24, canvas.height - 6);
      ctx.lineTo(24, canvas.height - 6);
      ctx.quadraticCurveTo(6, canvas.height - 6, 6, canvas.height - 24);
      ctx.lineTo(6, 24);
      ctx.quadraticCurveTo(6, 6, 24, 6);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "bold 28px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.6, 0.85, 1);
    return sprite;
  }

  private createCoinMesh(): THREE.Group {
    const coin = new THREE.Group();
    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: "#cf8619",
      emissive: "#6a3703",
      metalness: 0.92,
      roughness: 0.22,
    });
    const faceMaterial = new THREE.MeshStandardMaterial({
      color: "#ffd166",
      emissive: "#9d6410",
      metalness: 0.84,
      roughness: 0.18,
    });
    const stampMaterial = new THREE.MeshStandardMaterial({
      color: "#fff0ad",
      emissive: "#8f6a17",
      metalness: 0.68,
      roughness: 0.26,
    });

    const edge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.12, 32),
      edgeMaterial,
    );
    edge.castShadow = true;
    edge.receiveShadow = true;
    coin.add(edge);

    for (const direction of [-1, 1] as const) {
      const face = new THREE.Mesh(
        new THREE.CylinderGeometry(0.31, 0.31, 0.018, 32),
        faceMaterial,
      );
      face.position.y = direction * 0.05;
      face.castShadow = true;
      face.receiveShadow = true;
      coin.add(face);
    }

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.19, 0.022, 12, 32),
      stampMaterial,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.056;
    ring.castShadow = true;
    ring.receiveShadow = true;
    coin.add(ring);

    const stamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.01, 24),
      stampMaterial,
    );
    stamp.position.y = 0.058;
    stamp.castShadow = true;
    stamp.receiveShadow = true;
    coin.add(stamp);

    return coin;
  }

  private createChestMesh(): THREE.Group {
    const chest = new THREE.Group();
    const woodMaterial = new THREE.MeshStandardMaterial({
      color: "#9b5d2b",
      emissive: "#4f230a",
      metalness: 0.22,
      roughness: 0.7,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: "#d49a33",
      emissive: "#6b4308",
      metalness: 0.84,
      roughness: 0.22,
    });

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.36, 0.68), woodMaterial);
    base.position.y = -0.08;
    base.castShadow = true;
    base.receiveShadow = true;
    chest.add(base);

    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.22, 0.72), woodMaterial);
    lid.position.set(0, 0.18, -0.02);
    lid.rotation.x = -0.06;
    lid.castShadow = true;
    lid.receiveShadow = true;
    chest.add(lid);

    const frontBand = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.09, 0.08), trimMaterial);
    frontBand.position.set(0, -0.02, 0.34);
    frontBand.castShadow = true;
    frontBand.receiveShadow = true;
    chest.add(frontBand);

    for (const direction of [-1, 1] as const) {
      const sideBand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.36, 0.72), trimMaterial);
      sideBand.position.set(direction * 0.29, -0.05, 0);
      sideBand.castShadow = true;
      sideBand.receiveShadow = true;
      chest.add(sideBand);
    }

    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.06), trimMaterial);
    latch.position.set(0, 0.1, 0.36);
    latch.castShadow = true;
    latch.receiveShadow = true;
    chest.add(latch);

    return chest;
  }

  private createRareMesh(): THREE.Object3D {
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42, 0),
      new THREE.MeshPhysicalMaterial({
        color: "#7ae8ff",
        emissive: "#11779a",
        metalness: 0.24,
        roughness: 0.08,
        transmission: 0.2,
        clearcoat: 0.4,
        clearcoatRoughness: 0.12,
      }),
    );
    core.castShadow = true;
    core.receiveShadow = true;
    return core;
  }

  private getCollectionPitFloorY(): number {
    return this.collectionFloorY - 0.32;
  }

  private getCollectionPitCenterZ(): number {
    return this.collectionCenterZ + 0.02;
  }

  private getCollectionPitDepth(): number {
    return this.collectionDepth - 0.22;
  }

  private createSlotFrame(x: number, width: number, label: string, color: string): void {
    const mouthDepth = this.getCollectionPitDepth() - 0.08;
    const mouthWidth = width - 0.18;
    const pitDepth = mouthDepth - 0.1;
    const pitFloorY = this.getCollectionPitFloorY();
    const mouthCenterZ = this.getCollectionPitCenterZ() + 0.02;
    const mouthY = this.getFloorSurfaceY() - 0.08;
    const cavityHeight = mouthY - pitFloorY;

    const rimMaterial = new THREE.MeshPhysicalMaterial({
      color: "#d4e4ef",
      emissive: "#355066",
      metalness: 0.86,
      roughness: 0.18,
      clearcoat: 0.35,
      clearcoatRoughness: 0.22,
    });
    const accentRimMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.35,
      metalness: 0.55,
      roughness: 0.28,
    });
    const pitWallMaterial = new THREE.MeshStandardMaterial({
      color: "#071018",
      emissive: "#03070c",
      metalness: 0.12,
      roughness: 0.92,
    });
    const pitFloorMaterial = new THREE.MeshStandardMaterial({
      color: "#02060b",
      emissive: "#010305",
      metalness: 0.05,
      roughness: 0.98,
    });

    const rearRim = new THREE.Mesh(new THREE.BoxGeometry(mouthWidth + 0.08, 0.1, 0.14), rimMaterial);
    rearRim.position.set(x, mouthY + 0.02, mouthCenterZ - mouthDepth / 2 + 0.02);
    rearRim.castShadow = true;
    rearRim.receiveShadow = true;
    this.scene.add(rearRim);

    for (const direction of [-1, 1] as const) {
      const sideRim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, mouthDepth + 0.04), rimMaterial);
      sideRim.position.set(x + direction * (mouthWidth / 2), mouthY + 0.02, mouthCenterZ);
      sideRim.castShadow = true;
      sideRim.receiveShadow = true;
      this.scene.add(sideRim);
    }

    const frontRim = new THREE.Mesh(new THREE.BoxGeometry(mouthWidth + 0.08, 0.12, 0.16), rimMaterial);
    frontRim.position.set(x, mouthY + 0.01, mouthCenterZ + mouthDepth / 2 - 0.02);
    frontRim.castShadow = true;
    frontRim.receiveShadow = true;
    this.scene.add(frontRim);

    const accentStrip = new THREE.Mesh(
      new THREE.BoxGeometry(mouthWidth - 0.2, 0.04, 0.05),
      accentRimMaterial,
    );
    accentStrip.position.set(x, mouthY + 0.05, mouthCenterZ + mouthDepth / 2 + 0.02);
    this.scene.add(accentStrip);

    const openMouth = new THREE.Mesh(
      new THREE.PlaneGeometry(mouthWidth - 0.28, mouthDepth - 0.28),
      new THREE.MeshBasicMaterial({
        color: "#000000",
        transparent: true,
        opacity: 0.94,
      }),
    );
    openMouth.position.set(x, mouthY - 0.01, mouthCenterZ + 0.02);
    openMouth.rotation.x = -Math.PI / 2;
    this.scene.add(openMouth);

    const pitFloor = new THREE.Mesh(
      new THREE.BoxGeometry(mouthWidth - 0.3, 0.05, pitDepth - 0.18),
      pitFloorMaterial,
    );
    pitFloor.position.set(x, pitFloorY + 0.03, mouthCenterZ + 0.05);
    pitFloor.rotation.x = 0.05;
    pitFloor.receiveShadow = true;
    this.scene.add(pitFloor);

    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(mouthWidth - 0.28, cavityHeight * 0.9, 0.08),
      pitWallMaterial,
    );
    backWall.position.set(x, pitFloorY + cavityHeight * 0.45, mouthCenterZ - pitDepth / 2 + 0.1);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    for (const direction of [-1, 1] as const) {
      const sideWall = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, cavityHeight * 0.9, pitDepth - 0.16),
        pitWallMaterial,
      );
      sideWall.position.set(
        x + direction * ((mouthWidth - 0.34) / 2),
        pitFloorY + cavityHeight * 0.45,
        mouthCenterZ + 0.04,
      );
      sideWall.castShadow = true;
      sideWall.receiveShadow = true;
      this.scene.add(sideWall);
    }

    const frontInner = new THREE.Mesh(
      new THREE.BoxGeometry(mouthWidth - 0.28, cavityHeight * 0.62, 0.08),
      pitWallMaterial,
    );
    frontInner.position.set(x, pitFloorY + cavityHeight * 0.34, mouthCenterZ + pitDepth / 2 - 0.02);
    frontInner.castShadow = true;
    frontInner.receiveShadow = true;
    this.scene.add(frontInner);

    const depthShade = new THREE.Mesh(
      new THREE.PlaneGeometry(mouthWidth - 0.42, cavityHeight * 0.82),
      new THREE.MeshBasicMaterial({
        color: "#000000",
        transparent: true,
        opacity: 0.62,
      }),
    );
    depthShade.position.set(x, pitFloorY + cavityHeight * 0.42, mouthCenterZ - pitDepth / 2 + 0.15);
    this.scene.add(depthShade);

    const bottomGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(mouthWidth - 0.5, pitDepth - 0.4),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.14,
      }),
    );
    bottomGlow.position.set(x, pitFloorY + 0.06, mouthCenterZ + 0.08);
    bottomGlow.rotation.x = -Math.PI / 2;
    this.scene.add(bottomGlow);

    const rimGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(mouthWidth - 0.34, 0.12),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.34,
      }),
    );
    rimGlow.position.set(x, mouthY + 0.08, mouthCenterZ + mouthDepth / 2 + 0.05);
    this.scene.add(rimGlow);

    const pitLight = new THREE.PointLight(color, 7, 2.2, 2.4);
    pitLight.position.set(x, pitFloorY + 0.18, mouthCenterZ + 0.12);
    this.scene.add(pitLight);

    const mouthLight = new THREE.PointLight(color, 4.5, 1.8, 2);
    mouthLight.position.set(x, mouthY + 0.12, mouthCenterZ + mouthDepth / 2 - 0.1);
    this.scene.add(mouthLight);

    const plaque = this.createBillboard(label, color);
    plaque.position.set(x, this.collectionFloorY + 1.12, this.collectionCenterZ + 0.62);
    this.scene.add(plaque);
  }

  private addStaticBody(halfExtents: Vec3, position: Vec3, rotationX = 0, rotationZ = 0): void {
    this.physics.createStaticBox({
      halfExtents,
      position,
      rotationX,
      rotationZ,
    });
  }

  private getFloorSurfaceY(_z?: number): number {
    return this.floorY + this.floorThickness / 2;
  }

  private getPusherBaseY(_z?: number): number {
    return this.getFloorSurfaceY() + this.pusherHoverGap;
  }

  private getPusherSurfaceY(_z?: number): number {
    const centerY = this.pusherBody
      ? this.pusherBody.position.y
      : this.getPusherBaseY() + this.pusherBodyHalfHeight;
    return centerY + this.pusherBodyHalfHeight;
  }

  private getItemRestOffset(type: DropItemType): number {
    if (type === "chest") {
      return 0.34;
    }
    if (type === "rare") {
      return 0.4;
    }
    return 0.08;
  }

  private bindControls(): void {
    this.ui.dropButton.addEventListener("click", () => this.requestDrop());
    this.ui.autoDropButton.addEventListener("click", () => {
      this.state.autoDropEnabled = !this.state.autoDropEnabled;
      this.pushMessage(this.state.autoDropEnabled ? "自动投币已开启。" : "自动投币已关闭。");
      this.renderState();
    });
    this.ui.debugToggleButton.addEventListener("click", () => {
      this.state.debugVisible = !this.state.debugVisible;
      this.renderState();
    });
    this.ui.coinUpgradeButton.addEventListener("click", () => this.purchaseUpgrade("coinValue"));
    this.ui.speedUpgradeButton.addEventListener("click", () => this.purchaseUpgrade("pusherSpeed"));
    this.ui.autoUpgradeButton.addEventListener("click", () => this.purchaseUpgrade("autoDrop"));

    window.addEventListener("keydown", this.handleKeyDown);
  }

  private buildDebugPresetBar(): void {
    this.ui.debugPresetBar.innerHTML = "";
    for (const preset of DEBUG_PRESETS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preset-button";
      button.textContent = preset.label;
      button.title = preset.description;
      button.dataset.presetId = preset.id;
      button.addEventListener("click", () => this.applyPreset(preset.id));
      this.ui.debugPresetBar.append(button);
    }
  }

  private buildDebugPanel(): void {
    if (this.debugPanelBuilt) {
      return;
    }

    const sliders: Array<{
      key: keyof DebugOverrides;
      label: string;
      min: number;
      max: number;
      step: number;
    }> = [
      {
        key: "timeScale",
        label: "时间倍率",
        min: DEBUG_LIMITS.timeScale.min,
        max: DEBUG_LIMITS.timeScale.max,
        step: DEBUG_LIMITS.timeScale.step,
      },
      {
        key: "pusherSpeedScale",
        label: "推盘速度倍率",
        min: DEBUG_LIMITS.pusherSpeedScale.min,
        max: DEBUG_LIMITS.pusherSpeedScale.max,
        step: DEBUG_LIMITS.pusherSpeedScale.step,
      },
      {
        key: "dropRateScale",
        label: "投币速度倍率",
        min: DEBUG_LIMITS.dropRateScale.min,
        max: DEBUG_LIMITS.dropRateScale.max,
        step: DEBUG_LIMITS.dropRateScale.step,
      },
      {
        key: "coinValueScale",
        label: "金币量级倍率",
        min: DEBUG_LIMITS.coinValueScale.min,
        max: DEBUG_LIMITS.coinValueScale.max,
        step: DEBUG_LIMITS.coinValueScale.step,
      },
      {
        key: "rewardMultiplier",
        label: "奖励结算倍率",
        min: DEBUG_LIMITS.rewardMultiplier.min,
        max: DEBUG_LIMITS.rewardMultiplier.max,
        step: DEBUG_LIMITS.rewardMultiplier.step,
      },
      {
        key: "bonusChargeScale",
        label: "Bonus 充能倍率",
        min: DEBUG_LIMITS.bonusChargeScale.min,
        max: DEBUG_LIMITS.bonusChargeScale.max,
        step: DEBUG_LIMITS.bonusChargeScale.step,
      },
    ];

    const panel = this.ui.debugPanel;
    panel.innerHTML = `
      <div class="debug-panel-head">
        <div>
          <div class="panel-kicker">Developer Debug</div>
          <h2>调试入口</h2>
        </div>
        <button type="button" class="ghost-button" data-action="toggle-debug">隐藏</button>
      </div>
      <div class="debug-panel-body"></div>
      <div class="debug-panel-foot"></div>
    `;

    const body = panel.querySelector<HTMLDivElement>(".debug-panel-body");
    const foot = panel.querySelector<HTMLDivElement>(".debug-panel-foot");
    if (!body || !foot) {
      throw new Error("Failed to build debug panel.");
    }

    const sliderGrid = document.createElement("div");
    sliderGrid.className = "slider-grid";

    for (const slider of sliders) {
      const row = document.createElement("label");
      row.className = "slider-row";

      const top = document.createElement("div");
      top.className = "slider-head";
      const name = document.createElement("span");
      name.textContent = slider.label;
      const value = document.createElement("span");
      value.className = "slider-value";
      value.dataset.sliderValue = String(slider.key);
      value.textContent = String(this.debugOverrides[slider.key]);
      top.append(name, value);

      const input = document.createElement("input");
      input.type = "range";
      input.min = String(slider.min);
      input.max = String(slider.max);
      input.step = String(slider.step);
      input.value = String(this.debugOverrides[slider.key]);
      input.dataset.sliderKey = String(slider.key);
      input.addEventListener("input", () => {
        const numericValue = Number(input.value);
        this.setDebugOverride(slider.key, numericValue);
        value.textContent = numericValue.toFixed(2);
        this.renderState();
      });

      row.append(top, input);
      sliderGrid.append(row);
    }

    const quickActions = document.createElement("div");
    quickActions.className = "quick-actions";

    const actionButtons: Array<{ label: string; run: () => void; quickAddBase?: number }> = [
      {
        label: "+100 金币",
        run: () => {
          this.injectDebugCoins(100, "开发者注入");
        },
        quickAddBase: 100,
      },
      {
        label: "+1000 金币",
        run: () => {
          this.injectDebugCoins(1000, "开发者注入");
        },
        quickAddBase: 1000,
      },
      {
        label: "强制 Bonus",
        run: () => {
          this.triggerBonus();
          this.pushMessage("开发者触发了一次 Bonus。");
        },
      },
      {
        label: "清理低价值物体",
        run: () => {
          this.clearLowValueItems();
          this.pushMessage("已清理低价值堆积物。");
        },
      },
      {
        label: "重置会话",
        run: () => {
          this.resetSession();
          this.pushMessage("会话已重置。");
        },
      },
      {
        label: "恢复默认调试值",
        run: () => {
          this.debugOverrides = { ...DEFAULT_DEBUG_OVERRIDES };
          this.applyPreset("default", true);
          this.pushMessage("调试覆盖已恢复默认。");
        },
      },
    ];

    for (const action of actionButtons) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost-button";
      button.textContent = action.label;
      if (action.quickAddBase != null) {
        button.dataset.quickAddBase = String(action.quickAddBase);
      }
      button.addEventListener("click", () => {
        action.run();
        this.syncDebugPanel();
        this.renderState();
      });
      quickActions.append(button);
    }

    body.append(sliderGrid);
    foot.append(quickActions);

    panel
      .querySelector<HTMLButtonElement>("[data-action='toggle-debug']")
      ?.addEventListener("click", () => {
        this.state.debugVisible = !this.state.debugVisible;
        this.renderState();
      });

    this.debugPanelBuilt = true;
    this.syncDebugPanel();
  }

  private applyPreset(presetId: string, silent = false): void {
    const preset = DEBUG_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }

    this.debugOverrides = { ...preset.overrides };
    this.state.currentPresetId = preset.id;
    if (preset.overrides.startingCoins != null) {
      this.state.coins = preset.overrides.startingCoins;
      this.lastCoins = this.state.coins;
      this.displayedCoins = this.state.coins;
    }
    if (!silent) {
      this.pushMessage(`调试预设已切换为 ${preset.label}。`);
    }
    this.syncDebugPanel();
    this.renderState();
  }

  private requestDrop(forceType?: DropItemType): boolean {
    if (!this.physicsReady) {
      this.pushMessage("物理引擎还在初始化，请稍后再投币。");
      this.renderState();
      return false;
    }
    if (this.state.coins < BASE_CONFIG.baseDropCost) {
      this.pushMessage("金币不足，无法继续投币。");
      this.renderState();
      return false;
    }

    this.state.coins -= BASE_CONFIG.baseDropCost;
    this.state.drops += 1;
    this.incrementTaskMetric("drops", 1);
    const itemType = forceType ?? this.rollItemType();
    this.spawnItem(itemType);
    this.renderState();
    return true;
  }

  private rollItemType(): DropItemType {
    const roll = Math.random();
    if (roll > 0.97) {
      return "rare";
    }
    if (roll > 0.85) {
      return "chest";
    }
    return "coin";
  }

  private spawnItem(
    type: DropItemType,
    x?: number,
    z?: number,
    options?: {
      spawnY?: number;
      velocityX?: number;
      velocityZ?: number;
      randomSpin?: boolean;
      rotationX?: number;
    },
  ): void {
    if (!this.physicsReady && !this.physics.isReady()) {
      return;
    }
    const spawnX = x ?? THREE.MathUtils.randFloat(-(this.playfieldWidth / 2) + 0.7, this.playfieldWidth / 2 - 0.7);
    const spawnCenterZ = this.pusherBody ? this.pusherBody.position.z : this.pusherStartZ;
    const pusherBackZ = spawnCenterZ - this.pusherDepth / 2;
    const spawnRangeBack = Math.max(this.floorBackZ + 0.48, pusherBackZ + 0.34);
    const spawnRangeFront = Math.min(this.floorBackZ + 1.18, pusherBackZ + 0.92);
    const spawnZ = z ?? THREE.MathUtils.randFloat(spawnRangeBack, Math.max(spawnRangeBack + 0.12, spawnRangeFront));
    const spawnY = options?.spawnY ?? this.getPusherSurfaceY(spawnZ) + 1.18;
    const rotationX = options?.rotationX ?? 0;

    let mesh: THREE.Object3D;
    let baseReward = BASE_CONFIG.baseCoinReward;
    let linearDamping = 0.14;
    let angularDamping = 0.2;

    if (type === "coin") {
      mesh = this.createCoinMesh();
      baseReward = BASE_CONFIG.baseCoinReward;
      linearDamping = 0.55;
      angularDamping = 1.4;
    } else if (type === "chest") {
      mesh = this.createChestMesh();
      baseReward = 26;
      linearDamping = 0.28;
      angularDamping = 0.55;
    } else {
      mesh = this.createRareMesh();
      baseReward = 12;
      linearDamping = 0.24;
      angularDamping = 0.4;
    }

    mesh.position.set(spawnX, spawnY, spawnZ);
    mesh.rotation.x = rotationX;
    this.scene.add(mesh);

    const velocity = vec3(
      options?.velocityX ?? THREE.MathUtils.randFloat(-0.03, 0.03),
      THREE.MathUtils.randFloat(-0.08, 0.01),
      options?.velocityZ ?? THREE.MathUtils.randFloat(0.04, 0.14),
    );
    let angularVelocity = vec3(0, 0, 0);
    if (options?.randomSpin !== false) {
      if (type === "coin") {
        angularVelocity = vec3(
          THREE.MathUtils.randFloat(-0.35, 0.35),
          THREE.MathUtils.randFloat(-0.18, 0.18),
          THREE.MathUtils.randFloat(-0.35, 0.35),
        );
      } else {
        angularVelocity = vec3(
          THREE.MathUtils.randFloat(-0.75, 0.75),
          THREE.MathUtils.randFloat(-0.75, 0.75),
          THREE.MathUtils.randFloat(-0.75, 0.75),
        );
      }
    }

    const body = this.physics.createDynamicBody({
      kind: type,
      position: vec3(spawnX, spawnY, spawnZ),
      rotationX,
      velocity,
      angularVelocity,
      linearDamping,
      angularDamping,
    });

    const item: DropItem = {
      id: randomId(type),
      type,
      body,
      mesh,
      baseReward,
      spawnTime: performance.now(),
      collected: false,
    };
    this.items.push(item);
  }

  private seedBoard(): void {
    const seedRows = [
      { zone: "pusher", z: -2.2, xs: [-2.4, -0.8, 0.8, 2.4] },
      { zone: "pusher", z: -1.2, xs: [-1.8, 0, 1.8] },
      { zone: "lower", z: 1.6, xs: [-2.2, -0.6, 0.8, 2.2] },
      { zone: "lower", z: 2.8, xs: [-1.5, 0.2, 1.7] },
    ];

    for (const row of seedRows) {
      for (const x of row.xs) {
        const surfaceY =
          row.zone === "pusher"
            ? this.getPusherSurfaceY(row.z)
            : this.getFloorSurfaceY();
        this.spawnItem("coin", x, row.z, {
          spawnY: surfaceY + this.getItemRestOffset("coin"),
          rotationX: 0,
          velocityX: 0,
          velocityZ: 0,
          randomSpin: false,
        });
      }
    }

    this.spawnItem("chest", -2.4, 2.1, {
      spawnY: this.getFloorSurfaceY() + this.getItemRestOffset("chest"),
      rotationX: 0,
      velocityX: 0,
      velocityZ: 0,
      randomSpin: false,
    });
    this.spawnItem("rare", 1.8, 2.6, {
      spawnY: this.getFloorSurfaceY() + this.getItemRestOffset("rare"),
      rotationX: 0,
      velocityX: 0,
      velocityZ: 0,
      randomSpin: false,
    });
  }

  private purchaseUpgrade(key: "coinValue" | "autoDrop" | "pusherSpeed"): void {
    const level = this.state.upgrades[key];
    const baseCost = key === "coinValue" ? 45 : key === "pusherSpeed" ? 90 : 120;
    const growth = key === "coinValue" ? 1.48 : key === "pusherSpeed" ? 1.56 : 1.62;
    const cost = Math.round(baseCost * Math.pow(growth, level));

    if (this.state.coins < cost) {
      this.pushMessage("金币不够，升级失败。");
      this.renderState();
      return;
    }

    this.state.coins -= cost;
    this.state.upgrades[key] += 1;
    const label =
      key === "coinValue" ? "金币收益升级" : key === "pusherSpeed" ? "推盘速度升级" : "自动投币升级";
    this.pushMessage(`${label}成功，当前等级 ${this.state.upgrades[key]}。`);
    this.pulseElement(this.ui.coinCard);
    this.renderState();
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    this.tickFrame();
  };

  private tickFrame(): void {
    if (this.frameInProgress) {
      return;
    }
    this.frameInProgress = true;
    this.lastFrameAtMs = performance.now();
    try {
      this.handleResize();

      const rawDelta = this.clock.getDelta();
      const delta = Math.min(Math.max(rawDelta, 0) * this.debugOverrides.timeScale, 0.05);
      const now = performance.now();
      this.frameCount += 1;

      this.updateAutoDrop(delta);
      if (!this.physicsReady) {
        this.processScheduledActions(now);
        this.updateTimers(delta);
        this.sampleFps(now);
        this.renderState();
        this.renderer.render(this.scene, this.camera);
        return;
      }

      this.updatePusher(delta);
      this.applyPusherAssist();
      this.stepPhysics(delta);
      this.syncMeshes();
      this.resolveCollections();
      this.processScheduledActions(now);
      this.updateTimers(delta);
      this.sampleFps(now);
      this.renderState();

      this.renderer.render(this.scene, this.camera);
    } catch (error) {
      console.error("CoinPusherApp frame failed.", error);
    } finally {
      this.frameInProgress = false;
    }
  };

  private updateAutoDrop(deltaSeconds: number): void {
    if (!this.state.autoDropEnabled) {
      this.autoDropElapsedMs = 0;
      return;
    }

    const upgradeFactor = 1 + this.state.upgrades.autoDrop * 0.08;
    const interval =
      (BASE_CONFIG.autoDropIntervalMs / this.debugOverrides.dropRateScale) / upgradeFactor;
    this.autoDropElapsedMs += deltaSeconds * 1000;

    let drops = 0;
    while (this.autoDropElapsedMs >= interval && interval > 1 && drops < 3) {
      this.autoDropElapsedMs -= interval;
      drops += 1;
      if (!this.requestDrop()) {
        this.state.autoDropEnabled = false;
        break;
      }
    }
    if (this.autoDropElapsedMs > interval * 3) {
      this.autoDropElapsedMs = interval;
    }
  }

  private updatePusher(deltaSeconds: number): void {
    const speedBoost = 1 + this.state.upgrades.pusherSpeed * 0.08;
    const cycleSpeed = BASE_CONFIG.basePusherSpeed * this.debugOverrides.pusherSpeedScale * speedBoost * 0.42;
    this.pusherTime = (this.pusherTime + deltaSeconds * cycleSpeed) % 1;

    // Keep motion readable near turnarounds (pure ease-in-out crawls and looks stuck).
    let z = this.pusherStartZ;
    if (this.pusherTime < 0.5) {
      const t = this.pusherTime / 0.5;
      const eased = t * 0.35 + easeInOutCubic(t) * 0.65;
      z = THREE.MathUtils.lerp(this.pusherStartZ, this.pusherEndZ, eased);
    } else {
      const t = (this.pusherTime - 0.5) / 0.5;
      const eased = t * 0.35 + easeInOutCubic(t) * 0.65;
      z = THREE.MathUtils.lerp(this.pusherEndZ, this.pusherStartZ, eased);
    }

    const y = this.getPusherBaseY() + this.pusherBodyHalfHeight;
    const previousPosition = this.pusherBody.position.clone();
    this.pusherBody.setNextKinematicPose(0, y, z, 0);
    this.pusherBody.velocity.set(
      0,
      (y - previousPosition.y) / Math.max(deltaSeconds, 0.0001),
      (z - previousPosition.z) / Math.max(deltaSeconds, 0.0001),
    );
    this.pusherMesh.position.set(0, y, z);
  }

  private usingTaichiHybrid(): boolean {
    return this.physicsBackend === "taichi-hybrid" && this.taichiPhysics?.isReady() === true;
  }

  private applyPendingTaichiAssist(): void {
    if (!this.taichiPendingResult) {
      return;
    }

    const result = this.taichiPendingResult;
    this.taichiPendingResult = null;

    const velocityById = new Map<string, [number, number, number]>();
    result.ids.forEach((id, index) => {
      const velocity = result.velocities[index];
      if (velocity) {
        velocityById.set(id, velocity);
      }
    });

    for (const item of this.items) {
      if (item.collected) {
        continue;
      }

      const assistedVelocity = velocityById.get(item.id);
      if (!assistedVelocity) {
        continue;
      }

      const nextVelocityX = clamp(lerpNumber(item.body.velocity.x, assistedVelocity[0], 0.72), -0.28, 0.28);
      const nextVelocityZ = clamp(Math.max(item.body.velocity.z, assistedVelocity[2]), -0.12, 1.12);

      if (
        Math.abs(nextVelocityX - item.body.velocity.x) > 0.012 ||
        Math.abs(nextVelocityZ - item.body.velocity.z) > 0.012
      ) {
        item.body.wakeUp();
      }

      item.body.velocity.x = nextVelocityX;
      item.body.velocity.z = nextVelocityZ;
    }
  }

  private queueTaichiAssistStep(deltaSeconds: number): void {
    if (!this.usingTaichiHybrid() || !this.taichiPhysics || this.taichiPendingComputation) {
      return;
    }

    const snapshot = this.buildTaichiAssistSnapshot();
    if (snapshot.length === 0) {
      this.taichiPendingResult = null;
      return;
    }

    this.taichiPendingComputation = this.taichiPhysics
      .step(snapshot, Math.max(deltaSeconds, 1 / 120))
      .then((result) => {
        if (this.physicsBackend === "taichi-hybrid") {
          this.taichiPendingResult = result;
        }
      })
      .catch((error: unknown) => {
        console.error("Taichi hybrid step failed.", error);
        if (this.physicsBackend === "taichi-hybrid") {
          this.physicsBackend = "rapier";
          this.taichiPhysics = null;
          this.taichiPendingResult = null;
          this.pushMessage("Taichi runtime failed. Falling back to Rapier physics.");
          this.renderState();
        }
      })
      .finally(() => {
        this.taichiPendingComputation = null;
      });
  }

  private buildTaichiAssistSnapshot(): TaichiAssistSnapshotItem[] {
    const snapshot: TaichiAssistSnapshotItem[] = [];
    const pusherBackZ = this.pusherBody.position.z - this.pusherDepth / 2 + 0.05;
    const pusherFrontZ = this.pusherBody.position.z + this.pusherDepth / 2 - 0.05;
    const pusherVz = this.pusherBody.velocity.z;

    for (const item of this.items) {
      if (item.collected) {
        continue;
      }

      const { x, y, z } = item.body.position;
      if (z < this.floorBackZ - 0.2 || z > this.floorFrontZ + 0.12) {
        continue;
      }
      if (Math.abs(x) > this.playfieldWidth / 2 + 0.28) {
        continue;
      }

      const onFloor = z < this.floorFrontZ - 0.08 && y <= this.getFloorSurfaceY() + 0.22;
      if (!onFloor) {
        continue;
      }

      let desiredForward = 0;
      let forwardBias = 0;

      const onPusher =
        Math.abs(x) <= this.pusherWidth / 2 + 0.03 &&
        z >= pusherBackZ &&
        z <= pusherFrontZ &&
        y <= this.getPusherSurfaceY() + this.getItemRestOffset(item.type) + 0.14;

      if (onPusher && Math.abs(pusherVz) > 0.01) {
        const follow = item.type === "chest" ? 0.84 : item.type === "rare" ? 0.9 : 0.94;
        desiredForward = lerpNumber(item.body.velocity.z, pusherVz, follow);
        forwardBias = Math.abs(pusherVz) * 1.35;
      } else if (
        z > pusherFrontZ &&
        Math.abs(x) <= this.playfieldWidth / 2 - 0.16 &&
        Math.hypot(item.body.velocity.x, item.body.velocity.z) < 0.04 &&
        Math.hypot(item.body.velocity.x, item.body.velocity.z) > 0.002
      ) {
        const targetVelocity = item.type === "chest" ? 0.03 : item.type === "rare" ? 0.035 : 0.04;
        desiredForward = targetVelocity;
        forwardBias = targetVelocity * 0.8;
      }

      if (desiredForward === 0 && forwardBias === 0) {
        continue;
      }

      snapshot.push({
        id: item.id,
        type: item.type,
        position: [x, y, z],
        velocity: [item.body.velocity.x, item.body.velocity.y, item.body.velocity.z],
        radius: this.getAssistRadius(item.type),
        desiredForward,
        forwardBias,
        lateralLimit: this.playfieldWidth / 2 - 0.12,
        lateralDamping: this.getAssistLateralDamping(item.type),
      });

      if (snapshot.length >= 128) {
        break;
      }
    }

    return snapshot;
  }

  private getAssistRadius(type: DropItemType): number {
    if (type === "chest") {
      return 0.44;
    }
    if (type === "rare") {
      return 0.38;
    }
    return 0.35;
  }

  private getAssistLateralDamping(type: DropItemType): number {
    if (type === "chest") {
      return 0.95;
    }
    if (type === "rare") {
      return 0.94;
    }
    return 0.93;
  }

  private stepPhysics(deltaSeconds: number): void {
    this.physics.step(1 / 60, deltaSeconds, 3);
  }

  private applyPusherAssist(): void {
    const pusherVz = this.pusherBody.velocity.z;
    const pusherVy = this.pusherBody.velocity.y;
    if (Math.abs(pusherVz) < 0.01 && Math.abs(pusherVy) < 0.01) {
      return;
    }

    const pusherBackZ = this.pusherBody.position.z - this.pusherDepth / 2 + 0.05;
    const pusherFrontZ = this.pusherBody.position.z + this.pusherDepth / 2 - 0.05;

    for (const item of this.items) {
      if (item.collected || item.body.isSleeping()) {
        continue;
      }
      if (Math.abs(item.body.position.x) > this.pusherWidth / 2 + 0.03) {
        continue;
      }
      if (item.body.position.z < pusherBackZ || item.body.position.z > pusherFrontZ) {
        continue;
      }

      const surfaceY = this.getPusherSurfaceY(item.body.position.z);
      const restY = surfaceY + this.getItemRestOffset(item.type);
      if (item.body.position.y > restY + 0.14) {
        continue;
      }
      if (item.body.position.y < restY - 0.1) {
        continue;
      }

      const followZ = item.type === "chest" ? 0.84 : item.type === "rare" ? 0.9 : 0.94;
      item.body.velocity.z = lerpNumber(item.body.velocity.z, pusherVz, followZ);
      item.body.velocity.y = lerpNumber(item.body.velocity.y, pusherVy, 0.62);
      item.body.velocity.x *= 0.965;
    }
  }

  private applyFloorAssist(): void {
    const floorSurfaceY = this.getFloorSurfaceY();
    const pusherFrontZ = this.pusherBody.position.z + this.pusherDepth / 2 - 0.05;

    for (const item of this.items) {
      if (item.collected || item.body.isSleeping()) {
        continue;
      }

      const { x, y, z } = item.body.position;
      if (Math.abs(x) > this.playfieldWidth / 2 - 0.12) {
        continue;
      }
      if (z <= pusherFrontZ || z >= this.floorFrontZ - 0.08) {
        continue;
      }
      if (y > floorSurfaceY + this.getItemRestOffset(item.type) + 0.14) {
        continue;
      }

      const horizontalSpeed = Math.hypot(item.body.velocity.x, item.body.velocity.z);
      if (horizontalSpeed > 0.08 || horizontalSpeed < 0.002) {
        continue;
      }

      const targetVelocity = item.type === "chest" ? 0.028 : item.type === "rare" ? 0.032 : 0.036;
      if (item.body.velocity.z >= targetVelocity) {
        continue;
      }

      item.body.velocity.z = lerpNumber(item.body.velocity.z, targetVelocity, 0.05);
      item.body.velocity.x *= 0.985;
    }
  }

  private syncMeshes(): void {
    for (const item of this.items) {
      item.mesh.position.set(item.body.position.x, item.body.position.y, item.body.position.z);
      item.mesh.quaternion.set(
        item.body.quaternion.x,
        item.body.quaternion.y,
        item.body.quaternion.z,
        item.body.quaternion.w,
      );
    }
  }

  private resolveCollections(): void {
    for (const item of this.items) {
      if (item.collected) {
        continue;
      }

      if (
        Math.abs(item.body.position.x) > this.playfieldWidth / 2 - 0.12 &&
        item.body.position.z > this.sideExitLineZ - 0.15 &&
        item.body.position.z < this.sideRampEndZ + 0.35 &&
        item.body.position.y < this.getFloorSurfaceY() - 0.08
      ) {
        const slot = this.getSlotType(item.body.position.x);
        this.collectItem(item, slot);
        continue;
      }

      if (item.body.position.z < this.payoutGapZ + 0.04 || item.body.position.y > this.collectionFloorY - 0.1) {
        continue;
      }

      const slot = this.getSlotType(item.body.position.x);
      this.collectItem(item, slot);
    }

    for (const item of this.items) {
      if (
        item.collected ||
        item.body.position.y < -8 ||
        item.body.position.z > this.collectionCenterZ + this.collectionDepth + 1.2 ||
        Math.abs(item.body.position.x) > TABLE.width
      ) {
        this.cleanupBodies.push(item.body);
        this.scene.remove(item.mesh);
      }
    }

    for (const body of this.cleanupBodies) {
      this.physics.removeBody(body);
    }
    this.cleanupBodies.length = 0;

    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      if (item.collected || item.body.position.y < -8) {
        this.items.splice(index, 1);
      }
    }
  }

  private getSlotType(x: number): SlotType {
    if (x < -this.slotSplitX) {
      return "chest";
    }
    if (x > this.slotSplitX) {
      return "highValue";
    }
    return "bonus";
  }

  private collectItem(item: DropItem, slot: SlotType): void {
    item.collected = true;

    let coinsAwarded = 0;
    let diamondsAwarded = 0;
    let fragmentsAwarded = 0;
    let bonusChargeAdded = BASE_CONFIG.baseBonusCharge;

    const coinLevelBoost = 1 + this.state.upgrades.coinValue * 0.22;
    const feverBoost = this.state.feverTimeLeft > 0 ? 2 : 1;
    const rewardBase = item.baseReward * coinLevelBoost * this.debugOverrides.coinValueScale;
    const totalReward = Math.round(rewardBase * this.debugOverrides.rewardMultiplier * feverBoost);

    switch (slot) {
      case "normal":
        coinsAwarded = totalReward;
        break;
      case "bonus":
        coinsAwarded = Math.round(totalReward * 0.7);
        bonusChargeAdded += 28;
        break;
      case "chest":
        coinsAwarded = Math.round(totalReward * (item.type === "chest" ? 3 : 1.6));
        break;
      case "highValue":
        if (item.type === "rare") {
          diamondsAwarded = 1;
          fragmentsAwarded = 3;
          coinsAwarded = Math.round(totalReward * 0.6);
        } else {
          diamondsAwarded = item.type === "chest" ? 1 : 0;
          coinsAwarded = Math.round(totalReward * 1.4);
        }
        break;
    }

    this.state.coins += coinsAwarded;
    this.state.diamonds += diamondsAwarded;
    this.state.fragments += fragmentsAwarded;
    this.state.totalEarnings += coinsAwarded;
    this.pulseElement(this.ui.coinCard);
    if (diamondsAwarded > 0) {
      this.pulseElement(this.ui.diamondCard);
    }
    if (fragmentsAwarded > 0) {
      this.pulseElement(this.ui.fragmentCard);
    }
    this.incrementTaskMetric("earnings", coinsAwarded);

    if (this.addBonusCharge(bonusChargeAdded * this.debugOverrides.bonusChargeScale)) {
      this.triggerBonus();
    }

    if (slot === "bonus") {
      this.pushMessage(`${this.describeItem(item.type)} 滑入 Bonus 槽，能量大涨。`);
    } else if (item.type === "rare") {
      this.pushMessage(`稀有物掉落成功，获得 ${diamondsAwarded} 钻石与 ${fragmentsAwarded} 碎片。`);
    } else {
      this.pushMessage(`${this.describeItem(item.type)} 掉落到 ${this.describeSlot(slot)}，获得 ${coinsAwarded} 金币。`);
    }
  }

  private addBonusCharge(amount: number): boolean {
    this.state.bonusCharge += Math.round(amount);
    if (this.state.bonusCharge < this.state.bonusThreshold) {
      return false;
    }

    this.state.bonusCharge -= this.state.bonusThreshold;
    return true;
  }

  private triggerBonus(): void {
    const bonus = BONUS_ROTATION[this.nextBonusIndex % BONUS_ROTATION.length];
    this.nextBonusIndex += 1;
    this.state.activeBonus = bonus;
    this.incrementTaskMetric("bonus", 1);

    if (bonus === "coinRain") {
      this.pushMessage("Bonus 触发：金币暴雨。");
      for (let i = 0; i < 14; i += 1) {
        this.scheduleAction(i * 120, () => {
          const spawnZ = THREE.MathUtils.randFloat(this.floorBackZ + 0.35, this.floorCenterZ + 0.5);
          this.spawnItem("coin", THREE.MathUtils.randFloat(-3.4, 3.4), spawnZ, {
            spawnY: this.getFloorSurfaceY(spawnZ) + 1.8,
          });
        });
      }
    } else if (bonus === "fever") {
      this.state.feverTimeLeft = 10;
      this.pushMessage("Bonus 触发：Fever x2。");
    } else {
      this.pushMessage("Bonus 触发：宝箱空投。");
      for (let i = 0; i < 4; i += 1) {
        this.scheduleAction(i * 180, () => {
          const spawnZ = THREE.MathUtils.randFloat(-0.2, 2.1);
          this.spawnItem("chest", THREE.MathUtils.randFloat(-1.8, 1.8), spawnZ, {
            spawnY: this.getFloorSurfaceY(spawnZ) + 1.8,
          });
        });
      }
    }
  }

  private updateTimers(deltaSeconds: number): void {
    if (this.state.feverTimeLeft > 0) {
      this.state.feverTimeLeft = Math.max(0, this.state.feverTimeLeft - deltaSeconds);
      if (this.state.feverTimeLeft === 0 && this.state.activeBonus === "fever") {
        this.state.activeBonus = null;
        this.pushMessage("Fever 已结束。");
      }
    } else if (this.state.activeBonus === "coinRain" || this.state.activeBonus === "chestDrop") {
      if (!this.scheduledActions.some((action) => action.id.startsWith("bonus-"))) {
        this.state.activeBonus = null;
      }
    }
  }

  private scheduleAction(delayMs: number, run: () => void): void {
    const actionId = randomId("bonus");
    this.scheduledActions.push({
      id: actionId,
      fireAt: performance.now() + delayMs,
      run,
    });
  }

  private processScheduledActions(now: number): void {
    for (let index = this.scheduledActions.length - 1; index >= 0; index -= 1) {
      const action = this.scheduledActions[index];
      if (now < action.fireAt) {
        continue;
      }
      this.scheduledActions.splice(index, 1);
      action.run();
    }
  }

  private sampleFps(now: number): void {
    if (now - this.lastFpsSampleTime < 500) {
      return;
    }

    const frameDelta = this.frameCount - this.lastFrameCount;
    const seconds = (now - this.lastFpsSampleTime) / 1000;
    const fps = Math.round(frameDelta / seconds);
    this.ui.fps.textContent = String(fps);
    this.lastFrameCount = this.frameCount;
    this.lastFpsSampleTime = now;
  }

  private getPhysicsStatusViewModel(): {
    tone: "physics-status-rapier" | "physics-status-taichi" | "physics-status-fallback" | "physics-status-probing";
    title: string;
    detail: string;
  } {
    const requestedMode = this.getRequestedPhysicsMode();

    if (this.physicsBackend === "taichi-hybrid" && this.taichiPhysics?.isReady()) {
      return {
        tone: "physics-status-taichi",
        title: "Physics: Rapier + Taichi",
        detail: "Rapier rigid bodies with optional WebGPU assist.",
      };
    }

    if (this.physicsBackend === "rapier") {
      return {
        tone: "physics-status-rapier",
        title: "Physics: Rapier",
        detail:
          requestedMode === "cannon"
            ? "Cannon path retired. Running Rapier instead."
            : "Rigid-body solver with CCD and kinematic pusher.",
      };
    }

    if (this.physicsBackend === "failed") {
      return {
        tone: "physics-status-fallback",
        title: "Physics: Rapier Failed",
        detail: "WASM init failed. Reload the page to retry.",
      };
    }

    return {
      tone: "physics-status-probing",
      title: "Physics: Initializing Rapier",
      detail: "Loading the Rapier WASM solver.",
    };
  }

  private renderState(): void {
    this.updateAnimatedResources();

    this.ui.coins.textContent = formatShort(this.displayedCoins);
    this.ui.diamonds.textContent = formatShort(this.displayedDiamonds);
    this.ui.fragments.textContent = formatShort(this.displayedFragments);
    this.ui.drops.textContent = String(this.state.drops);
    this.ui.activeBodies.textContent = String(this.items.length);
    this.ui.autoDropButton.textContent = this.state.autoDropEnabled ? "自动投币：开" : "自动投币：关";

    const bonusRatio = clamp(this.displayedBonusCharge / this.state.bonusThreshold, 0, 1);
    this.ui.bonusBarFill.style.transform = `scaleX(${bonusRatio})`;
    this.ui.bonusLabel.textContent = this.describeBonusLabel();

    this.ui.feverPill.classList.toggle("hidden", this.state.feverTimeLeft <= 0);
    if (this.state.feverTimeLeft > 0) {
      this.ui.feverPill.textContent = `FEVER x2 ${this.state.feverTimeLeft.toFixed(1)}s`;
    }

    const physicsStatus = this.getPhysicsStatusViewModel();
    this.ui.physicsStatus.className = `physics-status ${physicsStatus.tone}`;
    const physicsTitle = this.ui.physicsStatus.querySelector<HTMLElement>(".physics-status-title");
    const physicsDetail = this.ui.physicsStatus.querySelector<HTMLElement>(".physics-status-detail");
    if (physicsTitle) {
      physicsTitle.textContent = physicsStatus.title;
    }
    if (physicsDetail) {
      physicsDetail.textContent = physicsStatus.detail;
    }

    this.renderTasks();
    this.renderMessages();
    this.syncDebugPanel();
    this.highlightPreset();

    const coinValueCost = this.getUpgradeCost("coinValue");
    const speedCost = this.getUpgradeCost("pusherSpeed");
    const autoCost = this.getUpgradeCost("autoDrop");

    this.ui.coinUpgradeButton.textContent = `金币收益 Lv.${this.state.upgrades.coinValue}  升级 ${coinValueCost}`;
    this.ui.speedUpgradeButton.textContent = `推盘速度 Lv.${this.state.upgrades.pusherSpeed}  升级 ${speedCost}`;
    this.ui.autoUpgradeButton.textContent = `自动投币 Lv.${this.state.upgrades.autoDrop}  升级 ${autoCost}`;
    this.ui.economyHint.innerHTML = [
      `<div>普通金币预估收益：<strong>${formatShort(this.getProjectedNormalReward())}</strong></div>`,
      `<div>调试加金币当前生效：<strong>+${formatShort(this.getScaledCoinInjection(100))}</strong></div>`,
    ].join("");

    this.ui.debugToggleButton.textContent = this.state.debugVisible ? "收起调试" : "开发调试";
    this.ui.debugPanel.classList.toggle("hidden", !this.state.debugVisible);
  }

  private renderTasks(): void {
    this.ui.taskList.innerHTML = "";
    for (const task of this.state.tasks) {
      const row = document.createElement("div");
      row.className = "task-card";
      const done = task.progress >= task.goal;
      row.innerHTML = `
        <div class="task-head">
          <span>${task.title}</span>
          <span>${task.progress}/${task.goal}</span>
        </div>
        <div class="task-track"><div class="task-fill" style="transform:scaleX(${clamp(task.progress / task.goal, 0, 1)})"></div></div>
      `;
      const footer = document.createElement("div");
      footer.className = "task-foot";
      footer.textContent = task.claimed
        ? "已领取"
        : done
          ? `可领取 ${task.reward} 金币`
          : `奖励 ${task.reward} 金币`;

      if (done && !task.claimed) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mini-button";
        button.textContent = "领取";
        button.addEventListener("click", () => {
          this.claimTask(task.id);
        });
        footer.append(button);
      }
      row.append(footer);
      this.ui.taskList.append(row);
    }
  }

  private renderMessages(): void {
    this.ui.messageFeed.innerHTML = "";
    for (const message of this.state.messages.slice(0, 5)) {
      const item = document.createElement("li");
      item.textContent = message;
      this.ui.messageFeed.append(item);
    }
  }

  private syncDebugPanel(): void {
    if (!this.debugPanelBuilt) {
      return;
    }

    const panel = this.ui.debugPanel;
    const sliderInputs = panel.querySelectorAll<HTMLInputElement>("[data-slider-key]");
    sliderInputs.forEach((input) => {
      const key = input.dataset.sliderKey as keyof DebugOverrides | undefined;
      if (!key) {
        return;
      }
      input.value = String(this.debugOverrides[key]);
      const valueNode = panel.querySelector<HTMLElement>(`[data-slider-value='${key}']`);
      if (valueNode) {
        const rawValue = this.debugOverrides[key];
        valueNode.textContent = typeof rawValue === "number" ? rawValue.toFixed(2) : String(rawValue);
      }
    });

    const quickAddButtons = panel.querySelectorAll<HTMLButtonElement>("[data-quick-add-base]");
    quickAddButtons.forEach((button) => {
      const base = Number(button.dataset.quickAddBase);
      if (!Number.isFinite(base)) {
        return;
      }
      button.textContent = `+${formatShort(this.getScaledCoinInjection(base))} 金币`;
    });
  }

  private highlightPreset(): void {
    const buttons = this.ui.debugPresetBar.querySelectorAll<HTMLButtonElement>("[data-preset-id]");
    buttons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.presetId === this.state.currentPresetId);
    });
  }

  private getUpgradeCost(key: "coinValue" | "autoDrop" | "pusherSpeed"): number {
    const level = this.state.upgrades[key];
    const baseCost = key === "coinValue" ? 45 : key === "pusherSpeed" ? 90 : 120;
    const growth = key === "coinValue" ? 1.48 : key === "pusherSpeed" ? 1.56 : 1.62;
    return Math.round(baseCost * Math.pow(growth, level));
  }

  private incrementTaskMetric(metric: SessionTask["metric"], delta: number): void {
    for (const task of this.state.tasks) {
      if (task.metric !== metric || task.claimed) {
        continue;
      }
      task.progress = Math.min(task.goal, task.progress + delta);
    }
  }

  private claimTask(taskId: string): void {
    const task = this.state.tasks.find((entry) => entry.id === taskId);
    if (!task || task.claimed || task.progress < task.goal) {
      return;
    }

    task.claimed = true;
    this.state.coins += task.reward;
    this.pulseElement(this.ui.coinCard);
    this.pushMessage(`领取任务奖励：${task.reward} 金币。`);
    this.renderState();
  }

  private clearLowValueItems(): void {
    for (const item of this.items) {
      if (item.type === "coin" && item.body.position.z > 2.3) {
        item.collected = true;
      }
    }
  }

  private describeSlot(slot: SlotType): string {
    switch (slot) {
      case "bonus":
        return "Bonus 槽";
      case "chest":
        return "宝箱区";
      case "highValue":
        return "高价值区";
      default:
        return "普通回收区";
    }
  }

  private describeItem(type: DropItemType): string {
    switch (type) {
      case "chest":
        return "宝箱";
      case "rare":
        return "稀有奖励物";
      default:
        return "金币";
    }
  }

  private describeBonusLabel(): string {
    if (this.state.activeBonus === "coinRain") {
      return "金币暴雨";
    }
    if (this.state.activeBonus === "chestDrop") {
      return "宝箱空投";
    }
    if (this.state.activeBonus === "fever") {
      return "Fever x2";
    }
    return "待机";
  }

  private pushMessage(message: string): void {
    this.state.messages.unshift(message);
    this.state.messages = this.state.messages.slice(0, 6);
  }

  private resetSession(): void {
    const previousPresetId = this.state.currentPresetId;
    const previousDebugVisible = this.state.debugVisible;
    this.state = createInitialState(this.debugOverrides);
    this.state.currentPresetId = previousPresetId;
    this.state.tasks = createDefaultTasks();
    this.state.messages = [];
    this.state.debugVisible = previousDebugVisible;
    this.items.forEach((item) => {
      this.physics.removeBody(item.body);
      this.scene.remove(item.mesh);
    });
    this.items.length = 0;
    this.scheduledActions.length = 0;
    this.autoDropElapsedMs = 0;
    this.nextBonusIndex = 0;
    this.displayedCoins = this.state.coins;
    this.displayedDiamonds = this.state.diamonds;
    this.displayedFragments = this.state.fragments;
    this.displayedBonusCharge = this.state.bonusCharge;
    this.lastCoins = this.state.coins;
    this.lastDiamonds = this.state.diamonds;
    this.lastFragments = this.state.fragments;
    this.taichiPendingResult = null;
    this.seedBoard();
    this.pushMessage("新会话开始。");
    this.renderState();
  }

  private handleResize = (): void => {
    const width = Math.max(1, this.ui.viewport.clientWidth || window.innerWidth);
    const height = Math.max(1, this.ui.viewport.clientHeight || window.innerHeight);
    if (width === this.lastViewportWidth && height === this.lastViewportHeight) {
      return;
    }
    this.lastViewportWidth = width;
    this.lastViewportHeight = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (key === " ") {
      event.preventDefault();
      this.requestDrop();
      return;
    }
    if (event.key === "F1") {
      event.preventDefault();
      this.state.debugVisible = !this.state.debugVisible;
      this.renderState();
      return;
    }

    switch (key) {
      case "1":
        this.applyPreset("default");
        break;
      case "2":
        this.applyPreset("fast_loop");
        break;
      case "3":
        this.applyPreset("rich_mode");
        break;
      case "4":
        this.applyPreset("bonus_test");
        break;
      case "5":
        this.applyPreset("stress_physics");
        break;
      case "g":
        this.injectDebugCoins(100, "开发者快捷键");
        break;
      case "h":
        this.injectDebugCoins(1000, "开发者快捷键");
        break;
      case "j":
        this.setDebugOverride("pusherSpeedScale", clamp(
          this.debugOverrides.pusherSpeedScale - 0.15,
          DEBUG_LIMITS.pusherSpeedScale.min,
          DEBUG_LIMITS.pusherSpeedScale.max,
        ));
        this.pushMessage("降低推盘速度倍率。");
        break;
      case "k":
        this.setDebugOverride("pusherSpeedScale", clamp(
          this.debugOverrides.pusherSpeedScale + 0.15,
          DEBUG_LIMITS.pusherSpeedScale.min,
          DEBUG_LIMITS.pusherSpeedScale.max,
        ));
        this.pushMessage("提高推盘速度倍率。");
        break;
      case "u":
        this.setDebugOverride("coinValueScale", clamp(
          this.debugOverrides.coinValueScale - 0.25,
          DEBUG_LIMITS.coinValueScale.min,
          DEBUG_LIMITS.coinValueScale.max,
        ));
        this.pushMessage("降低金币量级倍率。");
        break;
      case "i":
        this.setDebugOverride("coinValueScale", clamp(
          this.debugOverrides.coinValueScale + 0.25,
          DEBUG_LIMITS.coinValueScale.min,
          DEBUG_LIMITS.coinValueScale.max,
        ));
        this.pushMessage("提高金币量级倍率。");
        break;
      case "b":
        this.triggerBonus();
        this.pushMessage("开发者快捷键：强制触发 Bonus。");
        break;
      case "r":
        this.resetSession();
        break;
      case "a":
        this.state.autoDropEnabled = !this.state.autoDropEnabled;
        this.pushMessage(this.state.autoDropEnabled ? "自动投币已开启。" : "自动投币已关闭。");
        break;
      default:
        return;
    }

    this.renderState();
  };

  public getDebugState(): Record<string, unknown> {
    return {
      physicsBackend: this.physicsBackend,
      taichiReady: this.taichiPhysics?.isReady() ?? false,
      taichiAdapterAvailable: this.taichiAdapterAvailable,
      taichiPending: this.taichiPendingComputation !== null,
      coins: this.state.coins,
      displayedCoins: this.displayedCoins,
      activeItems: this.items.length,
      activeBonus: this.state.activeBonus,
      pusherPosition: {
        y: this.pusherBody.position.y,
        z: this.pusherBody.position.z,
      },
      currentPresetId: this.state.currentPresetId,
      debugOverrides: this.debugOverrides,
    };
  }

  private setDebugOverride<Key extends keyof DebugOverrides>(key: Key, value: DebugOverrides[Key]): void {
    this.debugOverrides = {
      ...this.debugOverrides,
      [key]: value,
    };
    this.state.currentPresetId = "custom";
  }

  private getScaledCoinInjection(baseAmount: number): number {
    return Math.max(1, Math.round(baseAmount * this.debugOverrides.coinValueScale));
  }

  private injectDebugCoins(baseAmount: number, sourceLabel: string): void {
    const addedCoins = this.getScaledCoinInjection(baseAmount);
    this.state.coins += addedCoins;
    this.pulseElement(this.ui.coinCard);
    this.pushMessage(`${sourceLabel}：+${formatShort(addedCoins)} 金币。`);
  }

  private getProjectedNormalReward(): number {
    const coinLevelBoost = 1 + this.state.upgrades.coinValue * 0.22;
    const feverBoost = this.state.feverTimeLeft > 0 ? 2 : 1;
    return Math.round(
      BASE_CONFIG.baseCoinReward *
        coinLevelBoost *
        this.debugOverrides.coinValueScale *
        this.debugOverrides.rewardMultiplier *
        feverBoost,
    );
  }

  private updateAnimatedResources(): void {
    const factor = 0.18;
    this.displayedCoins = lerpNumber(this.displayedCoins, this.state.coins, factor);
    this.displayedDiamonds = lerpNumber(this.displayedDiamonds, this.state.diamonds, factor);
    this.displayedFragments = lerpNumber(this.displayedFragments, this.state.fragments, factor);
    this.displayedBonusCharge = lerpNumber(this.displayedBonusCharge, this.state.bonusCharge, factor);

    if (Math.abs(this.displayedCoins - this.state.coins) < 0.8) {
      this.displayedCoins = this.state.coins;
    }
    if (Math.abs(this.displayedDiamonds - this.state.diamonds) < 0.05) {
      this.displayedDiamonds = this.state.diamonds;
    }
    if (Math.abs(this.displayedFragments - this.state.fragments) < 0.05) {
      this.displayedFragments = this.state.fragments;
    }
    if (Math.abs(this.displayedBonusCharge - this.state.bonusCharge) < 0.8) {
      this.displayedBonusCharge = this.state.bonusCharge;
    }

    if (this.lastCoins !== this.state.coins) {
      this.pulseElement(this.ui.coinCard);
      this.lastCoins = this.state.coins;
    }
    if (this.lastDiamonds !== this.state.diamonds) {
      this.pulseElement(this.ui.diamondCard);
      this.lastDiamonds = this.state.diamonds;
    }
    if (this.lastFragments !== this.state.fragments) {
      this.pulseElement(this.ui.fragmentCard);
      this.lastFragments = this.state.fragments;
    }
  }

  private pulseElement(element: HTMLElement): void {
    element.classList.remove("is-pulsing");
    void element.offsetWidth;
    element.classList.add("is-pulsing");
  }
}
