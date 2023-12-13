export function checkAllCasesHandled(a: never): never {
  throw new Error(`Can't be here: ${JSON.stringify(a)}`);
}

export function tryExtractErrorMessage(err: any): string {
  return err instanceof Error
    ? err.message
    : typeof err === "string"
    ? err
    : err.toString();
}

export function mapPartial<A, B>(
  list: A[],
  f: (a: A, i: number) => null | B
): B[] {
  const res = [];
  let i = 0;
  for (let a of list) {
    const mapped = f(a, i);
    if (mapped === null) {
    } else {
      res.push(mapped);
    }
    i++;
  }
  return res;
}
