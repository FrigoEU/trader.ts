import { dyn, scheduleForCleanup} from "./ui";
import 
import type { Remote } from "./types/remote";
import h from "hyperscript";

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
      onclick={(ev) => {
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
