export type EventMapBase = Record<string, unknown>;
export type EventName<Events extends EventMapBase> = Extract<keyof Events, string>;
export type EventHandler<Events extends EventMapBase, TName extends EventName<Events>> = (
  payload: Events[TName],
) => void;

export class EventBus<Events extends EventMapBase = EventMapBase> {
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  public on<TName extends EventName<Events>>(
    eventName: TName,
    handler: EventHandler<Events, TName>,
  ): () => void {
    const bucket = this.handlers.get(eventName) ?? new Set<(payload: unknown) => void>();
    bucket.add(handler as (payload: unknown) => void);
    this.handlers.set(eventName, bucket);

    return () => {
      this.off(eventName, handler);
    };
  }

  public once<TName extends EventName<Events>>(
    eventName: TName,
    handler: EventHandler<Events, TName>,
  ): () => void {
    const dispose = this.on(eventName, (payload) => {
      dispose();
      handler(payload);
    });
    return dispose;
  }

  public off<TName extends EventName<Events>>(
    eventName: TName,
    handler: EventHandler<Events, TName>,
  ): void {
    const bucket = this.handlers.get(eventName);
    if (!bucket) {
      return;
    }

    bucket.delete(handler as (payload: unknown) => void);
    if (bucket.size === 0) {
      this.handlers.delete(eventName);
    }
  }

  public emit<TName extends EventName<Events>>(eventName: TName, payload: Events[TName]): void {
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
