import { test } from "node:test";
import { Router, ServerRequest, ServerResponse, apiSpec } from "../router";
import { makeRoute } from "../route";
import { Right } from "purify-ts";
import * as c from "purify-ts/Codec";
import assert from "node:assert";
import httpMocks from "node-mocks-http";

test("Router tests", async function () {
  const router = new Router({});

  router.custom(
    apiSpec({
      route: makeRoute("/abc/def/{identifier:number}/ghi"),
      method: "GET",
      body: null,
      returns: c.nullType,
    }),
    async () => Right({}),
    async function (_ctx, { identifier }, _b, _auth, _req, res) {
      res.write(identifier.toString());
      return undefined;
    }
  );

  router.custom(
    apiSpec({
      route: makeRoute("/123/{text:string}"),
      method: "GET",
      body: null,
      returns: c.nullType,
    }),
    async () => Right({}),
    async function (_ctx, { text }, _b, _auth, _req, res) {
      res.write(text);
      return undefined;
    }
  );

  router.custom(
    apiSpec({
      route: makeRoute(
        "/withparams/{text:string}?{param1:string}&{param2:number}"
      ),
      method: "GET",
      body: null,
      returns: c.nullType,
    }),
    async () => Right({}),
    async function (_ctx, { text, param1, param2 }, _ps, _auth, _req, res) {
      res.write(text + (param1 || "") + (param2 || ""));
      return undefined;
    }
  );

  const spy1 = makeSpy1();
  router.run(
    { redirectOnUnauthorizedPage: null },
    {
      url: "/haha",
      method: "GET",
    } as ServerRequest,
    ({ write: spy1 } as unknown) as ServerResponse
  );

  testEq(spy1.called, false);

  const spy2 = makeSpy1();
  router.run(
    { redirectOnUnauthorizedPage: null },
    httpMocks.createRequest({
      url: "/abc/def/666/ghi",
      method: "GET",
    }) as ServerRequest,
    ({ write: spy2 } as unknown) as ServerResponse
  );

  await sleep(1);

  testEq(spy2.called, true);
  testEq(spy2.lastArg, 666);

  const spy3 = makeSpy1();
  router.run(
    { redirectOnUnauthorizedPage: null },
    httpMocks.createRequest({
      url: "/123/mytext",
      method: "GET",
    }) as ServerRequest,
    ({ write: spy3 } as unknown) as ServerResponse
  );

  await sleep(1);

  testEq(spy3.called, true);
  testEq(spy3.lastArg, "mytext");

  const sp4 = makeSpy1();
  router.run(
    { redirectOnUnauthorizedPage: null },
    httpMocks.createRequest({
      url: "/withparams/mytext?param2=123",
      method: "GET",
    }) as ServerRequest,
    ({ write: sp4 } as unknown) as ServerResponse
  );

  await sleep(1);

  testEq(sp4.called, true);
  testEq(sp4.lastArg, "mytext123");
});

function makeSpy1() {
  const spy = (p: any) => {
    spy.lastArg = p as any;
    spy.called = true;
  };
  spy.called = false;
  spy.lastArg = "" as any;
  return spy;
}

function testEq<T>(t1: T, t2: T) {
  return assert.deepEqual(t1, t2);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
