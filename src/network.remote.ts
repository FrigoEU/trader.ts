import { APISpec, SSESpec } from "./router";
import { rpc } from "./network";
import type { Remote } from "./types/remote";
import type { Source } from "./types/source";

export function rpcIntoRemote<Parameters, Body, Returns>(
  spec: APISpec<Parameters, Body, Returns>,
  params: Parameters,
  b: Body,
  s: Source<Remote<Returns>>
): Promise<Returns> {
  return rpc(spec, params, b).then(
    (res) => {
      s.set({ tag: "loaded", item: res });
      return res;
    },
    (err) => {
      s.set({ tag: "error", err: err });
      return Promise.reject(err);
    }
  );
}
