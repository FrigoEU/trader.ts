import { ClientComponents } from "trader.ts";
import { renderMyClientComponent } from "./client";

export const myClient = ClientComponents.registerClientComponentsSync({
  myClientComponent: renderMyClientComponent,
});

export type myClientComponents = ClientComponents.ClientComponentsExport<
  typeof myClient
>;
