export function debounce<CB extends Function>(callback: CB, wait: number): CB {
  let timeoutId: undefined | number | NodeJS.Timeout = undefined;
  return (((...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      callback(...args);
    }, wait);
  }) as unknown) as CB;
}
