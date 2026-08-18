import RAPIER from "@dimforge/rapier3d-compat";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type DynamicItemKind = "coin" | "chest" | "rare";

export interface StaticBoxSpec {
  halfExtents: Vec3;
  position: Vec3;
  rotationX?: number;
  friction?: number;
  restitution?: number;
}

export interface KinematicColliderSpec {
  halfExtents: Vec3;
  offset?: Vec3;
  friction?: number;
  restitution?: number;
}

export interface DynamicBodySpec {
  kind: DynamicItemKind;
  position: Vec3;
  rotationX?: number;
  velocity: Vec3;
  angularVelocity: Vec3;
  linearDamping: number;
  angularDamping: number;
}

const DEFAULT_FLOOR_FRICTION = 0.42;
const DEFAULT_FLOOR_RESTITUTION = 0.0;
const DEFAULT_PUSHER_FRICTION = 0.28;
const ITEM_FRICTION: Record<DynamicItemKind, number> = {
  coin: 0.38,
  chest: 0.34,
  rare: 0.3,
};

function copyVec3(value: { x: number; y: number; z: number }): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function quatFromEulerX(rotationX: number): { x: number; y: number; z: number; w: number } {
  const half = rotationX * 0.5;
  return {
    x: Math.sin(half),
    y: 0,
    z: 0,
    w: Math.cos(half),
  };
}

class MutableVec3 {
  public constructor(
    private readonly read: () => Vec3,
    private readonly write: (x: number, y: number, z: number) => void,
  ) {}

  public get x(): number {
    return this.read().x;
  }

  public set x(value: number) {
    const current = this.read();
    this.write(value, current.y, current.z);
  }

  public get y(): number {
    return this.read().y;
  }

  public set y(value: number) {
    const current = this.read();
    this.write(current.x, value, current.z);
  }

  public get z(): number {
    return this.read().z;
  }

  public set z(value: number) {
    const current = this.read();
    this.write(current.x, current.y, value);
  }

  public set(x: number, y: number, z: number): void {
    this.write(x, y, z);
  }

  public clone(): Vec3 {
    return this.read();
  }
}

class MutableQuat {
  public constructor(
    private readonly read: () => { x: number; y: number; z: number; w: number },
    private readonly write: (x: number, y: number, z: number, w: number) => void,
  ) {}

  public get x(): number {
    return this.read().x;
  }

  public get y(): number {
    return this.read().y;
  }

  public get z(): number {
    return this.read().z;
  }

  public get w(): number {
    return this.read().w;
  }

  public set(x: number, y: number, z: number, w: number): void {
    this.write(x, y, z, w);
  }

  public setFromEuler(rotationX: number): void {
    const quat = quatFromEulerX(rotationX);
    this.write(quat.x, quat.y, quat.z, quat.w);
  }
}

export class PhysicsBody {
  public readonly position: MutableVec3;
  public readonly velocity: MutableVec3;
  public readonly angularVelocity: MutableVec3;
  public readonly quaternion: MutableQuat;
  public readonly angularFactor = {
    set: (x: number, y: number, z: number): void => {
      this.raw.setEnabledRotations(x > 0.05, y > 0.05, z > 0.05, true);
    },
  };

  private kinematicTarget: Vec3 | null = null;
  private scriptedVelocity: Vec3 = { x: 0, y: 0, z: 0 };

  public constructor(
    public readonly raw: RAPIER.RigidBody,
    private readonly kinematic: boolean,
  ) {
    this.position = new MutableVec3(
      () => (this.kinematicTarget ? { ...this.kinematicTarget } : copyVec3(this.raw.translation())),
      (x, y, z) => {
        if (this.kinematic) {
          this.setNextKinematicPose(x, y, z);
          return;
        }
        this.raw.setTranslation({ x, y, z }, true);
      },
    );
    this.velocity = new MutableVec3(
      () => (this.kinematic ? { ...this.scriptedVelocity } : copyVec3(this.raw.linvel())),
      (x, y, z) => {
        if (this.kinematic) {
          this.scriptedVelocity = { x, y, z };
          return;
        }
        this.raw.setLinvel({ x, y, z }, true);
      },
    );
    this.angularVelocity = new MutableVec3(
      () => copyVec3(this.raw.angvel()),
      (x, y, z) => {
        this.raw.setAngvel({ x, y, z }, true);
      },
    );
    this.quaternion = new MutableQuat(
      () => {
        const rotation = this.raw.rotation();
        return { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
      },
      (x, y, z, w) => {
        if (this.kinematic) {
          this.raw.setNextKinematicRotation({ x, y, z, w });
          return;
        }
        this.raw.setRotation({ x, y, z, w }, true);
      },
    );
  }

  public setNextKinematicPose(x: number, y: number, z: number, rotationX?: number): void {
    this.kinematicTarget = { x, y, z };
    this.raw.setNextKinematicTranslation({ x, y, z });
    if (rotationX != null) {
      const quat = quatFromEulerX(rotationX);
      this.raw.setNextKinematicRotation(quat);
    }
  }

  public wakeUp(): void {
    this.raw.wakeUp();
  }

  public sleep(): void {
    if (this.kinematic) {
      return;
    }
    this.raw.sleep();
  }
}

export class RapierPhysicsWorld {
  private world: RAPIER.World | null = null;
  private accumulator = 0;
  private ready = false;

  public async init(): Promise<void> {
    if (this.ready) {
      return;
    }

    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -14.6, z: 0 });
    this.world.timestep = 1 / 90;
    this.world.integrationParameters.numSolverIterations = 16;
    this.world.integrationParameters.numInternalPgsIterations = 4;
    this.world.integrationParameters.maxCcdSubsteps = 8;
    this.world.integrationParameters.normalizedAllowedLinearError = 0.0008;
    this.world.integrationParameters.normalizedPredictionDistance = 0.004;
    this.ready = true;
  }

  public isReady(): boolean {
    return this.ready && this.world != null;
  }

  public createStaticBox(spec: StaticBoxSpec): void {
    const world = this.requireWorld();
    const rotation = quatFromEulerX(spec.rotationX ?? 0);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(spec.position.x, spec.position.y, spec.position.z)
        .setRotation(rotation),
    );
    const collider = RAPIER.ColliderDesc.cuboid(spec.halfExtents.x, spec.halfExtents.y, spec.halfExtents.z)
      .setFriction(spec.friction ?? DEFAULT_FLOOR_FRICTION)
      .setRestitution(spec.restitution ?? DEFAULT_FLOOR_RESTITUTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setContactSkin(0.004);
    world.createCollider(collider, body);
  }

  public createKinematicBody(position: Vec3, rotationX: number, colliders: KinematicColliderSpec[]): PhysicsBody {
    const world = this.requireWorld();
    const rotation = quatFromEulerX(rotationX);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(rotation)
        .setCcdEnabled(true)
        .setSoftCcdPrediction(0.45)
        .setAdditionalSolverIterations(4),
    );

    for (const collider of colliders) {
      const desc = RAPIER.ColliderDesc.cuboid(collider.halfExtents.x, collider.halfExtents.y, collider.halfExtents.z)
        .setFriction(collider.friction ?? DEFAULT_PUSHER_FRICTION)
        .setRestitution(collider.restitution ?? 0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setContactSkin(0.01);
      if (collider.offset) {
        desc.setTranslation(collider.offset.x, collider.offset.y, collider.offset.z);
      }
      world.createCollider(desc, body);
    }

    const handle = new PhysicsBody(body, true);
    handle.setNextKinematicPose(position.x, position.y, position.z, rotationX);
    return handle;
  }

  public createDynamicBody(spec: DynamicBodySpec): PhysicsBody {
    const world = this.requireWorld();
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spec.position.x, spec.position.y, spec.position.z)
      .setRotation(quatFromEulerX(spec.rotationX ?? 0))
      .setLinvel(spec.velocity.x, spec.velocity.y, spec.velocity.z)
      .setAngvel(spec.angularVelocity)
      .setLinearDamping(spec.linearDamping)
      .setAngularDamping(spec.angularDamping)
      .setCcdEnabled(true)
      .setSoftCcdPrediction(0.55)
      .setCanSleep(true)
      .setAdditionalSolverIterations(4);

    const body = world.createRigidBody(desc);
    world.createCollider(this.createItemCollider(spec.kind), body);
    return new PhysicsBody(body, false);
  }

  public removeBody(body: PhysicsBody): void {
    const world = this.world;
    if (!world) {
      return;
    }
    world.removeRigidBody(body.raw);
  }

  public step(fixedDt: number, elapsedSeconds: number, maxSubSteps: number): void {
    const world = this.requireWorld();
    const clampedElapsed = Math.min(elapsedSeconds, fixedDt * maxSubSteps);
    this.accumulator += clampedElapsed;

    let steps = 0;
    world.timestep = fixedDt;
    while (this.accumulator >= fixedDt && steps < maxSubSteps) {
      world.step();
      this.accumulator -= fixedDt;
      steps += 1;
    }
  }

  private createItemCollider(kind: DynamicItemKind): RAPIER.ColliderDesc {
    const friction = ITEM_FRICTION[kind];
    if (kind === "coin") {
      return RAPIER.ColliderDesc.cylinder(0.055, 0.33)
        .setFriction(friction)
        .setRestitution(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setContactSkin(0.003)
        .setDensity(18);
    }
    if (kind === "chest") {
      return RAPIER.ColliderDesc.cuboid(0.41, 0.3, 0.36)
        .setFriction(friction)
        .setRestitution(0.01)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setContactSkin(0.012)
        .setDensity(8);
    }
    return RAPIER.ColliderDesc.ball(0.36)
      .setFriction(friction)
      .setRestitution(0.02)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setContactSkin(0.01)
      .setDensity(5.5);
  }

  private requireWorld(): RAPIER.World {
    if (!this.world) {
      throw new Error("Rapier physics world is not initialized.");
    }
    return this.world;
  }
}
