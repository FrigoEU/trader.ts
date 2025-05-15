// client.tsx
import { ClientComponents, UI, h } from "trader.ts";

// Our render function
function renderMyClientComponent(props: { startNumber: number }) {
  const counterS = new UI.Source(props.startNumber);
  return (
    <div>
      <h1>Hello from Trader.ts!</h1>
      {UI.dyn(counterS, (counter) => (
        <h2>Counter: {counter}</h2>
      ))}
      <button onclick={() => counterS.set(counterS.get() + 1)}>
        Add 1 to the counter
      </button>
    </div>
  );
}

const parent = <div></div>;
document.body.append(parent);

// Adding it to the DOM
ClientComponents.renderComponentClientside(
  parent,
  null,
  renderMyClientComponent,
  {
    startNumber: 2,
  }
);
