import * as joda from "@js-joda/core";
import type { Codec } from "purify-ts/Codec";
import type { OpenAPIV3 } from "openapi-types";
import { Either, Left, Right } from "purify-ts/Either";
import { mapPartial } from "./utils";

// TODO: maybe keeping these errors is a waste on production?

export interface Route<Params> {
  parse: (s: string) => Either<Error, Params>;
  link: (p: Params) => string;
  mkClientSideLinkForHref: (p: Params) => string;
  parts: Part<any>[];
  __rawUrl: string; // TODO do you need this now that you have the parts?
}

interface BuiltinTypeMapping {
  string: string;
  number: number;
  "number|null": number | null;
  "number[]": number[];
  "number[]|null": number[] | null;
  boolean: boolean;
  date: joda.LocalDate;
  instant: joda.Instant;
}

type CompactIntersection<A, B> = A extends void ? B : A & B;

type TypeMappingSafer<
  TypeMapping,
  T extends string
> = T extends keyof TypeMapping ? TypeMapping[T] : never;

type TypeMappingSaferOptional<
  TypeMapping,
  T extends string
> = T extends keyof TypeMapping ? TypeMapping[T] | undefined : never;

type ExtractRouteParams<
  T extends string,
  ExtraMapping
> = T extends `${infer URL}?${infer QueryParams}`
  ? CompactIntersection<
      ExtractRouteParams<URL, ExtraMapping>,
      ExtractQueryParams<QueryParams, ExtraMapping>
    >
  : T extends `${infer _Start}{${infer Param}:${infer Typ}}/${infer Rest}`
  ? CompactIntersection<
      ExtractRouteParams<Rest, ExtraMapping>,
      {
        [k in Param]: TypeMappingSafer<BuiltinTypeMapping & ExtraMapping, Typ>;
      }
    >
  : T extends `${infer _Start}{${infer Param}:${infer Typ}}`
  ? { [k in Param]: TypeMappingSafer<BuiltinTypeMapping & ExtraMapping, Typ> }
  : void;

type ExtractQueryParams<
  T extends string,
  ExtraMapping
> = T extends `{${infer Param}:${infer Typ}}&${infer Rest}`
  ? CompactIntersection<
      ExtractQueryParams<Rest, ExtraMapping>,
      {
        [k in Param]: TypeMappingSaferOptional<
          BuiltinTypeMapping & ExtraMapping,
          Typ
        >;
      }
    >
  : T extends `{${infer Param}:${infer Typ}}`
  ? {
      [k in Param]: TypeMappingSaferOptional<
        BuiltinTypeMapping & ExtraMapping,
        Typ
      >;
    }
  : void;

const regex = /{[^}]+}|[^{}]*/g;
export type Encoder<T> = {
  parse: (s: string) => Either<Error, T>;
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
  "number|null": {
    parse: function (str): Either<Error, number | null> {
      if (str.trim() === "-") {
        return Right(null);
      } else {
        return parseNumber(str);
      }
    },
    serialize: function (numOrNull) {
      if (numOrNull === null) {
        return "-";
      } else {
        return numOrNull.toString();
      }
    },
    swaggerType: "number",
  },
  string: {
    parse: Right,
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
    parse: function (str): Either<Error, number[] | null> {
      if (str.trim() === "-") {
        return Right(null);
      } else if (str.trim() === "") {
        return Right([]);
      } else {
        return Right(
          str.split("_").map((s) => {
            const res = parseFloatSafe(s);
            if (!res) {
              throw new Error("Can't deserialize to float: " + s);
            } else {
              return res;
            }
          })
        );
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
    parse: function (str): Either<Error, number[]> {
      if (str.trim() === "-") {
        return Right([]);
      } else if (str.trim() === "") {
        return Right([]);
      } else {
        return Right(
          str.split("_").map((s) => {
            const res = parseFloatSafe(s);
            if (!res) {
              throw new Error("Can't deserialize to float: " + s);
            } else {
              return res;
            }
          })
        );
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
function parseNumber(str: string): Either<Error, number> {
  const res = Number.parseFloat(str);
  if (isNaN(res)) {
    return Left(new Error("Failed to parse into number: " + str));
  } else {
    return Right(res);
  }
}
function parseBoolean(s: string): Either<Error, boolean> {
  return s === "true"
    ? Right(true)
    : s === "false"
    ? Right(false)
    : Left(new Error("Failed to parse into boolean: " + s));
}
function serializeBoolean(b: boolean): string {
  return b ? "true" : "false";
}
const dateFormat = joda.DateTimeFormatter.ofPattern("yyyy-MM-dd");
function parseDate(s: string): Either<Error, joda.LocalDate> {
  try {
    return Right(joda.LocalDate.parse(s, dateFormat));
  } catch (err) {
    return Left(err as Error);
  }
}
function serializeDate(d: joda.LocalDate): string {
  return d.format(dateFormat);
}
function parseInstant(s: string): Either<Error, joda.Instant> {
  try {
    return Right(joda.Instant.parse(s));
  } catch (err) {
    return Left(err as Error);
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
    parse: function (str): Either<Error, SumEncoderHelper<K, Options>> {
      const split = str.split("~");
      if (split && split[0] && split[1]) {
        const foundOption = opts[split[0]];
        if (!foundOption) {
          return Left(new Error(`${split[0]} is not a valid case`));
        } else {
          const parsedValue = foundOption.parse(split[1]);
          return parsedValue.bimap(
            (err) => new Error("In case " + split[0] + ": " + err.message),
            (parsed) =>
              ({
                [split[0]]: parsed,
              } as SumEncoderHelper<K, Options>)
          );
        }
      } else {
        return Left(new Error(`No "~" found to split cases`));
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
 * const match = myroute.parse("/users/5"); // returns Right({id: 5})
 * const match2 = myroute.parse("/somethingelse"); // returns Left(Error)
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
  const splitOnQuestionmark = r.split("?");
  const urlParts = splitOnQuestionmark[0].match(regex);
  if (urlParts === null) {
    throw new Error("Invalid path: " + r);
  } else {
    const cleanedParts = urlParts
      .filter(function (part) {
        return part.trim() !== "";
      })
      .map(function (part): Part<any> {
        if (part[0] === "{") {
          return parseKeyColonEncoder(
            part.substring(1, part.length - 1),
            extraEncoders || null
          );
        } else {
          return {
            tag: "constant",
            constant: part,
          };
        }
      });
    const optionalParts = splitOnQuestionmark[1]
      ? splitOnQuestionmark[1].split("&").map((part) => {
          if (part[0] === "{") {
            return parseKeyColonEncoder(
              part.substring(1, part.length - 1),
              extraEncoders || null
            );
          } else {
            throw new Error(`Wrong syntax is query params: ${part}`);
          }
        })
      : [];

    function parseQueryParams(str: string): Either<Error, Record<string, any>> {
      const acc = {} as Record<string, any>;
      const parts = str.split("&");
      for (let op of optionalParts) {
        const matching = parts.find((p) => p.startsWith(op.key));
        if (!matching) {
          acc[op.key] = undefined;
        } else {
          const parsed = op.encoder.parse(
            decodeURIComponent(matching.substring(op.key.length + 1))
          );
          if (parsed.isLeft()) {
            const err = parsed.extract();
            err.message =
              `Failed to parse query params value for key ${op.key}: ` +
              err.message;
            return Left(err);
          } else {
            acc[op.key] = parsed.extract();
          }
        }
      }
      return Right(acc);
    }
    function parseUrl(str: string): Either<Error, Record<string, any>> {
      const acc = {} as Record<string, any>;
      let rest = str;
      for (let p of cleanedParts) {
        if (p.tag === "constant") {
          if (rest.substring(0, p.constant.length) === p.constant) {
            rest = rest.substring(p.constant.length);
          } else {
            return Left(
              new Error(
                `Tried to match constant "${p.constant}" but failed. Remaining url: ${rest}`
              )
            );
          }
        } else if (p.tag === "capture") {
          const captured = rest.split("/")[0];
          const parsed = p.encoder.parse(decodeURIComponent(captured));
          if (parsed.isLeft()) {
            const err = parsed.extract();
            err.message = err.message + ". Remaining url: " + rest;
            return Left(err);
          } else {
            (acc as any)[p.key] = parsed.extract();
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
        return Right(acc);
      } else {
        return Left(
          new Error(`Tried to match url, but have remaining string: ${rest}`)
        );
      }
    }

    return {
      parts: cleanedParts,
      __rawUrl: r,
      parse: function (str_: string) {
        const split = str_.split("?");
        const url = parseUrl(split[0]);
        return url.caseOf({
          Left: (e) => Left(e),
          Right: (routeparams) => {
            const qps = parseQueryParams(split[1] || "");
            if (qps.isLeft()) {
              return qps;
            } else {
              return Right({
                ...routeparams,
                ...qps.extract(),
              } as ExtractRouteParams<T, ExtraTypeMapping>);
            }
          },
        });
      },
      link: function (params) {
        let acc: string = "";
        for (let p of cleanedParts) {
          if (p.tag === "constant") {
            acc = acc + p.constant;
          } else if (p.tag === "capture") {
            acc += encodeURIComponent(
              p.encoder.serialize((params as any)[p.key])
            );
          } else {
            checkAllCasesHandled(p);
          }
        }
        let queryParamsAcc = mapPartial(optionalParts, (op) => {
          if ((params as any)[op.key] !== undefined) {
            return (
              op.key +
              "=" +
              encodeURIComponent(op.encoder.serialize((params as any)[op.key]))
            );
          } else {
            return null;
          }
        }).join("&");
        if (queryParamsAcc !== "") {
          acc += "?";
          acc += queryParamsAcc;
        }
        return acc;
      },
      mkClientSideLinkForHref: function (params) {
        return "#" + this.link(params);
      },
    };
  }
}

function parseKeyColonEncoder<ExtraTypeMapping>(
  s: string,
  extraEncoders:
    | {
        [k in keyof ExtraTypeMapping]: Encoder<ExtraTypeMapping[k]>;
      }
    | null
): {
  tag: "capture";
  key: string;
  encoder: Encoder<any>;
} {
  const split = s.split(":");
  if (split && split[0] && split[1]) {
    const encoder =
      builtinEncoders[split[1] as keyof BuiltinTypeMapping] ||
      (extraEncoders && extraEncoders[split[1] as keyof ExtraTypeMapping]);
    if (encoder === null) {
      throw new Error("No encoder found for type: " + split[1]);
    }
    return {
      tag: "capture",
      key: split[0],
      encoder: encoder,
    };
  } else {
    throw new Error("Invalid capture syntax: " + s);
  }
}

export function makeEncoderFromCodec<T>(codec: Codec<T>): Encoder<T> {
  return {
    parse: (str): Either<Error, T> => {
      let parsed;
      try {
        parsed = JSON.parse(str);
      } catch (err) {
        return Left(err as Error);
      }
      const res = codec.decode(parsed);
      return res.mapLeft((str) => new Error(str));
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
