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
