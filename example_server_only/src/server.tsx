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
