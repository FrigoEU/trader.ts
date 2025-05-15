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
