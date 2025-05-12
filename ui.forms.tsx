import h from "trader-hyperscript";
import { Source } from "./types/source";
import { dyn, dynClass, scheduleForCleanup } from "./ui";
import * as standardinputs from "./ui.common";
import { equals } from "rambda";
import * as joda from "@js-joda/core";
import { checkAllCasesHandled, mapPartial } from "./utils";

const DEBUG = false;
function log(s: string) {
  if (DEBUG) {
    console.log(s);
  }
}

export class Form<ParsedScope extends { [fieldName: string]: any } = {}> {
  private readonly fieldCalculators: {
    [fieldName in keyof ParsedScope]: {
      dependsOn: (keyof ParsedScope)[];
      calc: (deps: any /* temp */) => Promise<Field<any>>;
    };
  };

  constructor(
    fs: {
      [fieldName in keyof ParsedScope]: {
        dependsOn: (keyof ParsedScope)[];
        calc: (deps: any /* temp */) => Promise<Field<any>>;
      };
    }
  ) {
    this.fieldCalculators = fs;
  }

  public addField<
    MyFieldName extends string,
    MyField extends Field<any>,
    DependsOn extends keyof ParsedScope
  >(
    fieldName: MyFieldName,
    dependsOn: DependsOn[],
    fd: (deps: { [dep in DependsOn]: ParsedScope[dep] }) => Promise<MyField>
  ): Form<ParsedScope & { [fn in MyFieldName]: getParsedFromField<MyField> }> {
    return new Form<
      ParsedScope & { [fn in MyFieldName]: getParsedFromField<MyField> }
    >({
      ...this.fieldCalculators,
      [fieldName]: {
        dependsOn: dependsOn,
        calc: fd,
      },
    });
  }

  public build(opts?: {
    render: (
      preRendered: {
        [k in keyof ParsedScope]: () => HTMLElement | HTMLElement[];
      }
    ) => HTMLElement | HTMLElement[];
  }): Field<ParsedScope> {
    const cleanups: (() => void)[] = [];
    const self = this;

    const mainSource: Source<Parsing<ParsedScope>> = new Source({
      tag: "initial",
    });
    const fieldNames = object_keys(this.fieldCalculators);
    const currentStatusOfFieldsS = {} as {
      [fieldName in keyof ParsedScope]: {
        source: Source<Parsing<ParsedScope[fieldName]>>;
        field: Source<null | Field<ParsedScope[fieldName]>>;
        cleanups: (() => void)[];
      };
    };

    log("Making current status sources");

    for (let fieldName of fieldNames) {
      // Setting up a collection of sources where we always have the current "Parsing" value of each field
      const currentStatusS: typeof currentStatusOfFieldsS[typeof fieldName] = {
        source: new Source({
          tag: "loading",
        }),
        field: new Source(null),
        cleanups: [],
      };
      currentStatusOfFieldsS[fieldName] = currentStatusS;

      // Whenever these change -> update the main source
      cleanups.push(
        currentStatusS.source.observe(recalcMainSource) // TODO optim this so we don't always need to iterate through every field? Fairly complicated
      );

      // For every field that is observing this field -> trigger recalculation when this one changes
      for (let fieldName2 of fieldNames) {
        const fieldCalc2 = this.fieldCalculators[fieldName2];
        if (fieldCalc2.dependsOn.includes(fieldName)) {
          cleanups.push(
            currentStatusS.source.observe(() => runFieldCalc(fieldName2))
          );
        }
      }
    }

    // Attempt to run the fieldCalc with its deps, from the currentStatusOfFieldsS collection
    function runFieldCalc(fieldName: keyof ParsedScope) {
      const fieldCalc = self.fieldCalculators[fieldName];

      const curr = currentStatusOfFieldsS[fieldName];
      curr.cleanups.forEach((f) => f());
      curr.cleanups.length = 0;
      curr.field.set(null);

      const res = runFieldCalcImplementation(fieldCalc);
      if (res === null) {
        log(`Field ${String(fieldName)} not initialized`);
        curr.source.set({ tag: "initial" });
      } else {
        log(`Loading field ${String(fieldName)}`);
        curr.source.set({ tag: "loading" });
        res.then(function (field) {
          if (curr.source.get().tag === "loading") {
            log(`Loaded field ${String(fieldName)}`);
            curr.field.set(field);

            // "Forward"ing source
            curr.source.set(field.s.get());
            curr.cleanups.push(
              field.s.observe((parsingVal) => curr.source.set(parsingVal))
            );

            // Adding cleanup of field to our cleanups
            curr.cleanups.push(field.cleanup);
          } else {
            log(
              `Loaded field ${String(fieldName)} but no longer in loading state`
            );
          }
        });
      }
    }

    function runFieldCalcImplementation<T>(fieldCalc: {
      dependsOn: (keyof ParsedScope)[];
      calc: (deps: any /* temp */) => Promise<Field<T>>;
    }): null | Promise<Field<T>> {
      const deps = {} as any; // temp
      for (let dependsOn_ of fieldCalc.dependsOn) {
        const depVal = currentStatusOfFieldsS[dependsOn_].source.get();
        if (depVal.tag === "loading") {
          return null;
        } else if (depVal.tag === "err") {
          return null;
        } else if (depVal.tag === "initial") {
          return null;
        } else {
          deps[dependsOn_] = depVal.parsed;
        }
      }
      return fieldCalc.calc(deps);
    }

    function recalcMainSource() {
      mainSource.set(recalcMainSourceImplementation());
    }

    function recalcMainSourceImplementation(): Parsing<ParsedScope> {
      const buildingUp = {} as ParsedScope;
      for (let fieldName of fieldNames) {
        const currentVal = currentStatusOfFieldsS[fieldName].source.get();
        if (currentVal.tag === "loading") {
          return { tag: "loading" };
        } else if (currentVal.tag === "err") {
          return { tag: "err" };
        } else if (currentVal.tag === "initial") {
          return { tag: "initial" };
        } else if (currentVal.tag === "parsed") {
          buildingUp[fieldName] = currentVal.parsed;
        }
      }

      return { tag: "parsed", parsed: buildingUp };
    }

    log("Kicking off calculations");

    for (let fieldName of fieldNames) {
      // Kick off calculations
      runFieldCalc(fieldName);
    }

    function cleanup() {
      cleanups.forEach((f) => f());
      for (let fieldName of fieldNames) {
        currentStatusOfFieldsS[fieldName].cleanups.forEach((f) => f());
      }
    }

    return {
      s: mainSource,
      cleanup,
      render: function () {
        scheduleForCleanup(
          mainSource.observe((parsing) => {
            if (parsing.tag === "parsed") {
              const currentFullValueFromFields = recalcMainSourceImplementation();
              if (equals(parsing, currentFullValueFromFields)) {
                // do nothing
              } else {
                // Source got set from the outside -> push values down into fields
                for (let fieldName of fieldNames) {
                  currentStatusOfFieldsS[fieldName].field.get()?.s.set({
                    tag: "parsed",
                    parsed: parsing.parsed[fieldName],
                  });
                }
              }
            }
          })
        );
        // TODO: setup/cleanup sequence is not OK
        const customRenderFunc = opts?.render || null;
        if (customRenderFunc === null) {
          const renderedFields = [];
          for (let fieldName of fieldNames) {
            const fieldS = currentStatusOfFieldsS[fieldName].field;
            renderedFields.push(
              dyn(fieldS, function (field) {
                if (field === null) {
                  return <span></span>;
                } else {
                  return field.render();
                }
              })
            );
          }
          return renderedFields.flat();
        } else {
          const renderedFields = {} as {
            [k in keyof ParsedScope]: () => HTMLElement | HTMLElement[];
          };
          for (let fieldName of fieldNames) {
            const fieldS = currentStatusOfFieldsS[fieldName].field;
            // Wrapping this in a closure so you can still use <dyn> inside
            // the customRenderFunc, otherwise this bugs
            renderedFields[fieldName] = () =>
              dyn(fieldS, function (field) {
                if (field === null) {
                  return <span></span>;
                } else {
                  return field.render();
                }
              });
          }
          return customRenderFunc(renderedFields);
        }
      },
    };
  }
}

export function textBox(opts: {
  initialVal?: string;
  type?: string;
  label?: string;
  style?: string;
  class?: string;
  validations?: ((
    s: string
  ) => { tag: "err"; label?: string } | { tag: "parsed"; parsed: string })[];
}): Promise<Field<string>> {
  const rawS = new Source(opts.initialVal?.toString() || "");

  const initialVal = opts.initialVal || "";
  const parsedS: Source<Parsing<string>> = new Source(
    initialVal.trim() === "" &&
    (opts.validations || []).some((v) => v(initialVal.trim()).tag === "err")
      ? { tag: "initial" }
      : {
          tag: "parsed",
          parsed: initialVal,
        }
  );

  function parse(
    s: string
  ): { tag: "parsed"; parsed: string } | { tag: "err" } {
    const allValidations = opts.validations || [];
    let currentValue = s;
    for (let validation of allValidations) {
      const res = validation(currentValue);
      if (res.tag === "err") {
        return res;
      } else {
        currentValue = res.parsed;
      }
    }
    return { tag: "parsed", parsed: currentValue };
  }

  function render() {
    syncRawAndParsing<string, string>({
      rawS,
      parsingS: parsedS,
      parse,
      parsedToRaw: (s) => s,
    });

    return wrapInputWithHasErrorDynClass(
      parsedS,
      standardinputs.textbox({
        ...opts,
        error: parsedS,
        trackUserTyping: (opts.validations || []).length > 0,
        source: rawS,
        label: opts.label,
      })
    );
  }

  return Promise.resolve({
    s: parsedS,
    cleanup: () => {},
    render,
  });
}

export function timeBox(opts: {
  initialVal?: joda.LocalTime;
  label?: string;
  emptyLabel?: string;
  style?: string;
  class?: string;
  id?: string;
  previewS?: Source<joda.LocalTime>;
}): Promise<Field<joda.LocalTime>> {
  const rawS = new Source(opts.initialVal?.toString() || "");

  const parsedS: Source<Parsing<joda.LocalTime>> = new Source(
    opts.initialVal
      ? { tag: "parsed", parsed: opts.initialVal }
      : {
          tag: "initial",
        }
  );

  function parse(raw: string): Parsing<joda.LocalTime> {
    try {
      const parsed = joda.LocalTime.parse(raw);
      return { tag: "parsed", parsed };
    } catch {
      return {
        tag: "err",
        label: opts.emptyLabel === undefined ? "Mandatory" : opts.emptyLabel,
      };
    }
  }

  const cleanup = rawS.observe((raw) => {
    parsedS.set(parse(raw));
  });

  function render() {
    if (opts.previewS) {
      scheduleForCleanup(
        parsedS.observe((s) =>
          s.tag === "parsed" ? opts.previewS!.set(s.parsed) : {}
        )
      );
    }

    return wrapInputWithHasErrorDynClass(
      parsedS,
      standardinputs.textbox({
        ...opts,
        source: rawS,
        type: "time",
      })
    );
  }

  return Promise.resolve({
    s: parsedS,
    cleanup,
    render,
  });
}

export function dateBox(opts: {
  initialVal?: joda.LocalDate;
  label?: string;
  style?: string;
  class?: string;
  id?: string;
  onChange?: (d: joda.LocalDate) => void;
}): Promise<Field<joda.LocalDate>> {
  const rawS = new Source(opts.initialVal ? opts.initialVal.toString() : "");

  const parsingS: Source<Parsing<joda.LocalDate>> = new Source(
    opts.initialVal
      ? { tag: "parsed", parsed: opts.initialVal }
      : {
          tag: "initial",
        }
  );

  function parse(
    raw: string
  ): { tag: "parsed"; parsed: joda.LocalDate } | undefined {
    try {
      const parsed = joda.LocalDate.parse(raw);
      return { tag: "parsed", parsed };
    } catch {
      return undefined;
    }
  }

  syncRawAndParsing({
    rawS,
    parsingS,
    parse,
    parsedToRaw: (r) => {
      return r.toString();
    },
  });

  function render() {
    if (opts.onChange) {
      parsingS.observe((s) =>
        s.tag === "parsed" ? opts.onChange!(s.parsed) : {}
      );
    }
    return wrapInputWithHasErrorDynClass(
      parsingS,
      standardinputs.textbox({
        ...opts,
        required: true,
        source: rawS,
        type: "date",
      })
    );
  }

  return Promise.resolve({
    s: parsingS,
    cleanup: () => {},
    render,
  });
}

export function constantField<T>(
  val: T,
  opts?: { render?: HTMLElement | HTMLElement[] }
): Promise<Field<T>> {
  return Promise.resolve({
    s: new Source({ tag: "parsed", parsed: val }),
    cleanup: () => {},
    render: () => opts?.render || [],
  });
}

export function checkBox(opts: {
  initialVal: boolean;
  label: string;
  style?: string;
  class?: string;
  disabled?: boolean;
  requiredTrue?: true;
}): Promise<Field<boolean>> {
  const rawS = new Source(opts.initialVal);

  const parsedS: Source<Parsing<boolean>> = new Source(
    opts.requiredTrue === true && opts.initialVal === false
      ? { tag: "initial" }
      : {
          tag: "parsed",
          parsed: opts.initialVal,
        }
  );

  function parse(
    raw: boolean
  ): { tag: "parsed"; parsed: boolean } | { tag: "err" } {
    if (opts.requiredTrue === true && raw === false) {
      return { tag: "err" };
    }
    return { tag: "parsed", parsed: raw };
  }

  const cleanup = rawS.observe((raw) => {
    parsedS.set(parse(raw));
  });

  function render() {
    return wrapInputWithHasErrorDynClass(
      parsedS,
      standardinputs.checkbox({
        ...opts,
        source: rawS,
      })
    );
  }

  return Promise.resolve({
    s: parsedS,
    cleanup,
    render,
  });
}

export function numberBox(
  initialVal?: number,
  opts?: {
    label?: string;
    constraint?: "positive" | "negative";
    constraintLabel?: string;
    step?: number;
  }
): Promise<Field<number>> {
  const rawS = new Source(initialVal?.toString() || "");

  const parsedS: Source<Parsing<number>> = new Source(
    initialVal !== undefined
      ? { tag: "parsed", parsed: initialVal }
      : { tag: "initial" }
  );

  function render() {
    const i = wrapInputWithHasErrorDynClass(
      parsedS,
      (
        <input type="number" step={opts?.step || 1} value={rawS.get()} />
      ) as HTMLInputElement
    );
    i.oninput = () => rawS.set(i.value);
    return opts?.label ? (
      <label>
        <div className="label-text">{opts.label}</div>
        {i}
      </label>
    ) : (
      i
    );
  }

  syncRawAndParsing({
    rawS,
    parsingS: parsedS,
    parse: (n) => {
      return parseNumberInput(n);
    },
    parsedToRaw: (n) => n.toString(),
  });

  return Promise.resolve({
    s: parsedS,
    cleanup: () => {},
    render,
  });
}

function parseNumberInput(
  raw: string,
  opts?: {
    constraint?: "positive" | "negative";
    constraintLabel?: string;
  }
): { tag: "parsed"; parsed: number } | { tag: "err"; label?: string } {
  try {
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      if (
        opts &&
        opts.constraint &&
        opts.constraint === "positive" &&
        parsed < 0
      ) {
        return { tag: "err", label: opts.constraintLabel || "" };
      }
      if (
        opts &&
        opts.constraint &&
        opts.constraint === "negative" &&
        parsed > 0
      ) {
        return { tag: "err", label: opts.constraintLabel || "" };
      }
      return { tag: "parsed", parsed };
    } else {
      return { tag: "err" };
    }
  } catch {
    return { tag: "err" };
  }
}

export function numberBoxOptional(
  initialVal: number | null,
  opts?: {
    label?: string;
    constraint?: "positive" | "negative";
    constraintLabel?: string;
    step?: number;
  }
): Promise<Field<number | null>> {
  const rawS = new Source(initialVal?.toString() || "");

  const parsedS: Source<Parsing<number | null>> = new Source({
    tag: "parsed",
    parsed: initialVal,
  });

  function parse(
    raw: string
  ): { tag: "parsed"; parsed: number | null } | { tag: "err"; label?: string } {
    if (raw.trim() === "") {
      return { tag: "parsed", parsed: null };
    }
    return parseNumberInput(raw, opts);
  }

  const cleanup = rawS.observe((raw) => {
    parsedS.set(parse(raw));
  });

  function render() {
    const i = wrapInputWithHasErrorDynClass(
      parsedS,
      (
        <input type="number" step={opts?.step || 1} value={rawS.get()} />
      ) as HTMLInputElement
    );
    i.oninput = () => rawS.set(i.value);
    return opts?.label ? (
      <label>
        <div className="label-text">{opts.label}</div>
        {i}
      </label>
    ) : (
      i
    );
  }

  return Promise.resolve({
    s: parsedS,
    cleanup,
    render,
  });
}

export function selectBox<T>(opts: {
  initial: T | null | undefined;
  values: T[];
  show: (t: T) => string;
  label?: string;
  style?: string;
  class?: string;
  saveAndLoadInitialValToLocalStorage?: string;
  previewS?: Source<T>;
  isDisabled?: (t: T) => boolean;
  groups?: {
    groupnames: string[];
    assignToGroup: (t: T) => string;
  };
}): Promise<Field<T>> {
  const lsKey = opts?.saveAndLoadInitialValToLocalStorage
    ? "trader_forms_selectbox_" + opts.saveAndLoadInitialValToLocalStorage
    : null;
  const fromLs = lsKey ? localStorage.getItem(lsKey) : null;
  // We save the SHOWN value into LS, not the "identifier"
  const initial = !isNil(fromLs)
    ? fromLs
    : !isNil(opts.initial)
    ? opts.show(opts.initial)
    : null;

  const initialFound = opts.values.find((opt) => opts.show(opt) === initial);
  const initialParsed =
    initialFound &&
    (isNil(opts) ||
      isNil(opts.isDisabled) ||
      opts.isDisabled(initialFound) === false)
      ? {
          tag: "parsed" as const,
          parsed: initialFound,
        }
      : { tag: "initial" as const };

  const parsedS: Source<Parsing<T>> = new Source(initialParsed);
  const rawS: Source<string> = new Source(
    initialParsed.tag === "parsed" ? opts.show(initialParsed.parsed) : ""
  );

  function parse(raw: string): { tag: "parsed"; parsed: T } | undefined {
    try {
      const parsed = opts.values.find((opt) => opts.show(opt) === raw);
      if (parsed !== undefined) {
        return { tag: "parsed", parsed };
      } else {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }

  if (opts?.previewS) {
    scheduleForCleanup(
      parsedS.observe((s) => {
        if (s.tag === "parsed") {
          opts!.previewS!.set(s.parsed as T);
        }
      })
    );
  }

  syncRawAndParsing({ rawS, parsingS: parsedS, parse, parsedToRaw: opts.show });

  function render() {
    function renderOpt(opt: T) {
      return (
        <option
          disabled={
            isNil(opts) ||
            isNil(opts.isDisabled) ||
            opts.isDisabled(opt) === false
              ? false
              : true
          }
          value={opts.show(opt)}
        >
          {opts.show(opt)}
        </option>
      );
    }

    const i = wrapInputWithHasErrorDynClass(
      parsedS,
      (
        <select
          value={rawS.get()}
          style={opts?.style || ""}
          className={opts?.class || ""}
          required={true}
        >
          {initial === null || initial === undefined ? (
            <option value=""></option>
          ) : (
            ((null as unknown) as HTMLOptionElement)
          )}
          {opts && opts.groups
            ? mapPartial(opts.groups.groupnames, (groupname) => {
                const optionsForGroup = opts.values.filter(
                  (opt) => opts.groups!.assignToGroup(opt) === groupname
                );
                if (optionsForGroup.length === 0) {
                  return null;
                } else {
                  if (groupname === "") {
                    return optionsForGroup.map(renderOpt);
                  } else {
                    return (
                      <optgroup label={groupname}>
                        {optionsForGroup.map(renderOpt)}
                      </optgroup>
                    );
                  }
                }
              })
            : opts.values.map(renderOpt)}
        </select>
      ) as HTMLInputElement
    );

    i.value = rawS.get();

    i.oninput = () => {
      rawS.set(i.value);
    };

    scheduleForCleanup(
      rawS.observe((r) => {
        if (r !== i.value) {
          i.value = r;
        }
        if (lsKey) {
          localStorage.setItem(lsKey, i.value);
        }
      })
    );

    return standardinputs.wrapWithLabel(opts.label, parsedS, i);
  }

  return Promise.resolve({
    s: parsedS,
    cleanup: () => {},
    render,
  });
}

export function multiSelectbox<T>(
  options: T[],
  initial: T[],
  show: (t: T) => string,
  opts?: {
    label?: string;
    textIfNothingSelected?: string;
  }
): Promise<Field<T[]>> {
  const rawS: Source<string[]> = new Source(initial.map((opt) => show(opt)));

  const parsedS: Source<Parsing<T[]>> = new Source({
    tag: "parsed",
    parsed: initial,
  });

  function parse(
    raw: string[]
  ): { tag: "parsed"; parsed: T[] } | { tag: "err" } {
    try {
      let parsed = [];
      for (let r of raw) {
        const found = options.find((opt) => r === show(opt));
        if (!found) {
          return { tag: "err" };
        } else {
          parsed.push(found);
        }
      }
      return { tag: "parsed", parsed };
    } catch {
      return { tag: "err" };
    }
  }

  const cleanup = rawS.observe((raw) => {
    parsedS.set(parse(raw));
  });

  function render() {
    return standardinputs.multiSelectBox({
      source: rawS,
      options: options.map((opt) => ({
        value: show(opt),
        label: show(opt),
      })),
      label: opts?.label,
      textIfNothingSelected: opts?.textIfNothingSelected,
    });
  }

  return Promise.resolve({
    s: parsedS,
    cleanup,
    render,
  });
}

export type Parsing<T> =
  | { tag: "loading" }
  | { tag: "initial" }
  | { tag: "err"; label?: string }
  | { tag: "parsed"; parsed: T };

type getParsedFromField<F> = F extends Field<infer Parsed> ? Parsed : never;

export interface Field<Parsed> {
  s: Source<Parsing<Parsed>>;
  render: () => HTMLElement | HTMLElement[];
  cleanup: () => void;
}

export function object_keys<T extends object>(obj: T): Array<keyof T> {
  return Object.keys(obj) as Array<keyof T>;
}

export function syncRawAndParsing<Raw, Parsed>(opts: {
  rawS: Source<Raw>;
  parsingS: Source<Parsing<Parsed>>;
  parse: (
    raw: Raw
  ) =>
    | undefined
    | { tag: "parsed"; parsed: Parsed }
    | { tag: "err"; label?: string };
  parsedToRaw: (parsed: Parsed) => Raw;
}) {
  scheduleForCleanup(
    opts.rawS.observe((raw) => {
      const parsed = opts.parse(raw);
      if (parsed === undefined) {
        opts.parsingS.set({ tag: "err" });
      } else if (parsed.tag === "err") {
        opts.parsingS.set(parsed);
      } else if (parsed.tag === "parsed") {
        const currentParsing = opts.parsingS.get();
        if (!equals(parsed, currentParsing)) {
          opts.parsingS.set(parsed);
        }
      } else {
        checkAllCasesHandled(parsed);
      }
    })
  );

  scheduleForCleanup(
    opts.parsingS.observe((parsing) => {
      if (parsing.tag === "parsed") {
        const currentRaw = opts.rawS.get();
        const newRaw = opts.parsedToRaw(parsing.parsed);
        if (!equals(currentRaw, newRaw)) {
          opts.rawS.set(newRaw);
        }
      }
    })
  );
}

function isNil(value: any): value is null | undefined {
  return value === null || value === undefined;
}

function wrapInputWithHasErrorDynClass<T, H extends HTMLElement>(
  parsedS: Source<Parsing<T>>,
  i: H
) {
  return dynClass(
    parsedS,
    (parsed) =>
      parsed.tag === "err"
        ? "has_error"
        : parsed.tag === "initial"
        ? "has_initial"
        : "",
    i
  ) as HTMLInputElement;
}
