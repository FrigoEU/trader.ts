export type unsubber = () => void;

// Basic type of (clientside) dynamic values = values that can change over time
export interface Source<T> {
  get(): T;
  set(newval: T): void;
  observe(f: (currentVal: T) => void): unsubber;
}

// Only clientside! Serverside: use initServersideSources
let clientSourceI = 0;
export const Source = class Source<T> implements Source<T> {
  private value: T;
  private observers: ((currentVal: T) => void)[];
  public i: number; // So equality checks fail

  constructor(value: T) {
    if (typeof window === "undefined") {
      throw new Error("Don't use this serverside");
    }
    this.value = value;
    this.observers = [];
    this.i = clientSourceI;
    clientSourceI++;
  }
  get(): T {
    return this.value;
  }
  set(newval: T): void {
    this.value = newval;
    this.observers.forEach(function (obs) {
      obs(newval);
    }, null);
  }
  observe(f: (currentVal: T) => void): unsubber {
    this.observers.push(f);
    return () => {
      this.observers = this.observers.filter((f2) => f2 !== f);
    };
  }
};
