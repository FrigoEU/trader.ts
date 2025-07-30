import { APISpec, SSESpec } from "./router";

const timeoutMS = 10000;

/**
 * Fire off an HTTP request to the APISpec with the provided params and body
 * For now, this only works *ClientSide* as it requires a global "fetch" function
 */
export function rpc<Parameters, Body, Returns>(
  spec: APISpec<Parameters, Body, Returns>,
  params: Parameters,
  b: Body,
  opts?: { timeoutMS?: number }
): Promise<Returns> {
  const url = spec.route.link(params);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), opts?.timeoutMS || timeoutMS);

  return fetch(url, {
    method: spec.method,
    body: spec.body === null ? undefined : spec.body.encode(b),
    credentials: "include",
    signal: controller.signal,
  }).then(
    (res): Promise<Returns> => {
      return handleRpcResponse(spec, url, res);
    }
  );
}

export function handleRpcResponse<Parameters, Body, Returns>(
  spec: APISpec<Parameters, Body, Returns>,
  url: string,
  res: Response
) {
  if (res.status === 200) {
    if (res.headers.get("content-type") === "application/json") {
      return res.json().then(
        (j): Promise<Returns> => {
          const decodeRes = spec.returns.decode(j);
          return decodeRes.caseOf({
            Left: (err: string) =>
              Promise.reject(
                `Failed to decode result of rpc call to ${url}: ${err}`
              ),
            Right: (decoded: Returns) => Promise.resolve(decoded),
          });
        }
      );
    } else {
      return Promise.reject(
        `Request succeeded but no JSON payload found: ${url}`
      );
    }
  } else {
    if (res.headers.get("content-type") === "application/json") {
      return res
        .json()
        .then((j) => Promise.reject(res.status + ": " + JSON.stringify(j)));
    } else if (res.headers.get("content-type") === "text/plain") {
      return res.text().then((j) => Promise.reject(res.status + ": " + j));
    } else {
      return Promise.reject(res.status.toString() + " " + res.statusText);
    }
  }
}
