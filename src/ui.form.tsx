import h from "hyperscript";
import { groupBy, isEqual, toPairs } from "lodash";
import { Source } from "./types/source";
import { dyn, dynClass, scheduleForCleanup } from "./ui";
import { checkAllCasesHandled } from "./utils";

// General "propagation" strategy:
// More high-level / external models get propagated downward if valid, but not if invalid if they come from "inside the component".
//   If a highlevel component is initiated/set to invalid, a default value will be calculated and propagated downwards
// Lower-level models get propagated upward both when valid and invalid

export type InputModel<Parsed> =
  | {
      tag: "invalid";
      reason: { error: string } | "loading";
      internal?: boolean;
    }
  | { tag: "valid"; item: Parsed; validation: null | { error: string } };

export function selectBox<Parsed>(
  inputModel: Source<InputModel<Parsed>>,
  opts: {
    options: Parsed[];
    toLabel: (p: Parsed) => string;
    toUnique: (p: Parsed) => string;
    toGroup?: (p: Parsed) => string;
    class?: string;
    style?: string;
    oninput?: () => void;
    label?: string;
    errorMessages?: {
      noOptions?: string;
    };
    showInvalidInitialOption?: false | { invalidOptionErrorMessage: string }; // If false, invalid initial options will immediately get recalculated.
  }
): HTMLElement | HTMLElement[] {
  const rawSourceS: Source<string> = new Source("");

  connectExternalToInternalSources(
    inputModel,
    [rawSourceS],
    function ([internal]) {
      const found = opts.options.find((opt) => opts.toUnique(opt) === internal);
      if (found !== undefined) {
        return { tag: "valid", item: found };
      } else {
        return {
          tag: "invalid",
          reason: { error: "Technical error: Value not found" }, // This is a technical error as all options that are selectable should be valid
        };
      }
    },
    function (parsed) {
      const found = opts.options.find(
        (opt) => opts.toUnique(opt) === opts.toUnique(parsed)
      );
      if (found) {
        return { tag: "valid", internal: [opts.toUnique(found)] };
      } else {
        return {
          tag: "invalid",
          reason:
            (opts.showInvalidInitialOption !== false &&
              opts.showInvalidInitialOption?.invalidOptionErrorMessage) ||
            "Value is unknown",
          internal: opts.showInvalidInitialOption
            ? [opts.toUnique(parsed)]
            : undefined,
        };
      }
    },
    () => opts.options[0] || { tag: "nodefaultavailable" },
    { noDefaultValuePossible: opts.errorMessages?.noOptions }
  );

  const init = inputModel.get();
  const initialInvalidOption =
    init.tag === "valid" &&
    opts.showInvalidInitialOption &&
    !opts.options.map(opts.toUnique).includes(opts.toUnique(init.item)) ? (
      <option value={opts.toUnique(init.item)} disabled="true">
        {opts.toLabel(init.item)}
      </option>
    ) : (
      <span></span>
    );

  const groups = opts.toGroup ? groupBy(opts.options, opts.toGroup) : null;

  function mkOption(opt: Parsed): HTMLElement {
    return <option value={opts.toUnique(opt)}>{opts.toLabel(opt)}</option>;
  }

  const select = dynClass(
    inputModel,
    (ip) => (ip.tag === "invalid" ? "invalid" : ""),
    <select className={opts.class || ""} style={opts.style || ""}>
      {initialInvalidOption}
      {groups
        ? toPairs(groups).map(([groupname, groupOptions]) => (
            <optgroup label={groupname}>{groupOptions.map(mkOption)}</optgroup>
          ))
        : opts.options.map(mkOption)}
    </select>
  ) as HTMLSelectElement;

  select.value = rawSourceS.get();
  select.oninput = function () {
    rawSourceS.set(select.value);
    opts.oninput && opts.oninput();
  };
  scheduleForCleanup(
    rawSourceS.observe((v) => {
      select.value = v;
    })
  );
  return wrapWithLabel(opts.label, inputModel, select);
}

export function textBox(
  s: Source<InputModel<string>>,
  opts: {
    class?: string;
    type?: string;
    style?: string;
    label?: string;
    placeholder?: string;
  }
) {
  const init = s.get();
  const initVal = init.tag === "invalid" ? "" : init.item;
  if (init.tag === "invalid") {
    s.set({ tag: "valid", item: "", validation: null });
  }
  const i = (opts.type === "textarea" ? (
    <textarea
      className={opts.class || ""}
      style={opts.style || ""}
      value={initVal}
      placeholder={opts.placeholder || ""}
    />
  ) : (
    <input
      type={opts.type || "text"}
      style={opts.style || ""}
      className={opts.class || ""}
      value={initVal}
      placeholder={opts.placeholder || ""}
    />
  )) as HTMLInputElement;
  i.oninput = () => s.set({ tag: "valid", item: i.value, validation: null });
  scheduleForCleanup(
    s.observe((v) => {
      if (v.tag === "valid") {
        i.value = v.item;
      } else {
        s.set({
          tag: "valid",
          item: "",
          validation: null,
        });
      }
    })
  );
  return wrapWithLabel(opts.label, s, i);
}

function wrapWithLabel(
  l: string | undefined,
  ip: Source<InputModel<any>>,
  i: HTMLElement
): HTMLElement {
  return (
    <label>
      {l === undefined ? (
        ((null as unknown) as HTMLElement)
      ) : (
        <div className="label-text">{l}</div>
      )}
      {i}
      {errorMessage(ip)}
    </label>
  );
}

export function errorMessage(
  ip: Source<InputModel<any>>,
  className?: string,
  style?: string
): HTMLElement[] {
  return dyn(ip, function (ip) {
    return ip.tag === "invalid" && ip.reason !== "loading" ? (
      <span className={"errormessage " + (className || "")} style={style}>
        <i className="fas fa-exclamation" style="margin-right: 12px"></i>
        {ip.reason.error}
      </span>
    ) : (
      <span></span>
    );
  });
}

export function connectExternalToInternalSources<
  Parsed,
  InternalSources extends Array<Source<any>>,
  InternalValues extends {
    [K in keyof InternalSources]: InternalSources[K] extends Source<infer S>
      ? S
      : never;
  }
>(
  inputModel: Source<InputModel<Parsed>>,
  internalSources: [...InternalSources],
  fromInternalToExternal: (
    internal: [...InternalValues]
  ) =>
    | { tag: "invalid"; reason: { error: string } | "loading" }
    | { tag: "valid"; item: Parsed },
  fromExternalToInternal: (
    p: Parsed
  ) =>
    | {
        tag: "valid";
        internal: [...InternalValues];
      }
    | {
        tag: "invalid";
        reason: string;
        internal?: [
          ...InternalValues
        ] /* If internal values are present here -> don't automatically recalculate invalid Parsed value */;
      },
  getDefault: () => Parsed | { tag: "nodefaultavailable" },
  labels?: {
    noDefaultValuePossible?: string;
  }
): void {
  // Whenever external source changes -> push this to internal sources
  // We register this first, so the initial propagation of external to internal can run multiple times if a default is being set
  scheduleForCleanup(inputModel.observe(propagateExternalToInternal));

  propagateExternalToInternal();

  // When internal sources change -> try to parse and push it to the external
  internalSources.forEach(function (internalSource) {
    scheduleForCleanup(internalSource.observe(propagateInternalToExternal));
  });

  // External to internal -> mostly fairly straightforward
  function propagateExternalToInternal() {
    const p = inputModel.get();
    if (p.tag === "valid") {
      // Initialize internal sources
      const res = fromExternalToInternal(p.item);
      if (res.tag === "valid") {
        res.internal.forEach((newInternal, i) =>
          setIfDifferent(internalSources[i], newInternal)
        );
      } else if (res.tag === "invalid") {
        if (res.internal) {
          if (res.internal !== undefined) {
            res.internal.forEach((newInternal, i) =>
              setIfDifferent(internalSources[i], newInternal)
            );
          }
          inputModel.set({ tag: "invalid", reason: { error: res.reason } });
        } else {
          applyDefault();
        }
      } else {
        return checkAllCasesHandled(res);
      }
    } else if (p.tag === "invalid") {
      if (p.internal === true) {
        // Nothing: invalid was set internally so we don't want to circle back downward
      } else {
        applyDefault();
      }
    }
  }

  function applyDefault() {
    const def = getDefault();
    if (
      def === null ||
      def === undefined ||
      ((def as any).hasOwnProperty("tag") &&
        (def as any).tag === "nodefaultavailable")
    ) {
      // No default available :(
      setIfDifferent(inputModel, {
        tag: "invalid",
        reason: {
          error: labels?.noDefaultValuePossible || "No default value possible",
        },
      });
    } else {
      // Default available -> use it
      setIfDifferent(inputModel, {
        tag: "valid",
        item: def as Parsed,
        validation: null,
      });
    }
  }

  // Internal to external -> Parsing logic
  function propagateInternalToExternal() {
    const internalValues = internalSources.map((s) => s.get()) as [
      ...InternalValues
    ];
    const res = fromInternalToExternal(internalValues);
    if (res.tag === "invalid") {
      if (res.reason === "loading") {
        // We wait
      } else {
        setIfDifferent(inputModel, {
          tag: "invalid",
          reason: res.reason,
          internal: true,
        });
      }
    } else if (res.tag === "valid") {
      setIfDifferent(inputModel, {
        tag: "valid",
        item: res.item,
        validation: null,
      });
    } else {
      checkAllCasesHandled(res);
    }
  }
}

// We don't have any default logic here, so we don't need to make a difference between internal and external invalid states
export function connectSumSources<
  T extends { [key: string]: any },
  K extends keyof T
>(
  sum: Source<InputModel<{ tag: K; item: T[K] }>>,
  selector: Source<InputModel<K>>,
  seperates: { [Prop in K]: Source<InputModel<T[Prop]>> }
) {
  /* propagateSeperatesToSum(); */

  // We register this first, so the initial propagation of external to internal can run multiple times if a default is being set
  scheduleForCleanup(sum.observe(propagateSumToSeperates));

  propagateSumToSeperates();

  scheduleForCleanup(selector.observe(propagateSeperatesToSum));
  for (let sep in seperates) {
    scheduleForCleanup(seperates[sep].observe(propagateSeperatesToSum));
  }

  function propagateSumToSeperates() {
    const currentSum = sum.get();
    if (currentSum.tag === "invalid") {
      // Nothing for now
    } else if (currentSum.tag === "valid") {
      setIfDifferent(seperates[currentSum.item.tag], {
        tag: "valid",
        item: currentSum.item.item,
        validation: null,
      });
      setIfDifferent(selector, {
        tag: "valid",
        item: currentSum.item.tag,
        validation: null,
      });
    } else {
      return checkAllCasesHandled(currentSum);
    }
  }

  function propagateSeperatesToSum() {
    const currentSelector = selector.get();
    if (currentSelector.tag === "invalid") {
      setIfDifferent(sum, {
        tag: "invalid",
        reason: { error: "Selector is invalid" },
      });
    } else if (currentSelector.tag === "valid") {
      const currentSeperate = seperates[currentSelector.item].get();
      if (currentSeperate.tag === "invalid") {
        setIfDifferent(sum, {
          tag: "invalid",
          reason: { error: "Seperate is invalid" },
        });
      } else if (currentSeperate.tag === "valid") {
        setIfDifferent(sum, {
          tag: "valid",
          item: {
            tag: currentSelector.item,
            item: currentSeperate.item,
          },
          validation: null,
        });
      } else {
        return checkAllCasesHandled(currentSeperate);
      }
    } else {
      return checkAllCasesHandled(currentSelector);
    }
  }
}

export function connectListSources<T>(
  listS: Source<InputModel<Array<T>>>,
  elementsS: Source<Array<Source<InputModel<T>>>>,
  getUnique: (t: T) => string
) {
  let cleanupfuncs: (() => void)[] = [];

  // Whenever external source changes -> push this to internal sources
  // We register this first, so the initial propagation of external to internal can run multiple times if a default is being set
  scheduleForCleanup(listS.observe(propagateExternalToInternal));

  propagateExternalToInternal();

  scheduleForCleanup(() => {
    cleanupfuncs.forEach((cleanup) => cleanup());
  });

  scheduleForCleanup(elementsS.observe(propagateInternalToExternal));

  // An element gets added / removed to the list -> cleanup all individual watchers and make new ones
  // Maybe not perfectly efficient, but much simpler and less error-prone than figuring out what did/didn't change
  resetObservers();
  function resetObservers() {
    cleanupfuncs.forEach((cleanup) => cleanup());
    cleanupfuncs.length = 0;
    elementsS
      .get()
      .forEach((elS) =>
        cleanupfuncs.push(elS.observe(propagateInternalToExternal))
      );
  }

  // External to internal -> mostly fairly straightforward
  function propagateExternalToInternal() {
    const p = listS.get();
    if (p.tag === "valid") {
      const existingElements = elementsS.get();
      const newItems: Array<Source<InputModel<T>>> = [];
      p.item.forEach(function (item) {
        const itemKey = getUnique(item);
        const existingElement = existingElements.find((exelS) => {
          const exel = exelS.get();
          return exel.tag === "valid" && getUnique(exel.item) === itemKey;
        });
        if (!existingElement) {
          // This item is new, it's not currently in the "lower" elements array
          const newElement = new Source({
            tag: "valid" as const,
            item: item,
            validation: null,
          });
          newItems.push(newElement);
        } else {
          setIfDifferent(existingElement, {
            tag: "valid",
            item: item,
            validation: null,
          });
          newItems.push(existingElement);
        }
      });

      // TODO: Do we need to look for removed items here? To clean up their listeners maybe?

      function mapToUnique(elements: Array<Source<InputModel<T>>>) {
        return elements.map((elS) => {
          const exel = elS.get();
          return exel.tag === "valid" ? getUnique(exel.item) : null;
        });
      }
      if (!isEqual(mapToUnique(existingElements), mapToUnique(newItems))) {
        elementsS.set(newItems);
      }
    } else if (p.tag === "invalid") {
      if (p.internal === true) {
        // Doing nothing, we don't want to propagate internal invalid states back down
      } else {
        // Initiate external source with default
        applyDefault();
      }
    } else {
      checkAllCasesHandled(p);
    }
    resetObservers();
  }

  function applyDefault() {
    // TODO: we can have an argument getDefault here as well if necessary
    setIfDifferent(listS, { tag: "valid", item: [], validation: null });
  }

  // Internal to external -> Parsing logic
  function propagateInternalToExternal() {
    const elements = elementsS.get();
    const validElements = [];
    for (let elS of elements) {
      const el = elS.get();
      if (el.tag === "invalid") {
        if (el.reason === "loading") {
          // We wait
          return;
        } else {
          setIfDifferent(listS, {
            tag: "invalid",
            reason: el.reason,
            internal: true,
          });
          return;
        }
      } else if (el.tag === "valid") {
        validElements.push(el.item);
      } else {
        checkAllCasesHandled(el);
      }
    }
    setIfDifferent(listS, {
      tag: "valid",
      item: validElements,
      validation: null,
    });
    resetObservers();
  }
}

function setIfDifferent<T>(s: Source<T>, t: T) {
  if (!isEqual(s.get(), t)) {
    s.set(t);
  }
}
