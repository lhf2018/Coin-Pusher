export type EventHandler<T = unknown> = (payload: T) => void;

export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  public on<T = unknown>(eventName: string, handler: EventHandler<T>): () => void {
    const bucket = this.handlers.get(eventName) ?? new Set<EventHandler>();
    bucket.add(handler as EventHandler);
    this.handlers.set(eventName, bucket);

    return () => {
      this.off(eventName, handler);
    };
  }

  public off<T = unknown>(eventName: string, handler: EventHandler<T>): void {
    const bucket = this.handlers.get(eventName);
    if (!bucket) {
      return;
    }

    bucket.delete(handler as EventHandler);
    if (bucket.size === 0) {
      this.handlers.delete(eventName);
    }
  }

  public emit<T = unknown>(eventName: string, payload: T): void {
    const bucket = this.handlers.get(eventName);
    if (!bucket) {
      return;
    }

    for (const handler of bucket) {
      handler(payload);
    }
  }

  public clear(): void {
    this.handlers.clear();
  }
}
