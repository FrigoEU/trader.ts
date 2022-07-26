export type Remote<T> =
  | { tag: "initial" }
  | { tag: "error"; err: Error | string }
  | { tag: "loaded"; item: T };
