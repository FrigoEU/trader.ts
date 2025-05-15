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
