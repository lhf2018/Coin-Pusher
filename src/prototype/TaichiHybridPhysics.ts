// @ts-nocheck
import * as ti from "taichi.js";
import type { DropItemType } from "./types";

export interface TaichiAssistSnapshotItem {
  id: string;
  type: DropItemType;
  position: [number, number, number];
  velocity: [number, number, number];
  radius: number;
  desiredForward: number;
  forwardBias: number;
  lateralLimit: number;
  lateralDamping: number;
}

export interface TaichiAssistResult {
  ids: string[];
  velocities: Array<[number, number, number]>;
}

export class TaichiHybridPhysics {
  private readonly capacity: number;
  private ready = false;

  private positions: any;
  private velocities: any;
  private radii: any;
  private desiredForward: any;
  private forwardBias: any;
  private lateralLimit: any;
  private lateralDamping: any;
  private outputVelocities: any;
  private stepKernel: any;

  public constructor(capacity = 128) {
    this.capacity = capacity;
  }

  public async init(): Promise<void> {
    if (this.ready) {
      return;
    }

    await ti.init();

    this.positions = ti.Vector.field(3, ti.f32, [this.capacity]);
    this.velocities = ti.Vector.field(3, ti.f32, [this.capacity]);
    this.radii = ti.field(ti.f32, [this.capacity]);
    this.desiredForward = ti.field(ti.f32, [this.capacity]);
    this.forwardBias = ti.field(ti.f32, [this.capacity]);
    this.lateralLimit = ti.field(ti.f32, [this.capacity]);
    this.lateralDamping = ti.field(ti.f32, [this.capacity]);
    this.outputVelocities = ti.Vector.field(3, ti.f32, [this.capacity]);

    ti.addToKernelScope({
      positions: this.positions,
      velocities: this.velocities,
      radii: this.radii,
      desiredForward: this.desiredForward,
      forwardBias: this.forwardBias,
      lateralLimit: this.lateralLimit,
      lateralDamping: this.lateralDamping,
      outputVelocities: this.outputVelocities,
    });

    this.stepKernel = ti.kernel((activeCount, deltaSeconds) => {
      for (let i of range(activeCount)) {
        let pos = positions[i];
        let vel = velocities[i];
        let nextVx = f32(vel[0] * lateralDamping[i]);
        let nextVy = vel[1];
        let nextVz = f32(vel[2] * 0.988);

        let crowdX = f32(0.0);
        let crowdZ = f32(0.0);

        for (let j of range(activeCount)) {
          if (i !== j) {
            let otherPos = positions[j];
            let dx = pos[0] - otherPos[0];
            let dz = pos[2] - otherPos[2];
            let distSqr = dx * dx + dz * dz;
            let minDist = radii[i] + radii[j];
            let minDistSqr = minDist * minDist;

            if (distSqr > 0.0001 && distSqr < minDistSqr) {
              let dist = sqrt(distSqr);
              let invDist = f32(1.0) / max(dist, f32(0.0001));
              let overlap = f32(minDist - dist);
              let nx = f32(dx * invDist);
              let nz = f32(dz * invDist);

              crowdX = f32(crowdX + nx * overlap * 0.32);
              crowdZ = f32(crowdZ + nz * overlap * 0.12);

              if (otherPos[2] < pos[2]) {
                crowdZ = f32(crowdZ + overlap * 0.08);
              } else {
                crowdZ = f32(crowdZ - overlap * 0.016);
              }
            }
          }
        }

        let xLimit = lateralLimit[i];
        let boundaryX = f32(0.0);
        if (pos[0] > xLimit) {
          boundaryX = f32((xLimit - pos[0]) * 0.42);
        } else if (pos[0] < -xLimit) {
          boundaryX = f32((-xLimit - pos[0]) * 0.42);
        }

        nextVx = f32(nextVx + crowdX + boundaryX);
        nextVz = max(f32(nextVz + crowdZ + forwardBias[i] * deltaSeconds), desiredForward[i]);

        nextVx = min(max(nextVx, f32(-0.24)), f32(0.24));
        nextVz = min(max(nextVz, f32(-0.12)), f32(1.12));
        outputVelocities[i] = [nextVx, nextVy, nextVz];
      }
    });

    this.ready = true;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async step(snapshot: TaichiAssistSnapshotItem[], deltaSeconds: number): Promise<TaichiAssistResult> {
    if (!this.ready) {
      throw new Error("Taichi physics is not initialized.");
    }

    const activeCount = Math.min(snapshot.length, this.capacity);
    const ids = snapshot.slice(0, activeCount).map((item) => item.id);

    const positions = Array.from({ length: this.capacity }, () => [0, 0, 0]);
    const velocities = Array.from({ length: this.capacity }, () => [0, 0, 0]);
    const radii = new Array(this.capacity).fill(0);
    const desiredForward = new Array(this.capacity).fill(0);
    const forwardBias = new Array(this.capacity).fill(0);
    const lateralLimit = new Array(this.capacity).fill(3.4);
    const lateralDamping = new Array(this.capacity).fill(0.96);

    for (let index = 0; index < activeCount; index += 1) {
      const item = snapshot[index];
      positions[index] = item.position;
      velocities[index] = item.velocity;
      radii[index] = item.radius;
      desiredForward[index] = item.desiredForward;
      forwardBias[index] = item.forwardBias;
      lateralLimit[index] = item.lateralLimit;
      lateralDamping[index] = item.lateralDamping;
    }

    await this.positions.fromArray(positions);
    await this.velocities.fromArray(velocities);
    await this.radii.fromArray(radii);
    await this.desiredForward.fromArray(desiredForward);
    await this.forwardBias.fromArray(forwardBias);
    await this.lateralLimit.fromArray(lateralLimit);
    await this.lateralDamping.fromArray(lateralDamping);

    this.stepKernel(activeCount, deltaSeconds);
    await ti.sync();

    const rawVelocities = await this.outputVelocities.toArray();
    return {
      ids,
      velocities: rawVelocities.slice(0, activeCount) as Array<[number, number, number]>,
    };
  }
}
