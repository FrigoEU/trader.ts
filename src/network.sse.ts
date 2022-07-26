import { APISpec, SSESpec } from "./router";
import {
  orderWatchEvents,
  processWatchEventWithId,
  watchEvent,
} from "./types/watchevent";
import { rpc } from "./network";
import type { Remote } from "./types/remote";
import { Source } from "./types/source";
import { tryExtractErrorMessage } from "./utils";

export function connectStreamWithInitialLoadIntoRemote<
  Parameters,
  Item extends { identifier: number }
>(
  rpcSpec: APISpec<Parameters, unknown, Item[]>,
  sseSpec: SSESpec<Parameters, Array<watchEvent<Item>>>,
  params: Parameters
): { close: () => void; sourceR: Source<Remote<Source<Item[]>>> } {
  const sourceR: Source<Remote<Source<Item[]>>> = new Source({
    tag: "initial" as const,
  });
  const res = connectStreamWithInitialLoad(rpcSpec, sseSpec, params);

  res.opened
    .then(function (res) {
      sourceR.set({ tag: "loaded", item: res.source });
    })
    .catch(function (err) {
      sourceR.set({ tag: "error", err });
    });
  return {
    close: res.close,
    sourceR,
  };
}

export function connectStreamWithInitialLoad<
  Parameters,
  Item extends { identifier: number }
>(
  rpcSpec: APISpec<Parameters, unknown, Item[]>,
  sseSpec: SSESpec<Parameters, Array<watchEvent<Item>>>,
  params: Parameters,
  callback?: (opts: {
    events: Array<watchEvent<Item>>;
    old: Item[];
    new: Item[];
  }) => void
): { close: () => void; opened: Promise<{ source: Source<Item[]> }> } {
  let loaded = false;
  const source: Source<Item[]> = new Source([]);
  const stream = serverSentEventsConnect(
    sseSpec,
    params,
    function (watchevents) {
      if (loaded === true) {
        const orderedEvents = orderWatchEvents(watchevents);
        const oldState = source.get();
        const newState = orderedEvents.reduce(
          processWatchEventWithId,
          oldState
        );
        source.set(newState);
        callback &&
          callback({ events: orderedEvents, old: oldState, new: newState });
      }
    }
  );

  return {
    close: stream.close,
    opened: stream.opened.then(function () {
      return rpc(rpcSpec, params, null)
        .then(function (currentItems) {
          source.set(currentItems);
          loaded = true;
          return { source: source };
        })
        .catch(function (err) {
          stream.close();
          return Promise.reject(err);
        });
    }),
  };
}

// This does not wait for the full setup of the stream.
// It returns immediately and keeps trying to connect until closed
export function serverSentEventsConnectDontWait<Params, Returns>(
  spec: SSESpec<Params, Returns>,
  p: Params,
  cb: (r: Returns) => void,
  opts?: {
    onfirstopen: () => void;
    onerror: () => void;
  }
): {
  close: () => void;
} {
  let eventSource = new EventSource(spec.route.link(p));
  let closed = false;

  if (opts) {
    eventSource.addEventListener("open", function () {
      opts.onfirstopen();
    });
  }

  addEventHandlers(eventSource, null);

  return {
    close: () => {
      closed = true;
      eventSource.close();
    },
  };

  function addEventHandlers(ev: EventSource, lastEventId_in: string | null) {
    let lastEventId = lastEventId_in;
    const handleMessage = function (event: MessageEvent<unknown>) {
      lastEventId = event.lastEventId;
      if (event.data === "initlasteventid") {
        // This is an event that the server sends to set our lastEventId
        // We need this because of the following scenario:
        // 1. We connect to the server. Our lastEventId is null. We don't get any events that set our lastEventId
        // 2. We lose our connection
        // 3. The server sends an item
        // 4. We regain our connection. We don't send a lastEventId as we don't have any. We just missed an item that we shouldn't have missed
        // Solution -> always send an initial message as we connect
        return;
      }
      let decoded;
      try {
        decoded = spec.returns.decode(JSON.parse(event.data as string));
      } catch (err) {
        console.error(
          `Failed to parse data from SSE endpoint: ${spec.route.link(p)}: ${
            event.data
          }: ${tryExtractErrorMessage(err)}`
        );
        return;
      }
      decoded.caseOf({
        Left: (e) => {
          console.error(
            `Failed to decode data from SSE endpoint: ${spec.route.link(p)}: ${
              event.data
            }: ${e}`
          );
        },
        Right: (decoded) => cb(decoded),
      });
    };
    let timeout: number | null;
    function handleError() {
      if (closed === true) {
        return;
      }
      if (opts) {
        opts.onerror();
      }
      if (timeout !== null) {
        clearTimeout(timeout); // So we don't have multiple of these functions going around
      }
      if (eventSource.readyState === EventSource.CONNECTING) {
        // Browser is trying to (re)connect (Chrome)
        // Just in case, we check every few seconds to make sure it's not stopped now
        // If in the meantime we got an error that closed the connection, the timeout will be cancelled
        // so we should never have two living eventSources at the same time
        timeout = window.setTimeout(handleError, 3000);
      } else if (eventSource.readyState === EventSource.OPEN) {
        // Not doing anything, we're good
      } else {
        // EventSource is closed -> Wait a little bit and then reconnect
        // Firefox
        ev.close(); // just to make sure
        timeout = window.setTimeout(function () {
          eventSource.close(); // just to make sure
          const newEventSource = new EventSource(
            spec.route.link(p) +
              (lastEventId ? `?last-event-id=${lastEventId}` : "")
          );
          addEventHandlers(newEventSource, lastEventId);
          eventSource = newEventSource;
        }, 3000 /* retry every few seconds */);
      }
    }
    ev.addEventListener("message", handleMessage);
    ev.addEventListener("error", handleError);
  }
}

// This returns a promise that only resolves after the stream is correctly set up
export function serverSentEventsConnect<Params, Returns>(
  spec: SSESpec<Params, Returns>,
  p: Params,
  cb: (r: Returns) => void
): { close: () => void; opened: Promise<void> } {
  let opened = false;

  let resolveP: null | (() => void) = null;
  let rejectP: null | ((err: string) => void) = null;

  const { close } = serverSentEventsConnectDontWait(spec, p, cb, {
    onfirstopen: function () {
      opened = true;
      resolveP && resolveP();
    },
    onerror: function () {
      rejectP && rejectP("Failed to connect to eventSource: errored");
    },
  });

  // If it takes too long to make a connection -> kill
  window.setTimeout(function () {
    if (opened === false) {
      close();
      rejectP && rejectP("Failed to connect to eventSource: timeout");
    }
  }, 10 * 1000);
  return {
    close,
    opened: new Promise(function (resolve, reject) {
      resolveP = resolve;
      rejectP = reject;
    }),
  };
}
