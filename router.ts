import * as joda from "@js-joda/core";
import type {
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse as ServerResponse_,
} from "node:http";
import { Codec, nullType } from "purify-ts/Codec";
import { Either, Right } from "purify-ts/Either";
import type { Route } from "./route";
import { writeDataWithCompression } from "./router.static";

declare module "http" {
  interface ServerResponse {
    write(chunk: string | Uint8Array, callback?: (err: Error) => void): boolean;
    write(
      chunk: string | Uint8Array,
      encoding: BufferEncoding,
      callback?: (err: Error) => void
    ): boolean;
  }
}

export type ServerRequest = IncomingMessage;
export type ServerResponse = ServerResponse_;

const isDev = process.env.NODE_ENV || "development" === "development";

function checkMoreGeneralRoutes(
  existingSpecs: InternalSpec<any, any, any>[],
  newMethod: HTTPMethod,
  newRoute: Route<any>
) {
  function routePartsToStringForComparison(r: Route<any>) {
    return r.parts
      .map((part) => {
        if (part.tag === "constant") {
          return part.constant;
        } else if (part.tag === "capture") {
          return "var";
        } else {
          throw new Error("Bad tag property in Route part");
        }
      })
      .join("")
      .trim();
  }

  const moreGeneralRoute = existingSpecs.find(
    (r) =>
      r.method === newMethod &&
      routePartsToStringForComparison(newRoute) ===
        routePartsToStringForComparison(r.route)
  );
  if (moreGeneralRoute) {
    throw new Error(`
Route being registered will never be called.
Problem route: ${newRoute.__rawUrl}.
More general route: ${moreGeneralRoute.route.__rawUrl}
`);
  }
}

export type HTTPMethod = "GET" | "PUT" | "POST" | "DELETE";

// No-op function, just to check APISpec creation and to infer types
export function apiSpec<UrlParams, Body, Returns>(
  spec: APISpec<UrlParams, Body, Returns>
): APISpec<UrlParams, Body, Returns> {
  return spec;
}

export type APISpec<Params, Body, Returns> = {
  route: Route<Params>;
  method: HTTPMethod;
  body: Codec<Body> | null;
  returns: Codec<Returns>;
};

// No-op function, just to check SSESpec creation and to infer types
export function sseSpec<UrlParams, Returns>(
  spec: SSESpec<UrlParams, Returns>
): SSESpec<UrlParams, Returns> {
  return spec;
}

export type SSESpec<Params, Returns> = {
  route: Route<Params>;
  returns: Codec<Returns>;
};

export type GetReturnTypeFromApiSpec<T> = T extends APISpec<
  any,
  any,
  infer Returns
>
  ? Returns
  : never;

export type InternalSpec<Context, Params, Token> = {
  route: Route<Params>;
  method: HTTPMethod;
  body: Codec<any> | null;
  returns: "sse" | "html" | Codec<any> | null;
  run: (
    opts: RunOptions,
    ctx: Context,
    req: ServerRequest,
    res: ServerResponse,
    p: Params
  ) => void;
  needsAuthorization: null | authfunc<Context, Token, Params>;
  tags: { name: string; comment: string }[];
};

export type authfunc<Context, Token, Params> = (
  req: ServerRequest,
  context: Context,
  params: Params
) => Promise<
  Either<
    | string
    | { tag: "redirect"; redirectUrl: string }
    | [number, OutgoingHttpHeaders],
    Token
  >
>;

type RunOptions = { redirectOnUnauthorizedPage: string | null };

export type RoutesRec =
  | Route<any>
  | APISpec<any, any, any>
  | SSESpec<any, any>
  | {
      [name: string]: RoutesRec;
    };

const mainFileName = require.main?.filename || "";
const runningInTest = mainFileName.includes("alsatian");

export class Router<Context> {
  private specs: InternalSpec<Context, any, any>[] = [];

  constructor() {}

  private getBody<Body>(
    codec: Codec<Body> | null,
    req: ServerRequest,
    res: ServerResponse,
    cont: (body: Body) => void
  ): void {
    if (codec === null) {
      cont(
        (null as unknown) as Body /* We know this is correct because only then newSpec.body === null */
      );
    } else {
      // Gather the incoming body and run the actual implementation with the parsed body
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => {
        const decodeResult = codec.decode(data);
        decodeResult.caseOf({
          Left: (error: string) => {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.write("Error decoding body: " + error);
            res.end();
            console.error("Encountered error during body decoding.");
            console.error(`Incoming url: ${req.headers.host}${req.url}`);
            console.error(`Incoming body: ${data}`);
            console.error(`Error: ${error}`);
          },
          Right: (decodedBody: Body) => {
            cont(decodedBody);
          },
        });
      });
    }
  }

  page<Params, Token>(
    route: Route<Params>,
    needsAuthorization: authfunc<Context, Token, Params>,
    run: (
      context: Context,
      p: Params,
      auth: Token,
      req: ServerRequest,
      res: ServerResponse
    ) => Promise<HTMLElement | { tag: "redirect"; url: string }>,
    opts?: { dontCompress?: boolean }
  ): void {
    this.custom<Params, null, null, Token>(
      {
        route: route,
        method: "GET",
        body: null,
        returns: nullType,
      },
      needsAuthorization,
      async function (ctx, p, _b, auth, req, res) {
        return run(ctx, p, auth, req, res).then(function (r) {
          if ("tag" in r) {
            res.writeHead(302, {
              Location: r.url,
            });
            res.end();
          } else {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader(
              "Cache-Control",
              "no-cache, no-store, must-revalidate"
            );
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
            if (opts?.dontCompress === true) {
              res.writeHead(200, {});
              res.write("<!DOCTYPE html>");
              res.end(r.outerHTML);
            } else {
              writeDataWithCompression(
                req,
                res,
                "<!DOCTYPE html>" + r.outerHTML
              );
            }
          }
        });
      }
    );
  }

  /**
   *
   * @typeParam Params - Params parsed from URL
   * @typeParam Body - Params parsed from POST body if relevant, always JSON.parse'd
   * @typeParam Returns - Return type of API, will be JSON.stringify'd
   *
   */
  api<Params, Body, Returns, Token>(
    newSpec: APISpec<Params, Body, Returns>,
    needsAuthorization: authfunc<Context, Token, Params>,
    run: (
      context: Context,
      p: Params,
      b: Body,
      auth: Token,
      req: ServerRequest,
      res: ServerResponse
    ) => Promise<Returns>,
    opts?: { dontCompress?: boolean }
  ): void {
    this.custom<Params, Body, Returns, Token>(
      newSpec,
      needsAuthorization,
      async function (ctx, p, b, auth, req, res) {
        return run(ctx, p, b, auth, req, res).then(function (r) {
          const responseAsString = JSON.stringify(newSpec.returns.encode(r));
          if (opts?.dontCompress === true) {
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(responseAsString),
            });
            res.end(responseAsString);
          } else {
            res.setHeader("Content-Type", "application/json");
            writeDataWithCompression(req, res, responseAsString);
          }
        });
      }
    );
  }

  /**
   *
   * @typeParam Params - Params parsed from URL
   * @typeParam Returns - Type of events sent to the client
   * @param filter - Does this subscription want this item?
   *
   */
  serverSentEvents<Params, Returns, Token>(
    newSpec: SSESpec<Params, Returns[]>,
    needsAuthorization: authfunc<Context, Token, Params>,
    run: (newItem: (toPush: Returns[]) => void) => void,
    filter: (p: Params, r: Returns) => boolean,
    removeItemsFromCacheAfterMinutes: number
  ): void {
    // Id of the item we'll send next
    let myLastEventId = 0;
    // All clients currently connected
    const subscriptions: [Params, ServerResponse][] = [];
    // List of items we've sent previously
    const cache: [number, joda.Instant, Returns[]][] = [];

    const makeMessage = function makeMessage(
      toPush: Returns[],
      id: number
    ): string {
      return `data:${JSON.stringify(
        newSpec.returns.encode(toPush)
      )}\nid:${id}\n\n`;
    };

    // We immediately "start" the processing
    // Every time a new item is ready, we send it to all relevant subscriptions and save it
    // We always do this processing, even if we don't have any subscriptions,
    // because there might be a client trying to reconnect that will want those
    // items once it's got its connection back up
    run(function newItem(toPush: Returns[]): void {
      // TODO what if newlines in JSON payload?
      let i = 0;
      const eventId = myLastEventId + 1;
      cache.push([eventId, joda.Instant.now(), toPush]);
      // Can't remove subs inside loop, cause we'll skip other subs then
      const subsToRemove: number[] = [];
      for (let sub of subscriptions) {
        const toPushFiltered = toPush.filter((item) => filter(sub[0], item));
        if (toPushFiltered.length > 0) {
          const itemToWrite = makeMessage(toPushFiltered, eventId);
          const res = sub[1].write(itemToWrite);
          // The result of write is false if the connection is no longer writeable
          if (!res) {
            sub[1].end(); // Not sure if this is necessary
            subsToRemove.push(i);
          }
        }
        i = i + 1;
      }
      pullAt(subscriptions, subsToRemove);
      myLastEventId = eventId;
    });

    // clean up cache every now and then so we don't blow up our memory
    setInterval(function () {
      let cont = true;
      const treshHold = joda.Instant.now()
        .atZone(joda.ZoneId.UTC)
        .minusMinutes(removeItemsFromCacheAfterMinutes)
        .toInstant();
      // As we push all items onto the cache, it's always ordered oldest - youngest. So once we find a single item that isn't too old, we can stop
      while (cont && cache[0]) {
        if (cache[0][1].toEpochMilli() < treshHold.toEpochMilli()) {
          cache.shift();
        } else {
          cont = false;
        }
      }
    }, 60 * 1000);

    // Making a route where subscribers can register themselves
    this.custom(
      {
        route: newSpec.route,
        method: "GET",
        body: null,
        returns: nullType,
      },
      needsAuthorization,
      async function (_ctx, p, _b, _auth, req, res) {
        // We immediately reply to the client saying to start an SSE connection
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        res.write("\n"); // if we don't this, Chrome doesn't seem to "open" the connection correctly

        subscriptions.push([p, res]);

        const lastEventIdStr =
          req.headers["last-event-id"] ||
          new URL(
            req.url || "",
            "http://localhost" /* not important */
          ).searchParams.get("last-event-id");

        if (lastEventIdStr === null || lastEventIdStr === undefined) {
          // If the client's last-event-id is null, we don't give anything but new events, since the client didn't miss anything, presumably getting all relevant data from an initial load call
          // We do however send our own last-event-id. This way the client will know at which index we are
          //   so if it loses connection and misses an event, it will always have a last-event-id to send back to us
          res.write(`data:initlasteventid\nid:${myLastEventId}\n\n`);
          return;
        } else {
          const lastEventId = parseInt(
            Array.isArray(lastEventIdStr) ? lastEventIdStr[0]! : lastEventIdStr,
            10
          );
          if (isNaN(lastEventId)) {
            return;
          }
          // If the client's last-event-id is lower than what we have, we'll give everything the client doesn't have yet
          if (lastEventId < myLastEventId) {
            const itemsToSend = takeRightWhile(
              cache,
              ([id, _t, _i]) => id > lastEventId
            );
            res.write(
              itemsToSend
                .map(([id, _t, items]) =>
                  makeMessage(
                    items.filter((item) => filter(p, item)),
                    id
                  )
                )
                .join("")
            );
            return;
          }
          // If the client's last-event-id was higher than what we (=the server) have, it means we've restarted and all we can do is send all our items
          if (lastEventId > myLastEventId) {
            res.write(
              cache
                .map(([id, _t, items]) =>
                  makeMessage(
                    items.filter((item) => filter(p, item)),
                    id
                  )
                )
                .join("")
            );
            return;
          }
        }
      }
    );
  }

  // If you call this function, you're responsible for handling (and .end()'ing) the response 100% yourself
  custom<Params, Body, Returns, Token>(
    newSpec: APISpec<Params, Body, Returns>,
    needsAuthorization: authfunc<Context, Token, Params>,
    run: (
      context: Context,
      p: Params,
      b: Body,
      auth: Token,
      req: ServerRequest,
      res: ServerResponse
    ) => Promise<void>
  ): void {
    const router = this;

    if (isDev) {
      checkMoreGeneralRoutes(router.specs, newSpec.method, newSpec.route);
    }

    const internalSpec: InternalSpec<Context, Params, Token> = {
      route: newSpec.route,
      method: newSpec.method,
      body: newSpec.body,
      returns: newSpec.returns,
      needsAuthorization: needsAuthorization,
      tags: [],
      run: function (
        _runOpts: RunOptions,
        ctx: Context,
        req: ServerRequest,
        res: ServerResponse,
        p: Params
      ) {
        // First we get body, then authorization
        // Initially, it was the other way around. But this caused problems as the authFunc is/can be async. So
        //   we might miss out on "data" and "end" events on the request while we're running the authFunc, as the
        //   event handlers are only set up in .getBody()
        router.getBody(newSpec.body, req, res, function (b: Body) {
          const authP: Promise<
            Either<
              | string
              | { tag: "redirect"; redirectUrl: string }
              | [number, OutgoingHttpHeaders],
              Token
            >
          > = needsAuthorization(req, ctx, p) as Promise<
            Either<
              | string
              | { tag: "redirect"; redirectUrl: string }
              | [number, OutgoingHttpHeaders],
              Token
            >
          >;

          authP.then(
            (token) => {
              token.caseOf({
                Left: (error) => {
                  if (typeof error === "string") {
                    res.writeHead(401, { "Content-Type": "text/plain" });
                    res.write("Failed to authorize: " + error);
                    res.end();
                    return;
                  } else if ("tag" in error) {
                    res.writeHead(302, { Location: error.redirectUrl });
                    res.end();
                    return;
                  } else {
                    res.writeHead(error[0], error[1]);
                    res.end();
                    return;
                  }
                },
                Right: (token) => {
                  // const start = process.hrtime();
                  run(ctx, p, b, token, req, res)
                    // .then(function () {
                    //   const end = process.hrtime();
                    //   const duration =
                    //     (end[0] - start[0]) * 1000 +
                    //     Math.floor((end[1] - start[1]) / 1_000_000);
                    //   console.log(`Handled request in ${duration} milliseconds`);
                    // })
                    .catch(function (error) {
                      const returnCode =
                        error &&
                        error instanceof HTTPError &&
                        error.httpReturnCode >= 100 &&
                        error.httpReturnCode < 600
                          ? error.httpReturnCode
                          : 500;

                      res.writeHead(returnCode, {
                        "Content-Type": "text/plain",
                      });
                      res.write("Server error: " + error);
                      res.end();
                      if (!runningInTest) {
                        console.error("");
                        console.error("Encountered error during run function.");
                        console.error(
                          `Incoming url: ${req.headers.host}${req.url}`
                        );
                        console.error(
                          `Matched route: ${newSpec.route.__rawUrl}`
                        );
                        console.error(`Incoming body: ${JSON.stringify(b)}`);
                        console.error(`Return code: ${returnCode}`);
                        console.error(`Server error: ${error}`);
                        if (error instanceof Error) {
                          console.error(`Stacktrace: ${error.stack}`);
                          console.error("");
                        }
                      }
                    });
                },
              });
            },
            (err) => {
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.write("Server error: " + err);
              res.end();
              console.error(
                "Encountered error during run function of authorization."
              );
              console.error(`Incoming url: ${req.headers.host}${req.url}`);
              console.error(`Headers: ${JSON.stringify(req.headers)}`);
              console.error(`Server error: ${err}`);
              if ("detail" in err) {
                console.error(`Error detail: ${err.detail}`);
              }
            }
          );
        });
      },
    };

    // Add a new route
    router.specs.push(internalSpec);
  }

  /**
   * Handles the request (end()'ing it), if the url matches one of the routes. Otherwise, does nothing
   * @returns True if a route matched, false if not
   *
   * @example
   * http.createServer(function (req, res) {
   *   const matched = router.run(req, res);
   *   if (!matched){
   *     res.writeHead(404);
   *     res.end();
   *   }
   * }).listen(6666);
   */

  run(
    opts: RunOptions,
    ctx: Context,
    req: ServerRequest,
    res: ServerResponse
  ): boolean {
    const url = req.url;

    // This might look slow, but it's actually really fast.
    // I tried to use more optimized routing libraries (https://www.npmjs.com/package/@medley/router)
    // and it made no or negative difference.

    for (let spec of this.specs) {
      if (spec.method.toLowerCase() === req.method?.toLowerCase()) {
        const parsed = spec.route.parse(url || "");
        if (parsed !== null) {
          spec.run(opts, ctx, req, res, parsed);
          return true;
        }
      }
    }
    return false;
  }

  // Pass a nested object of routes to make sure all routes in this object are implemented
  checkAllRoutesImplemented(
    routes: RoutesRec
  ): null | Route<any> | APISpec<any, any, any> | SSESpec<any, any> {
    if (!isDev) {
      return null;
    }
    if ((routes as Route<any>).link !== undefined) {
      const r = routes as Route<any>;
      const foundSpec = this.specs.find(
        (s) => s.route === r && s.method === "GET"
      );
      if (foundSpec) {
        return null;
      } else {
        return r;
      }
    } else if (
      (routes as SSESpec<any, any>).route !== undefined &&
      (routes as APISpec<any, any, any>).method === undefined
    ) {
      const sp = routes as SSESpec<any, any>;
      const foundSpec = this.specs.find(
        (s) => s.route === sp.route && s.method === "GET"
      );
      if (foundSpec) {
        return null;
      } else {
        return sp;
      }
    } else if ((routes as APISpec<any, any, any>).route !== undefined) {
      const sp = routes as APISpec<any, any, any>;
      const foundSpec = this.specs.find(
        (s) => s.route === sp.route && s.method === sp.method
      );
      if (foundSpec) {
        return null;
      } else {
        return sp;
      }
    } else {
      const rs = routes as { [name: string]: RoutesRec };
      for (let k in rs) {
        const r = rs[k]!;
        const res = this.checkAllRoutesImplemented(r);
        if (res !== null) {
          return res;
        }
      }
      return null;
    }
  }

  getInternalSpecs(): InternalSpec<any, any, any>[] {
    return this.specs;
  }
}

export class HTTPError extends Error {
  public httpReturnCode: number;

  constructor(message: string, code: number) {
    super();
    this.message = message;
    this.httpReturnCode = code;
  }
}

function pullAt<T>(arr: T[], ns: number[]): T[] {
  ns.sort();
  for (let n = ns.length - 1; n >= 0; n--) {
    arr.splice(ns[n]!, 1);
  }
  return arr;
}

function takeRightWhile<T>(arr: T[], cb: (t: T) => boolean): T[] {
  let newArr: T[] = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const curr = arr[i]!;
    if (cb(curr)) {
      newArr.unshift(curr);
    } else {
      return newArr;
    }
  }
  return newArr;
}

export const noAuthorization: authfunc<any, null, any> = async function () {
  return Right(null);
};
