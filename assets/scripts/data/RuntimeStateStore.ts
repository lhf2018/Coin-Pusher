import { RuntimePlayerState } from "./RuntimeState";

export type RuntimeStateListener = (state: Readonly<RuntimePlayerState>) => void;
export type RuntimeStateUpdater = (state: Readonly<RuntimePlayerState>) => RuntimePlayerState;

export class RuntimeStateStore {
  private state: RuntimePlayerState;
  private readonly listeners = new Set<RuntimeStateListener>();

  public constructor(initialState: RuntimePlayerState) {
    this.state = initialState;
  }

  public getState(): Readonly<RuntimePlayerState> {
    return this.state;
  }

  public subscribe(listener: RuntimeStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);

    return () => {
      this.listeners.delete(listener);
    };
  }

  public update(updater: RuntimeStateUpdater): void {
    this.state = updater(this.state);
    this.emit();
  }

  public reset(nextState: RuntimePlayerState): void {
    this.state = nextState;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
