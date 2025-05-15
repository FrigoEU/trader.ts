# Trader.ts 
Trader.ts is a typescript UI library with a serverside and a clientside component. The different parts can be used independently but work together seamlessly. The main design goals are:

* No magic: just function calls.
  * No special file structure, special function names, build-time processing,...
* The simplest possible mental model, no quirks
  * No hooks, no reconciliation, ...
* Fully typesafe, including communication between server and browser and back
* Very small API surface
* Just provide the basics to build on
* No framework: Just a library that provides you with useful functions

Built in response to React, Angular, Vue, Next.Js ever growing API surface and complicated mental models, the core of trader.ts consists of only a handful of functions. It might seem too limited and simple at first, but the simple abstractions allow you to build anything you want on top of it.

## Server: Node.JS
On the server, trader.ts provides a Router to structure your application. You define the routes of your application, whether they will return HTML or JSON data (or have custom processing) and it returns you a function that you can use to route incoming HTTP requests.

```typescript
// server.tsx
import { Route, Router, h } from "trader.ts";
import * as http from "node:http";

// A definition of a route, described by a URL with parameters
// The type of myFirstRoute is Route<{myOptionalParam: string | undefined}>
const myFirstRoute = Route.makeRoute("/?{myOptionalParam:string}");

// An object that will be passed to every handler.
// Can contain things like a handle to the database, caches, ...
const myContext = {};

// Creating our router
const router = new Router.Router(myContext);

// Registering our first page
router.page(
  myFirstRoute,
  Router.noAuthorization,
  async function (myContext, { myOptionalParam }) {
    return (
      <html>
        <body>
          <h1>Ahoy matey!</h1>
          <h2>{myOptionalParam || ""}</h2>
        </body>
      </html>
    );
  }
);

const port = process.env.PORT || 4000;

// Starting the Node.Js HTTP Server
// Notice that Trader.ts does not start the server itself.
// It's not an HTTP framework, just a library,
// so any logging, debugging, etc is completely free for you to provide
http
  .createServer(function (req, res) {
    // Running our router function
    const routed = router.run({ redirectOnUnauthorizedPage: "/" }, req, res);

    if (routed === false) {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(port);

console.log(`Listening on port ${port}`);
```

You can find a runnable example of this in ./example_server_only

## Client: Browser
In the browser, trader.ts allows you to render HTML dynamically, similar in goals to UI libraries like React, Angular or Vue. Importantly, you mark data that can change in the browser with a Source datatype (similar to an observable). This might seem like a step back into the past of web development, but it makes everything much more simple and predictable.

```typescript
// client.tsx
import { ClientComponents, UI, h } from "trader.ts";

// Our render function
function renderMyClientComponent(props: { startNumber: number }) {
  const counterS = new UI.Source(props.startNumber);
  return (
    <div>
      <h1>Hello from Trader.ts!</h1>
      {UI.dyn(counterS, (counter) => (
        <h2>Counter: {counter}</h2>
      ))}
      <button onclick={() => counterS.set(counterS.get() + 1)}>
        Add 1 to the counter
      </button>
    </div>
  );
}

const parent = <div></div>;
document.body.append(parent);

// Adding it to the DOM
ClientComponents.renderComponentClientside(
  parent,
  null,
  renderMyClientComponent,
  {
    startNumber: 2,
  }
);
```

You can find a runnable example of this in ./example_client_only

`dyn` (stands for dynamic) is the most important function here, rerendering everything inside when the Source changes. This might seem archaic, slow, etc but it's just much easier to work with. Inputs are implemented differently (using observe to set values, etc). Since the mental model is so simple, you can implement things like async loading, caching etc, all yourself exactly the way you want and only when you need it.

## Client and server working together
In a project where both client and server are written in TypeScript and using Trader.ts, communication back and forth can be handled by Trader.ts in a fully typesafe way. Because there is no magic, the heavy lifting to accomplish this is done by two files ("routes" and "clientcomponents") being shared by the client and the server bundles. 

The two above examples are integrated in a single project. Note that file structure and file names are completely up to you. 

You can find the full example in ./example

```typescript
// client.tsx
import { UI, h } from "trader.ts";
import * as routes from "./routes";

// Our actual render function
export function renderMyClientComponent(props: { startNumber: number }) {
  const counterS = new UI.Source(props.startNumber);
  return (
    <div>
      <h1>Hello from Trader.ts!</h1>
      {UI.dyn(counterS, (counter) => (
        <h2>Counter: #{counter}</h2>
      ))}

      <div>
        <button onclick={() => counterS.set(counterS.get() + 1)}>+ 1</button>
      </div>

      <a href={routes.myFirstRoute.link({ myOptionalParam: "Hello" })}>
        A link to myself
      </a>
    </div>
  );
}
```

```typescript
// routes.ts
import { Route } from "trader.ts";
import { apiSpec } from "trader.ts/router";

// A definition of a route, described by a URL with parameters
// The type of myFirstRoute is Route<{myParam: number, myOptionalParam: string | undefined}>
export const myFirstRoute = Route.makeRoute("/?{myOptionalParam:string}");

export const clientcomponentsJsRoute = apiSpec({
  route: Route.makeRoute("/out/clientcomponents.js"),
  method: "GET",
  body: null,
  returns: undefined as any, // TODO
});
```

```typescript
// clientcomponents.ts

import { ClientComponents } from "trader.ts";
import { renderMyClientComponent } from "./client";

export const myClient = ClientComponents.registerClientComponentsSync({
  myClientComponent: renderMyClientComponent,
});

export type myClientComponents = ClientComponents.ClientComponentsExport<
  typeof myClient
>;
```

```typescript
// server.ts
import * as http from "node:http";
import * as fs from "node:fs/promises";
import { ClientComponents, Router, h } from "trader.ts";
import { sendStatic, writeDataWithCompression } from "../../router.static";
import type { myClientComponents } from "./clientcomponents";
import * as routes from "./routes";

const renderClientComponent = ClientComponents.renderInBrowser<myClientComponents>();

// An object that will be passed to every handler.
// Can contain things like a handle to the database, caches, ...
const myContext = {
  renderClientComponent,
};

// Creating our router
const router = new Router.Router(myContext);

// Registering our first page
router.page(
  routes.myFirstRoute,
  Router.noAuthorization,
  async function (myContext, { myOptionalParam }) {
    return (
      <html>
        <head>
          <script
            type="application/javascript"
            src={routes.clientcomponentsJsRoute.route.link()}
          ></script>
        </head>
        <body>
          <h1>Ahoy matey!</h1>
          <h2>{myOptionalParam || ""}</h2>

          {myContext.renderClientComponent("myClientComponent", {
            startNumber: 2,
          })}
        </body>
      </html>
    );
  }
);

router.custom(
  routes.clientcomponentsJsRoute,
  Router.noAuthorization,
  async function (_ctx, _p, _b, _a, req, res) {
    return writeDataWithCompression(
      req,
      res,
      await fs.readFile("./out/clientcomponents.js")
    );
  }
);

const port = process.env.PORT || 5000;

// Starting the Node.Js HTTP Server
// Notice that Trader.ts does not start the server itself.
// It's not an HTTP framework, just a library,
// so any logging, debugging, etc is completely free for you to provide
http
  .createServer(function (req, res) {
    console.log(`Serving ${req.url || ""}`);

    // Running our router function
    const routed = router.run({ redirectOnUnauthorizedPage: "/" }, req, res);

    if (routed === false) {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(port);

console.log(`Listening on port ${port}`);
```
