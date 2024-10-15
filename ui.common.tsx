import h from "trader-hyperscript";
import type { Remote } from "./types/remote";
import { Source } from "./types/source";
import { debounce } from "./lib/debounce";
import { dyn, dynClass, scheduleForCleanup } from "./ui";
import * as joda from "@js-joda/core";

export function errorMessage(
  errS: Source<string | null | undefined>,
  className?: string,
  style?: string
): HTMLElement[] {
  return dyn(errS, function (errStr: string | null | undefined) {
    return errStr ? (
      <span className={"errormessage " + (className || "")} style={style}>
        <i className="fas fa-exclamation" style="margin-right: 12px"></i>
        {[errStr]}
      </span>
    ) : (
      <span></span>
    );
  });
}

export function renderRemote<T>(
  r: Source<Remote<T>>,
  f: (t: T) => HTMLElement | HTMLElement[]
) {
  return dyn(r, function (loaded) {
    if (loaded.tag === "initial") {
      return <span className="loading"></span>;
    } else if (loaded.tag === "error") {
      return (
        <span className="error">
          {loaded.err instanceof Error ? loaded.err.message : loaded.err}
        </span>
      );
    } else {
      return f(loaded.item);
    }
  });
}

export function renderPopup<T>(opts: {
  waitFor: Promise<T>;
  render: (t: T) => HTMLElement;
  onClose: () => void;
  classNames?: {
    container: string;
    inner: string;
  };
  styles?: {
    inner: string;
  };
}): HTMLElement {
  const rs: Source<Remote<T>> = new Source({ tag: "initial" });
  opts.waitFor.then(
    (goodRes) => rs.set({ tag: "loaded", item: goodRes }),
    (err) => rs.set({ tag: "error", err: err })
  );

  const backdrop = (
    <div
      className={
        opts.classNames ? opts.classNames.container : "popup-container"
      }
      onclick={(_ev) => {
        opts.onClose();
      }}
    ></div>
  );
  const popup = (
    <div
      className={opts.classNames ? opts.classNames.inner : "popup"}
      style={opts.styles?.inner || ""}
    >
      {renderRemote(rs, opts.render)}
    </div>
  );

  scheduleForCleanup(() => {
    backdrop.remove();
    popup.remove();
  });

  document.body.appendChild(backdrop);
  document.body.appendChild(popup);

  return <div></div>;
}

export function renderIf(
  s: Source<boolean>,
  render: () => HTMLElement
): HTMLElement[] {
  return dyn(s, function (show) {
    if (show === true) {
      return render();
    } else {
      return <span></span>;
    }
  });
}

export function textbox(opts: {
  source: Source<string>;
  trackUserTyping?: boolean;
  error?: Source<string | null>;
  class?: string;
  type?: string;
  style?: string;
  label?: string;
  placeholder?: string;
  id?: string;
  required?: boolean;
}) {
  const userIsTypingS = new Source(false);
  const i_orig =
    opts.type === "textarea"
      ? ((
          <textarea
            className={opts.class || ""}
            style={opts.style || ""}
            value={opts.source.get()}
            placeholder={opts.placeholder || ""}
            required={opts.required || undefined}
            id={opts.id || undefined}
          />
        ) as HTMLInputElement)
      : ((
          <input
            type={opts.type || "text"}
            style={opts.style || ""}
            className={opts.class || ""}
            value={opts.source.get()}
            placeholder={opts.placeholder || ""}
            required={opts.required || undefined}
            id={opts.id || undefined}
          />
        ) as HTMLInputElement);
  const i = opts.trackUserTyping
    ? (dynClass(
        userIsTypingS,
        (typing) => (typing ? "user_is_typing" : ""),
        i_orig
      ) as HTMLInputElement)
    : i_orig;
  i.oninput = () => opts.source.set(i.value);

  const userStoppedTypingDebounced = debounce(function userStoppedTyping() {
    userIsTypingS.set(false);
  }, 1500);
  i.onkeydown = () => {
    userIsTypingS.set(true);
    userStoppedTypingDebounced();
  };
  scheduleForCleanup(
    opts.source.observe((v) => {
      i.value = v;
    })
  );
  return wrapWithLabel(opts.label, opts.error, i);
}

export function wrapWithLabel(
  l: string | undefined,
  err: Source<string | null> | undefined,
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
      {err === undefined
        ? ((null as unknown) as HTMLElement)
        : errorMessage(err)}
    </label>
  );
}

export function checkbox(opts: {
  source: Source<boolean>;
  class?: string;
  label?: string;
  disabled?: boolean;
}) {
  const i = (
    <input
      type="checkbox"
      checked={opts.source.get() === true ? "checked" : null}
      disabled={opts.disabled || false}
      onchange={(e: InputEvent) =>
        opts.source.set((e?.target as HTMLInputElement)?.checked)
      }
    />
  ) as HTMLInputElement;
  scheduleForCleanup(
    opts.source.observe((v) => {
      i.checked = v;
    })
  );
  return (
    <label className={opts.class || ""}>
      {i}
      {opts.label ? <span>{opts.label}</span> : ""}
    </label>
  );
}

export function selectbox(opts: {
  source: Source<string>;
  error?: Source<string | null>;
  options: { value: string; label: string }[];
  class?: string;
  style?: string;
  label?: string;
  oninput?: () => void;
}) {
  const select = (
    <select className={opts.class || ""} style={opts.style || ""}>
      {opts.options.map((o) => (
        <option value={o.value}>{o.label}</option>
      ))}
    </select>
  ) as HTMLSelectElement;

  const curr = opts.source.get();
  select.value = curr;
  select.oninput = function () {
    opts.source.set(select.value);
    opts.oninput && opts.oninput();
  };
  scheduleForCleanup(
    opts.source.observe((v) => {
      select.value = v;
    })
  );
  return wrapWithLabel(opts.label, opts.error, select);
}

export function multiSelectBox(opts: {
  source: Source<string[]>;
  error?: Source<string | null>;
  options: { value: string; label: string }[];
  class?: string;
  label?: string;
  textIfNothingSelected?: string;
}) {
  const showPopupS: Source<null | number> = new Source(null);

  function findParentButton(el: HTMLElement | null): HTMLButtonElement | null {
    if (el === null) {
      return null;
    }
    if (el.tagName.toLowerCase() === "button") {
      return el as HTMLButtonElement;
    } else {
      return !el.parentElement ? null : findParentButton(el.parentElement);
    }
  }

  const buttonText = dyn(opts.source, function (current) {
    const text = current
      .map((co) => opts.options.find((o) => co === o.value))
      .filter((o) => o !== undefined)
      .map((o) => o?.label)
      .join(", ");
    return <span>{text === "" ? opts.textIfNothingSelected || "" : text}</span>;
  });

  const button = (
    <button
      className="multiselect-button"
      onclick={(ev: MouseEvent) => {
        // When clicking on the text, the target of the event is not this button so we need to find it first
        const button = findParentButton((ev.target as HTMLElement) || null);
        if (button) {
          showPopupS.set(button.getBoundingClientRect().width || 180);
        }
      }}
    >
      {buttonText}
    </button>
  );

  function renderCheckbox(o: { value: string; label: string }) {
    const c = (
      <input
        type="checkbox"
        onchange={(e: InputEvent) => {
          const checked = (e?.target as HTMLInputElement)?.checked;
          const current = opts.source.get();
          const filtered = current.filter((c) => c !== o.value);
          opts.source.set(checked ? filtered.concat(o.value) : filtered);
        }}
      />
    ) as HTMLInputElement;
    const current = opts.source.get();
    const checked = current.some((c) => c === o.value);
    if (checked === true) {
      c.checked = true;
    }
    return (
      <div>
        <label>
          {c} {o.label}
        </label>
      </div>
    );
  }

  const searchS = new Source("");

  const searchBar = textbox({
    source: searchS,
    class: "multiselect-popup-search",
  });

  const popup = dyn(showPopupS, function (showPopup) {
    if (showPopup !== null) {
      setTimeout(
        () =>
          Array.isArray(searchBar)
            ? searchBar.forEach((el) => el.focus && el.focus())
            : searchBar.focus(),
        1
      );

      // Rendering backdrop as button, so grid doesn't recognize this as an actual click on the grid row
      // Doesn't matter much anyway
      return (
        <div>
          <button
            id="backdrop"
            style="z-index: 100; position: fixed; width: 100vw; height: 100vh; top: 0px; left: 0px; opacity: 0; cursor: default"
            onclick={(ev) => {
              showPopupS.set(null);
              ev.preventDefault();
              ev.stopPropagation();
            }}
          ></button>
          <div
            style={"z-index: 101; " + "width: " + showPopup + "px"}
            className="multiselect-popup"
          >
            <div style="display: flex; align-items: center">
              {selectAll}
              {searchBar}
            </div>
            <div className="multiselect-popup-checkboxes">
              {dyn(searchS, function (_search) {
                const search = _search.toLowerCase();
                return opts.options.map((o) =>
                  o.label.toLowerCase().includes(search) ? (
                    renderCheckbox(o)
                  ) : (
                    <span></span>
                  )
                );
              })}
            </div>
          </div>
        </div>
      );
    } else {
      return <span></span>;
    }
  });

  const full = (
    <div style="position: relative">
      {button}
      {popup}
    </div>
  );

  const selectAll = (
    <input
      type="checkbox"
      style="margin-left: 6px"
      onchange={(e: InputEvent) => {
        const checked = (e?.target as HTMLInputElement)?.checked;
        opts.source.set(checked ? opts.options.map((o) => o.value) : []);
        full
          .querySelectorAll(`input[type="checkbox"]`)
          .forEach((c) => ((c as HTMLInputElement).checked = checked));
      }}
    />
  );

  return wrapWithLabel(opts.label, opts.error, full);
}

function toDate(d: joda.LocalDate): Date {
  return new Date(Date.parse(d.toString()));
}
function toLocalDate(d: Date): joda.LocalDate {
  return joda.LocalDate.of(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
export function datebox(opts: {
  source: Source<joda.LocalDate | null>;
  error?: Source<string | null>;
  class?: string;
  label?: string;
  placeholder?: string;
}) {
  const i = (
    <input
      type="date"
      className={opts.class || ""}
      placeholder={opts.placeholder || ""}
    />
  ) as HTMLInputElement;
  const currentValue = opts.source.get();
  i.valueAsDate = currentValue === null ? null : toDate(currentValue);
  i.oninput = () =>
    i.valueAsDate === null
      ? opts.source.set(null)
      : opts.source.set(toLocalDate(i.valueAsDate));
  scheduleForCleanup(
    opts.source.observe((v) => {
      i.valueAsDate = v === null ? null : toDate(v);
    })
  );
  return wrapWithLabel(opts.label, opts.error, i);
}
