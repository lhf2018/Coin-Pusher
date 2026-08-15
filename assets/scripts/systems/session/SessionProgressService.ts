import { RuntimeStateStore } from "../../data/RuntimeStateStore";
import { RuntimePlayerState } from "../../data/RuntimeState";

export class SessionProgressService {
  public constructor(private readonly stateStore: RuntimeStateStore) {}

  public addCoins(amount: number): number {
    const delta = Math.max(0, Math.round(amount));
    this.stateStore.update((state) => ({
      ...state,
      wallet: {
        ...state.wallet,
        coin: state.wallet.coin + delta,
      },
    }));
    return this.stateStore.getState().wallet.coin;
  }

  public spendCoins(amount: number): boolean {
    const cost = Math.max(0, Math.round(amount));
    const state = this.stateStore.getState();
    if (state.wallet.coin < cost) {
      return false;
    }

    this.stateStore.update((currentState) => ({
      ...currentState,
      wallet: {
        ...currentState.wallet,
        coin: currentState.wallet.coin - cost,
      },
    }));
    return true;
  }

  public addDiamonds(amount: number): number {
    const delta = Math.max(0, Math.round(amount));
    this.stateStore.update((state) => ({
      ...state,
      wallet: {
        ...state.wallet,
        diamond: state.wallet.diamond + delta,
      },
    }));
    return this.stateStore.getState().wallet.diamond;
  }

  public addBonusCharge(amount: number, threshold: number): boolean {
    const delta = Math.max(0, Math.round(amount));
    const safeThreshold = Math.max(1, Math.round(threshold));
    let triggered = false;

    this.stateStore.update((state) => {
      let nextCharge = state.bonus.currentCharge + delta;
      let triggerCount = state.bonus.triggerCount;

      while (nextCharge >= safeThreshold) {
        nextCharge -= safeThreshold;
        triggerCount += 1;
        triggered = true;
      }

      return {
        ...state,
        bonus: {
          ...state.bonus,
          currentCharge: nextCharge,
          triggerCount,
        },
      };
    });

    return triggered;
  }

  public setActiveBonus(bonusId: string | null): void {
    this.stateStore.update((state) => ({
      ...state,
      bonus: {
        ...state.bonus,
        activeBonusId: bonusId,
      },
    }));
  }

  public setCurrentPresetId(presetId: string): void {
    this.stateStore.update((state) => ({
      ...state,
      runtimeFlags: {
        ...state.runtimeFlags,
        currentPresetId: presetId,
      },
    }));
  }

  public setAutoDropEnabled(enabled: boolean): void {
    this.stateStore.update((state) => ({
      ...state,
      runtimeFlags: {
        ...state.runtimeFlags,
        autoDropEnabled: enabled,
      },
    }));
  }

  public toggleAutoDrop(): boolean {
    const nextEnabled = !this.stateStore.getState().runtimeFlags.autoDropEnabled;
    this.setAutoDropEnabled(nextEnabled);
    return nextEnabled;
  }

  public setDebugPanelVisible(visible: boolean): void {
    this.stateStore.update((state) => ({
      ...state,
      runtimeFlags: {
        ...state.runtimeFlags,
        debugPanelVisible: visible,
      },
    }));
  }

  public setCompactDebugBarVisible(visible: boolean): void {
    this.stateStore.update((state) => ({
      ...state,
      runtimeFlags: {
        ...state.runtimeFlags,
        compactDebugBarVisible: visible,
      },
    }));
  }

  public addInventoryItem(itemId: string, amount = 1): number {
    const safeAmount = Math.max(1, Math.round(amount));
    this.stateStore.update((state) => ({
      ...state,
      inventory: {
        ...state.inventory,
        [itemId]: (state.inventory[itemId] ?? 0) + safeAmount,
      },
    }));
    return this.stateStore.getState().inventory[itemId] ?? 0;
  }

  public clearInventoryItem(itemId: string): void {
    this.stateStore.update((state) => ({
      ...state,
      inventory: {
        ...state.inventory,
        [itemId]: 0,
      },
    }));
  }

  public resetSession(nextState: RuntimePlayerState): void {
    this.stateStore.reset(nextState);
  }
}
