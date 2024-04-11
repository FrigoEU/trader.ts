import * as joda from "@js-joda/core";

export function findNonSerializable(obj: any): any | null {
  function isPlain(val: any) {
    return (
      val === undefined ||
      val === null ||
      typeof val === "string" ||
      typeof val === "boolean" ||
      typeof val === "number" ||
      val instanceof Date ||
      val instanceof joda.DayOfWeek ||
      val instanceof joda.LocalDate ||
      val instanceof joda.LocalTime ||
      val instanceof joda.LocalDateTime ||
      val instanceof joda.Instant ||
      val instanceof Buffer ||
      Array.isArray(val) ||
      (val.constructor === Object && // don't allow classes or functions
        val.toString() === "[object Object]")
    );
  }
  // Special casing ServersideSource: We CAN serialize this from server to client,
  //   as long as the value itself is serializable (ie. not a function or class)
  if (obj && obj.tag === "ServersideSource") {
    const nonSerializableVal = findNonSerializable(obj.value);
    if (nonSerializableVal) {
      return nonSerializableVal;
    } else {
      return null;
    }
  }
  if (!isPlain(obj)) {
    return obj;
  }

  if (Array.isArray(obj)) {
    // Split this up, because Arrays with extra properties, like postgres.js's RowList, were causing issues. They're arrays, and will be serialized as arrays. These other properties don't matter
    for (var el of obj) {
      const nonSerializableNested = findNonSerializable(el);
      if (nonSerializableNested) {
        return nonSerializableNested;
      }
    }
  } else if (typeof obj === "object") {
    for (var property in obj) {
      if (obj.hasOwnProperty(property)) {
        const nonSerializableNested = findNonSerializable(obj[property]);
        if (nonSerializableNested) {
          return nonSerializableNested;
        }
      }
    }
  }
}

export function runWithCustomSerializers<A>(f: () => A): A {
  const oldDatePrototype = Date.prototype.toJSON;
  const oldDayOfWeekPrototype = joda.DayOfWeek.prototype.toJSON;
  const oldPlainDatePrototype = joda.LocalDate.prototype.toJSON;
  const oldPlainTimePrototype = joda.LocalTime.prototype.toJSON;
  const oldPlainDateTimePrototype = joda.LocalDateTime.prototype.toJSON;
  const oldInstantPrototype = joda.Instant.prototype.toJSON;
  const oldMonthPrototype = joda.Month.prototype.toJSON;

  Date.prototype.toJSON = function () {
    return {
      __tag: "date",
      value: this.toISOString(),
    } as any;
  };
  joda.DayOfWeek.prototype.toJSON = function () {
    return {
      __tag: "dayofweek",
      value: this.ordinal(),
    } as any;
  };
  joda.LocalDate.prototype.toJSON = function () {
    return {
      __tag: "plaindate",
      value: this.toString(),
    } as any;
  };
  joda.LocalTime.prototype.toJSON = function () {
    return {
      __tag: "plaintime",
      value: this.toString(),
    } as any;
  };
  joda.LocalDateTime.prototype.toJSON = function () {
    return {
      __tag: "plaindatetime",
      value: this.toString(),
    } as any;
  };
  joda.Instant.prototype.toJSON = function () {
    return {
      __tag: "instant",
      value: this.toEpochMilli().toString(),
    } as any;
  };
  joda.Month.prototype.toJSON = function () {
    return {
      __tag: "month",
      value: this.ordinal(),
    } as any;
  };
  /* (ArrayBuffer.prototype as any).toJSON = function () {
   *   return {
   *     __tag: "ArrayBuffer",
   *     value: Array.from(new Uint8Array(this)),
   *   } as any;
   * }; */

  const res: any = f();

  Date.prototype.toJSON = oldDatePrototype;
  joda.DayOfWeek.prototype.toJSON = oldDayOfWeekPrototype;
  joda.LocalDate.prototype.toJSON = oldPlainDatePrototype;
  joda.LocalTime.prototype.toJSON = oldPlainTimePrototype;
  joda.LocalDateTime.prototype.toJSON = oldPlainDateTimePrototype;
  joda.Instant.prototype.toJSON = oldInstantPrototype;
  joda.Month.prototype.toJSON = oldMonthPrototype;

  return res;
}

export function deserializeProps(p: string) {
  return JSON.parse(p, function (_: any, x: any) {
    if (x && x.__tag && x.__tag === "date" && "value" in x) {
      return new Date(x.value);
    }
    if (x && x.__tag && x.__tag === "plaindate" && "value" in x) {
      return joda.LocalDate.parse(x.value);
    }
    if (x && x.__tag && x.__tag === "dayofweek" && "value" in x) {
      return joda.DayOfWeek.of(x.value + 1);
    }
    if (x && x.__tag && x.__tag === "plaintime" && "value" in x) {
      return joda.LocalTime.parse(x.value);
    }
    if (x && x.__tag && x.__tag === "plaindatetime" && "value" in x) {
      return joda.LocalDateTime.parse(x.value);
    }
    if (x && x.__tag && x.__tag === "instant" && "value" in x) {
      return joda.Instant.ofEpochMilli(parseInt(x.value));
    }
    if (x && x.__tag && x.__tag === "month" && "value" in x) {
      return joda.Month.of(parseInt(x.value) + 1);
    }
    if (x && x.type && x.type === "Buffer" && "data" in x) {
      return new Uint8Array(x.data);
    }
    return x;
  });
}
