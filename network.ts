import { APISpec, APISpecWithProgress } from "./router";

const defaultTimeoutMs = 10000;

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
  const timeoutms = opts?.timeoutMS || defaultTimeoutMs;
  setTimeout(
    () =>
      controller.abort(
        `Call to ${url} took too long, timeout(ms) = ${timeoutms}`
      ),
    timeoutms
  );

  return fetch(url, {
    method: spec.method,
    // TODO: I'm screwing with decodings here, the encode/decode of magicCodec also does stringification
    body: spec.body === null ? undefined : spec.body.encode(b),
    credentials: "include",
    signal: controller.signal,
  }).then(
    (res): Promise<Returns> => {
      return handleRpcResponse(spec, url, res);
    }
  );
}

export function rpcWithProgress<Parameters, Body, Returns, Progress>(
  spec: APISpecWithProgress<Parameters, Body, Returns, Progress>,
  params: Parameters,
  b: Body,
  handleProgress: (p: Progress) => void
): Promise<Returns> {
  const url = spec.route.link(params);

  return fetch(url, {
    method: spec.method,
    // TODO: I'm screwing with decodings here, the encode/decode of magicCodec also does stringification
    body: spec.body === null ? undefined : spec.body.encode(b),
    credentials: "include",
  }).then(
    async (res): Promise<Returns> => {
      if (
        res.status === 200 &&
        res.body &&
        (res.headers.get("content-type") ?? "") === "text/event-stream"
      ) {
        const b = res.body;
        return new Promise(async (resolve, reject) => {
          const reader = b.getReader();
          const decoder = new TextDecoder("utf-8");

          let buffer = "";

          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });

              // Process lines when double newlines (SSE boundary) are present
              let boundary = buffer.indexOf("\n\n");
              while (boundary !== -1) {
                const block = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);

                // Process individual SSE lines (data, event, id)
                for (const line of block.split("\n")) {
                  if (line.startsWith("progress:")) {
                    // TODO: I'm screwing with decodings here, the encode/decode of magicCodec also does stringification
                    const data = line.replace("progress:", "");
                    const decoded = spec.progress.decode(data);
                    decoded.caseOf({
                      Left: (e) => {
                        reject(
                          new Error(
                            `Failed to parse progress data: ${data} - ${e}`
                          )
                        );
                      },
                      Right: (p) => handleProgress(p),
                    });
                  }

                  if (line.startsWith("error:")) {
                    const data = line.replace("error:", "");
                    reject(new Error(data));
                    return;
                  }

                  if (line.startsWith("response:")) {
                    const data = line.replace("response:", "");
                    // TODO: I'm screwing with decodings here, the encode/decode of magicCodec also does stringification
                    const decoded = spec.returns.decode(data);
                    decoded.caseOf({
                      Left: (e) => {
                        reject(
                          new Error(
                            `Failed to parse result data: ${data} - ${e}`
                          )
                        );
                      },
                      Right: (p) => resolve(p),
                    });
                    return;
                  }
                }
                boundary = buffer.indexOf("\n\n");
              }
            }
          } finally {
            reader.releaseLock();
          }
        });
      } else {
        return handleRpcResponse(spec, url, res);
      }
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
      return res.text().then(
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
