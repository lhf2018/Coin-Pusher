export interface DebugMetricsSnapshot {
  sessionStartTime: number;
  sessionEndTime: number | null;
  coinDrops: number;
  rewardsResolved: number;
  rewardAmount: number;
  bonusTriggers: number;
  upgradePurchases: number;
  taskClaims: number;
  latestFps: number;
  peakRigidBodyCount: number;
}

export class DebugMetrics {
  private snapshot: DebugMetricsSnapshot = this.createDefaultSnapshot();

  public recordSessionStart(): void {
    this.snapshot.sessionStartTime = Date.now();
    this.snapshot.sessionEndTime = null;
  }

  public recordSessionEnd(): void {
    this.snapshot.sessionEndTime = Date.now();
  }

  public recordCoinDrop(dropCount = 1): void {
    this.snapshot.coinDrops += Math.max(1, Math.round(dropCount));
  }

  public recordReward(amount: number): void {
    this.snapshot.rewardsResolved += 1;
    this.snapshot.rewardAmount += Math.max(0, Math.round(amount));
  }

  public recordBonusTrigger(): void {
    this.snapshot.bonusTriggers += 1;
  }

  public recordUpgradePurchase(): void {
    this.snapshot.upgradePurchases += 1;
  }

  public recordTaskClaim(): void {
    this.snapshot.taskClaims += 1;
  }

  public sampleFps(fps: number): void {
    this.snapshot.latestFps = Math.max(0, Math.round(fps));
  }

  public setActiveRigidBodyCount(count: number): void {
    this.snapshot.peakRigidBodyCount = Math.max(
      this.snapshot.peakRigidBodyCount,
      Math.max(0, Math.round(count)),
    );
  }

  public reset(): void {
    this.snapshot = this.createDefaultSnapshot();
  }

  public getSnapshot(): Readonly<DebugMetricsSnapshot> {
    return this.snapshot;
  }

  private createDefaultSnapshot(): DebugMetricsSnapshot {
    return {
      sessionStartTime: Date.now(),
      sessionEndTime: null,
      coinDrops: 0,
      rewardsResolved: 0,
      rewardAmount: 0,
      bonusTriggers: 0,
      upgradePurchases: 0,
      taskClaims: 0,
      latestFps: 0,
      peakRigidBodyCount: 0,
    };
  }
}
