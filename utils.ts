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

export function mapPartial<A, B>(list: A[], f: (a: A) => null | B): B[] {
  const res = [];
  for (let a of list) {
    const mapped = f(a);
    if (mapped === null) {
    } else {
      res.push(mapped);
    }
  }
  return res;
}
