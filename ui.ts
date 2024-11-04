import { Source, unsubber } from "./types/source";

type unsubberList = (unsubber | unsubberList)[];
let currentUnsubberList: null | unsubberList = null;

export function scheduleForCleanup(f: unsubber) {
  if (currentUnsubberList === null) {
    console.info("scheduleForCleanup called without currentUnsubber!", f);
  } else {
    currentUnsubberList.push(f);
  }
}
if (typeof window !== "undefined") {
  (window as any).scheduleForCleanup = scheduleForCleanup;
}

function cleanupUnsubberList(l: unsubberList): void {
  l.forEach((el) => (Array.isArray(el) ? cleanupUnsubberList(el) : el()));
  l.length = 0;
}

// Client side only function of making an HTML fragment that can change
// based on the value of a source
export function dynVariadic<T extends Array<Source<any>>>(
  ss: [...T],
  render: (
    t: {
      [K in keyof T]: T[K] extends Source<infer S> ? S : never;
    }
  ) => HTMLElement | HTMLElement[]
): HTMLElement[] {
  if (typeof window === "undefined") {
    throw new Error(
      "Can't use dyn on serverside. Wrap code in a component and use active instead."
    );
  }
  const comment1 = (document.createComment("") as unknown) as HTMLElement;
  const comment2 = (document.createComment("") as unknown) as HTMLElement;

  // We add myUnsubberList to myParentUnsubberList, so *nested* dyns' cleanup functions will also get cleaned up
  const myParentUnsubberList = currentUnsubberList;
  const myUnsubberList: unsubberList = [];
  if (myParentUnsubberList !== null) {
    myParentUnsubberList.push(myUnsubberList);
  } else {
    // Current dyn has no parent: no problem
  }
  currentUnsubberList = myUnsubberList;
  const el = render((ss as any).map((s: Source<any>) => s.get()));
  currentUnsubberList = myParentUnsubberList;
  ss.forEach((s) => {
    scheduleForCleanup(
      s.observe(function (_newv) {
        // Every time our source changes, we:
        // * Run the cleanup functions that were added during the last render
        // * Run our render function again, gathering cleanup functions again
        // TODO run these off thread?
        cleanupUnsubberList(myUnsubberList);
        const p = comment1.parentNode;

        if (
          p &&
          p.isConnected
          /* parent no longer connected to document -> no need to render again,
             probably another source removed our parent in the meantime
             (happens rarely, so far only when you .set two sources one
             after the other that are in the same dynVariadic...).
             But it's a good principle in general
           */
        ) {
          const previousUnsubberList = currentUnsubberList;
          currentUnsubberList = myUnsubberList;
          let newel = render((ss as any).map((s: Source<any>) => s.get()));
          // putting previousUnsubberList back into currentUnsubberList
          // We used to put myParentUnsubberList back in there, and this is the same in most cases,
          //   unless you do a .set() inside of a render!
          currentUnsubberList = previousUnsubberList;

          const r = document.createRange();
          r.setStartAfter(comment1);
          r.setEndBefore(comment2);

          r.deleteContents();

          const frag = new DocumentFragment();
          const doAppend = function (newel: Node | Node[]) {
            if (Array.isArray(newel)) {
              newel.forEach((e) => doAppend(e));
            } else {
              frag.appendChild(newel);
            }
          };
          doAppend(newel);
          p.insertBefore(frag, comment2);
        }
      })
    );
  });
  return Array.isArray(el)
    ? [comment1].concat(el).concat(comment2)
    : [comment1, el, comment2];
}

export function dyn<T>(
  t: Source<T>,
  render: (t: T) => HTMLElement | HTMLElement[]
): HTMLElement[] {
  return dynVariadic([t], ([t]) => render(t));
}

export function dynClassVariadic<T extends Array<Source<any>>>(
  ss: [...T],
  f: (
    t: {
      [K in keyof T]: T[K] extends Source<infer S> ? S : never;
    }
  ) => null | string,
  el: HTMLElement
): HTMLElement {
  if (typeof window === "undefined") {
    throw new Error(
      "Can't use dyn on serverside. Wrap code in a component and use active instead."
    );
  }
  let previouslySetClass: null | string = null;
  setClass(f((ss as any).map((s: Source<any>) => s.get())));
  ss.forEach((s) => {
    scheduleForCleanup(
      s.observe(function (_newv) {
        setClass(f((ss as any).map((s: Source<any>) => s.get())));
      })
    );
  });

  function setClass(_extraClass: null | string) {
    const extraClass = _extraClass === null ? null : _extraClass.trim();
    // First we extract our previous change to the className, then we apply the new change we want to do
    const currentClass = el.className || "";
    const currentClassWithoutPreviouslySetClass = previouslySetClass
      ? currentClass.replace(previouslySetClass, "")
      : currentClass;
    const newClass = (
      currentClassWithoutPreviouslySetClass.trim() +
      " " +
      (extraClass || "")
    ).trim();
    previouslySetClass = extraClass;
    if (currentClass !== newClass) {
      el.className = newClass;
    }
  }

  return el;
}

export function dynClass<T>(
  s: Source<T>,

  f: (t: T) => null | string,
  el: HTMLElement
): HTMLElement {
  return dynClassVariadic([s], ([t]) => f(t), el);
}

export function dynStyleVariadic<T extends Array<Source<any>>>(
  ss: [...T],
  f: (
    t: {
      [K in keyof T]: T[K] extends Source<infer S> ? S : never;
    }
  ) => null | string,
  el: HTMLElement
): HTMLElement {
  if (typeof window === "undefined") {
    throw new Error(
      "Can't use dyn on serverside. Wrap code in a component and use active instead."
    );
  }
  let previouslySetStyle: null | string = null;
  setStyle(f((ss as any).map((s: Source<any>) => s.get())));
  ss.forEach((s) => {
    scheduleForCleanup(
      s.observe(function (_newv) {
        setStyle(f((ss as any).map((s: Source<any>) => s.get())));
      })
    );
  });

  function setStyle(extraStyle: null | string) {
    // First we extract our previous change to the style attribute, then we apply the new change we want to do
    const currentStyle = el.getAttribute("style") || "";
    const currentStyleWithoutPreviouslySetStyle = previouslySetStyle
      ? currentStyle.replace(previouslySetStyle, "")
      : currentStyle;
    const newStyle = (
      (currentStyleWithoutPreviouslySetStyle.trim().endsWith(";")
        ? currentStyleWithoutPreviouslySetStyle
        : currentStyleWithoutPreviouslySetStyle + ";") + (extraStyle || "")
    ).trim();
    previouslySetStyle = extraStyle;
    if (currentStyle !== newStyle) {
      el.setAttribute("style", newStyle);
    }
  }

  return el;
}

export function dynStyle<T>(
  s: Source<T>,
  f: (t: T) => null | string,
  el: HTMLElement
): HTMLElement {
  return dynStyleVariadic([s], ([t]) => f(t), el);
}
