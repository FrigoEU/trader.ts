import h from "trader-hyperscript";
import { Source } from "./types/source";
import { dyn, scheduleForCleanup } from "./ui";
import * as standardinputs from "./ui.common";
import { equals } from "rambda";
import * as joda from "@js-joda/core";
import { mapPartial } from "./utils";

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
        [k in keyof ParsedScope]: HTMLElement | HTMLElement[];
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
            [k in keyof ParsedScope]: HTMLElement | HTMLElement[];
          };
          for (let fieldName of fieldNames) {
            const fieldS = currentStatusOfFieldsS[fieldName].field;
            renderedFields[fieldName] = dyn(fieldS, function (field) {
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
  mandatory?: boolean;
  initialVal?: string;
  type?: string;
  label?: string;
  style?: string;
  class?: string;
}): Promise<Field<string>> {
  const rawS = new Source(opts.initialVal?.toString() || "");

  const initialVal = opts.initialVal || "";
  const parsedS: Source<Parsing<string>> = new Source(
    opts.mandatory === true && initialVal.trim() === ""
      ? { tag: "initial" }
      : {
          tag: "parsed",
          parsed: initialVal,
        }
  );

  function parse(
    raw: string
  ): { tag: "parsed"; parsed: string } | { tag: "err" } {
    if (opts.mandatory === true && raw.trim() === "") {
      return { tag: "err" };
    } else {
      return { tag: "parsed", parsed: raw };
    }
  }

  const cleanup = rawS.observe((raw) => {
    parsedS.set(parse(raw));
  });

  function render() {
    return standardinputs.textbox({
      ...opts,
      required: opts.mandatory,
      source: rawS,
      label: opts.label,
    });
  }

  return Promise.resolve({
    s: parsedS,
    cleanup,
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

    return standardinputs.textbox({
      ...opts,
      source: rawS,
      type: "time",
    });
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

  function parse(raw: string): joda.LocalDate | undefined {
    try {
      const parsed = joda.LocalDate.parse(raw);
      return parsed;
    } catch {
      return undefined;
    }
  }

  function render() {
    if (opts.onChange) {
      parsingS.observe((s) =>
        s.tag === "parsed" ? opts.onChange!(s.parsed) : {}
      );
    }
    syncRawAndParsing({
      rawS,
      parsingS,
      parse,
      parsedToRaw: (r) => {
        return r.toString();
      },
    });
    return standardinputs.textbox({
      ...opts,
      required: true,
      source: rawS,
      type: "date",
    });
  }

  return Promise.resolve({
    s: parsingS,
    cleanup: () => {},
    render,
  });
}

export function constantField<T>(val: T): Promise<Field<T>> {
  return Promise.resolve({
    s: new Source({ tag: "parsed", parsed: val }),
    cleanup: () => {},
    render: () => <span></span>,
  });
}

export function checkBox(opts: {
  initialVal: boolean;
  label: string;
  style?: string;
  class?: string;
}): Promise<Field<boolean>> {
  const rawS = new Source(opts.initialVal);

  const parsedS: Source<Parsing<boolean>> = new Source({
    tag: "parsed",
    parsed: opts.initialVal,
  });

  function parse(
    raw: boolean
  ): { tag: "parsed"; parsed: boolean } | { tag: "err" } {
    return { tag: "parsed", parsed: raw };
  }

  const cleanup = rawS.observe((raw) => {
    parsedS.set(parse(raw));
  });

  function render() {
    return standardinputs.checkbox({
      ...opts,
      source: rawS,
    });
  }

  return Promise.resolve({
    s: parsedS,
    cleanup,
    render,
  });
}

export function numberBox(
  initialVal?: number,
  opts?: { label?: string }
): Promise<Field<number>> {
  const rawS = new Source(initialVal?.toString() || "");

  const parsedS: Source<Parsing<number>> = new Source(
    initialVal !== undefined
      ? { tag: "parsed", parsed: initialVal }
      : { tag: "initial" }
  );

  function parse(
    raw: string
  ): { tag: "parsed"; parsed: number } | { tag: "err" } {
    try {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) {
        return { tag: "parsed", parsed };
      } else {
        return { tag: "err" };
      }
    } catch {
      return { tag: "err" };
    }
  }

  const cleanup = rawS.observe((raw) => {
    parsedS.set(parse(raw));
  });

  function render() {
    const i = (<input type="number" value={rawS.get()} />) as HTMLInputElement;
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

export function selectBox<T>(
  options: T[],
  initial_: T | null | undefined,
  show: (t: T) => string,
  opts?: {
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
  }
): Promise<Field<T>> {
  const lsKey = opts?.saveAndLoadInitialValToLocalStorage
    ? "trader_forms_selectbox_" + opts.saveAndLoadInitialValToLocalStorage
    : null;
  const fromLs = lsKey ? localStorage.getItem(lsKey) : null;
  // We save the SHOWN value into LS, not the "identifier"
  const initial = !isNil(fromLs)
    ? fromLs
    : !isNil(initial_)
    ? show(initial_)
    : null;
  const rawS: Source<string> = new Source(initial || "");

  const initialFound = options.find((opt) => show(opt) === initial);
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

  function parse(raw: string): { tag: "parsed"; parsed: T } | { tag: "err" } {
    try {
      const parsed = options.find((opt) => show(opt) === raw);
      if (parsed !== undefined) {
        return { tag: "parsed", parsed: parsed };
      } else {
        return { tag: "err" };
      }
    } catch {
      return { tag: "err" };
    }
  }

  const cleanup = rawS.observe((raw) => {
    parsedS.set(parse(raw));
  });

  function render() {
    if (opts?.previewS) {
      scheduleForCleanup(
        parsedS.observe((s) => {
          if (s.tag === "parsed") {
            opts!.previewS!.set(s.parsed as T);
          }
        })
      );
    }

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
          value={show(opt)}
        >
          {show(opt)}
        </option>
      );
    }

    const i = (
      <select
        value={rawS.get()}
        style={opts?.style || ""}
        className={opts?.class || ""}
      >
        {initial === null || initial === undefined ? (
          <option value=""></option>
        ) : (
          ((null as unknown) as HTMLOptionElement)
        )}
        {opts && opts.groups
          ? mapPartial(opts.groups.groupnames, (groupname) => {
              const optionsForGroup = options.filter(
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
          : options.map(renderOpt)}
      </select>
    ) as HTMLInputElement;

    if (!isNil(initialFound)) {
      i.value = show(initialFound);
    }

    i.oninput = () => {
      rawS.set(i.value);
      if (lsKey) {
        localStorage.setItem(lsKey, i.value);
      }
    };
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
  parse: (raw: Raw) => undefined | Parsed;
  parsedToRaw: (parsed: Parsed) => Raw;
}) {
  scheduleForCleanup(
    opts.rawS.observe((raw) => {
      const parsed = opts.parse(raw);
      if (parsed !== undefined) {
        const newParsing = { tag: "parsed" as const, parsed };
        const currentParsing = opts.parsingS.get();
        if (!equals(newParsing, currentParsing)) {
          opts.parsingS.set(newParsing);
        }
      } else {
        opts.parsingS.set({ tag: "err" });
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
