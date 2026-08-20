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
  CoinFaceStyle,
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
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  private readonly physics = new RapierPhysicsWorld();
  private readonly clock = new THREE.Clock();

  private state: RuntimeState = createInitialState();
  private debugOverrides: DebugOverrides = { ...DEFAULT_DEBUG_OVERRIDES };
  private readonly items: DropItem[] = [];
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
   * walls cover [back → exit line], side exit tunnels cover [exit line → front].
   */
  private readonly sideRampOpeningWidth = 1.65;
  private readonly sideRampEndZ = this.floorFrontZ + 0.02;
  private readonly sideExitLineZ = this.sideRampEndZ - this.sideRampOpeningWidth;
  private readonly sideWallFrontZ = this.sideExitLineZ;
  /** Horizontal outward length of each side-exit ramp. */
  private readonly sideRampRun = 1.42;
  /** Vertical drop of each side-exit ramp. */
  private readonly sideRampDrop = 1.05;
  private readonly sideWallThickness = 0.34;
  private readonly sideWallHeight = 1.28;
  /** Side-wall mesh center Y offset above the floor surface. */
  private readonly sideWallCenterOffsetY = 0.52;
  private readonly collectionCenterZ = 5.1;
  private readonly collectionDepth = 1.5;
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
  private coinChuteGroup: THREE.Group | null = null;
  private coinChuteCarriage: THREE.Group | null = null;
  private coinChuteTime = 0;
  private coinChuteX = 0;
  private coinChuteMinX = -2.4;
  private coinChuteMaxX = 2.4;
  private readonly coinChuteMouthLocal = new THREE.Vector3(0, -0.76, 0.68);
  private readonly coinChuteMouthWorld = new THREE.Vector3();
  private readonly pusherLedStrips: Array<{
    segments: THREE.MeshStandardMaterial[];
    speed: number;
    phase: number;
    tail: number;
    mode: "marquee" | "wave" | "burst" | "spark" | "pattern";
    cols?: number;
    rows?: number;
  }> = [];
  private pusherDecorElapsed = 0;
  private readonly ledGlyphCache = new Map<string, Uint8Array>();
  private readonly ledCellGeometryCache = new Map<string, THREE.BoxGeometry>();
  private readonly coinLookCache = new Map<
    CoinFaceStyle,
    {
      faceMaterial: THREE.MeshStandardMaterial;
      edgeMaterial: THREE.MeshStandardMaterial;
    }
  >();
  private coinRefImage: HTMLImageElement | null = null;
  private coinLooksReady: Promise<void> | null = null;
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
  private uiTasksDirty = true;
  private uiMessagesDirty = true;
  private uiDebugDirty = true;
  private ledUpdateAccumulator = 0;
  private lastPhysicsStatusKey = "";
  private lastUpgradeUiKey = "";
  private lastBonusUiKey = "";
  private lastFeverUiKey = "";
  private lastTowerButtonKey = "";
  private lastAutoDropUiKey = "";
  /** Center playfield lift hatch — coins rise through this circular opening. */
  private readonly floorHoleCenterX = 0;
  private readonly floorHoleCenterZ = 0.55;
  private readonly floorHoleRadius = 1.05;
  private readonly floorHoleShaftDepth = 1.55;
  /** Visual coin radius is 0.35; pack slightly under that for a tight ring. */
  private readonly coinTowerCoinRadius = 0.34;
  private readonly coinTowerRingCount = 6;
  private readonly coinTowerLayers = 8;
  /** Vertical step ≈ coin collider height so layers rest without bounce. */
  private readonly coinTowerLayerStep = 0.11;
  private floorHoleOpen = 0;
  private floorHoleTarget = 0;
  private floorHoleCovers: Array<{
    mesh: THREE.Mesh;
    body: PhysicsBody;
    closedX: number;
    closedY: number;
    closedZ: number;
    bodyOffsetX: number;
    bodyOffsetY: number;
    slideX: number;
    dropY: number;
  }> = [];
  private coinTowerPhase: "idle" | "opening" | "rising" | "closing" | "stabilizing" = "idle";
  private coinTowerRise = 0;
  private coinTowerStabilizeLeft = 0;
  private coinTowerItemIds = new Set<string>();
  private coinTowerAnchoredIds = new Set<string>();
  private readonly coinTowerRestPoses = new Map<string, { x: number; y: number; z: number }>();
  private payoutGlowLight: THREE.PointLight | null = null;
  private payoutWarmLight: THREE.PointLight | null = null;
  private readonly slotPitLights = new Map<SlotType, THREE.PointLight>();
  private readonly collectRingGeometry = new THREE.RingGeometry(0.08, 0.32, 20);
  /** Pooled GPU sparks — never add/remove lights or materials at collect time. */
  private readonly collectFxMaxSparks = 96;
  private readonly collectFxPositions = new Float32Array(96 * 3);
  private readonly collectFxColors = new Float32Array(96 * 3);
  private readonly collectFxBaseColors = new Float32Array(96 * 3);
  private readonly collectFxVelocities = new Float32Array(96 * 3);
  private readonly collectFxLife = new Float32Array(96);
  private readonly collectFxMaxLife = new Float32Array(96);
  private collectFxCursor = 0;
  private collectFxPoints: THREE.Points | null = null;
  private readonly collectRingPool: Array<{
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    age: number;
    life: number;
    active: boolean;
  }> = [];
  private readonly slotPitFlashBoost = new Map<SlotType, number>();
  private payoutGlowFlashBoost = 0;
  private payoutWarmFlashBoost = 0;
  private collectFxSpawnsThisFrame = 0;
  private collectUiPulsePending = false;

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
      await this.ensureCoinLooksReady();
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
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
    this.scene.background = new THREE.Color("#2a2038");
    this.scene.fog = new THREE.Fog("#342840", 18, 38);

    const hemi = new THREE.HemisphereLight("#ffe8cc", "#241828", 1.08);
    this.scene.add(hemi);

    const key = new THREE.SpotLight("#ffe8c6", 168, 38, 0.34, 0.55, 1);
    key.position.set(-3.4, 11.5, 8.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 2;
    key.shadow.bias = -0.00008;
    key.shadow.normalBias = 0.02;
    key.target.position.set(0, 0.42, 1.55);
    this.scene.add(key, key.target);

    const sideKey = new THREE.SpotLight("#ffc8e8", 78, 30, 0.55, 0.65, 1.8);
    sideKey.position.set(6.2, 5.8, 5.2);
    sideKey.target.position.set(3.2, 0.2, this.sideExitLineZ + 0.4);
    sideKey.castShadow = false;
    this.scene.add(sideKey, sideKey.target);

    const sideKeyLeft = new THREE.SpotLight("#c8f0ff", 78, 30, 0.55, 0.65, 1.8);
    sideKeyLeft.position.set(-6.2, 5.8, 5.2);
    sideKeyLeft.target.position.set(-3.2, 0.2, this.sideExitLineZ + 0.4);
    sideKeyLeft.castShadow = false;
    this.scene.add(sideKeyLeft, sideKeyLeft.target);

    const rim = new THREE.PointLight("#ff6ec7", 18, 22, 2);
    rim.position.set(-4.6, 3.2, -0.3);
    this.scene.add(rim);

    const frontFill = new THREE.PointLight("#ffd49a", 46, 24, 2);
    frontFill.position.set(0, 1.6, 7.8);
    this.scene.add(frontFill);

    const payoutGlow = new THREE.PointLight("#57d6ff", 12, 8, 2.2);
    payoutGlow.position.set(0, -0.18, this.collectionCenterZ + 0.22);
    this.scene.add(payoutGlow);
    this.payoutGlowLight = payoutGlow;

    const payoutWarm = new THREE.PointLight("#ffd49a", 8, 6.5, 2.2);
    payoutWarm.position.set(0, -0.12, this.collectionCenterZ - 0.02);
    this.scene.add(payoutWarm);
    this.payoutWarmLight = payoutWarm;

    const hallNeonLeft = new THREE.PointLight("#ff5fae", 20, 20, 2);
    hallNeonLeft.position.set(-5.8, 4.2, -4.2);
    this.scene.add(hallNeonLeft);

    const hallNeonRight = new THREE.PointLight("#6ee8ff", 20, 20, 2);
    hallNeonRight.position.set(5.8, 4.2, -4.2);
    this.scene.add(hallNeonRight);

    const hallOverhead = new THREE.PointLight("#ffd166", 30, 28, 2);
    hallOverhead.position.set(0, 6.8, -2.4);
    this.scene.add(hallOverhead);

    this.setupMetalEnvironment();
    this.initCollectEffects();
  }

  /** Soft studio env so high-metal coin faces pick up specular highlights. */
  private setupMetalEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();

    const addPanel = (color: string, position: THREE.Vector3, rotation: THREE.Euler, size = 14) => {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ color }),
      );
      panel.position.copy(position);
      panel.rotation.copy(rotation);
      envScene.add(panel);
    };

    addPanel("#ffffff", new THREE.Vector3(0, 9, 0), new THREE.Euler(-Math.PI / 2, 0, 0), 18);
    addPanel("#3a3048", new THREE.Vector3(0, -3, 0), new THREE.Euler(Math.PI / 2, 0, 0), 18);
    addPanel("#ffd0e8", new THREE.Vector3(-8, 3, 0), new THREE.Euler(0, Math.PI / 2, 0), 12);
    addPanel("#c8f4ff", new THREE.Vector3(8, 3, 0), new THREE.Euler(0, -Math.PI / 2, 0), 12);
    addPanel("#fff0c8", new THREE.Vector3(0, 3, 8), new THREE.Euler(0, Math.PI, 0), 12);
    addPanel("#4a3a58", new THREE.Vector3(0, 3, -8), new THREE.Euler(0, 0, 0), 12);

    const envMap = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = envMap;
    this.scene.environmentIntensity = 1.25;
    pmrem.dispose();
    envScene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
  }

  private createTable(): void {
    // Keep the shell below the side-exit ramps so they don't pierce the cabinet.
    // Stop before the front pits so dropped items can fall through open air.
    const cabinetBackZ = this.floorBackZ - 2.24;
    const cabinetFrontZ = this.floorFrontZ - 0.08;
    const cabinetDepth = cabinetFrontZ - cabinetBackZ;
    const cabinet = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE.width + 0.9, 2.2, cabinetDepth),
      new THREE.MeshStandardMaterial({
        color: "#0b1826",
        metalness: 0.44,
        roughness: 0.62,
      }),
    );
    cabinet.position.set(0, -1.72, (cabinetBackZ + cabinetFrontZ) / 2);
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

    const frontTrimWidth = this.playfieldWidth + 0.2;
    const frontTrimDepth = this.floorFrontZ - this.sideExitLineZ + 0.08;
    const frontTrimCenterZ = (this.sideExitLineZ + this.floorFrontZ) / 2;
    const frontTrim = new THREE.Mesh(
      new THREE.BoxGeometry(frontTrimWidth, 0.2, frontTrimDepth),
      new THREE.MeshStandardMaterial({
        color: "#0f2233",
        metalness: 0.28,
        roughness: 0.72,
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
    const frontFloorWidth = this.playfieldWidth;
    const frontFloorDepth = this.floorFrontZ - this.sideExitLineZ;
    const frontFloorCenterZ = (this.sideExitLineZ + this.floorFrontZ) / 2;

    this.createPlayfieldFloorWithCenterHole(floorMaterial);

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
    const floorFrontCap = new THREE.Mesh(
      new THREE.PlaneGeometry(frontFloorWidth + 0.02, this.floorThickness + 0.02),
      new THREE.MeshBasicMaterial({ color: "#143445" }),
    );
    floorFrontCap.position.set(0, this.floorY, this.floorFrontZ + 0.003);
    this.scene.add(floorFrontCap);

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
        new THREE.BoxGeometry(this.sideWallThickness, this.sideWallHeight, sideWallDepth),
        railMaterial,
      );
      sideWall.position.set(
        sideWallCenterX,
        sideWallBaseY + this.sideWallCenterOffsetY,
        sideWallCenterZ,
      );
      sideWall.castShadow = true;
      sideWall.receiveShadow = true;
      this.scene.add(sideWall);

      this.addStaticBody(
        vec3(this.sideWallThickness / 2, this.sideWallHeight / 2, sideWallDepth / 2),
        vec3(sideWallCenterX, sideWallBaseY + this.sideWallCenterOffsetY, sideWallCenterZ),
      );

      const sideTrim = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, this.sideWallHeight - 0.1, sideWallDepth),
        sideTrimMaterial,
      );
      sideTrim.position.set(
        direction * (sideWallInnerX + 0.01),
        sideWallBaseY + this.sideWallCenterOffsetY - 0.02,
        sideWallCenterZ,
      );
      sideTrim.castShadow = true;
      sideTrim.receiveShadow = true;
      this.scene.add(sideTrim);
    }

    this.createSideExitRamps(floorMaterial, railMaterial);

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

    const dividerMaterial = new THREE.MeshStandardMaterial({
      color: "#182838",
      emissive: "#0b141c",
      metalness: 0.18,
      roughness: 0.82,
    });
    const collectionPitFrontZ = this.getCollectionPitCenterZ() + this.getCollectionPitDepth() / 2;
    const dividerHeight = 2.55;
    const dividerTopY = deckFrontY - 0.04;
    const dividerCenterY = dividerTopY - dividerHeight / 2;
    const dividerBackZ = this.floorFrontZ - 0.16;
    const dividerFrontZ = collectionPitFrontZ + 0.08;
    const dividerDepth = dividerFrontZ - dividerBackZ;
    const dividerZ = (dividerBackZ + dividerFrontZ) / 2;
    const collectionDividers = [
      { width: 0.12, x: -(this.playfieldWidth / 2) + 0.06 },
      { width: 0.14, x: -this.slotSplitX },
      { width: 0.14, x: this.slotSplitX },
      { width: 0.12, x: this.playfieldWidth / 2 - 0.06 },
    ] as const;

    for (const divider of collectionDividers) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(divider.width, dividerHeight, dividerDepth),
        dividerMaterial,
      );
      mesh.position.set(divider.x, dividerCenterY, dividerZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.addStaticBody(
        vec3(divider.width / 2, dividerHeight / 2, dividerDepth / 2),
        vec3(divider.x, dividerCenterY, dividerZ),
      );
    }

    this.createSlotFrame(-3.05, 2.82, "宝箱区", "#ffbe5a", "chest");
    this.createSlotFrame(0, 3.04, "Bonus", "#54f3ff", "bonus");
    this.createSlotFrame(3.05, 2.82, "高价值", "#ff6f4d", "highValue");
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

    this.createPusherFrontLedCrown(
      wallWidth,
      holeWidth,
      holeHeight,
      holeCenterY,
      apertureZ + faceThickness / 2 + 0.008,
    );
    this.createCoinChuteSlider(
      wallWidth,
      holeWidth,
      holeHeight,
      holeCenterY,
      apertureZ + faceThickness / 2 + 0.02,
    );

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

    this.createPusherBackWallDecor({
      backFaceZ: tunnelCenterZ - tunnelDepth / 2 + 0.055,
      wallWidth,
      holeWidth,
      holeHeight,
      holeCenterY,
      sideWidth: shellSideWidth,
      topHeight,
      bottomHeight,
    });
  }

  private createPusherBackWallDecor(layout: {
    backFaceZ: number;
    wallWidth: number;
    holeWidth: number;
    holeHeight: number;
    holeCenterY: number;
    sideWidth: number;
    topHeight: number;
    bottomHeight: number;
  }): void {
    const { backFaceZ, wallWidth, holeWidth, holeHeight, holeCenterY, sideWidth, topHeight, bottomHeight } =
      layout;
    const techColors = ["#00e8ff", "#4da6ff", "#00f5d4", "#7b8cff", "#ff6ec7", "#ffd166"];

    const mainWidth = Math.min(wallWidth - 0.55, holeWidth + 1.35);
    const mainHeight = Math.max(0.72, topHeight - 0.28);
    const mainY = holeCenterY + holeHeight / 2 + mainHeight / 2 + 0.2;

    this.addLedTechFrame(mainWidth, mainHeight, 0, mainY, backFaceZ);
    this.addLedMatrix(
      0,
      mainY,
      backFaceZ + 0.012,
      10,
      5,
      mainWidth - 0.12,
      mainHeight - 0.12,
      techColors,
      "pattern",
      1.35,
      0,
    );

    const sidePanelWidth = Math.max(0.72, sideWidth - 0.02);
    const sidePanelHeight = Math.min(holeHeight * 0.92, 1.45);
    const sideX = holeWidth / 2 + sidePanelWidth / 2 + 0.08;

    this.addLedTechFrame(sidePanelWidth, sidePanelHeight, -sideX, holeCenterY + 0.04, backFaceZ);
    this.addLedMatrix(
      -sideX,
      holeCenterY + 0.04,
      backFaceZ + 0.012,
      4,
      7,
      sidePanelWidth - 0.1,
      sidePanelHeight - 0.1,
      ["#00e8ff", "#7b8cff", "#ff6ec7"],
      "pattern",
      1.55,
      0.8,
    );

    this.addLedTechFrame(sidePanelWidth, sidePanelHeight, sideX, holeCenterY + 0.04, backFaceZ);
    this.addLedMatrix(
      sideX,
      holeCenterY + 0.04,
      backFaceZ + 0.012,
      4,
      7,
      sidePanelWidth - 0.1,
      sidePanelHeight - 0.1,
      ["#00f5d4", "#4da6ff", "#ffd166"],
      "pattern",
      1.55,
      2.4,
    );

    if (bottomHeight > 0.28) {
      const bannerWidth = Math.min(holeWidth + 0.55, wallWidth - 1.1);
      const bannerHeight = Math.min(0.38, bottomHeight - 0.12);
      const bannerY = holeCenterY - holeHeight / 2 - bannerHeight / 2 - 0.1;
      this.addLedTechFrame(bannerWidth, bannerHeight, 0, bannerY, backFaceZ);
      this.addLedStripLine(
        0,
        bannerY,
        backFaceZ + 0.012,
        bannerWidth - 0.1,
        10,
        "horizontal",
        techColors,
        9.5,
        0.4,
      );
    }

    this.addLedStripLine(
      0,
      mainY + mainHeight / 2 + 0.1,
      backFaceZ + 0.015,
      mainWidth + 0.2,
      10,
      "horizontal",
      techColors,
      11,
      0,
    );

    for (const direction of [-1, 1] as const) {
      this.addLedStripLine(
        direction * (sideX + sidePanelWidth / 2 + 0.08),
        holeCenterY,
        backFaceZ + 0.015,
        sidePanelHeight + 0.15,
        8,
        "vertical",
        techColors,
        8.5,
        direction === -1 ? 1.4 : 2.8,
      );
    }

    this.addLedPerimeterChase(
      holeWidth + 0.18,
      holeHeight + 0.12,
      0,
      holeCenterY,
      backFaceZ + 0.018,
      techColors,
      13,
    );

    const tunnelGlow = new THREE.PointLight("#00e8ff", 14, 5.5, 2);
    tunnelGlow.position.set(0, holeCenterY + 0.55, backFaceZ - 0.35);
    this.scene.add(tunnelGlow);

    const sideGlowLeft = new THREE.PointLight("#7b8cff", 7, 3.2, 2);
    sideGlowLeft.position.set(-sideX, holeCenterY, backFaceZ - 0.2);
    this.scene.add(sideGlowLeft);

    const sideGlowRight = new THREE.PointLight("#00f5d4", 7, 3.2, 2);
    sideGlowRight.position.set(sideX, holeCenterY, backFaceZ - 0.2);
    this.scene.add(sideGlowRight);
  }

  private createPusherFrontLedCrown(
    wallWidth: number,
    holeWidth: number,
    holeHeight: number,
    holeCenterY: number,
    faceZ: number,
  ): void {
    const panelWidth = wallWidth - 0.55;
    const panelHeight = 1.55;
    const panelY = holeCenterY + holeHeight / 2 + 1.05;
    const techColors = ["#00e8ff", "#4da6ff", "#00f5d4", "#7b8cff", "#ff6ec7"];

    this.addLedTechFrame(panelWidth, panelHeight, 0, panelY, faceZ - 0.004);
    this.addLedMatrix(
      0,
      panelY,
      faceZ,
      10,
      4,
      panelWidth - 0.14,
      panelHeight - 0.14,
      techColors,
      "pattern",
      1.7,
      1.5,
    );

    this.addLedStripLine(
      0,
      panelY + panelHeight / 2 + 0.07,
      faceZ + 0.012,
      panelWidth + 0.08,
      10,
      "horizontal",
      techColors,
      12,
      0.2,
    );
  }

  private createCoinChuteSlider(
    wallWidth: number,
    holeWidth: number,
    holeHeight: number,
    holeCenterY: number,
    faceZ: number,
  ): void {
    const panelHeight = 1.55;
    const panelY = holeCenterY + holeHeight / 2 + 1.05;
    const railY = panelY + panelHeight / 2 + 0.14;
    const railWidth = Math.min(wallWidth - 0.9, holeWidth + 0.35);
    this.coinChuteMinX = -railWidth / 2 + 0.48;
    this.coinChuteMaxX = railWidth / 2 - 0.48;
    this.coinChuteX = 0;

    const group = new THREE.Group();
    group.position.set(0, 0, faceZ);
    this.scene.add(group);
    this.coinChuteGroup = group;

    const railMaterial = new THREE.MeshStandardMaterial({
      color: "#c5d4de",
      emissive: "#3a4e5c",
      metalness: 0.86,
      roughness: 0.22,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: "#1a2430",
      emissive: "#0b1218",
      metalness: 0.55,
      roughness: 0.4,
    });
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: "#57e8ff",
      emissive: "#57e8ff",
      emissiveIntensity: 1.35,
      metalness: 0.3,
      roughness: 0.25,
    });

    const rail = new THREE.Mesh(new THREE.BoxGeometry(railWidth, 0.08, 0.1), railMaterial);
    rail.position.set(0, railY, 0.02);
    rail.castShadow = true;
    group.add(rail);

    const railGroove = new THREE.Mesh(new THREE.BoxGeometry(railWidth - 0.12, 0.03, 0.04), darkMaterial);
    railGroove.position.set(0, railY, 0.07);
    group.add(railGroove);

    for (const direction of [-1, 1] as const) {
      const stop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.14), railMaterial);
      stop.position.set(direction * (railWidth / 2), railY, 0.03);
      group.add(stop);
    }

    const carriage = new THREE.Group();
    carriage.position.set(0, railY, 0.08);
    group.add(carriage);
    this.coinChuteCarriage = carriage;

    const sliderBlock = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.36, 0.36), darkMaterial);
    sliderBlock.position.set(0, 0.04, 0.08);
    sliderBlock.castShadow = true;
    carriage.add(sliderBlock);

    const sliderCap = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.4), glowMaterial);
    sliderCap.position.set(0, 0.24, 0.08);
    carriage.add(sliderCap);

    const chuteMetal = new THREE.MeshStandardMaterial({
      color: "#d8e2ea",
      emissive: "#3a4c5a",
      metalness: 0.88,
      roughness: 0.2,
    });
    const chuteAccent = new THREE.MeshStandardMaterial({
      color: "#ffd166",
      emissive: "#a66a10",
      emissiveIntensity: 0.75,
      metalness: 0.72,
      roughness: 0.26,
    });
    const chuteInner = new THREE.MeshStandardMaterial({
      color: "#9eb4c4",
      emissive: "#5a7a90",
      emissiveIntensity: 0.55,
      metalness: 0.7,
      roughness: 0.28,
    });
    const chuteFloor = new THREE.MeshStandardMaterial({
      color: "#c9d8e4",
      emissive: "#6a8aa0",
      emissiveIntensity: 0.7,
      metalness: 0.82,
      roughness: 0.18,
    });

    // Vertical square duct from the slider down to the spout.
    const duct = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.78, 0.34), chuteMetal);
    duct.position.set(0, -0.42, 0.2);
    duct.castShadow = true;
    carriage.add(duct);

    const ductFront = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.7, 0.02), darkMaterial);
    ductFront.position.set(0, -0.42, 0.38);
    carriage.add(ductFront);

    // Open spout: metal floor + walls + hood, no black void plane.
    const spout = new THREE.Group();
    spout.position.set(0, -0.92, 0.28);
    spout.rotation.x = -0.55;
    carriage.add(spout);

    const floorPlate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.58), chuteFloor);
    floorPlate.position.set(0, -0.14, 0.18);
    floorPlate.receiveShadow = true;
    spout.add(floorPlate);

    const floorRib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.5), chuteAccent);
    floorRib.position.set(0, -0.11, 0.2);
    spout.add(floorRib);

    for (const direction of [-1, 1] as const) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.58), chuteInner);
      wall.position.set(direction * 0.26, 0.0, 0.16);
      wall.castShadow = true;
      spout.add(wall);
    }

    const backWall = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.3, 0.05), chuteInner);
    backWall.position.set(0, 0.0, -0.12);
    spout.add(backWall);

    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.05, 0.5), chuteMetal);
    hood.position.set(0, 0.18, 0.14);
    hood.castShadow = true;
    spout.add(hood);

    // Gold exit frame around the open mouth.
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.045, 0.05), chuteAccent);
    frameTop.position.set(0, 0.16, 0.4);
    spout.add(frameTop);
    const frameBottom = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.045, 0.05), chuteAccent);
    frameBottom.position.set(0, -0.16, 0.44);
    spout.add(frameBottom);
    for (const direction of [-1, 1] as const) {
      const frameSide = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.32, 0.05), chuteAccent);
      frameSide.position.set(direction * 0.27, 0.0, 0.42);
      spout.add(frameSide);
    }

    // Exit lip / tray extending forward.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.035, 0.2), chuteAccent);
    lip.position.set(0, -0.18, 0.52);
    spout.add(lip);

    const cheekLeft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.16), chuteMetal);
    cheekLeft.position.set(-0.25, -0.14, 0.5);
    spout.add(cheekLeft);
    const cheekRight = cheekLeft.clone();
    cheekRight.position.x = 0.25;
    spout.add(cheekRight);

    const mouthMarker = new THREE.Object3D();
    mouthMarker.position.copy(this.coinChuteMouthLocal);
    carriage.add(mouthMarker);

    const chuteLight = new THREE.PointLight("#b8e8ff", 12, 2.8, 2);
    chuteLight.position.set(0, -0.55, 0.45);
    carriage.add(chuteLight);

    // Warm light from inside the spout so the metal floor reads clearly.
    const mouthGlow = new THREE.PointLight("#ffe0a0", 11, 1.4, 1.8);
    mouthGlow.position.set(0, -0.95, 0.55);
    carriage.add(mouthGlow);

    this.updateCoinChute(0);
  }

  private updateCoinChute(deltaSeconds: number): void {
    if (!this.coinChuteCarriage) {
      return;
    }

    this.coinChuteTime += deltaSeconds;
    // Triangle shuttle: nearly constant speed, quick turnaround at the ends.
    const roundTripSeconds = 3.4;
    const phase = (this.coinChuteTime / roundTripSeconds) % 1;
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    this.coinChuteX = THREE.MathUtils.lerp(this.coinChuteMinX, this.coinChuteMaxX, tri);
    this.coinChuteCarriage.position.x = this.coinChuteX;
    this.coinChuteCarriage.updateMatrixWorld(true);
    this.coinChuteMouthWorld.copy(this.coinChuteMouthLocal);
    this.coinChuteCarriage.localToWorld(this.coinChuteMouthWorld);
  }

  private getCoinChuteDropPose(): { x: number; y: number; z: number } {
    if (!this.coinChuteCarriage) {
      return {
        x: 0,
        y: this.getPusherSurfaceY() + 1.1,
        z: this.pusherApertureZ + 0.55,
      };
    }
    this.coinChuteCarriage.updateMatrixWorld(true);
    this.coinChuteMouthWorld.copy(this.coinChuteMouthLocal);
    this.coinChuteCarriage.localToWorld(this.coinChuteMouthWorld);
    return {
      x: this.coinChuteMouthWorld.x,
      y: this.coinChuteMouthWorld.y,
      z: this.coinChuteMouthWorld.z,
    };
  }

  private addLedTechFrame(
    width: number,
    height: number,
    x: number,
    y: number,
    z: number,
    depth = 0.06,
  ): void {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.1, height + 0.1, depth),
      new THREE.MeshStandardMaterial({
        color: "#0a1018",
        emissive: "#04060c",
        metalness: 0.84,
        roughness: 0.26,
      }),
    );
    frame.position.set(x, y, z - depth / 2 - 0.008);
    this.scene.add(frame);

    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: "#00e8ff",
      emissive: "#00e8ff",
      emissiveIntensity: 0.35,
      metalness: 0.62,
      roughness: 0.18,
    });
    for (const [edgeWidth, edgeHeight, offsetX, offsetY] of [
      [width + 0.12, 0.018, 0, height / 2 + 0.04],
      [width + 0.12, 0.018, 0, -height / 2 - 0.04],
      [0.018, height + 0.12, -width / 2 - 0.04, 0],
      [0.018, height + 0.12, width / 2 + 0.04, 0],
    ] as const) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(edgeWidth, edgeHeight, 0.02), edgeMaterial);
      edge.position.set(x + offsetX, y + offsetY, z + 0.004);
      this.scene.add(edge);
    }
  }

  private getLedCellGeometry(width: number, height: number, depth: number): THREE.BoxGeometry {
    const key = `${width.toFixed(4)}:${height.toFixed(4)}:${depth.toFixed(4)}`;
    const cached = this.ledCellGeometryCache.get(key);
    if (cached) {
      return cached;
    }
    const geometry = new THREE.BoxGeometry(width, height, depth);
    this.ledCellGeometryCache.set(key, geometry);
    return geometry;
  }

  private addLedMatrix(
    x: number,
    y: number,
    z: number,
    cols: number,
    rows: number,
    width: number,
    height: number,
    colors: string[],
    mode: "marquee" | "wave" | "burst" | "spark" | "pattern",
    speed: number,
    phase: number,
  ): void {
    const cellW = width / cols;
    const cellH = height / rows;
    const gap = 0.014;
    const segments: THREE.MeshStandardMaterial[] = [];
    const geometry = this.getLedCellGeometry(cellW - gap, cellH - gap, 0.016);

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const color = colors[(col + row * 2) % colors.length];
        const material = new THREE.MeshStandardMaterial({
          color: "#061018",
          emissive: color,
          emissiveIntensity: 0.05,
          metalness: 0.48,
          roughness: 0.2,
        });
        segments.push(material);

        const cell = new THREE.Mesh(geometry, material);
        cell.position.set(
          x - width / 2 + cellW / 2 + col * cellW,
          y - height / 2 + cellH / 2 + row * cellH,
          z,
        );
        this.scene.add(cell);
      }
    }

    this.pusherLedStrips.push({ segments, speed, phase, tail: 5, mode, cols, rows });
  }

  private addLedStripLine(
    x: number,
    y: number,
    z: number,
    length: number,
    count: number,
    orientation: "horizontal" | "vertical",
    colors: string[],
    speed: number,
    phase: number,
  ): void {
    const segments: THREE.MeshStandardMaterial[] = [];
    const cellLength = length / count;
    const gap = 0.012;
    const size =
      orientation === "horizontal"
        ? ([cellLength - gap, 0.038, 0.018] as const)
        : ([0.038, cellLength - gap, 0.018] as const);
    const geometry = this.getLedCellGeometry(size[0], size[1], size[2]);

    for (let index = 0; index < count; index += 1) {
      const color = colors[index % colors.length];
      const material = new THREE.MeshStandardMaterial({
        color: "#061018",
        emissive: color,
        emissiveIntensity: 0.05,
        metalness: 0.5,
        roughness: 0.18,
      });
      segments.push(material);

      const cell = new THREE.Mesh(geometry, material);
      const offset = -length / 2 + cellLength / 2 + index * cellLength;
      cell.position.set(
        orientation === "horizontal" ? x + offset : x,
        orientation === "horizontal" ? y : y + offset,
        z,
      );
      this.scene.add(cell);
    }

    this.pusherLedStrips.push({ segments, speed, phase, tail: 4, mode: "marquee" });
  }

  private addLedPerimeterChase(
    width: number,
    height: number,
    x: number,
    y: number,
    z: number,
    colors: string[],
    speed: number,
  ): void {
    const segments: THREE.MeshStandardMaterial[] = [];
    const perSide = 6;
    const positions: Array<[number, number]> = [];
    const geometry = this.getLedCellGeometry(0.042, 0.042, 0.02);

    for (let index = 0; index < perSide; index += 1) {
      const t = index / (perSide - 1);
      positions.push([x - width / 2 + t * width, y + height / 2]);
    }
    for (let index = 1; index < perSide; index += 1) {
      const t = index / (perSide - 1);
      positions.push([x + width / 2, y + height / 2 - t * height]);
    }
    for (let index = 1; index < perSide; index += 1) {
      const t = index / (perSide - 1);
      positions.push([x + width / 2 - t * width, y - height / 2]);
    }
    for (let index = 1; index < perSide - 1; index += 1) {
      const t = index / (perSide - 1);
      positions.push([x - width / 2, y - height / 2 + t * height]);
    }

    positions.forEach(([px, py], index) => {
      const color = colors[index % colors.length];
      const material = new THREE.MeshStandardMaterial({
        color: "#061018",
        emissive: color,
        emissiveIntensity: 0.05,
        metalness: 0.5,
        roughness: 0.18,
      });
      segments.push(material);

      const cell = new THREE.Mesh(geometry, material);
      cell.position.set(px, py, z);
      this.scene.add(cell);
    });

    this.pusherLedStrips.push({ segments, speed, phase: 0, tail: 6, mode: "marquee" });
  }

  private updatePusherBackWallDecor(deltaSeconds: number): void {
    if (this.pusherLedStrips.length === 0) {
      return;
    }

    // LED material updates are CPU-heavy; ~20 Hz is enough for the chase look.
    this.pusherDecorElapsed += deltaSeconds;
    this.ledUpdateAccumulator += deltaSeconds;
    if (this.ledUpdateAccumulator < 0.05) {
      return;
    }
    this.ledUpdateAccumulator = 0;

    const time = this.pusherDecorElapsed;

    for (const strip of this.pusherLedStrips) {
      const count = strip.segments.length;
      if (count === 0) {
        continue;
      }

      if (strip.mode === "marquee") {
        const head = (time * strip.speed + strip.phase) % count;
        strip.segments.forEach((material, index) => {
          let distance = index - head;
          if (distance < 0) {
            distance += count;
          }
          material.emissiveIntensity =
            distance < 0.6 ? 2.25 : distance < strip.tail ? 1.35 - distance * 0.22 : 0.04;
        });
        continue;
      }

      if (strip.mode === "pattern" && strip.cols && strip.rows) {
        this.updateLedPatternStrip(strip, time);
        continue;
      }

      if (strip.mode === "wave" && strip.cols && strip.rows) {
        strip.segments.forEach((material, index) => {
          const col = index % strip.cols!;
          const row = Math.floor(index / strip.cols!);
          const wave = Math.sin(col * 0.72 + row * 0.48 - time * strip.speed + strip.phase);
          material.emissiveIntensity = 0.04 + (wave * 0.5 + 0.5) * 1.85;
        });
        continue;
      }

      if (strip.mode === "burst" && strip.cols && strip.rows) {
        const centerCol = (strip.cols - 1) / 2;
        const centerRow = (strip.rows - 1) / 2;
        const maxRadius = Math.hypot(centerCol, centerRow) + 1.2;
        const radius = (time * strip.speed + strip.phase) % (maxRadius + 1.5);
        strip.segments.forEach((material, index) => {
          const col = index % strip.cols!;
          const row = Math.floor(index / strip.cols!);
          const distance = Math.hypot(col - centerCol, row - centerRow);
          const band = Math.abs(distance - radius);
          material.emissiveIntensity = band < 0.85 ? 2.1 - band * 0.9 : 0.03;
        });
        continue;
      }

      if (strip.mode === "spark" && strip.cols && strip.rows) {
        const cycle = Math.floor(time * strip.speed + strip.phase);
        strip.segments.forEach((material, index) => {
          const col = index % strip.cols!;
          const row = Math.floor(index / strip.cols!);
          const hash = (col * 17 + row * 31 + cycle * 13) % 97;
          const flicker = Math.sin(time * 11 + index * 0.7 + strip.phase);
          const active = hash > 68 || (hash > 48 && flicker > 0.35);
          material.emissiveIntensity = active ? 0.85 + flicker * 0.55 : 0.03 + Math.max(flicker, 0) * 0.06;
        });
      }
    }
  }

  private updateLedPatternStrip(
    strip: {
      segments: THREE.MeshStandardMaterial[];
      speed: number;
      phase: number;
      cols?: number;
      rows?: number;
    },
    time: number,
  ): void {
    const cols = strip.cols!;
    const rows = strip.rows!;
    const period = Math.max(1.05, 2.35 / strip.speed);
    const local = (time + strip.phase) % period;
    const cycle = Math.floor((time + strip.phase) / period);
    const flashWindow = 0.55;
    const flashProgress = local / flashWindow;
    const isFlashing = local < flashWindow;

    // Idle: almost dark with rare twinkles, then suddenly stamp a glyph.
    if (!isFlashing) {
      strip.segments.forEach((material, index) => {
        const hash = (index * 19 + cycle * 7) % 53;
        const twinkle = hash > 48 ? 0.18 + Math.sin(time * 14 + index) * 0.08 : 0.02;
        material.emissiveIntensity = twinkle;
      });
      return;
    }

    const glyphNames = this.getLedGlyphNames(cols, rows);
    const glyphName = glyphNames[cycle % glyphNames.length];
    const mask = this.getLedGlyphMask(glyphName, cols, rows, cycle);
    const blink =
      flashProgress < 0.08 || (flashProgress > 0.18 && flashProgress < 0.28)
        ? 0.15
        : flashProgress > 0.82
          ? Math.max(0, 1 - (flashProgress - 0.82) / 0.18)
          : 1;
    const punch = flashProgress < 0.12 ? 2.55 : 2.05;

    strip.segments.forEach((material, index) => {
      if (mask[index]) {
        material.emissiveIntensity = punch * blink;
      } else {
        material.emissiveIntensity = blink > 0.8 ? 0.04 : 0.02;
      }
    });
  }

  private getLedGlyphNames(cols: number, rows: number): string[] {
    if (cols >= 18) {
      return ["star", "lightning", "boltBurst", "diamond", "arrow", "sparkCross", "starField", "zigzag"];
    }
    if (rows >= 12) {
      return ["lightning", "star", "arrow", "sparkCross", "boltBurst", "diamond"];
    }
    return ["star", "lightning", "arrow", "sparkCross", "diamond", "zigzag"];
  }

  private getLedGlyphMask(name: string, cols: number, rows: number, seed: number): Uint8Array {
    const key = `${name}:${cols}x${rows}:${seed % 4}`;
    const cached = this.ledGlyphCache.get(key);
    if (cached) {
      return cached;
    }

    const mask = new Uint8Array(cols * rows);
    const stamp = (glyph: string[], offsetX = 0, offsetY = 0): void => {
      const gw = glyph[0]?.length ?? 0;
      const gh = glyph.length;
      const originX = Math.floor((cols - gw) / 2) + offsetX;
      const originY = Math.floor((rows - gh) / 2) + offsetY;
      for (let row = 0; row < gh; row += 1) {
        for (let col = 0; col < gw; col += 1) {
          if (glyph[row][col] !== "#") {
            continue;
          }
          const x = originX + col;
          // Matrix row 0 is the bottom of the panel; flip so glyph row 0 stays visually on top.
          const y = originY + (gh - 1 - row);
          if (x < 0 || y < 0 || x >= cols || y >= rows) {
            continue;
          }
          mask[y * cols + x] = 1;
        }
      }
    };

    const variant = seed % 4;
    if (name === "star") {
      stamp(this.ledGlyphStar(), variant === 1 ? -2 : variant === 2 ? 2 : 0, variant === 3 ? 1 : 0);
      if (cols >= 18) {
        stamp(this.ledGlyphMiniStar(), -Math.floor(cols * 0.28), -Math.floor(rows * 0.18));
        stamp(this.ledGlyphMiniStar(), Math.floor(cols * 0.26), Math.floor(rows * 0.16));
      }
    } else if (name === "lightning") {
      stamp(this.ledGlyphLightning(), variant === 1 ? -1 : variant === 2 ? 1 : 0, 0);
    } else if (name === "boltBurst") {
      stamp(this.ledGlyphLightning(), -Math.max(1, Math.floor(cols * 0.12)), 0);
      stamp(this.ledGlyphMiniStar(), Math.floor(cols * 0.22), -Math.floor(rows * 0.2));
      stamp(this.ledGlyphMiniStar(), Math.floor(cols * 0.18), Math.floor(rows * 0.22));
    } else if (name === "diamond") {
      stamp(this.ledGlyphDiamond(), 0, 0);
    } else if (name === "arrow") {
      stamp(this.ledGlyphArrow(), 0, variant % 2 === 0 ? 0 : 1);
    } else if (name === "sparkCross") {
      stamp(this.ledGlyphSparkCross(), 0, 0);
      if (cols >= 16) {
        stamp(this.ledGlyphMiniStar(), -Math.floor(cols * 0.3), 0);
        stamp(this.ledGlyphMiniStar(), Math.floor(cols * 0.3), 0);
      }
    } else if (name === "starField") {
      stamp(this.ledGlyphMiniStar(), -Math.floor(cols * 0.28), -Math.floor(rows * 0.2));
      stamp(this.ledGlyphStar(), 0, 0);
      stamp(this.ledGlyphMiniStar(), Math.floor(cols * 0.3), Math.floor(rows * 0.18));
      stamp(this.ledGlyphMiniStar(), Math.floor(cols * 0.08), -Math.floor(rows * 0.28));
    } else if (name === "zigzag") {
      stamp(this.ledGlyphZigzag(cols, rows), 0, 0);
    } else {
      stamp(this.ledGlyphStar(), 0, 0);
    }

    this.ledGlyphCache.set(key, mask);
    return mask;
  }

  private ledGlyphStar(): string[] {
    return [
      "...#...",
      "...#...",
      "##.#.##",
      ".#####.",
      "##.#.##",
      "...#...",
      "...#...",
    ];
  }

  private ledGlyphMiniStar(): string[] {
    return [
      ".#.",
      "###",
      ".#.",
    ];
  }

  private ledGlyphLightning(): string[] {
    return [
      "..###.",
      ".###..",
      ".##...",
      "####..",
      ".###..",
      "..##..",
      "..###.",
      ".###..",
      ".##...",
    ];
  }

  private ledGlyphDiamond(): string[] {
    return [
      "...#...",
      "..###..",
      ".#####.",
      "#######",
      ".#####.",
      "..###..",
      "...#...",
    ];
  }

  private ledGlyphArrow(): string[] {
    return [
      "...#...",
      "..###..",
      ".#####.",
      "...#...",
      "...#...",
      "...#...",
      "...#...",
    ];
  }

  private ledGlyphSparkCross(): string[] {
    return [
      "#.....#",
      ".#...#.",
      "..#.#..",
      "...#...",
      "..#.#..",
      ".#...#.",
      "#.....#",
    ];
  }

  private ledGlyphZigzag(cols: number, rows: number): string[] {
    const width = Math.min(cols, 11);
    const height = Math.min(rows, 7);
    const lines: string[] = [];
    for (let row = 0; row < height; row += 1) {
      let line = "";
      for (let col = 0; col < width; col += 1) {
        const on =
          col === Math.floor((row / Math.max(height - 1, 1)) * (width - 1)) ||
          col === Math.floor(((height - 1 - row) / Math.max(height - 1, 1)) * (width - 1));
        line += on ? "#" : ".";
      }
      lines.push(line);
    }
    return lines;
  }

  private createAmusementParkBackdrop(): void {
    const hallBackZ = this.floorBackZ - 5.6;
    const hallWidth = TABLE.width + 7.2;
    const hallHeight = 7.4;
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: "#3a2848",
      emissive: "#221430",
      metalness: 0.08,
      roughness: 0.88,
    });

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(hallWidth + 4, 16),
      new THREE.MeshStandardMaterial({
        color: "#221828",
        emissive: "#140e1c",
        metalness: 0.04,
        roughness: 0.92,
      }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, hallHeight, -1.2);
    this.scene.add(ceiling);

    const hallFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(hallWidth + 6, 18),
      new THREE.MeshStandardMaterial({
        map: this.createHallFloorTexture(),
        color: "#ffffff",
        emissive: "#181020",
        emissiveIntensity: 0.28,
        metalness: 0.12,
        roughness: 0.78,
      }),
    );
    hallFloor.rotation.x = -Math.PI / 2;
    hallFloor.position.set(0, -2.38, -1.8);
    hallFloor.receiveShadow = true;
    this.scene.add(hallFloor);

    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(hallWidth, hallHeight), wallMaterial);
    backWall.position.set(0, hallHeight / 2 - 1.1, hallBackZ);
    this.scene.add(backWall);

    for (const direction of [-1, 1] as const) {
      const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(12, hallHeight), wallMaterial);
      sideWall.position.set(direction * (hallWidth / 2 + 0.4), hallHeight / 2 - 1.1, -2.4);
      sideWall.rotation.y = direction * (-Math.PI / 2);
      this.scene.add(sideWall);
    }

    const techStripColors = ["#00e8ff", "#4da6ff", "#00f5d4", "#7b8cff", "#00e8ff"];
    for (let index = 0; index < techStripColors.length; index += 1) {
      const stripWidth = hallWidth - 1.2 - index * 0.35;
      this.addTechLightStrip(
        stripWidth,
        techStripColors[index],
        new THREE.Vector3(0, 2.15 + index * 0.42, hallBackZ + 0.08),
      );
    }

    for (const direction of [-1, 1] as const) {
      this.addTechLightStrip(
        0.045,
        direction === -1 ? "#00e8ff" : "#7b8cff",
        new THREE.Vector3(direction * (hallWidth / 2 - 0.55), 3.35, hallBackZ + 0.1),
        0,
        4.8,
        0.014,
      );
    }

    const sign = this.createTechHudDecal("欢乐世界", "#00e8ff", 4.6);
    sign.position.set(0, 5.05, hallBackZ + 0.12);
    this.scene.add(sign);

    const subSign = this.createTechHudDecal("COIN ARCADE", "#7b8cff", 3.2);
    subSign.position.set(0, 4.05, hallBackZ + 0.1);
    this.scene.add(subSign);

    const panelColors = ["#00e8ff", "#4da6ff", "#00f5d4"];
    for (let index = 0; index < panelColors.length; index += 1) {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(1.35, 1.85),
        new THREE.MeshStandardMaterial({
          color: "#121820",
          emissive: panelColors[index],
          emissiveMap: this.createTechPanelTexture(panelColors[index]),
          emissiveIntensity: 0.95,
          metalness: 0.62,
          roughness: 0.28,
        }),
      );
      const offset = (index - 1) * 2.15;
      panel.position.set(offset, 2.65, hallBackZ + 0.1);
      this.scene.add(panel);

      this.addTechLightStrip(1.22, panelColors[index], new THREE.Vector3(offset, 3.62, hallBackZ + 0.11), 0, 0.035, 0.01);
      this.addTechLightStrip(1.22, panelColors[index], new THREE.Vector3(offset, 1.68, hallBackZ + 0.11), 0, 0.035, 0.01);
    }

    const ledColors = ["#00e8ff", "#4da6ff", "#00f5d4", "#7b8cff", "#00e8ff", "#4da6ff"];
    for (let index = 0; index < ledColors.length; index += 1) {
      const t = index / (ledColors.length - 1);
      const x = -hallWidth / 2 + 0.8 + t * (hallWidth - 1.6);
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.06, 0.12),
        new THREE.MeshStandardMaterial({
          color: "#101620",
          emissive: "#060a10",
          metalness: 0.78,
          roughness: 0.32,
        }),
      );
      housing.position.set(x, hallHeight - 0.38, 0.2);
      this.scene.add(housing);

      const led = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.018, 0.04),
        new THREE.MeshStandardMaterial({
          color: ledColors[index],
          emissive: ledColors[index],
          emissiveIntensity: 1.65,
          metalness: 0.42,
          roughness: 0.18,
        }),
      );
      led.position.set(x, hallHeight - 0.36, 0.24);
      this.scene.add(led);
    }

    for (const direction of [-1, 1] as const) {
      const cabinet = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 2.4, 0.72),
        new THREE.MeshStandardMaterial({
          color: "#241830",
          emissive: direction === -1 ? "#ff4d8a" : "#6ee8ff",
          emissiveIntensity: 0.28,
          metalness: 0.34,
          roughness: 0.62,
        }),
      );
      cabinet.position.set(direction * (hallWidth / 2 - 0.55), 0.15, hallBackZ + 1.8);
      this.scene.add(cabinet);

      const marquee = new THREE.Mesh(
        new THREE.BoxGeometry(0.92, 0.04, 0.04),
        new THREE.MeshStandardMaterial({
          color: direction === -1 ? "#00e8ff" : "#7b8cff",
          emissive: direction === -1 ? "#00e8ff" : "#7b8cff",
          emissiveMap: this.createTechStripTexture(direction === -1 ? "#00e8ff" : "#7b8cff", 0.92),
          emissiveIntensity: 1.45,
          metalness: 0.52,
          roughness: 0.22,
        }),
      );
      marquee.position.set(direction * (hallWidth / 2 - 0.55), 1.55, hallBackZ + 2.18);
      this.scene.add(marquee);
    }

    this.addTechLightStrip(
      hallWidth - 2.4,
      "#00e8ff",
      new THREE.Vector3(0, hallHeight - 0.95, 1.8),
      -0.12,
      0.05,
      0.012,
    );
  }

  private addTechLightStrip(
    width: number,
    color: string,
    position: THREE.Vector3,
    rotationX = 0,
    height = 0.05,
    depth = 0.08,
  ): void {
    const track = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.08, height + 0.03, depth + 0.03),
      new THREE.MeshStandardMaterial({
        color: "#0c1018",
        emissive: "#04060a",
        metalness: 0.82,
        roughness: 0.28,
      }),
    );
    track.position.copy(position);
    track.rotation.x = rotationX;
    this.scene.add(track);

    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveMap: this.createTechStripTexture(color, width),
        emissiveIntensity: 1.55,
        metalness: 0.46,
        roughness: 0.18,
      }),
    );
    strip.position.copy(position);
    strip.position.z += 0.015;
    strip.rotation.x = rotationX;
    this.scene.add(strip);

    for (const direction of [-1, 1] as const) {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, height + 0.02, depth + 0.02),
        new THREE.MeshStandardMaterial({
          color: "#182028",
          emissive: color,
          emissiveIntensity: 0.35,
          metalness: 0.74,
          roughness: 0.24,
        }),
      );
      cap.position.copy(position);
      cap.position.x += direction * (width / 2 + 0.02);
      cap.position.z += 0.012;
      cap.rotation.x = rotationX;
      this.scene.add(cap);
    }
  }

  private createTechStripTexture(color: string, stripWidth = 8): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#06080c";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const segmentCount = 28;
      const gap = 6;
      const segmentWidth = (canvas.width - gap * (segmentCount + 1)) / segmentCount;
      for (let index = 0; index < segmentCount; index += 1) {
        const x = gap + index * (segmentWidth + gap);
        const gradient = ctx.createLinearGradient(x, 0, x, canvas.height);
        gradient.addColorStop(0, color);
        gradient.addColorStop(0.45, "#ffffff");
        gradient.addColorStop(1, color);
        ctx.fillStyle = gradient;
        ctx.fillRect(x, 4, segmentWidth, canvas.height - 8);

        if (index % 4 === 0) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
          ctx.fillRect(x + segmentWidth * 0.38, 1, segmentWidth * 0.24, 2);
        }
      }

      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(Math.max(2, Math.round(stripWidth / 1.8)), 1);
    return texture;
  }

  private createTechPanelTexture(color: string): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#0a1018";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= canvas.width; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);

      ctx.globalAlpha = 0.28;
      for (let index = 0; index < 5; index += 1) {
        const y = 48 + index * 56;
        ctx.fillStyle = color;
        ctx.fillRect(34, y, canvas.width - 68, 10);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(34, y, (canvas.width - 68) * (0.35 + index * 0.12), 3);
      }

      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(canvas.width - 42, 42, 18, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private createTechHudDecal(text: string, color: string, width: number): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const height = width * (canvas.height / canvas.width);
    if (!ctx) {
      return new THREE.Mesh(new THREE.PlaneGeometry(width, height));
    }

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '800 96px "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';

    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 36;
    ctx.fillText(text, centerX, centerY);
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    ctx.strokeRect(72, 56, canvas.width - 144, canvas.height - 112);

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.fillText(text, centerX, centerY);

    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.globalAlpha = 0.55;
    ctx.fillText(text, centerX, centerY - 1);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    return new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        emissive: color,
        emissiveIntensity: 0.72,
        roughness: 0.28,
        metalness: 0.42,
        depthWrite: false,
      }),
    );
  }

  private createHallFloorTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#2a2038";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const tile = 64;
      for (let y = 0; y < canvas.height; y += tile) {
        for (let x = 0; x < canvas.width; x += tile) {
          const even = ((x / tile) + (y / tile)) % 2 === 0;
          ctx.fillStyle = even ? "#342840" : "#2e2436";
          ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);
        }
      }

      ctx.strokeStyle = "rgba(255, 140, 200, 0.12)";
      ctx.lineWidth = 2;
      for (let x = 0; x <= canvas.width; x += tile) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y += tile) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
  }

  private createNeonDecal(text: string, color: string, width: number): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const height = width * (canvas.height / canvas.width);
    if (!ctx) {
      return new THREE.Mesh(new THREE.PlaneGeometry(width, height));
    }

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '900 108px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif';

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 48;
    ctx.fillText(text, centerX, centerY);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillText(text, centerX, centerY);
    ctx.restore();

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff6fb";
    ctx.fillText(text, centerX, centerY);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    return new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        emissive: color,
        emissiveIntensity: 0.85,
        roughness: 0.35,
        metalness: 0.08,
        depthWrite: false,
      }),
    );
  }

  private createDecor(): void {
    this.createAmusementParkBackdrop();

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: "#b7efff",
      transparent: true,
      opacity: 0.12,
      transmission: 0.94,
      roughness: 0.06,
      metalness: 0,
    });
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

  private createSprayPaintDecal(text: string, color: string, width: number): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const height = width * (canvas.height / canvas.width);
    if (!ctx) {
      return new THREE.Mesh(new THREE.PlaneGeometry(width, height));
    }

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '800 112px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif';

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 32;
    ctx.fillText(text, centerX, centerY);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.48;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillText(text, centerX, centerY);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.86;
    ctx.fillStyle = color;
    ctx.fillText(text, centerX, centerY);
    ctx.restore();

    ctx.fillStyle = color;
    for (let index = 0; index < 80; index += 1) {
      ctx.globalAlpha = 0.06 + Math.random() * 0.16;
      ctx.beginPath();
      ctx.arc(
        centerX + (Math.random() - 0.5) * 820,
        centerY + (Math.random() - 0.5) * 150,
        0.5 + Math.random() * 1.8,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    const paint = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        roughness: 0.96,
        metalness: 0.02,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    paint.renderOrder = 1;
    return paint;
  }

  private ensureCoinLooksReady(): Promise<void> {
    if (this.coinRefImage) {
      return Promise.resolve();
    }
    if (this.coinLooksReady) {
      return this.coinLooksReady;
    }

    this.coinLooksReady = new Promise<void>((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        this.coinRefImage = image;
        this.coinLookCache.clear();
        resolve();
      };
      image.onerror = () => {
        console.warn("Failed to load coin reference texture; using procedural fallback.");
        resolve();
      };
      image.src = "/textures/coin-gold-ref.png";
    });

    return this.coinLooksReady;
  }

  private getCoinFacePalette(style: CoinFaceStyle): {
    base: string;
    mid: string;
    highlight: string;
    shade: string;
    roughness: number;
    clearcoat: number;
    metalness: number;
    envIntensity: number;
  } {
    // Satin struck-gold look from the Roman solidus reference.
    if (style === "copper") {
      return {
        base: "#b87333",
        mid: "#d4a574",
        highlight: "#e8c49a",
        shade: "#7a4a22",
        roughness: 0.38,
        clearcoat: 0.05,
        metalness: 0.78,
        envIntensity: 0.7,
      };
    }
    if (style === "prism") {
      return {
        base: "#d4a017",
        mid: "#f0d060",
        highlight: "#ffe9a0",
        shade: "#8a6208",
        roughness: 0.28,
        clearcoat: 0.12,
        metalness: 0.82,
        envIntensity: 0.85,
      };
    }
    return {
      base: "#c9962e",
      mid: "#e0b84a",
      highlight: "#f0d878",
      shade: "#8a6818",
      roughness: 0.32,
      clearcoat: 0.06,
      metalness: 0.8,
      envIntensity: 0.78,
    };
  }

  private createCoinNormalFromAlbedo(albedoCanvas: HTMLCanvasElement): THREE.CanvasTexture {
    const size = albedoCanvas.width;
    const srcCtx = albedoCanvas.getContext("2d");
    const out = document.createElement("canvas");
    out.width = size;
    out.height = size;
    const ctx = out.getContext("2d");
    if (!srcCtx || !ctx) {
      return new THREE.CanvasTexture(out);
    }

    // Light blur first so photo grain doesn't become noisy normals.
    ctx.filter = "blur(1.2px)";
    ctx.drawImage(albedoCanvas, 0, 0);
    ctx.filter = "none";
    const src = ctx.getImageData(0, 0, size, size).data;
    const dst = ctx.createImageData(size, size);
    const lum = (i: number) => (src[i]! * 0.299 + src[i + 1]! * 0.587 + src[i + 2]! * 0.114) / 255;
    const strength = 1.7;

    for (let y = 1; y < size - 1; y += 1) {
      for (let x = 1; x < size - 1; x += 1) {
        const i = (y * size + x) * 4;
        const left = lum((y * size + (x - 1)) * 4);
        const right = lum((y * size + (x + 1)) * 4);
        const up = lum(((y - 1) * size + x) * 4);
        const down = lum(((y + 1) * size + x) * 4);
        const dx = (left - right) * strength;
        const dy = (up - down) * strength;
        const dz = 1;
        const len = Math.hypot(dx, dy, dz) || 1;
        dst.data[i] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
        dst.data[i + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
        dst.data[i + 2] = Math.round(((dz / len) * 0.5 + 0.5) * 255);
        dst.data[i + 3] = 255;
      }
    }
    ctx.putImageData(dst, 0, 0);

    const texture = new THREE.CanvasTexture(out);
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    return texture;
  }

  private createCoinFaceTexture(style: CoinFaceStyle): {
    map: THREE.CanvasTexture;
    normalMap: THREE.CanvasTexture;
  } {
    const palette = this.getCoinFacePalette(style);
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      return { map, normalMap: new THREE.CanvasTexture(canvas) };
    }

    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.5;

    ctx.fillStyle = palette.mid;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    if (this.coinRefImage) {
      const image = this.coinRefImage;
      const cover = Math.max(size / image.width, size / image.height) * 1.14;
      const drawW = image.width * cover;
      const drawH = image.height * cover;

      if (style === "copper") {
        ctx.filter = "hue-rotate(-28deg) saturate(0.92) brightness(0.94) contrast(1.08)";
      } else if (style === "prism") {
        ctx.filter = "saturate(1.1) brightness(1.03) contrast(1.08)";
      } else {
        ctx.filter = "saturate(1.08) brightness(1.03) contrast(1.08)";
      }

      ctx.drawImage(image, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
      ctx.filter = "none";

      if (style === "copper") {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = "rgba(190, 120, 70, 0.28)";
        ctx.fillRect(0, 0, size, size);
        ctx.globalCompositeOperation = "source-over";
      }

      if (style === "prism") {
        ctx.globalCompositeOperation = "soft-light";
        for (let i = 0; i < 8; i += 1) {
          const start = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(cx, cy, radius * 0.97, start, start + Math.PI / 10);
          ctx.arc(cx, cy, radius * 0.82, start + Math.PI / 10, start, true);
          ctx.closePath();
          ctx.fillStyle = i % 2 === 0 ? "rgba(61, 214, 198, 0.45)" : "rgba(255, 107, 157, 0.4)";
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }
    } else {
      const disc = ctx.createRadialGradient(cx - 60, cy - 80, 20, cx, cy, radius);
      disc.addColorStop(0, palette.highlight);
      disc.addColorStop(0.55, palette.mid);
      disc.addColorStop(1, palette.base);
      ctx.fillStyle = disc;
      ctx.fillRect(0, 0, size, size);
    }

    const rimShade = ctx.createRadialGradient(cx, cy, radius * 0.78, cx, cy, radius);
    rimShade.addColorStop(0, "rgba(0,0,0,0)");
    rimShade.addColorStop(0.7, "rgba(80, 50, 10, 0.08)");
    rimShade.addColorStop(1, "rgba(40, 24, 4, 0.28)");
    ctx.fillStyle = rimShade;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    map.needsUpdate = true;

    return {
      map,
      normalMap: this.createCoinNormalFromAlbedo(canvas),
    };
  }

  private createCoinEdgeTexture(style: CoinFaceStyle): THREE.CanvasTexture {
    const palette = this.getCoinFacePalette(style);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, palette.shade);
      gradient.addColorStop(0.4, palette.mid);
      gradient.addColorStop(0.7, palette.highlight);
      gradient.addColorStop(1, palette.base);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const reedCount = 140;
      for (let i = 0; i < reedCount; i += 1) {
        const x = (i / reedCount) * canvas.width;
        const width = canvas.width / reedCount;
        ctx.fillStyle = i % 2 === 0 ? "rgba(255, 210, 110, 0.18)" : "rgba(90, 55, 12, 0.2)";
        ctx.fillRect(x, 1, width * 0.4, canvas.height - 2);
      }

      if (style === "prism") {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = "#3dd6c6";
        ctx.fillRect(0, 4, canvas.width, 8);
        ctx.fillStyle = "#ff6b9d";
        ctx.fillRect(0, canvas.height - 12, canvas.width, 8);
        ctx.globalAlpha = 1;
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1);
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    return texture;
  }

  private getCoinLook(style: CoinFaceStyle): {
    faceMaterial: THREE.MeshStandardMaterial;
    edgeMaterial: THREE.MeshStandardMaterial;
  } {
    const cached = this.coinLookCache.get(style);
    if (cached) {
      return cached;
    }

    const palette = this.getCoinFacePalette(style);
    const { map: faceMap, normalMap } = this.createCoinFaceTexture(style);
    const edgeMap = this.createCoinEdgeTexture(style);

    // StandardMaterial is much cheaper than Physical+clearcoat for many coins.
    const faceMaterial = new THREE.MeshStandardMaterial({
      map: faceMap,
      normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      color: "#ffffff",
      metalness: palette.metalness,
      roughness: palette.roughness,
      envMapIntensity: palette.envIntensity,
      emissive: "#000000",
      emissiveIntensity: 0,
    });

    const edgeMaterial = new THREE.MeshStandardMaterial({
      map: edgeMap,
      color: palette.mid,
      metalness: Math.min(0.92, palette.metalness + 0.06),
      roughness: Math.min(0.42, palette.roughness + 0.04),
      envMapIntensity: palette.envIntensity,
      emissive: "#000000",
      emissiveIntensity: 0,
    });

    const look = { faceMaterial, edgeMaterial };
    this.coinLookCache.set(style, look);
    return look;
  }

  private rollCoinFaceStyle(bias: "default" | "tower" | "rain" = "default"): CoinFaceStyle {
    if (bias === "tower") {
      return "gold";
    }
    const roll = Math.random();
    if (bias === "rain") {
      if (roll > 0.7) {
        return "prism";
      }
      return "gold";
    }
    if (roll > 0.9) {
      return "prism";
    }
    if (roll > 0.22) {
      return "gold";
    }
    return "copper";
  }

  private coinRewardForStyle(style: CoinFaceStyle): number {
    if (style === "prism") {
      return Math.round(BASE_CONFIG.baseCoinReward * 2);
    }
    if (style === "gold") {
      return Math.round(BASE_CONFIG.baseCoinReward * 1.25);
    }
    return BASE_CONFIG.baseCoinReward;
  }

  private createCoinMesh(style: CoinFaceStyle = "gold"): THREE.Group {
    const coin = new THREE.Group();
    const { faceMaterial, edgeMaterial } = this.getCoinLook(style);

    // Keep original coin thickness/radius; only the face pattern changed.
    const radius = 0.35;
    const height = 0.12;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 48, 1, true),
      edgeMaterial,
    );
    body.castShadow = false;
    body.receiveShadow = true;
    coin.add(body);

    const faceGeometry = new THREE.CircleGeometry(0.348, 48);
    for (const direction of [-1, 1] as const) {
      const face = new THREE.Mesh(faceGeometry, faceMaterial);
      face.rotation.x = direction === 1 ? -Math.PI / 2 : Math.PI / 2;
      face.position.y = direction * 0.05;
      face.castShadow = false;
      face.receiveShadow = true;
      coin.add(face);
    }

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.338, 0.011, 10, 48), edgeMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.castShadow = false;
    rim.receiveShadow = true;
    coin.add(rim);

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

  private getCollectionPitCenterZ(): number {
    return this.collectionCenterZ + 0.02;
  }

  private getCollectionPitDepth(): number {
    return this.collectionDepth - 0.22;
  }

  private createSlotFrame(
    x: number,
    width: number,
    label: string,
    color: string,
    slot: SlotType,
  ): void {
    const mouthWidth = width - 0.18;
    const mouthCenterZ = this.getCollectionPitCenterZ() + 0.02;
    const mouthY = this.getFloorSurfaceY() - 0.06;
    const shaftHeight = 2.35;
    const shaftBackZ = this.floorFrontZ - 0.08;

    const pitWallMaterial = new THREE.MeshStandardMaterial({
      color: "#071018",
      emissive: "#03070c",
      metalness: 0.12,
      roughness: 0.92,
    });

    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(mouthWidth - 0.28, shaftHeight, 0.08),
      pitWallMaterial,
    );
    backWall.position.set(x, mouthY - shaftHeight * 0.5, shaftBackZ);
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    const depthShade = new THREE.Mesh(
      new THREE.PlaneGeometry(mouthWidth - 0.42, shaftHeight * 0.62),
      new THREE.MeshBasicMaterial({
        color: "#000000",
        transparent: true,
        opacity: 0.72,
      }),
    );
    depthShade.position.set(
      x,
      mouthY - shaftHeight * 0.62,
      shaftBackZ + 0.05,
    );
    this.scene.add(depthShade);

    const pitLight = new THREE.PointLight(color, 4.2, 2.4, 2.4);
    pitLight.position.set(x, mouthY - 0.55, mouthCenterZ + 0.08);
    this.scene.add(pitLight);
    this.slotPitLights.set(slot, pitLight);

    const paintWidth = Math.min(mouthWidth - 0.42, 2.18);
    const paint = this.createSprayPaintDecal(label, color, paintWidth);
    paint.position.set(x, mouthY - 0.58, shaftBackZ + 0.055);
    this.scene.add(paint);
  }

  private createSideExitRamps(
    _floorMaterial: THREE.Material,
    _wallMaterial: THREE.Material,
  ): void {
    const floorSurfaceY = this.getFloorSurfaceY();
    const thickness = this.floorThickness;
    const halfThickness = thickness / 2;
    const joinX = this.playfieldWidth / 2;
    const run = this.sideRampRun;
    const drop = this.sideRampDrop;
    const rampDepth = this.sideRampEndZ - this.sideExitLineZ;
    const zStart = this.sideExitLineZ;
    const zCenter = (this.sideExitLineZ + this.sideRampEndZ) / 2;
    const slopeLength = Math.hypot(run, drop);
    const angle = Math.atan2(drop, run);
    const wallTopY = floorSurfaceY + this.sideWallCenterOffsetY + this.sideWallHeight / 2;
    const coverThickness = 0.1;
    const cheekThickness = 0.1;
    const tunnelClearBottom = floorSurfaceY - drop - 0.08;
    const tunnelInnerHeight = wallTopY - tunnelClearBottom;

    const rampMaterial = new THREE.MeshPhysicalMaterial({
      color: "#3d6f8c",
      emissive: "#1a4058",
      emissiveIntensity: 0.35,
      metalness: 0.72,
      roughness: 0.22,
      clearcoat: 0.4,
      clearcoatRoughness: 0.18,
    });
    const tunnelShellMaterial = new THREE.MeshStandardMaterial({
      color: "#152838",
      emissive: "#0a1824",
      emissiveIntensity: 0.45,
      metalness: 0.48,
      roughness: 0.55,
    });
    const tunnelInnerMaterial = new THREE.MeshStandardMaterial({
      color: "#1a3044",
      emissive: "#123048",
      emissiveIntensity: 0.55,
      metalness: 0.28,
      roughness: 0.62,
    });
    const accentStripMaterial = new THREE.MeshStandardMaterial({
      color: "#57e8ff",
      emissive: "#57e8ff",
      emissiveIntensity: 1.45,
      metalness: 0.35,
      roughness: 0.22,
    });
    const warmStripMaterial = new THREE.MeshStandardMaterial({
      color: "#ffd166",
      emissive: "#ffb347",
      emissiveIntensity: 1.25,
      metalness: 0.28,
      roughness: 0.28,
    });

    for (const direction of [-1, 1] as const) {
      const topCenterX = direction * (joinX + run / 2);
      const topCenterY = floorSurfaceY - drop / 2;
      const normalX = -direction * Math.sin(angle);
      const normalY = Math.cos(angle);
      const rampCenterX = topCenterX - normalX * halfThickness;
      const rampCenterY = topCenterY - normalY * halfThickness;
      const rotationZ = -direction * angle;
      const accentColor = direction === -1 ? "#ff6ec7" : "#57e8ff";

      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(slopeLength, thickness, rampDepth),
        rampMaterial,
      );
      ramp.position.set(rampCenterX, rampCenterY, zCenter);
      ramp.rotation.z = rotationZ;
      ramp.castShadow = true;
      ramp.receiveShadow = true;
      this.scene.add(ramp);
      this.addStaticBody(
        vec3(slopeLength / 2, halfThickness, rampDepth / 2),
        vec3(rampCenterX, rampCenterY, zCenter),
        0,
        rotationZ,
      );

      // Center guide stripe on the ramp so the slope reads clearly.
      const guide = new THREE.Mesh(
        new THREE.BoxGeometry(slopeLength * 0.96, 0.012, 0.16),
        warmStripMaterial,
      );
      guide.position.set(
        topCenterX + normalX * 0.01,
        topCenterY + normalY * 0.01,
        zCenter,
      );
      guide.rotation.z = rotationZ;
      this.scene.add(guide);

      const cover = new THREE.Mesh(
        new THREE.BoxGeometry(run + 0.04, coverThickness, rampDepth + 0.04),
        tunnelShellMaterial,
      );
      cover.position.set(topCenterX, wallTopY - coverThickness / 2, zCenter);
      cover.castShadow = true;
      cover.receiveShadow = true;
      this.scene.add(cover);
      this.addStaticBody(
        vec3((run + 0.04) / 2, coverThickness / 2, (rampDepth + 0.04) / 2),
        vec3(topCenterX, wallTopY - coverThickness / 2, zCenter),
      );

      // Underside light bar makes the tunnel ceiling catch highlights.
      const ceilingBar = new THREE.Mesh(
        new THREE.BoxGeometry(run * 0.88, 0.03, 0.08),
        accentStripMaterial.clone(),
      );
      (ceilingBar.material as THREE.MeshStandardMaterial).color.set(accentColor);
      (ceilingBar.material as THREE.MeshStandardMaterial).emissive.set(accentColor);
      ceilingBar.position.set(topCenterX, wallTopY - coverThickness - 0.02, zCenter);
      this.scene.add(ceilingBar);

      for (const zEdge of [zStart, this.sideRampEndZ] as const) {
        const cheek = new THREE.Mesh(
          new THREE.BoxGeometry(run + 0.04, tunnelInnerHeight, cheekThickness),
          tunnelInnerMaterial,
        );
        const cheekZ = zEdge + (zEdge === zStart ? cheekThickness / 2 : -cheekThickness / 2);
        cheek.position.set(topCenterX, tunnelClearBottom + tunnelInnerHeight / 2, cheekZ);
        cheek.castShadow = true;
        cheek.receiveShadow = true;
        this.scene.add(cheek);
        this.addStaticBody(
          vec3((run + 0.04) / 2, tunnelInnerHeight / 2, cheekThickness / 2),
          vec3(topCenterX, tunnelClearBottom + tunnelInnerHeight / 2, cheekZ),
        );

        const cheekTrim = new THREE.Mesh(
          new THREE.BoxGeometry(run * 0.92, 0.04, 0.03),
          accentStripMaterial.clone(),
        );
        (cheekTrim.material as THREE.MeshStandardMaterial).color.set(accentColor);
        (cheekTrim.material as THREE.MeshStandardMaterial).emissive.set(accentColor);
        cheekTrim.position.set(
          topCenterX,
          wallTopY - 0.08,
          cheekZ + (zEdge === zStart ? 0.02 : -0.02),
        );
        this.scene.add(cheekTrim);
      }

      const outerFrame = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, coverThickness + 0.04, rampDepth + 0.04),
        tunnelShellMaterial,
      );
      outerFrame.position.set(
        direction * (joinX + run + 0.02),
        wallTopY - coverThickness / 2,
        zCenter,
      );
      outerFrame.castShadow = true;
      this.scene.add(outerFrame);

      // Entrance lintel + sill glow so the tunnel mouth reads clearly.
      const mouthLintel = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, rampDepth + 0.1),
        accentStripMaterial.clone(),
      );
      (mouthLintel.material as THREE.MeshStandardMaterial).color.set(accentColor);
      (mouthLintel.material as THREE.MeshStandardMaterial).emissive.set(accentColor);
      mouthLintel.position.set(direction * (joinX + 0.02), wallTopY - 0.06, zCenter);
      this.scene.add(mouthLintel);

      const mouthSill = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.03, rampDepth * 0.9),
        warmStripMaterial,
      );
      mouthSill.position.set(direction * (joinX + 0.05), floorSurfaceY + 0.02, zCenter);
      this.scene.add(mouthSill);

      // Interior fill: wash the slope and walls with colored light.
      const tunnelFill = new THREE.PointLight(accentColor, 18, 3.4, 1.6);
      tunnelFill.position.set(
        direction * (joinX + run * 0.42),
        floorSurfaceY - drop * 0.25 + 0.35,
        zCenter,
      );
      this.scene.add(tunnelFill);

      const tunnelDownlight = new THREE.SpotLight(accentColor, 42, 4.2, 0.72, 0.55, 1.4);
      tunnelDownlight.position.set(topCenterX, wallTopY - 0.12, zCenter);
      tunnelDownlight.target.position.set(
        direction * (joinX + run * 0.72),
        floorSurfaceY - drop * 0.7,
        zCenter,
      );
      tunnelDownlight.castShadow = false;
      this.scene.add(tunnelDownlight, tunnelDownlight.target);

      const mouthGlow = new THREE.PointLight("#ffd166", 10, 2.6, 2);
      mouthGlow.position.set(direction * (joinX + 0.25), floorSurfaceY + 0.35, zCenter);
      this.scene.add(mouthGlow);

      const exitGlow = new THREE.PointLight(accentColor, 12, 2.8, 2);
      exitGlow.position.set(
        direction * (joinX + run + 0.15),
        floorSurfaceY - drop + 0.2,
        zCenter,
      );
      this.scene.add(exitGlow);
    }
  }

  private addStaticBody(
    halfExtents: Vec3,
    position: Vec3,
    rotationX = 0,
    rotationZ = 0,
    rotationY = 0,
  ): void {
    this.physics.createStaticBox({
      halfExtents,
      position,
      rotationX,
      rotationY,
      rotationZ,
    });
  }

  private addFloorSegment(
    material: THREE.MeshStandardMaterial | null,
    width: number,
    depth: number,
    centerX: number,
    centerZ: number,
    options?: { visible?: boolean },
  ): void {
    if (width <= 0.04 || depth <= 0.04) {
      return;
    }

    if (options?.visible !== false && material) {
      const segment = new THREE.Mesh(
        new THREE.BoxGeometry(width, this.floorThickness, depth),
        material,
      );
      segment.position.set(centerX, this.floorY, centerZ);
      segment.castShadow = true;
      segment.receiveShadow = true;
      this.scene.add(segment);
    }

    this.addStaticBody(
      vec3(width / 2, this.floorThickness / 2, depth / 2),
      vec3(centerX, this.floorY, centerZ),
    );
  }

  private createPlayfieldFloorWithCenterHole(floorMaterial: THREE.MeshStandardMaterial): void {
    const radius = this.floorHoleRadius;
    const playHalfW = this.playfieldWidth / 2;

    // One continuous floor plate with a true circular hatch — no square cutout.
    const floorShape = new THREE.Shape();
    floorShape.moveTo(-playHalfW, this.floorBackZ);
    floorShape.lineTo(playHalfW, this.floorBackZ);
    floorShape.lineTo(playHalfW, this.sideExitLineZ);
    floorShape.lineTo(-playHalfW, this.sideExitLineZ);
    floorShape.lineTo(-playHalfW, this.floorBackZ);

    const hatch = new THREE.Path();
    hatch.absarc(
      this.floorHoleCenterX,
      this.floorHoleCenterZ,
      radius,
      0,
      Math.PI * 2,
      true,
    );
    floorShape.holes.push(hatch);

    const floorGeometry = new THREE.ExtrudeGeometry(floorShape, {
      depth: this.floorThickness,
      bevelEnabled: false,
      curveSegments: 64,
    });
    // Lay the shape onto XZ: shape Y → world Z, extrude → world -Y, then shift so
    // the plate is centered like the box floors (center at floorY).
    floorGeometry.rotateX(Math.PI / 2);
    floorGeometry.translate(0, this.floorThickness / 2, 0);

    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.position.set(0, this.floorY, 0);
    floorMesh.castShadow = true;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);

    // Invisible physics colliders: outer slabs + polar ring (circle open only).
    this.addCircularHolePhysicsColliders(radius);

    const shaftMaterial = new THREE.MeshStandardMaterial({
      color: "#081018",
      emissive: "#0a1824",
      emissiveIntensity: 0.12,
      metalness: 0.72,
      roughness: 0.38,
      side: THREE.DoubleSide,
    });
    const shaftCenterY = this.floorY - this.floorHoleShaftDepth / 2 - this.floorThickness * 0.15;
    const shaftWall = new THREE.Mesh(
      new THREE.CylinderGeometry(radius + 0.02, radius + 0.02, this.floorHoleShaftDepth, 64, 1, true),
      shaftMaterial,
    );
    shaftWall.position.set(this.floorHoleCenterX, shaftCenterY, this.floorHoleCenterZ);
    shaftWall.castShadow = true;
    shaftWall.receiveShadow = true;
    this.scene.add(shaftWall);

    const shaftFloor = new THREE.Mesh(
      new THREE.CircleGeometry(radius + 0.06, 64),
      shaftMaterial,
    );
    shaftFloor.rotation.x = -Math.PI / 2;
    shaftFloor.position.set(
      this.floorHoleCenterX,
      this.floorY - this.floorHoleShaftDepth - this.floorThickness * 0.2,
      this.floorHoleCenterZ,
    );
    shaftFloor.receiveShadow = true;
    this.scene.add(shaftFloor);

    this.createFloorHoleDashedRing(radius);
    this.createCircularHoleCovers(radius, floorMaterial);
  }

  private createFloorHoleDashedRing(radius: number): void {
    const segments = 96;
    const surfaceY = this.getFloorSurfaceY() + 0.003;
    const points: THREE.Vector3[] = [];

    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      points.push(
        new THREE.Vector3(
          this.floorHoleCenterX + Math.cos(angle) * radius,
          surfaceY,
          this.floorHoleCenterZ + Math.sin(angle) * radius,
        ),
      );
    }

    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({
        color: "#7ec8e3",
        dashSize: 0.14,
        gapSize: 0.1,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      }),
    );
    ring.computeLineDistances();
    ring.renderOrder = 2;
    this.scene.add(ring);
  }

  private addCircularHolePhysicsColliders(radius: number): void {
    const holeMinX = this.floorHoleCenterX - radius;
    const holeMaxX = this.floorHoleCenterX + radius;
    const holeMinZ = this.floorHoleCenterZ - radius;
    const holeMaxZ = this.floorHoleCenterZ + radius;
    const playHalfW = this.playfieldWidth / 2;

    const backDepth = holeMinZ - this.floorBackZ;
    if (backDepth > 0.04) {
      this.addFloorSegment(
        null,
        this.playfieldWidth,
        backDepth,
        0,
        (this.floorBackZ + holeMinZ) / 2,
        { visible: false },
      );
    }

    const frontDepth = this.sideExitLineZ - holeMaxZ;
    if (frontDepth > 0.04) {
      this.addFloorSegment(
        null,
        this.playfieldWidth,
        frontDepth,
        0,
        (holeMaxZ + this.sideExitLineZ) / 2,
        { visible: false },
      );
    }

    const sideDepth = holeMaxZ - holeMinZ;
    const leftWidth = playHalfW + holeMinX;
    if (leftWidth > 0.04) {
      this.addFloorSegment(
        null,
        leftWidth,
        sideDepth,
        (-playHalfW + holeMinX) / 2,
        this.floorHoleCenterZ,
        { visible: false },
      );
    }

    const rightWidth = playHalfW - holeMaxX;
    if (rightWidth > 0.04) {
      this.addFloorSegment(
        null,
        rightWidth,
        sideDepth,
        (holeMaxX + playHalfW) / 2,
        this.floorHoleCenterZ,
        { visible: false },
      );
    }

    // Cover square-corner leftovers outside the circle (physics only).
    const segments = 32;
    const outerRadius = radius * Math.SQRT2 + 0.04;
    const ringThickness = outerRadius - radius;
    const midRadius = radius + ringThickness * 0.5;

    for (let index = 0; index < segments; index += 1) {
      const angle = ((index + 0.5) / segments) * Math.PI * 2;
      const span = (Math.PI * 2) / segments;
      const chord = 2 * midRadius * Math.sin(span * 0.5);
      this.addStaticBody(
        vec3(ringThickness / 2, this.floorThickness / 2, Math.max(0.05, chord * 0.55)),
        vec3(
          this.floorHoleCenterX + Math.cos(angle) * midRadius,
          this.floorY,
          this.floorHoleCenterZ + Math.sin(angle) * midRadius,
        ),
        0,
        0,
        -angle,
      );
    }
  }

  private createCircularHoleCovers(
    radius: number,
    floorMaterial: THREE.MeshStandardMaterial,
  ): void {
    // Same look as the playfield so the closed hatch reads as continuous floor.
    const coverMaterial = floorMaterial.clone();
    const coverThickness = 0.05;
    // Fill the hole almost to the rim; tiny clearance avoids z-fighting with the floor edge.
    const coverRadius = radius - 0.004;
    // Overlap past the diameter so the two halves meet without a center seam.
    const seamOverlap = 0.02;
    // Top of the lid flush with the floor surface.
    const coverCenterY = this.getFloorSurfaceY() - coverThickness / 2;

    for (const direction of [-1, 1] as const) {
      const shape = new THREE.Shape();
      if (direction > 0) {
        shape.moveTo(-seamOverlap, -coverRadius);
        shape.absarc(0, 0, coverRadius, -Math.PI / 2, Math.PI / 2, false);
        shape.lineTo(-seamOverlap, coverRadius);
        shape.lineTo(-seamOverlap, -coverRadius);
      } else {
        shape.moveTo(seamOverlap, coverRadius);
        shape.absarc(0, 0, coverRadius, Math.PI / 2, (Math.PI * 3) / 2, false);
        shape.lineTo(seamOverlap, -coverRadius);
        shape.lineTo(seamOverlap, coverRadius);
      }

      const coverGeometry = new THREE.ExtrudeGeometry(shape, {
        depth: coverThickness,
        bevelEnabled: false,
        curveSegments: 48,
      });
      coverGeometry.rotateX(Math.PI / 2);
      coverGeometry.translate(0, coverThickness / 2, 0);

      const coverMesh = new THREE.Mesh(coverGeometry, coverMaterial);
      coverMesh.position.set(this.floorHoleCenterX, coverCenterY, this.floorHoleCenterZ);
      coverMesh.castShadow = true;
      coverMesh.receiveShadow = true;
      this.scene.add(coverMesh);

      const coverBody = this.physics.createKinematicBody(
        vec3(
          this.floorHoleCenterX + direction * (coverRadius * 0.5),
          coverCenterY,
          this.floorHoleCenterZ,
        ),
        0,
        [
          {
            halfExtents: vec3(
              coverRadius * 0.5 + seamOverlap * 0.5,
              coverThickness / 2,
              coverRadius,
            ),
            friction: 0.42,
          },
        ],
      );

      this.floorHoleCovers.push({
        mesh: coverMesh,
        body: coverBody,
        closedX: this.floorHoleCenterX,
        closedY: coverCenterY,
        closedZ: this.floorHoleCenterZ,
        bodyOffsetX: direction * (coverRadius * 0.5),
        bodyOffsetY: 0,
        slideX: direction * (coverRadius * 0.98),
        dropY: 0.72,
      });
    }
  }

  private updateFloorHole(deltaSeconds: number): void {
    const lerpSpeed = this.coinTowerPhase === "closing" ? 7.5 : 5.5;
    this.floorHoleOpen = lerpNumber(this.floorHoleOpen, this.floorHoleTarget, Math.min(1, deltaSeconds * lerpSpeed));

    for (const cover of this.floorHoleCovers) {
      const open = this.floorHoleOpen;
      const x = cover.closedX + cover.slideX * open;
      const y = cover.closedY - cover.dropY * open;
      const z = cover.closedZ;
      cover.mesh.position.set(x, y, z);
      cover.body.setNextKinematicPose(
        x + cover.bodyOffsetX,
        y + cover.bodyOffsetY,
        z,
        0,
      );
    }
  }

  private advanceCoinTower(deltaSeconds: number): void {
    if (this.coinTowerPhase === "opening") {
      if (this.floorHoleOpen >= 0.96) {
        this.spawnCoinTower();
        this.coinTowerPhase = "rising";
        this.coinTowerRise = 0;
      }
      return;
    }

    if (this.coinTowerPhase === "rising") {
      const riseDuration = 2.5;
      this.coinTowerRise = Math.min(1, this.coinTowerRise + deltaSeconds / riseDuration);
      if (this.coinTowerRise >= 1) {
        this.coinTowerPhase = "closing";
        this.floorHoleTarget = 0;
        this.pushMessage("金币塔已升起，升降口关闭。");
        this.renderState();
      }
      return;
    }

    if (this.coinTowerPhase === "closing" && this.floorHoleOpen <= 0.02) {
      this.floorHoleOpen = 0;
      this.coinTowerPhase = "stabilizing";
      this.coinTowerStabilizeLeft = 0.85;
      this.captureCoinTowerRestPoses();
      this.lockCoinTowerBodies();
      return;
    }

    if (this.coinTowerPhase === "stabilizing") {
      this.coinTowerStabilizeLeft = Math.max(0, this.coinTowerStabilizeLeft - deltaSeconds);
      this.lockCoinTowerBodies();
      if (this.coinTowerStabilizeLeft <= 0) {
        this.finalizeCoinTower();
        this.coinTowerPhase = "idle";
        this.renderState();
      }
    }
  }

  private applyCoinTowerLift(): void {
    if (this.coinTowerPhase === "stabilizing") {
      this.lockCoinTowerBodies();
      return;
    }
    if (this.coinTowerPhase !== "rising" && this.coinTowerPhase !== "closing") {
      return;
    }

    const eased =
      this.coinTowerPhase === "closing" ? 1 : easeInOutCubic(this.coinTowerRise);
    for (const item of this.items) {
      if (!item.towerLift || !this.coinTowerItemIds.has(item.id)) {
        continue;
      }
      const y = THREE.MathUtils.lerp(item.towerLift.startY, item.towerLift.targetY, eased);
      item.body.position.set(item.towerLift.x, y, item.towerLift.z);
      item.body.setVelocitySilent(0, 0, 0);
      item.body.setAngularVelocitySilent(0, 0, 0);
      item.body.sleep();
    }
  }

  private captureCoinTowerRestPoses(): void {
    this.coinTowerRestPoses.clear();
    for (const item of this.items) {
      if (!this.coinTowerItemIds.has(item.id) || !item.towerLift) {
        continue;
      }
      this.coinTowerRestPoses.set(item.id, {
        x: item.towerLift.x,
        y: item.towerLift.targetY,
        z: item.towerLift.z,
      });
    }
  }

  private lockCoinTowerBodies(): void {
    for (const item of this.items) {
      if (!this.coinTowerItemIds.has(item.id)) {
        continue;
      }
      const rest = this.coinTowerRestPoses.get(item.id);
      const lift = item.towerLift;
      const x = rest?.x ?? lift?.x ?? item.body.position.x;
      const y = rest?.y ?? lift?.targetY ?? item.body.position.y;
      const z = rest?.z ?? lift?.z ?? item.body.position.z;
      item.body.position.set(x, y, z);
      item.body.setVelocitySilent(0, 0, 0);
      item.body.setAngularVelocitySilent(0, 0, 0);
      item.body.sleep();
    }
  }

  private finalizeCoinTower(): void {
    for (const item of this.items) {
      if (!this.coinTowerItemIds.has(item.id)) {
        continue;
      }
      delete item.towerLift;
      const rest = this.coinTowerRestPoses.get(item.id);
      if (rest) {
        item.body.position.set(rest.x, rest.y, rest.z);
      }
      item.body.setVelocitySilent(0, 0, 0);
      item.body.setAngularVelocitySilent(0, 0, 0);
      item.body.sleep();
      this.coinTowerAnchoredIds.add(item.id);
    }
    this.coinTowerItemIds.clear();
  }

  private maintainAnchoredCoinTower(): void {
    if (this.coinTowerAnchoredIds.size === 0) {
      return;
    }

    const pusherFrontZ = this.pusherBody
      ? this.pusherBody.position.z + this.pusherDepth / 2
      : this.pusherStartZ;
    // Pusher max front is around z=-0.12; tower sits near floorHoleCenterZ.
    // Release as soon as the face reaches the rear of the tower pack.
    const releaseZ = this.floorHoleCenterZ - this.floorHoleRadius - 0.2;
    if (pusherFrontZ >= releaseZ) {
      this.releaseAnchoredCoinTower();
      return;
    }

    for (const item of this.items) {
      if (!this.coinTowerAnchoredIds.has(item.id)) {
        continue;
      }
      const rest = this.coinTowerRestPoses.get(item.id);
      if (!rest) {
        continue;
      }
      item.body.position.set(rest.x, rest.y, rest.z);
      item.body.setVelocitySilent(0, 0, 0);
      item.body.setAngularVelocitySilent(0, 0, 0);
      item.body.sleep();
    }
  }

  private releaseAnchoredCoinTower(): void {
    if (this.coinTowerAnchoredIds.size === 0) {
      return;
    }

    for (const item of this.items) {
      if (!this.coinTowerAnchoredIds.has(item.id)) {
        continue;
      }
      // Match ordinary dropped-coin damping so the pile isn't glued by tower spawn values.
      item.body.raw.setLinearDamping(1.2);
      item.body.raw.setAngularDamping(2.8);
      item.body.wakeUp();
      item.body.setVelocitySilent(0, 0, 0);
      item.body.setAngularVelocitySilent(0, 0, 0);
    }

    this.coinTowerAnchoredIds.clear();
    this.coinTowerRestPoses.clear();
  }

  private requestCoinTower(): void {
    if (!this.physicsReady) {
      this.pushMessage("物理引擎还在初始化，请稍后再试。");
      this.renderState();
      return;
    }
    if (this.coinTowerPhase !== "idle") {
      this.pushMessage("金币塔正在升降，请稍候。");
      this.renderState();
      return;
    }

    this.coinTowerPhase = "opening";
    this.coinTowerRise = 0;
    this.coinTowerStabilizeLeft = 0;
    this.floorHoleTarget = 1;
    this.coinTowerItemIds.clear();
    this.coinTowerAnchoredIds.clear();
    this.coinTowerRestPoses.clear();
    this.pushMessage("地板升降口打开，金币塔正在升起。");
    this.renderState();
  }

  private buildCoinTowerLayerOffsets(layer: number): Array<{ x: number; z: number }> {
    // Tight hex packing: center coin + 6-coin ring (prototype “coin circle”).
    const spacing = this.coinTowerCoinRadius * 2 * 0.995;
    const ringRadius = spacing;
    // Alternate layers rotate by half a slot so coins nest in the gaps below.
    const angleOffset = (layer % 2) * (Math.PI / this.coinTowerRingCount);
    const offsets: Array<{ x: number; z: number }> = [{ x: 0, z: 0 }];

    for (let index = 0; index < this.coinTowerRingCount; index += 1) {
      const angle = angleOffset + (index * Math.PI * 2) / this.coinTowerRingCount;
      offsets.push({
        x: Math.cos(angle) * ringRadius,
        z: Math.sin(angle) * ringRadius,
      });
    }

    return offsets;
  }

  private spawnCoinTower(): void {
    const floorSurfaceY = this.getFloorSurfaceY();
    const coinHalfHeight = this.coinTowerLayerStep * 0.5;
    const towerBaseY =
      floorSurfaceY - this.coinTowerLayers * this.coinTowerLayerStep - this.floorHoleShaftDepth * 0.72;

    for (let layer = 0; layer < this.coinTowerLayers; layer += 1) {
      const layerOffsets = this.buildCoinTowerLayerOffsets(layer);
      const targetY = floorSurfaceY + coinHalfHeight + layer * this.coinTowerLayerStep;
      const startY = towerBaseY + layer * this.coinTowerLayerStep;

      for (const offset of layerOffsets) {
        const x = this.floorHoleCenterX + offset.x;
        const z = this.floorHoleCenterZ + offset.z;

        const coinStyle = this.rollCoinFaceStyle("tower");
        const mesh = this.createCoinMesh(coinStyle);
        mesh.position.set(x, startY, z);
        this.scene.add(mesh);

        const body = this.physics.createDynamicBody({
          kind: "coin",
          position: vec3(x, startY, z),
          rotationX: 0,
          velocity: vec3(0, 0, 0),
          angularVelocity: vec3(0, 0, 0),
          linearDamping: 4.2,
          angularDamping: 5.5,
        });
        body.sleep();

        const item: DropItem = {
          id: randomId("tower-coin"),
          type: "coin",
          body,
          mesh,
          baseReward: this.coinRewardForStyle(coinStyle),
          spawnTime: performance.now(),
          collected: false,
          towerLift: { x, z, startY, targetY },
        };
        this.items.push(item);
        this.coinTowerItemIds.add(item.id);
      }
    }
  }

  private isTowerLiftItem(item: DropItem): boolean {
    return (
      Boolean(item.towerLift) ||
      this.coinTowerItemIds.has(item.id) ||
      this.coinTowerAnchoredIds.has(item.id)
    );
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
    this.ui.coinTowerButton.addEventListener("click", () => this.requestCoinTower());
    this.ui.autoDropButton.addEventListener("click", () => {
      this.state.autoDropEnabled = !this.state.autoDropEnabled;
      this.pushMessage(this.state.autoDropEnabled ? "自动投币已开启。" : "自动投币已关闭。");
      this.renderState();
    });
    this.ui.debugToggleButton.addEventListener("click", () => {
      this.state.debugVisible = !this.state.debugVisible;
      this.uiDebugDirty = true;
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
    this.uiDebugDirty = true;
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
    this.flashCoinChuteMouth();
    this.renderState();
    return true;
  }

  private flashCoinChuteMouth(): void {
    if (!this.coinChuteCarriage) {
      return;
    }
    const light = this.coinChuteCarriage.children.find(
      (child) => child instanceof THREE.PointLight,
    ) as THREE.PointLight | undefined;
    if (!light) {
      return;
    }
    const previous = light.intensity;
    light.intensity = previous + 16;
    this.scheduleAction(120, () => {
      if (light.parent) {
        light.intensity = previous;
      }
    });
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
      fromChute?: boolean;
      coinStyle?: CoinFaceStyle;
      coinStyleBias?: "default" | "tower" | "rain";
    },
  ): void {
    if (!this.physicsReady && !this.physics.isReady()) {
      return;
    }

    const useChute = options?.fromChute === true || (x === undefined && z === undefined);
    const chutePose = useChute ? this.getCoinChuteDropPose() : null;
    const spawnX = x ?? chutePose?.x ?? 0;
    const spawnZ =
      z ??
      chutePose?.z ??
      THREE.MathUtils.randFloat(this.floorBackZ + 0.48, this.floorBackZ + 1.18);
    const spawnY =
      options?.spawnY ??
      chutePose?.y ??
      this.getPusherSurfaceY(spawnZ) + 1.18;
    const rotationX = options?.rotationX ?? 0;

    let mesh: THREE.Object3D;
    let baseReward = BASE_CONFIG.baseCoinReward;
    let linearDamping = 0.14;
    let angularDamping = 0.2;

    if (type === "coin") {
      const coinStyle =
        options?.coinStyle ?? this.rollCoinFaceStyle(options?.coinStyleBias ?? "default");
      mesh = this.createCoinMesh(coinStyle);
      baseReward = this.coinRewardForStyle(coinStyle);
      linearDamping = 1.85;
      angularDamping = 4.2;
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
      options?.velocityX ?? (useChute ? THREE.MathUtils.randFloat(-0.08, 0.08) : THREE.MathUtils.randFloat(-0.03, 0.03)),
      useChute ? THREE.MathUtils.randFloat(-0.35, -0.12) : THREE.MathUtils.randFloat(-0.08, 0.01),
      options?.velocityZ ??
        (useChute ? THREE.MathUtils.randFloat(0.55, 0.95) : THREE.MathUtils.randFloat(0.04, 0.14)),
    );
    let angularVelocity = vec3(0, 0, 0);
    if (options?.randomSpin !== false) {
      if (type === "coin") {
        angularVelocity = vec3(
          THREE.MathUtils.randFloat(-0.08, 0.08),
          THREE.MathUtils.randFloat(-0.05, 0.05),
          THREE.MathUtils.randFloat(-0.08, 0.08),
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
          coinStyleBias: "default",
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
        this.updateFloorHole(delta);
        this.advanceCoinTower(delta);
        this.processScheduledActions(now);
        this.updateTimers(delta);
        this.sampleFps(now);
        this.renderState();
        this.renderer.render(this.scene, this.camera);
        return;
      }

      this.updatePusher(delta);
      this.updateCoinChute(delta);
      this.updatePusherBackWallDecor(delta);
      this.updateFloorHole(delta);
      this.advanceCoinTower(delta);
      this.applyPusherAssist();
      this.stepPhysics(delta);
      this.applyCoinTowerLift();
      this.maintainAnchoredCoinTower();
      this.syncMeshes();
      this.collectFxSpawnsThisFrame = 0;
      this.resolveCollections();
      this.updateCollectEffects(delta);
      if (this.collectUiPulsePending) {
        this.collectUiPulsePending = false;
        this.pulseElement(this.ui.coinCard);
      }
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
      if (this.isTowerLiftItem(item)) {
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
      if (this.isTowerLiftItem(item)) {
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
      if (this.isTowerLiftItem(item)) {
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

      if (item.body.position.z < this.floorFrontZ + 0.04 || item.body.position.y > this.getFloorSurfaceY() - 0.12) {
        continue;
      }

      const slot = this.getSlotType(item.body.position.x);
      this.collectItem(item, slot);
    }

    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      if (!this.shouldDespawnItem(item)) {
        continue;
      }
      this.physics.removeBody(item.body);
      this.scene.remove(item.mesh);
      this.items.splice(index, 1);
    }
  }

  private shouldDespawnItem(item: DropItem): boolean {
    if (item.body.position.y < -8) {
      return true;
    }
    if (item.body.position.z > this.collectionCenterZ + this.collectionDepth + 1.2) {
      return true;
    }
    if (Math.abs(item.body.position.x) > TABLE.width) {
      return true;
    }
    return item.collected && item.body.position.z < this.floorFrontZ;
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
    this.spawnCollectEffect(item, slot);

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
    this.collectUiPulsePending = true;
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
            coinStyleBias: "rain",
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

    const autoDropKey = this.state.autoDropEnabled ? "on" : "off";
    if (autoDropKey !== this.lastAutoDropUiKey) {
      this.lastAutoDropUiKey = autoDropKey;
      this.ui.autoDropButton.textContent = this.state.autoDropEnabled ? "自动投币：开" : "自动投币：关";
    }

    const towerKey = `${this.physicsReady}:${this.coinTowerPhase}`;
    if (towerKey !== this.lastTowerButtonKey) {
      this.lastTowerButtonKey = towerKey;
      this.ui.coinTowerButton.disabled = !this.physicsReady || this.coinTowerPhase !== "idle";
      this.ui.coinTowerButton.textContent =
        this.coinTowerPhase === "idle" ? "升起金币塔" : "金币塔升降中…";
    }

    const bonusRatio = clamp(this.displayedBonusCharge / this.state.bonusThreshold, 0, 1);
    const bonusKey = `${bonusRatio.toFixed(3)}:${this.describeBonusLabel()}`;
    if (bonusKey !== this.lastBonusUiKey) {
      this.lastBonusUiKey = bonusKey;
      this.ui.bonusBarFill.style.transform = `scaleX(${bonusRatio})`;
      this.ui.bonusLabel.textContent = this.describeBonusLabel();
    }

    const feverKey =
      this.state.feverTimeLeft > 0 ? `on:${this.state.feverTimeLeft.toFixed(1)}` : "off";
    if (feverKey !== this.lastFeverUiKey) {
      this.lastFeverUiKey = feverKey;
      this.ui.feverPill.classList.toggle("hidden", this.state.feverTimeLeft <= 0);
      if (this.state.feverTimeLeft > 0) {
        this.ui.feverPill.textContent = `FEVER x2 ${this.state.feverTimeLeft.toFixed(1)}s`;
      }
    }

    const physicsStatus = this.getPhysicsStatusViewModel();
    const physicsKey = `${physicsStatus.tone}|${physicsStatus.title}|${physicsStatus.detail}`;
    if (physicsKey !== this.lastPhysicsStatusKey) {
      this.lastPhysicsStatusKey = physicsKey;
      this.ui.physicsStatus.className = `physics-status ${physicsStatus.tone}`;
      const physicsTitle = this.ui.physicsStatus.querySelector<HTMLElement>(".physics-status-title");
      const physicsDetail = this.ui.physicsStatus.querySelector<HTMLElement>(".physics-status-detail");
      if (physicsTitle) {
        physicsTitle.textContent = physicsStatus.title;
      }
      if (physicsDetail) {
        physicsDetail.textContent = physicsStatus.detail;
      }
    }

    if (this.uiTasksDirty) {
      this.renderTasks();
      this.uiTasksDirty = false;
    }
    if (this.uiMessagesDirty) {
      this.renderMessages();
      this.uiMessagesDirty = false;
    }
    if (this.uiDebugDirty) {
      this.syncDebugPanel();
      this.highlightPreset();
      this.uiDebugDirty = false;
    }

    const coinValueCost = this.getUpgradeCost("coinValue");
    const speedCost = this.getUpgradeCost("pusherSpeed");
    const autoCost = this.getUpgradeCost("autoDrop");
    const upgradeKey = `${this.state.upgrades.coinValue}:${coinValueCost}|${this.state.upgrades.pusherSpeed}:${speedCost}|${this.state.upgrades.autoDrop}:${autoCost}`;
    if (upgradeKey !== this.lastUpgradeUiKey) {
      this.lastUpgradeUiKey = upgradeKey;
      this.ui.coinUpgradeButton.textContent = `金币收益 Lv.${this.state.upgrades.coinValue}  升级 ${coinValueCost}`;
      this.ui.speedUpgradeButton.textContent = `推盘速度 Lv.${this.state.upgrades.pusherSpeed}  升级 ${speedCost}`;
      this.ui.autoUpgradeButton.textContent = `自动投币 Lv.${this.state.upgrades.autoDrop}  升级 ${autoCost}`;
      this.ui.economyHint.innerHTML = [
        `<div>普通金币预估收益：<strong>${formatShort(this.getProjectedNormalReward())}</strong></div>`,
        `<div>调试加金币当前生效：<strong>+${formatShort(this.getScaledCoinInjection(100))}</strong></div>`,
      ].join("");
    }

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
    let changed = false;
    for (const task of this.state.tasks) {
      if (task.metric !== metric || task.claimed) {
        continue;
      }
      const next = Math.min(task.goal, task.progress + delta);
      if (next !== task.progress) {
        task.progress = next;
        changed = true;
      }
    }
    if (changed) {
      this.uiTasksDirty = true;
    }
  }

  private claimTask(taskId: string): void {
    const task = this.state.tasks.find((entry) => entry.id === taskId);
    if (!task || task.claimed || task.progress < task.goal) {
      return;
    }

    task.claimed = true;
    this.uiTasksDirty = true;
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

  private getSlotAccentColor(slot: SlotType): string {
    switch (slot) {
      case "chest":
        return "#ffbe5a";
      case "highValue":
        return "#ff6f4d";
      case "bonus":
        return "#54f3ff";
      default:
        return "#ffd166";
    }
  }

  private initCollectEffects(): void {
    for (let i = 0; i < this.collectFxMaxSparks; i += 1) {
      this.collectFxLife[i] = 0;
      this.collectFxPositions[i * 3 + 1] = -999;
    }

    const geometry = new THREE.BufferGeometry();
    const positionAttr = new THREE.BufferAttribute(this.collectFxPositions, 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    const colorAttr = new THREE.BufferAttribute(this.collectFxColors, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", positionAttr);
    geometry.setAttribute("color", colorAttr);

    const material = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.collectFxPoints = new THREE.Points(geometry, material);
    this.collectFxPoints.frustumCulled = false;
    this.collectFxPoints.renderOrder = 4;
    this.scene.add(this.collectFxPoints);

    for (let i = 0; i < 4; i += 1) {
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(this.collectRingGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.frustumCulled = false;
      ring.renderOrder = 3;
      this.scene.add(ring);
      this.collectRingPool.push({
        mesh: ring,
        material: ringMaterial,
        age: 0,
        life: 0.4,
        active: false,
      });
    }
  }

  private spawnCollectEffect(item: DropItem, slot: SlotType): void {
    this.flashSlotPitLight(slot, item.type === "rare" ? 1.35 : item.type === "chest" ? 1.15 : 1);

    if (this.collectFxSpawnsThisFrame >= 3) {
      return;
    }
    this.collectFxSpawnsThisFrame += 1;

    const color = new THREE.Color(this.getSlotAccentColor(slot));
    const rareBoost = item.type === "rare" ? 1.35 : item.type === "chest" ? 1.15 : 1;
    const sparkCount = Math.round(6 * rareBoost);
    const originX = item.body.position.x;
    const originY = Math.min(item.body.position.y + 0.08, this.getFloorSurfaceY() - 0.02);
    const originZ = item.body.position.z;

    for (let i = 0; i < sparkCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.9 + Math.random() * 1.8 * rareBoost;
      this.emitCollectSpark(
        originX,
        originY,
        originZ,
        Math.cos(angle) * speed,
        1.2 + Math.random() * 2.2 * rareBoost,
        Math.sin(angle) * speed * 0.5 - 0.25,
        i % 3 === 0 ? 1 : color.r,
        i % 3 === 0 ? 0.95 : color.g,
        i % 3 === 0 ? 0.78 : color.b,
        0.32 + Math.random() * 0.12,
      );
    }

    this.spawnCollectRing(originX, originY, originZ, color);
  }

  private emitCollectSpark(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    r: number,
    g: number,
    b: number,
    life: number,
  ): void {
    const index = this.collectFxCursor;
    this.collectFxCursor = (index + 1) % this.collectFxMaxSparks;
    const i3 = index * 3;
    this.collectFxPositions[i3] = x;
    this.collectFxPositions[i3 + 1] = y;
    this.collectFxPositions[i3 + 2] = z;
    this.collectFxVelocities[i3] = vx;
    this.collectFxVelocities[i3 + 1] = vy;
    this.collectFxVelocities[i3 + 2] = vz;
    this.collectFxBaseColors[i3] = r;
    this.collectFxBaseColors[i3 + 1] = g;
    this.collectFxBaseColors[i3 + 2] = b;
    this.collectFxColors[i3] = r;
    this.collectFxColors[i3 + 1] = g;
    this.collectFxColors[i3 + 2] = b;
    this.collectFxLife[index] = life;
    this.collectFxMaxLife[index] = life;
  }

  private spawnCollectRing(x: number, y: number, z: number, color: THREE.Color): void {
    const ring = this.collectRingPool.find((entry) => !entry.active) ?? this.collectRingPool[0];
    if (!ring) {
      return;
    }
    ring.active = true;
    ring.age = 0;
    ring.life = 0.38;
    ring.material.color.copy(color);
    ring.material.opacity = 0.85;
    ring.mesh.visible = true;
    ring.mesh.position.set(x, y, z);
    ring.mesh.scale.setScalar(0.55);
  }

  private flashSlotPitLight(slot: SlotType, intensityScale: number): void {
    const current = this.slotPitFlashBoost.get(slot) ?? 0;
    this.slotPitFlashBoost.set(slot, Math.min(14, current + 5.5 * intensityScale));
    this.payoutGlowFlashBoost = Math.min(12, this.payoutGlowFlashBoost + 3.5 * intensityScale);
    this.payoutWarmFlashBoost = Math.min(8, this.payoutWarmFlashBoost + 2.5 * intensityScale);
  }

  private updateCollectEffects(deltaSeconds: number): void {
    const positions = this.collectFxPositions;
    const velocities = this.collectFxVelocities;
    const colors = this.collectFxColors;
    const baseColors = this.collectFxBaseColors;
    const lives = this.collectFxLife;
    const maxLives = this.collectFxMaxLife;
    let needsUpload = false;

    for (let index = 0; index < this.collectFxMaxSparks; index += 1) {
      const life = lives[index];
      if (life <= 0) {
        continue;
      }

      needsUpload = true;
      const nextLife = life - deltaSeconds;
      const i3 = index * 3;
      if (nextLife <= 0) {
        lives[index] = 0;
        positions[i3 + 1] = -999;
        colors[i3] = 0;
        colors[i3 + 1] = 0;
        colors[i3 + 2] = 0;
        continue;
      }

      lives[index] = nextLife;
      velocities[i3 + 1] -= 9.5 * deltaSeconds;
      positions[i3] += velocities[i3] * deltaSeconds;
      positions[i3 + 1] += velocities[i3 + 1] * deltaSeconds;
      positions[i3 + 2] += velocities[i3 + 2] * deltaSeconds;

      const fade = nextLife / Math.max(0.0001, maxLives[index]);
      const brightness = fade * fade;
      colors[i3] = baseColors[i3] * brightness;
      colors[i3 + 1] = baseColors[i3 + 1] * brightness;
      colors[i3 + 2] = baseColors[i3 + 2] * brightness;
    }

    if (needsUpload && this.collectFxPoints) {
      const geometry = this.collectFxPoints.geometry;
      (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    }

    for (const ring of this.collectRingPool) {
      if (!ring.active) {
        continue;
      }
      ring.age += deltaSeconds;
      const t = Math.min(1, ring.age / ring.life);
      ring.mesh.scale.setScalar(0.55 + t * 2.2);
      ring.material.opacity = 0.85 * (1 - t) * (1 - t);
      if (t >= 1) {
        ring.active = false;
        ring.mesh.visible = false;
        ring.material.opacity = 0;
      }
    }

    this.updateCollectLightFlash(deltaSeconds);
  }

  private updateCollectLightFlash(deltaSeconds: number): void {
    const decay = 18 * deltaSeconds;

    for (const [slot, boost] of this.slotPitFlashBoost) {
      const next = Math.max(0, boost - decay);
      if (next > 0) {
        this.slotPitFlashBoost.set(slot, next);
      } else {
        this.slotPitFlashBoost.delete(slot);
      }
      const light = this.slotPitLights.get(slot);
      if (light) {
        light.intensity = 4.2 + next;
      }
    }

    this.payoutGlowFlashBoost = Math.max(0, this.payoutGlowFlashBoost - decay);
    this.payoutWarmFlashBoost = Math.max(0, this.payoutWarmFlashBoost - decay);
    if (this.payoutGlowLight) {
      this.payoutGlowLight.intensity = 12 + this.payoutGlowFlashBoost;
    }
    if (this.payoutWarmLight) {
      this.payoutWarmLight.intensity = 8 + this.payoutWarmFlashBoost;
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
    this.uiMessagesDirty = true;
  }

  private resetSession(): void {
    const previousPresetId = this.state.currentPresetId;
    const previousDebugVisible = this.state.debugVisible;
    this.state = createInitialState(this.debugOverrides);
    this.state.currentPresetId = previousPresetId;
    this.state.tasks = createDefaultTasks();
    this.state.messages = [];
    this.uiTasksDirty = true;
    this.uiMessagesDirty = true;
    this.uiDebugDirty = true;
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
    if (key === "t") {
      event.preventDefault();
      this.requestCoinTower();
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
    this.uiDebugDirty = true;
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
