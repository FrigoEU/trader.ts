import {
  deserializeProps,
  findNonSerializable,
  runWithCustomSerializers,
} from "./serialization";
import h from "hyperscript";

type ClientComponent<Props> = (props: Props) => HTMLElement | HTMLElement[];
type ClientComponents<T extends { [key: string]: any }> = {
  [K in keyof T]:
    | ClientComponent<T[K]>
    | (() => Promise<ClientComponent<T[K]>>);
};
export type ClientComponentsExport<T extends ClientComponents<any>> = T;

// Should be in CLIENTSIDE bundle
export function registerClientComponentsSync<T extends { [key: string]: any }>(
  components: { [K in keyof T]: ClientComponent<T[K]> }
): ClientComponents<T> {
  (window as any).clientcomponents = components;
  (window as any).instantiateComponent = instantiateComponent;
  return components;
}

export function registerClientComponentsAsync<T extends { [key: string]: any }>(
  components: {
    [K in keyof T]: () => Promise<ClientComponent<T[K]>>;
  }
): ClientComponents<T> {
  (window as any).clientcomponents = components;
  (window as any).instantiateComponent = instantiateComponent;
  return components;
}

// export const client = registerClientComponents({
//   comp1: async () => {
//     const modu = await import("./comp1");
//     return modu.render;
//   },
//   comp2: async () => {
//     const modu = await import("./comp2");
//     return modu.render;
//   },
//   comp3: async () => {
//     const modu = await import("./comp3");
//     return modu.render;
//   },
// });

// export type clientcomponents = ClientComponentsExport<typeof client>;

// const b = renderInBrowser<typeof client>();
// b("comp1", {});

// Use on SERVERSIDE
export function renderInBrowser<
  Components extends ClientComponents<any> = never
>() {
  return function <K extends keyof Components>(
    name: K,
    p: GetPropsFromComponent<Components[K]>
  ): HTMLElement[] {
    return renderInBrowserImpl(name as string, p);
  };
}

export type GetPropsFromComponent<T> = T extends () => Promise<
  ClientComponent<infer Props>
>
  ? Props
  : never;

function renderInBrowserImpl(name: string, p: any): HTMLElement[] {
  // serverside: make script tag, stringify props and pass "serialized: true"
  if (process.env.NODE_ENV === "production") {
    // in production: don't check anything, following check is rather expensive
  } else {
    // in development: make sure everything is serializable
    const nonSerializable: any = findNonSerializable(p);
    if (nonSerializable) {
      throw new Error(
        `During serialization of properties for component ${name}.
Can't serialize on serverside:
${
  typeof nonSerializable === "function"
    ? errPrintFunction(nonSerializable)
    : JSON.stringify(nonSerializable)
}`
      );
    }
  }

  const props = runWithCustomSerializers(() => JSON.stringify(p));

  // Using a seperate tag for the json data to not run into problems with serializing / deserializeing data that contains ' and " characters
  // Inspiration: https://quipblog.com/efficiently-loading-inlined-json-data-911960b0ac0a
  const jsondata = h(
    "script",
    { type: "application/json" } // Doesn't matter which type, just so browser doesn't parse it
  );
  // If we just pass props as a child to the "h" call, the props will get escaped,
  // causing things like "&" to become "&amp;"
  // This is correct behavior when making any HTML node, EXCEPT when making a <script> tag
  // We correct this using a small "hack" provided by the html-element library to set the innerHTML literally
  jsondata.innerHTML = props;

  const scr = h(
    "script",
    {},
    `var currentScript = document.currentScript;
var dataScript = currentScript.previousSibling;
dataScript.remove();
var textContent = dataScript.textContent;
go();

function go(){
  if (window.instantiateComponent){
    window.instantiateComponent(currentScript, '${name}', textContent);
  } else {
    setTimeout(go, 1)
  }
}`
  );

  return [jsondata, scr];
}

function errPrintFunction(f: Function): string {
  return `
Function name: ${f.name}
Function body: ${f.toString()}.

Wrap this in another component so function definition happens on client side.
`;
}

function instantiateComponent(
  currentScript: HTMLOrSVGScriptElement,
  name: string,
  propsIn: string
) {
  const props = deserializeProps(propsIn);

  const clientcomponents: ClientComponents<any> = (window as any)
    .clientcomponents;
  if (!clientcomponents) {
    throw new Error(
      "No client components registered. Did you forget to call registerClientComponents()?"
    );
  }
  const component = clientcomponents[name];
  if (!component) {
    throw new Error(`Critical error: no component named ${name} found`);
  }

  if (!currentScript) {
    throw new Error(`Critical error: currentScript not found`);
  }

  const com = renderComponentClientside(
    currentScript.parentNode!,
    currentScript,
    component,
    props
  );

  currentScript.remove();
}

function renderComponentClientside<Props>(
  parent: ParentNode,
  currentScript: HTMLOrSVGScriptElement,
  c: ClientComponent<Props> | (() => Promise<ClientComponent<Props>>),
  p: Props
): Comment {
  // clientside: just do the "run" function and insert the elements
  // TODO: maybe don't add comment in production?
  const com = document.createComment(`Reactive component`);
  (com as any).component = c;
  (com as any).props = p;

  parent.insertBefore(com, currentScript);

  const renderOrP = c(p);

  if (renderOrP instanceof Promise) {
    renderOrP.then(function (render) {
      if (parent.isConnected) {
        const els = render(p);
        const df = new DocumentFragment();
        if (Array.isArray(els)) {
          els.forEach((el) => df.append(el));
        } else {
          df.append(els);
        }
        parent.insertBefore(df, com);
      }
    });
  } else {
    if (parent.isConnected) {
      const els = renderOrP;
      const df = new DocumentFragment();
      if (Array.isArray(els)) {
        els.forEach((el) => df.append(el));
      } else {
        df.append(els);
      }
      parent.insertBefore(df, com);
    }
  }

  return com;
}
