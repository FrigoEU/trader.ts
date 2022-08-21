import { chain, orderBy } from "lodash-es";
import * as c from "purify-ts/Codec";
import { checkAllCasesHandled } from "../utils";

export type watchEvent<Item extends { identifier: number }> =
  | { tag: "new"; item: Item }
  | { tag: "updated"; item: Item }
  | { tag: "deleted"; item: Item };

export function watchEventC<Item extends { identifier: number }>(
  itemC: c.Codec<Item>
): c.Codec<watchEvent<Item>> {
  return c.oneOf([
    c.Codec.interface({ tag: c.exactly("new"), item: itemC }),
    c.Codec.interface({ tag: c.exactly("updated"), item: itemC }),
    c.Codec.interface({ tag: c.exactly("deleted"), item: itemC }),
  ]);
}

export function orderWatchEvents<T extends { identifier: number }>(
  events: Array<watchEvent<T>>
): Array<watchEvent<T>> {
  return orderBy(
    events,
    (ev) => {
      if (ev.tag === "deleted") {
        return 0;
      } else if (ev.tag === "new") {
        return 1;
      } else if (ev.tag === "updated") {
        return 2;
      } else {
        return checkAllCasesHandled(ev);
      }
    },
    "asc"
  );
}

export function processWatchEventWithId<T extends { identifier: number }>(
  current: Array<T>,
  ev: watchEvent<T>
): Array<T> {
  if (ev.tag === "new" || ev.tag === "updated") {
    // if it's new, we shouldn't do the filter step, but we do it anyway, just in case

    return chain(current)
      .filter((currI) => currI.identifier !== ev.item.identifier)
      .concat(ev.item)
      .value();
  } else if (ev.tag === "deleted") {
    return chain(current)
      .filter((item) => item.identifier !== ev.item.identifier)
      .value();
  } else {
    return checkAllCasesHandled(ev);
  }
}
