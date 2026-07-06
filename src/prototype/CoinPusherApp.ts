import * as THREE from "three";
import * as CANNON from "cannon-es";
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

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function lerpNumber(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

export class CoinPusherApp {
  private readonly ui: UIRefs;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private readonly world = new CANNON.World();
  private readonly clock = new THREE.Clock();

  private state: RuntimeState = createInitialState();
  private debugOverrides: DebugOverrides = { ...DEFAULT_DEBUG_OVERRIDES };
  private readonly items: DropItem[] = [];
  private readonly cleanupBodies: CANNON.Body[] = [];
  private readonly scheduledActions: ScheduledAction[] = [];
  private readonly floorMaterial = new CANNON.Material("floor");
  private readonly itemMaterial = new CANNON.Material("item");
  private readonly playfieldWidth = TABLE.width - 0.9;
  private readonly upperDeckDepth = 4.35;
  private readonly upperDeckThickness = 0.18;
  private readonly upperDeckTilt = 0.05;
  private readonly upperDeckY = 0.38;
  private readonly upperDeckCenterZ = -1.55;
  private readonly upperDeckBackZ = -3.72;
  private readonly upperDeckFrontZ = 0.62;
  private readonly lowerDeckDepth = 3.92;
  private readonly lowerDeckThickness = 0.18;
  private readonly lowerDeckTilt = 0.085;
  private readonly lowerDeckY = 0.04;
  private readonly lowerDeckCenterZ = 2.36;
  private readonly lowerDeckBackZ = 0.94;
  private readonly lowerDeckFrontZ = 4.28;
  private readonly payoutGapZ = 4.5;
  private readonly collectionCenterZ = 5.1;
  private readonly collectionDepth = 1.5;
  private readonly collectionFloorY = -0.24;
  private readonly slotSplitX = 1.55;
  private readonly pusherWidth = 6.9;
  private readonly pusherDepth = 3.72;
  private readonly pusherBodyHalfHeight = 0.11;
  private readonly pusherHoverGap = 0.01;
  private readonly pusherStartZ = -2.05;
  private readonly pusherEndZ = -1.24;
  private readonly pusherLiftAmount = 0.06;
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
  private pusherBody!: CANNON.Body;
  private debugPanelBuilt = false;

  public constructor(root: HTMLDivElement) {
    this.ui = createUI(root);
    this.configureRenderer();
    this.configureScene();
    this.configurePhysics();
    this.createTable();
    this.createPusher();
    this.createDecor();
    this.seedBoard();
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
    this.scheduleAction(300, () => {
      this.pushMessage("机台准备完成。按 Space 或点击投币开始。");
    });
    this.loop();
  }

  private configureRenderer(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.ui.viewport.clientWidth || 960, this.ui.viewport.clientHeight || 640);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.ui.viewport.append(this.renderer.domElement);

    this.camera.position.set(0, 7.6, 13.9);
    this.camera.lookAt(0, 0.2, 1.8);

    window.addEventListener("resize", this.handleResize);
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color("#07111d");
    this.scene.fog = new THREE.Fog("#07111d", 18, 30);

    const hemi = new THREE.HemisphereLight("#a6ddff", "#082238", 1.35);
    this.scene.add(hemi);

    const spot = new THREE.SpotLight("#ffd998", 130, 30, 0.42, 0.5, 1);
    spot.position.set(0, 12, 3);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    this.scene.add(spot);

    const rim = new THREE.PointLight("#3fd6ff", 16, 20, 2);
    rim.position.set(-4, 3, -1);
    this.scene.add(rim);

    const frontFill = new THREE.PointLight("#9ac6ff", 30, 20, 2);
    frontFill.position.set(0, 2.35, 6.4);
    this.scene.add(frontFill);
  }

  private configurePhysics(): void {
    this.world.gravity.set(0, -13.5, 0);
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    const solver = this.world.solver as CANNON.GSSolver;
    solver.iterations = 14;
    solver.tolerance = 0.001;

    this.world.defaultContactMaterial.friction = 0.34;
    this.world.defaultContactMaterial.restitution = 0.02;
    this.world.defaultContactMaterial.contactEquationRelaxation = 4;
    this.world.defaultContactMaterial.contactEquationStiffness = 1e8;
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.floorMaterial, this.itemMaterial, {
        friction: 0.42,
        restitution: 0.01,
      }),
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.itemMaterial, this.itemMaterial, {
        friction: 0.3,
        restitution: 0.02,
      }),
    );
  }

  private createTable(): void {
    const cabinet = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE.width + 0.9, 2.7, TABLE.depth + 1.1),
      new THREE.MeshStandardMaterial({
        color: "#0b1826",
        metalness: 0.44,
        roughness: 0.62,
      }),
    );
    cabinet.position.set(0, -1.42, 0.34);
    cabinet.receiveShadow = true;
    this.scene.add(cabinet);

    const trimDeck = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE.width + 0.22, 0.2, TABLE.depth + 0.38),
      new THREE.MeshStandardMaterial({
        color: "#173349",
        metalness: 0.82,
        roughness: 0.2,
      }),
    );
    trimDeck.position.set(0, -0.04, 0.14);
    trimDeck.receiveShadow = true;
    this.scene.add(trimDeck);

    const upperDeck = new THREE.Mesh(
      new THREE.BoxGeometry(this.playfieldWidth, this.upperDeckThickness, this.upperDeckDepth),
      new THREE.MeshStandardMaterial({
        color: "#214d6c",
        emissive: "#13354a",
        metalness: 0.72,
        roughness: 0.24,
      }),
    );
    upperDeck.position.set(0, this.upperDeckY, this.upperDeckCenterZ);
    upperDeck.rotation.x = this.upperDeckTilt;
    upperDeck.receiveShadow = true;
    this.scene.add(upperDeck);

    const lowerDeck = new THREE.Mesh(
      new THREE.BoxGeometry(this.playfieldWidth, this.lowerDeckThickness, this.lowerDeckDepth),
      new THREE.MeshStandardMaterial({
        color: "#163750",
        emissive: "#0d2638",
        metalness: 0.72,
        roughness: 0.28,
      }),
    );
    lowerDeck.position.set(0, this.lowerDeckY, this.lowerDeckCenterZ);
    lowerDeck.rotation.x = this.lowerDeckTilt;
    lowerDeck.receiveShadow = true;
    this.scene.add(lowerDeck);

    const upperDecal = new THREE.Mesh(
      new THREE.PlaneGeometry(this.playfieldWidth - 0.9, this.upperDeckDepth - 0.55),
      new THREE.MeshBasicMaterial({
        color: "#0d7f9f",
        transparent: true,
        opacity: 0.08,
      }),
    );
    upperDecal.rotation.x = -Math.PI / 2 + this.upperDeckTilt;
    upperDecal.position.set(
      0,
      this.getUpperDeckSurfaceY(this.upperDeckCenterZ) + 0.012,
      this.upperDeckCenterZ,
    );
    this.scene.add(upperDecal);

    const lowerDecal = new THREE.Mesh(
      new THREE.PlaneGeometry(this.playfieldWidth - 0.75, this.lowerDeckDepth - 0.58),
      new THREE.MeshBasicMaterial({
        color: "#0f5c75",
        transparent: true,
        opacity: 0.09,
      }),
    );
    lowerDecal.rotation.x = -Math.PI / 2 + this.lowerDeckTilt;
    lowerDecal.position.set(
      0,
      this.getLowerDeckSurfaceY(this.lowerDeckCenterZ) + 0.012,
      this.lowerDeckCenterZ,
    );
    this.scene.add(lowerDecal);

    this.addStaticBody(
      new CANNON.Vec3(this.playfieldWidth / 2, this.upperDeckThickness / 2, this.upperDeckDepth / 2),
      new CANNON.Vec3(0, this.upperDeckY, this.upperDeckCenterZ),
      this.upperDeckTilt,
    );
    this.addStaticBody(
      new CANNON.Vec3(this.playfieldWidth / 2, this.lowerDeckThickness / 2, this.lowerDeckDepth / 2),
      new CANNON.Vec3(0, this.lowerDeckY, this.lowerDeckCenterZ),
      this.lowerDeckTilt,
    );

    const railMaterial = new THREE.MeshStandardMaterial({
      color: "#23485d",
      emissive: "#102434",
      metalness: 0.72,
      roughness: 0.28,
      transparent: true,
      opacity: 0.86,
    });

    const sideSections = [
      { centerZ: this.upperDeckCenterZ, depth: this.upperDeckDepth, tilt: this.upperDeckTilt, baseY: this.getUpperDeckSurfaceY(this.upperDeckCenterZ) },
      { centerZ: this.lowerDeckCenterZ, depth: this.lowerDeckDepth, tilt: this.lowerDeckTilt, baseY: this.getLowerDeckSurfaceY(this.lowerDeckCenterZ) },
    ];
    for (const section of sideSections) {
      for (const direction of [-1, 1] as const) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 1.02, section.depth + 0.08),
          railMaterial,
        );
        rail.position.set(
          direction * (this.playfieldWidth / 2 + 0.1),
          section.baseY + 0.42,
          section.centerZ,
        );
        rail.rotation.x = section.tilt;
        rail.castShadow = true;
        rail.receiveShadow = true;
        this.scene.add(rail);

        this.addStaticBody(
          new CANNON.Vec3(0.1, 0.51, section.depth / 2 + 0.04),
          new CANNON.Vec3(
            direction * (this.playfieldWidth / 2 + 0.1),
            section.baseY + 0.42,
            section.centerZ,
          ),
          section.tilt,
        );
      }
    }

    const upperFrontGuide = new THREE.Mesh(
      new THREE.PlaneGeometry(this.playfieldWidth - 0.26, 0.18),
      new THREE.MeshBasicMaterial({
        color: "#b8d4e3",
        transparent: true,
        opacity: 0.42,
      }),
    );
    upperFrontGuide.position.set(0, this.getUpperDeckSurfaceY(this.upperDeckFrontZ) + 0.008, this.upperDeckFrontZ + 0.02);
    upperFrontGuide.rotation.x = -Math.PI / 2 + this.upperDeckTilt;
    this.scene.add(upperFrontGuide);

    const lowerBackGuide = new THREE.Mesh(
      new THREE.PlaneGeometry(this.playfieldWidth - 0.32, 0.16),
      new THREE.MeshBasicMaterial({
        color: "#85a8bd",
        transparent: true,
        opacity: 0.34,
      }),
    );
    lowerBackGuide.position.set(0, this.getLowerDeckSurfaceY(this.lowerDeckBackZ) + 0.008, this.lowerDeckBackZ - 0.03);
    lowerBackGuide.rotation.x = -Math.PI / 2 + this.lowerDeckTilt;
    this.scene.add(lowerBackGuide);

    for (const direction of [-1, 1] as const) {
      const rearGuide = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.42, 0.42),
        new THREE.MeshStandardMaterial({
          color: "#22516d",
          metalness: 0.6,
          roughness: 0.34,
        }),
      );
      rearGuide.position.set(
        direction * (this.playfieldWidth / 2 - 0.28),
        this.getUpperDeckSurfaceY(this.upperDeckBackZ + 0.08) + 0.18,
        this.upperDeckBackZ + 0.08,
      );
      rearGuide.rotation.x = this.upperDeckTilt;
      rearGuide.castShadow = true;
      rearGuide.receiveShadow = true;
      this.scene.add(rearGuide);
      this.addStaticBody(
        new CANNON.Vec3(0.17, 0.21, 0.21),
        new CANNON.Vec3(
          direction * (this.playfieldWidth / 2 - 0.28),
          this.getUpperDeckSurfaceY(this.upperDeckBackZ + 0.08) + 0.18,
          this.upperDeckBackZ + 0.08,
        ),
        this.upperDeckTilt,
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
    backWall.position.set(0, 1.74, this.upperDeckBackZ - 0.58);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    this.scene.add(backWall);
    this.addStaticBody(
      new CANNON.Vec3((this.playfieldWidth + 0.55) / 2, 1.8, 0.14),
      new CANNON.Vec3(0, 1.74, this.upperDeckBackZ - 0.58),
    );

    const payoutGuide = new THREE.Mesh(
      new THREE.PlaneGeometry(this.playfieldWidth - 0.18, 0.18),
      new THREE.MeshBasicMaterial({
        color: "#d2e1eb",
        transparent: true,
        opacity: 0.4,
      }),
    );
    payoutGuide.position.set(0, this.getLowerDeckSurfaceY(this.lowerDeckFrontZ) + 0.008, this.lowerDeckFrontZ - 0.02);
    payoutGuide.rotation.x = -Math.PI / 2 + this.lowerDeckTilt;
    this.scene.add(payoutGuide);

    const sideDrainMaterial = new THREE.MeshBasicMaterial({
      color: "#02070d",
      transparent: true,
      opacity: 0.56,
    });
    for (const direction of [-1, 1] as const) {
      const sideDrain = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 2.16),
        sideDrainMaterial,
      );
      sideDrain.position.set(
        direction * (this.playfieldWidth / 2 - 0.18),
        this.getLowerDeckSurfaceY(2.65) + 0.008,
        2.65,
      );
      sideDrain.rotation.x = -Math.PI / 2 + this.lowerDeckTilt;
      this.scene.add(sideDrain);
    }

    const collectionBase = new THREE.Mesh(
      new THREE.BoxGeometry(this.playfieldWidth, 0.22, this.collectionDepth),
      new THREE.MeshStandardMaterial({
        color: "#58788e",
        emissive: "#1e4961",
        metalness: 0.58,
        roughness: 0.28,
      }),
    );
    collectionBase.position.set(0, this.collectionFloorY, this.collectionCenterZ);
    collectionBase.receiveShadow = true;
    this.scene.add(collectionBase);
    this.addStaticBody(
      new CANNON.Vec3(this.playfieldWidth / 2, 0.11, this.collectionDepth / 2),
      new CANNON.Vec3(0, this.collectionFloorY, this.collectionCenterZ),
    );

    const collectionWallMaterial = new THREE.MeshStandardMaterial({
      color: "#8cb3c9",
      emissive: "#2f5b75",
      metalness: 0.78,
      roughness: 0.14,
    });
    const dividerDepth = this.collectionDepth;
    const collectionWalls = [
      { size: [0.16, 0.82, dividerDepth], position: [-(this.playfieldWidth / 2) + 0.08, this.collectionFloorY + 0.41, this.collectionCenterZ] },
      { size: [0.16, 0.82, dividerDepth], position: [(this.playfieldWidth / 2) - 0.08, this.collectionFloorY + 0.41, this.collectionCenterZ] },
      { size: [this.playfieldWidth, 0.82, 0.14], position: [0, this.collectionFloorY + 0.41, this.collectionCenterZ + this.collectionDepth / 2 - 0.07] },
      { size: [this.playfieldWidth, 0.82, 0.14], position: [0, this.collectionFloorY + 0.41, this.collectionCenterZ - this.collectionDepth / 2 + 0.07] },
      { size: [0.14, 0.74, dividerDepth - 0.18], position: [-this.slotSplitX, this.collectionFloorY + 0.37, this.collectionCenterZ] },
      { size: [0.14, 0.74, dividerDepth - 0.18], position: [this.slotSplitX, this.collectionFloorY + 0.37, this.collectionCenterZ] },
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
        new CANNON.Vec3(sx / 2, sy / 2, sz / 2),
        new CANNON.Vec3(px, py, pz),
      );
    }

    const payoutLight = new THREE.Mesh(
      new THREE.BoxGeometry(this.playfieldWidth - 0.5, 0.03, 0.1),
      new THREE.MeshBasicMaterial({
        color: "#9ef2ff",
      }),
    );
    payoutLight.position.set(0, this.collectionFloorY + 0.16, this.collectionCenterZ + this.collectionDepth / 2 - 0.12);
    this.scene.add(payoutLight);

    this.createSlotFrame(-3.05, 2.82, "宝箱区", "#ffbe5a");
    this.createSlotFrame(0, 3.04, "Bonus", "#54f3ff");
    this.createSlotFrame(3.05, 2.82, "高价值", "#ff6f4d");
  }

  private createPusher(): void {
    this.pusherMesh = new THREE.Group();

    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(this.pusherWidth, this.pusherBodyHalfHeight * 2, this.pusherDepth),
      new THREE.MeshStandardMaterial({
        color: "#f28f43",
        emissive: "#7b2d11",
        metalness: 0.52,
        roughness: 0.3,
      }),
    );
    platform.castShadow = true;
    platform.receiveShadow = true;
    this.pusherMesh.add(platform);

    this.pusherMesh.position.set(
      0,
      this.getPusherBaseY(this.pusherStartZ) + this.pusherBodyHalfHeight,
      this.pusherStartZ,
    );
    this.pusherMesh.rotation.x = this.upperDeckTilt;
    this.scene.add(this.pusherMesh);

    this.pusherBody = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      shape: new CANNON.Box(new CANNON.Vec3(this.pusherWidth / 2, this.pusherBodyHalfHeight, this.pusherDepth / 2)),
      position: new CANNON.Vec3(
        0,
        this.getPusherBaseY(this.pusherStartZ) + this.pusherBodyHalfHeight,
        this.pusherStartZ,
      ),
      material: this.floorMaterial,
    });
    this.pusherBody.quaternion.setFromEuler(this.upperDeckTilt, 0, 0);
    this.world.addBody(this.pusherBody);
  }

  private createDecor(): void {
    const backPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(TABLE.width + 0.6, 3.4),
      new THREE.MeshStandardMaterial({
        color: "#122235",
        emissive: "#0d2032",
        metalness: 0.2,
        roughness: 0.88,
      }),
    );
    backPanel.position.set(0, 1.9, this.upperDeckBackZ - 0.46);
    this.scene.add(backPanel);

    const aura = new THREE.Mesh(
      new THREE.CircleGeometry(2.55, 48),
      new THREE.MeshBasicMaterial({
        color: "#ff7d36",
        transparent: true,
        opacity: 0.12,
      }),
    );
    aura.position.set(0, 2.02, this.upperDeckBackZ - 0.4);
    this.scene.add(aura);

    const portalFrame = new THREE.Mesh(
      new THREE.BoxGeometry(4.9, 1.06, 0.2),
      new THREE.MeshStandardMaterial({
        color: "#27455a",
        emissive: "#142332",
        metalness: 0.66,
        roughness: 0.26,
      }),
    );
    portalFrame.position.set(0, this.getUpperDeckSurfaceY(this.upperDeckBackZ + 0.1) + 0.48, this.upperDeckBackZ - 0.34);
    portalFrame.castShadow = true;
    portalFrame.receiveShadow = true;
    this.scene.add(portalFrame);

    const portalVoid = new THREE.Mesh(
      new THREE.PlaneGeometry(4.15, 0.72),
      new THREE.MeshBasicMaterial({
        color: "#03070d",
      }),
    );
    portalVoid.position.set(0, this.getUpperDeckSurfaceY(this.upperDeckBackZ + 0.12) + 0.45, this.upperDeckBackZ - 0.23);
    this.scene.add(portalVoid);

    const tunnelMaterial = new THREE.MeshStandardMaterial({
      color: "#1d3648",
      emissive: "#0b1722",
      metalness: 0.52,
      roughness: 0.34,
    });
    const tunnelRoof = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.16, 0.96), tunnelMaterial);
    tunnelRoof.position.set(0, this.getUpperDeckSurfaceY(this.upperDeckBackZ + 0.12) + 0.8, this.upperDeckBackZ + 0.08);
    tunnelRoof.rotation.x = this.upperDeckTilt;
    tunnelRoof.castShadow = true;
    this.scene.add(tunnelRoof);

    for (const direction of [-1, 1] as const) {
      const tunnelSide = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.74, 1.02), tunnelMaterial);
      tunnelSide.position.set(
        direction * 2.07,
        this.getUpperDeckSurfaceY(this.upperDeckBackZ + 0.12) + 0.46,
        this.upperDeckBackZ + 0.12,
      );
      tunnelSide.rotation.x = this.upperDeckTilt;
      tunnelSide.castShadow = true;
      this.scene.add(tunnelSide);
    }

    const dropChute = new THREE.Mesh(
      new THREE.BoxGeometry(3.25, 0.72, 1.18),
      new THREE.MeshStandardMaterial({
        color: "#2b4f66",
        emissive: "#102536",
        metalness: 0.74,
        roughness: 0.24,
      }),
    );
    dropChute.position.set(0, 1.96, this.upperDeckBackZ + 0.52);
    dropChute.rotation.x = -0.2;
    dropChute.castShadow = true;
    this.scene.add(dropChute);

    const chuteLip = new THREE.Mesh(
      new THREE.BoxGeometry(2.7, 0.2, 0.34),
      new THREE.MeshStandardMaterial({
        color: "#ffd284",
        emissive: "#6f430d",
        metalness: 0.82,
        roughness: 0.18,
      }),
    );
    chuteLip.position.set(0, 1.62, this.upperDeckBackZ + 1.02);
    chuteLip.castShadow = true;
    this.scene.add(chuteLip);

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
      const glassSide = new THREE.Mesh(
        new THREE.PlaneGeometry(TABLE.depth - 0.7, 2.7),
        glassMaterial,
      );
      glassSide.position.set(direction * (this.playfieldWidth / 2 + 0.26), 1.02, 0.48);
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

  private createSlotFrame(x: number, width: number, label: string, color: string): void {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.16, this.collectionDepth),
      new THREE.MeshStandardMaterial({
        color: "#3a6177",
        emissive: "#153040",
        metalness: 0.78,
        roughness: 0.18,
      }),
    );
    frame.position.set(x, this.collectionFloorY + 0.53, this.collectionCenterZ);
    frame.castShadow = true;
    frame.receiveShadow = true;
    this.scene.add(frame);

    const inset = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.3, 0.08, this.collectionDepth - 0.24),
      new THREE.MeshStandardMaterial({
        color: "#12263a",
        emissive: "#0f2232",
        metalness: 0.18,
        roughness: 0.68,
      }),
    );
    inset.position.set(x, this.collectionFloorY + 0.12, this.collectionCenterZ);
    inset.receiveShadow = true;
    this.scene.add(inset);

    const accentStrip = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.42, 0.04, 0.12),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
      }),
    );
    accentStrip.position.set(x, this.collectionFloorY + 0.21, this.collectionCenterZ + this.collectionDepth / 2 - 0.17);
    this.scene.add(accentStrip);

    const plaque = this.createBillboard(label, color);
    plaque.position.set(x, this.collectionFloorY + 1.0, this.collectionCenterZ + 0.48);
    this.scene.add(plaque);
  }

  private addStaticBody(halfExtents: CANNON.Vec3, position: CANNON.Vec3, rotationX = 0): void {
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(halfExtents),
      position,
      material: this.floorMaterial,
    });
    if (rotationX !== 0) {
      body.quaternion.setFromEuler(rotationX, 0, 0);
    }
    this.world.addBody(body);
  }

  private getUpperDeckSurfaceY(z: number): number {
    return (
      this.upperDeckY +
      this.upperDeckThickness / 2 -
      Math.tan(this.upperDeckTilt) * (z - this.upperDeckCenterZ)
    );
  }

  private getLowerDeckSurfaceY(z: number): number {
    return (
      this.lowerDeckY +
      this.lowerDeckThickness / 2 -
      Math.tan(this.lowerDeckTilt) * (z - this.lowerDeckCenterZ)
    );
  }

  private getSurfaceYForZ(z: number): number {
    return z <= this.upperDeckFrontZ ? this.getUpperDeckSurfaceY(z) : this.getLowerDeckSurfaceY(z);
  }

  private getPusherBaseY(z: number): number {
    return this.getUpperDeckSurfaceY(z) + this.pusherHoverGap;
  }

  private getPusherSurfaceY(z: number): number {
    const centerZ = this.pusherBody ? this.pusherBody.position.z : this.pusherStartZ;
    const centerY = this.pusherBody
      ? this.pusherBody.position.y
      : this.getPusherBaseY(this.pusherStartZ) + this.pusherBodyHalfHeight;
    return centerY + this.pusherBodyHalfHeight - Math.tan(this.upperDeckTilt) * (z - centerZ);
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
    },
  ): void {
    const spawnX = x ?? THREE.MathUtils.randFloat(-(this.playfieldWidth / 2) + 0.7, this.playfieldWidth / 2 - 0.7);
    const spawnCenterZ = this.pusherBody ? this.pusherBody.position.z : this.pusherStartZ;
    const pusherBackZ = spawnCenterZ - this.pusherDepth / 2;
    const spawnRangeBack = Math.max(this.upperDeckBackZ + 0.48, pusherBackZ + 0.34);
    const spawnRangeFront = Math.min(this.upperDeckBackZ + 1.18, pusherBackZ + 0.92);
    const spawnZ = z ?? THREE.MathUtils.randFloat(spawnRangeBack, Math.max(spawnRangeBack + 0.12, spawnRangeFront));
    const spawnY = options?.spawnY ?? this.getPusherSurfaceY(spawnZ) + 1.18;

    let mesh: THREE.Object3D;
    let shape: CANNON.Shape;
    let mass = 0.48;
    let baseReward = BASE_CONFIG.baseCoinReward;

    if (type === "coin") {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.36, 0.14, 24),
        new THREE.MeshStandardMaterial({
          color: "#f7b03b",
          emissive: "#9e5d11",
          metalness: 0.9,
          roughness: 0.24,
        }),
      );
      shape = new CANNON.Box(new CANNON.Vec3(0.28, 0.05, 0.28));
      baseReward = BASE_CONFIG.baseCoinReward;
      mass = 0.32;
    } else if (type === "chest") {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.88, 0.62, 0.88),
        new THREE.MeshStandardMaterial({
          color: "#8d5227",
          emissive: "#49240d",
          metalness: 0.38,
          roughness: 0.62,
        }),
      );
      shape = new CANNON.Box(new CANNON.Vec3(0.44, 0.31, 0.44));
      baseReward = 26;
      mass = 1.28;
    } else {
      mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.46),
        new THREE.MeshStandardMaterial({
          color: "#5ce3ff",
          emissive: "#0a5d7a",
          metalness: 0.52,
          roughness: 0.14,
        }),
      );
      shape = new CANNON.Sphere(0.38);
      baseReward = 12;
      mass = 0.74;
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(spawnX, spawnY, spawnZ);
    this.scene.add(mesh);

    const body = new CANNON.Body({
      mass,
      position: new CANNON.Vec3(spawnX, spawnY, spawnZ),
      material: this.itemMaterial,
      linearDamping: 0.22,
      angularDamping: 0.38,
    });
    body.addShape(shape);
    body.sleepSpeedLimit = 0.12;
    body.sleepTimeLimit = 0.3;
    body.velocity.set(
      options?.velocityX ?? THREE.MathUtils.randFloat(-0.05, 0.05),
      THREE.MathUtils.randFloat(-0.16, 0.02),
      options?.velocityZ ?? THREE.MathUtils.randFloat(0.06, 0.22),
    );
    if (options?.randomSpin === false) {
      body.angularVelocity.set(0, 0, 0);
    } else {
      body.angularVelocity.set(
        THREE.MathUtils.randFloat(-1, 1),
        THREE.MathUtils.randFloat(-1, 1),
        THREE.MathUtils.randFloat(-1, 1),
      );
    }
    this.world.addBody(body);

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
      { zone: "pusher", z: -2.9, xs: [-2.85, -1.4, 0.05, 1.45, 2.8] },
      { zone: "pusher", z: -2.05, xs: [-3.05, -1.7, -0.2, 1.2, 2.55] },
      { zone: "pusher", z: -1.2, xs: [-2.7, -1.2, 0.35, 1.85] },
      { zone: "pusher", z: -0.4, xs: [-3.05, -1.7, -0.3, 1.05, 2.4] },
      { zone: "lower", z: 1.35, xs: [-2.7, -1.35, 0.15, 1.55, 2.95] },
      { zone: "lower", z: 2.45, xs: [-2.35, -0.95, 0.55, 1.95, 3.15] },
      { zone: "lower", z: 3.32, xs: [-1.95, -0.65, 0.95, 2.3] },
    ];

    for (const row of seedRows) {
      for (const x of row.xs) {
        const surfaceY =
          row.zone === "pusher"
            ? this.getPusherSurfaceY(row.z)
            : this.getLowerDeckSurfaceY(row.z);
        this.spawnItem("coin", x, row.z, {
          spawnY: surfaceY + 0.055,
          velocityX: THREE.MathUtils.randFloat(-0.03, 0.03),
          velocityZ: THREE.MathUtils.randFloat(-0.01, 0.03),
          randomSpin: false,
        });
      }
    }

    this.spawnItem("chest", -3.02, 1.7, {
      spawnY: this.getLowerDeckSurfaceY(1.7) + 0.16,
      velocityX: 0,
      velocityZ: 0.02,
      randomSpin: false,
    });
    this.spawnItem("chest", 2.65, 2.55, {
      spawnY: this.getLowerDeckSurfaceY(2.55) + 0.16,
      velocityX: 0,
      velocityZ: 0.02,
      randomSpin: false,
    });
    this.spawnItem("rare", 0.15, 3.15, {
      spawnY: this.getLowerDeckSurfaceY(3.15) + 0.12,
      velocityX: 0,
      velocityZ: 0.01,
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

    const rawDelta = this.clock.getDelta();
    const delta = rawDelta * this.debugOverrides.timeScale;
    const now = performance.now();
    this.frameCount += 1;

    this.updateAutoDrop(delta);
    this.updatePusher(delta);
    this.stepPhysics(delta);
    this.syncMeshes();
    this.resolveCollections();
    this.processScheduledActions(now);
    this.updateTimers(delta);
    this.sampleFps(now);
    this.renderState();

    this.renderer.render(this.scene, this.camera);
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

    while (this.autoDropElapsedMs >= interval) {
      this.autoDropElapsedMs -= interval;
      if (!this.requestDrop()) {
        this.state.autoDropEnabled = false;
        break;
      }
    }
  }

  private updatePusher(deltaSeconds: number): void {
    const speedBoost = 1 + this.state.upgrades.pusherSpeed * 0.08;
    const cycleSpeed = BASE_CONFIG.basePusherSpeed * this.debugOverrides.pusherSpeedScale * speedBoost * 0.34;
    this.pusherTime = (this.pusherTime + deltaSeconds * cycleSpeed) % 1;

    let z = this.pusherStartZ;
    let lift = 0;

    if (this.pusherTime < 0.58) {
      const t = easeOutCubic(this.pusherTime / 0.58);
      z = THREE.MathUtils.lerp(this.pusherStartZ, this.pusherEndZ, t);
    } else if (this.pusherTime < 0.68) {
      z = this.pusherEndZ;
    } else if (this.pusherTime < 0.94) {
      const t = (this.pusherTime - 0.68) / 0.26;
      z = THREE.MathUtils.lerp(this.pusherEndZ, this.pusherStartZ, t);
      lift = Math.sin(t * Math.PI) * this.pusherLiftAmount;
    } else {
      const t = (this.pusherTime - 0.94) / 0.06;
      z = this.pusherStartZ;
      lift = THREE.MathUtils.lerp(this.pusherLiftAmount * 0.16, 0, t);
    }

    const y = this.getPusherBaseY(z) + this.pusherBodyHalfHeight + lift;
    const previousPosition = this.pusherBody.position.clone();
    this.pusherBody.position.set(0, y, z);
    this.pusherBody.quaternion.setFromEuler(this.upperDeckTilt, 0, 0);
    this.pusherBody.velocity.set(
      0,
      (y - previousPosition.y) / Math.max(deltaSeconds, 0.0001),
      (z - previousPosition.z) / Math.max(deltaSeconds, 0.0001),
    );
    this.pusherMesh.position.set(0, y, z);
    this.pusherMesh.rotation.x = this.upperDeckTilt;
    this.applyPusherAssist();
  }

  private stepPhysics(deltaSeconds: number): void {
    this.world.step(1 / 90, deltaSeconds, 6);
  }

  private applyPusherAssist(): void {
    if (this.pusherBody.velocity.z <= 0.18) {
      return;
    }

    const pusherBackZ = this.pusherBody.position.z - this.pusherDepth / 2 + 0.08;
    const pusherFrontZ = this.pusherBody.position.z + this.pusherDepth / 2 - 0.08;

    for (const item of this.items) {
      if (item.collected) {
        continue;
      }
      if (Math.abs(item.body.position.x) > this.pusherWidth / 2 + 0.08) {
        continue;
      }
      if (item.body.position.z < pusherBackZ || item.body.position.z > pusherFrontZ) {
        continue;
      }
      if (item.body.position.y > this.getPusherSurfaceY(item.body.position.z) + 0.16) {
        continue;
      }

      const velocityBoost = item.type === "chest" ? 0.82 : item.type === "rare" ? 0.92 : 1;
      const targetVelocity = Math.min(0.9, Math.max(0.08, this.pusherBody.velocity.z * 0.055 * velocityBoost));
      item.body.wakeUp();
      item.body.velocity.z = Math.max(item.body.velocity.z, targetVelocity);
      item.body.velocity.x *= 0.98;
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
        Math.abs(item.body.position.x) > this.playfieldWidth / 2 - 0.34 &&
        item.body.position.z > this.lowerDeckBackZ + 0.95 &&
        item.body.position.z < this.payoutGapZ - 0.2 &&
        item.body.position.y < this.getLowerDeckSurfaceY(item.body.position.z) - 0.02
      ) {
        item.collected = true;
        continue;
      }

      if (item.body.position.z < this.payoutGapZ || item.body.position.y > this.collectionFloorY + 0.32) {
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
      this.world.removeBody(body);
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
          const spawnZ = THREE.MathUtils.randFloat(this.upperDeckBackZ + 0.35, this.lowerDeckBackZ + 0.5);
          this.spawnItem("coin", THREE.MathUtils.randFloat(-3.4, 3.4), spawnZ, {
            spawnY: this.getSurfaceYForZ(spawnZ) + 1.8,
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
            spawnY: this.getSurfaceYForZ(spawnZ) + 1.8,
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
      this.world.removeBody(item.body);
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
    this.seedBoard();
    this.pushMessage("新会话开始。");
    this.renderState();
  }

  private handleResize = (): void => {
    const width = this.ui.viewport.clientWidth || window.innerWidth;
    const height = this.ui.viewport.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
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
