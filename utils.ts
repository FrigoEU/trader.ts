export function checkAllCasesHandled(a: never): never {
  throw new Error(`Can't be here: ${JSON.stringify(a)}`);
}

export function tryExtractErrorMessage(err: any): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : err.toString();
}

export function mapPartial<A, B>(list: A[], f: (a: A, i: number) => null | B): B[] {
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

const MIME_TYPES_BY_EXTENSION: { [extension: string]: string } = {
  // text / markup
  css: "text/css",
  csv: "text/csv",
  htm: "text/html",
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
  yaml: "text/yaml",
  yml: "text/yaml",
  // scripts / data
  cjs: "application/node",
  js: "text/javascript",
  json: "application/json",
  map: "application/json",
  mjs: "text/javascript",
  sql: "application/sql",
  wasm: "application/wasm",
  webmanifest: "application/manifest+json",
  xml: "application/xml",
  // images
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/vnd.microsoft.icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tiff: "image/tiff",
  webp: "image/webp",
  // fonts
  eot: "application/vnd.ms-fontobject",
  otf: "font/otf",
  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
  // audio / video
  m4a: "audio/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "video/webm",
  // documents / archives
  gz: "application/gzip",
  pdf: "application/pdf",
  zip: "application/zip",
};

export function getMimeTypeForPath(url: string): string {
  const lastDot = url.lastIndexOf(".");
  const lastSlash = url.lastIndexOf("/");
  if (lastDot === -1 || lastDot < lastSlash || lastDot === url.length - 1) {
    return "application/octet-stream";
  } else {
    const extension = url.slice(lastDot + 1).toLowerCase();
    return MIME_TYPES_BY_EXTENSION[extension] ?? "application/octet-stream";
  }
}
