import * as joda from "@js-joda/core";
import type { Codec } from "purify-ts/Codec";
import type { OpenAPIV3 } from "openapi-types";

// TODO: maybe keeping these errors is a waste on production?

export interface Route<Params> {
  parse: (s: string) => Params | Error;
  link: (p: Params) => string;
  mkClientSideLinkForHref: (p: Params) => string;
  parts: Part<any>[];
  __rawUrl: string; // TODO do you need this now that you have the parts?
}

interface BuiltinTypeMapping {
  string: string;
  number: number;
  "number[]": number[];
  "number[]|null": number[] | null;
  boolean: boolean;
  date: joda.LocalDate;
  instant: joda.Instant;
}

type TypeMappingSafer<
  TypeMapping,
  T extends string
> = T extends keyof TypeMapping ? TypeMapping[T] : unknown;

type ExtractRouteParams<
  T extends string,
  ExtraMapping
> = T extends `${infer _Start}{${infer Param}:${infer Typ}}/${infer Rest}`
  ? ExtractRouteParams<Rest, ExtraMapping> extends void
    ? {
        [k in Param]: TypeMappingSafer<BuiltinTypeMapping & ExtraMapping, Typ>;
      }
    : {
        [k in Param]: TypeMappingSafer<BuiltinTypeMapping & ExtraMapping, Typ>;
      } &
        ExtractRouteParams<Rest, ExtraMapping>
  : T extends `${infer _Start}{${infer Param}:${infer Typ}}`
  ? { [k in Param]: TypeMappingSafer<BuiltinTypeMapping & ExtraMapping, Typ> }
  : void; // If we'd make this {}, then we wouldn't need the above conditional, but then routes without parameters would always need a "{}" parameter to be passed to it

const regex = /{[^}]+}|[^{}]*/g;
// TODO replace with purify Codec?
export type Encoder<T> = {
  parse: (s: string) => Error | T;
  serialize: (t: T) => string;
  swaggerType?: OpenAPIV3.NonArraySchemaObjectType;
};
export type Part<T> =
  | { tag: "constant"; constant: string }
  | { tag: "capture"; key: string; encoder: Encoder<T> };

export const builtinEncoders: {
  [k in keyof BuiltinTypeMapping]: Encoder<BuiltinTypeMapping[k]>;
} = {
  number: {
    parse: parseNumber,
    serialize: (n) => n.toString(),
    swaggerType: "number",
  },
  string: {
    parse: id,
    serialize: id,
    swaggerType: "string",
  },
  boolean: {
    parse: parseBoolean,
    serialize: serializeBoolean,
    swaggerType: "boolean",
  },
  date: {
    parse: parseDate,
    serialize: serializeDate,
    swaggerType: "string",
  },
  instant: {
    parse: parseInstant,
    serialize: serializeInstant,
    swaggerType: "string",
  },
  "number[]|null": {
    parse: function (str) {
      if (str.trim() === "-") {
        return null;
      } else if (str.trim() === "") {
        return [];
      } else {
        return str.split("_").map((s) => {
          const res = parseFloatSafe(s);
          if (!res) {
            throw new Error("Can't deserialize to float: " + s);
          } else {
            return res;
          }
        });
      }
    },
    serialize: function (numArr) {
      if (numArr === null) {
        return "-";
      } else {
        return numArr.map((n) => n.toString()).join("_");
      }
    },
    swaggerType: "string",
  },
  "number[]": {
    parse: function (str) {
      if (str.trim() === "-") {
        return [];
      } else if (str.trim() === "") {
        return [];
      } else {
        return str.split("_").map((s) => {
          const res = parseFloatSafe(s);
          if (!res) {
            throw new Error("Can't deserialize to float: " + s);
          } else {
            return res;
          }
        });
      }
    },
    serialize: function (numArr) {
      if (numArr.length === 0) {
        return "-";
      } else {
        return numArr.map((n) => n.toString()).join("_");
      }
    },
    swaggerType: "string",
  },
};
// const nullableStringEncoder:
function parseNumber(str: string): Error | number {
  const res = Number.parseFloat(str);
  if (isNaN(res)) {
    return new Error("Failed to parse into number: " + str);
  } else {
    return res;
  }
}
function parseBoolean(s: string): boolean | Error {
  return s === "true"
    ? true
    : s === "false"
    ? false
    : new Error("Failed to parse into boolean: " + s);
}
function serializeBoolean(b: boolean): string {
  return b ? "true" : "false";
}
function parseDate(s: string): joda.LocalDate | Error {
  try {
    return joda.LocalDate.parse(s);
  } catch (err) {
    return err as Error;
  }
}
function serializeDate(d: joda.LocalDate): string {
  return d.toString();
}
function parseInstant(s: string): joda.Instant | Error {
  try {
    return joda.Instant.parse(s);
  } catch (err) {
    return err as Error;
  }
}
function serializeInstant(d: joda.Instant): string {
  return d.toString();
}

type SumEncoderHelper<K extends keyof Full, Full> = K extends PropertyKey
  ? { [P in K]: Full[K] }
  : never;

// Pretty serialization of a sum type to a string, better for URL's than JSON serialization
export function makeEncoderFromSum<
  Options extends { [key: string]: any },
  K extends keyof Options
>(
  opts: { [K in keyof Options]: Encoder<Options[K]> }
): Encoder<SumEncoderHelper<K, Options>> {
  return {
    serialize: function (sum) {
      const key: string = Object.keys(sum)[0];
      const val = (sum as any)[key];
      const foundOption = opts[key];
      return key + "~" + foundOption.serialize(val);
    },
    parse: function (str) {
      const split = str.split("~");
      if (split && split[0] && split[1]) {
        const foundOption = opts[split[0]];
        if (!foundOption) {
          return new Error(`${split[0]} is not a valid case`);
        } else {
          const parsedValue = foundOption.parse(split[1]);
          if (parsedValue instanceof Error) {
            parsedValue.message =
              "In case " + split[0] + ": " + parsedValue.message;
            return parsedValue;
          } else {
            return {
              [split[0]]: parsedValue,
            } as SumEncoderHelper<K, Options>;
          }
        }
      } else {
        return new Error(`No "~" found to split cases`);
      }
    },
  };
}
// function parseNullable<T>(
//   f: (str: string) => T
// ): (str: string) => Error | T | null {
//   return function (str) {
//     if (str === "null") {
//       return null;
//     } else {
//       return f(str);
//     }
//   };
// }
// function serializeNullable<T>(f: (t: T) => string): (t: T | null) => string {
//   return function (t: T | null) {
//     if (t === null) {
//       return "null";
//     } else {
//       return f(t);
//     }
//   };
// }
function id<T>(a: T): T {
  return a;
}
/**
 * Pass this a string like "/users/{id:number}" to get a strongly typed "Route" back
 * This Route can be used to:
 * - check if a string conforms to this route (and returns the parameters to you if it does)
 * - make a valid link for you when passing the parameters
 *
 * @example
 * const myroute = makeRoute("/users/{id:number}");
 * const match = myroute.parse("/users/5"); // returns {id: 5}
 * const match2 = myroute.parse("/somethingelse"); // returns Error
 * const link = myroute.link({id: 7}); // return "/users/7"
 */
export function makeRoute<T extends string, ExtraTypeMapping>(
  r: T,
  extraEncoders?: {
    [k in keyof ExtraTypeMapping]: Encoder<ExtraTypeMapping[k]>;
  }
): Route<ExtractRouteParams<T, ExtraTypeMapping>> {
  if (!r.startsWith("/")) {
    throw new Error("Route must start with '/'");
  }
  const parts = r.match(regex);
  if (parts === null) {
    throw new Error("Invalid path: " + r);
  } else {
    const cleanedParts = parts
      .filter(function (part) {
        return part.trim() !== "";
      })
      .map(function (part): Part<any> {
        if (part[0] === "{") {
          const split = part.substring(1, part.length - 1).split(":");
          if (split && split[0] && split[1]) {
            const encoder =
              builtinEncoders[split[1] as keyof BuiltinTypeMapping] ||
              (extraEncoders &&
                extraEncoders[split[1] as keyof ExtraTypeMapping]);
            if (encoder === null) {
              throw new Error("No encoder found for type: " + split[1]);
            }
            return {
              tag: "capture",
              key: split[0],
              encoder: encoder,
            };
          } else {
            throw new Error("Invalid capture syntax: " + part);
          }
        } else {
          return {
            tag: "constant",
            constant: part,
          };
        }
      });
    return {
      parts: cleanedParts,
      __rawUrl: r,
      parse: function (str_: string) {
        const str =
          str_.indexOf("?") >= 0 ? str_.slice(0, str_.indexOf("?")) : str_; // Strip query string, this library does not use them
        const acc: { [key: string]: any } = {};
        let rest = str;
        for (let p of cleanedParts) {
          if (p.tag === "constant") {
            if (rest.substring(0, p.constant.length) === p.constant) {
              rest = rest.substring(p.constant.length);
            } else {
              return new Error(
                `Tried to match constant "${p.constant}" but failed. Remaining url: ${rest}`
              );
            }
          } else if (p.tag === "capture") {
            const captured = rest.split("/")[0];
            const parsed = p.encoder.parse(decodeURIComponent(captured));
            if (parsed && parsed instanceof Error) {
              parsed.message = parsed.message + ". Remaining url: " + rest;
              return parsed;
            } else {
              acc[p.key] = parsed;
              rest = rest.substring(captured.length);
            }
          } else {
            checkAllCasesHandled(p);
          }
        }
        if (
          rest.trim() === "" ||
          rest.trim().startsWith("?") /* allow query params after url */
        ) {
          return acc as any;
        } else {
          return new Error(
            `Tried to match url, but have remaining string: ${rest}`
          );
        }
      },
      link: function (params) {
        let acc: string = "";
        for (let p of cleanedParts) {
          if (p.tag === "constant") {
            acc = acc + p.constant;
          } else if (p.tag === "capture") {
            acc =
              acc +
              encodeURIComponent(p.encoder.serialize((params as any)[p.key]));
          } else {
            checkAllCasesHandled(p);
          }
        }
        return acc;
      },
      mkClientSideLinkForHref: function (params) {
        return "#" + this.link(params);
      },
    };
  }
}

export function makeEncoderFromCodec<T>(codec: Codec<T>): Encoder<T> {
  return {
    parse: (str): Error | T => {
      let parsed;
      try {
        parsed = JSON.parse(str);
      } catch (err) {
        return err as Error;
      }
      const res = codec.decode(parsed);
      return res.caseOf({
        Left: (e) => new Error(e),
        Right: (a): Error | T => a,
      });
    },
    serialize: (a: T) => JSON.stringify(codec.encode(a)),
  };
}

function checkAllCasesHandled(a: never): never {
  throw new Error(`Can't be here: ${JSON.stringify(a)}`);
}

function parseFloatSafe(n: string | null): number | null {
  if (n === null || n === undefined) {
    return null;
  }
  const num = parseFloat(n);
  return isNaN(num) ? null : num;
}
