import { OpenAPIV3 } from "openapi-types";
import { checkAllCasesHandled, mapPartial } from "./utils";
import { InternalSpec, Router } from "./router";

// This is async because this stupid @openapi-contrib/json-schema-to-openapi-schema
//   module works async...
export async function genSwagger(router: Router<any>) {
  return genSwaggerF(router.getInternalSpecs());
}

async function genSwaggerF(
  specs: InternalSpec<any, any, any>[]
): Promise<OpenAPIV3.Document> {
  // https://github.com/kogosoftwarellc/open-api/blob/master/packages/openapi-types/index.ts
  // https://swagger.io/docs/specification/basic-structure/
  const paths: OpenAPIV3.PathsObject = {};
  for (let spec of specs) {
    const { route, method, body, returns, tags, needsAuthorization } = spec;
    const url = route.parts
      .map(function (p) {
        if (p.tag === "constant") {
          return p.constant;
        } else if (p.tag === "capture") {
          return "{" + p.key + "}";
        } else {
          checkAllCasesHandled(p);
        }
      })
      .join("");
    const parameters: OpenAPIV3.ParameterObject[] = mapPartial(
      route.parts,
      function (p): OpenAPIV3.ParameterObject | null {
        if (p.tag === "constant") {
          return null;
        } else if (p.tag === "capture") {
          return {
            name: p.key,
            in: "path",
            required: true,
            schema: {
              type: p.encoder.swaggerType,
            },
          };
        } else {
          checkAllCasesHandled(p);
        }
      }
    );
    const requestBody: OpenAPIV3.RequestBodyObject | undefined =
      body === null
        ? undefined
        : {
            required: true,
            content: {
              "application/json": {
                schema: fixNullableProperties(body.schema() as any), //TBD
                // schema: fixNullableProperties(await convert(body.schema())),
              },
            },
          };
    const responses: OpenAPIV3.ResponsesObject = {
      "200": {
        description: "Request succeeded", // TODO?
        content:
          returns === null
            ? undefined
            : returns === "sse"
            ? { "text/event-stream": {} }
            : returns === "html"
            ? { "text/html": {} }
            : {
                "application/json": {
                  schema: fixNullableProperties(
                    returns.schema() as any // TBD
                    // await convert(returns.schema())
                  ),
                },
              },
      },
    };
    const opObject: OpenAPIV3.OperationObject = {
      summary: "TODO",
      parameters,
      requestBody,
      responses,
      security: needsAuthorization ? [{ bearerAuth: [] }] : undefined,
      tags: tags.map((t) => t.name),
    };
    const existing = paths[url];
    const pathItemObj: OpenAPIV3.PathItemObject = existing || {
      description: url /* TODO*/,
    };
    if (method === "GET") {
      pathItemObj.get = opObject;
    }
    if (method === "PUT") {
      pathItemObj.put = opObject;
    }
    if (method === "POST") {
      pathItemObj.post = opObject;
    }
    if (method === "DELETE") {
      pathItemObj.delete = opObject;
    }
    paths[url] = pathItemObj;
  }

  const doc: OpenAPIV3.Document = {
    openapi: "3.0.0",
    info: {
      title: "Aperigroup Public API",
      description: "Aperigroup Public API",
      version: `Yunction v${process.env.CURRENT_VERSION}`,
    },
    servers: [
      {
        url: "",
        description: "Public API",
      },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
    },
    tags: specs
      .reduce(
        (acc: { name: string; comment: string }[], p) => acc.concat(p.tags),
        []
      )
      .filter(function onlyUnique<T>(value: T, index: number, self: T[]) {
        return self.indexOf(value) === index;
      })
      .sort((a, b) => (a.name > b.name ? 1 : b.name > a.name ? -1 : 0)),
    // security  //TODO
  };

  return doc;

  /**
   * Changes property descriptions of the form:
   *   {oneOf: [{type: "string"}, {nullable: true}] }
   * to:
   *   {type: "string", nullable: true}
   */
  function fixNullableProperties(
    obj: OpenAPIV3.SchemaObject
  ): OpenAPIV3.SchemaObject {
    if (!obj.properties) {
      return obj;
    }
    function isReferenceObject(
      t: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject
    ): t is OpenAPIV3.ReferenceObject {
      return !!(t as OpenAPIV3.ReferenceObject).$ref;
    }
    const newProps = Object.entries(obj.properties).map(function ([key, prop]) {
      const res = prop;
      const noChange = [key, res];
      if (isReferenceObject(prop)) {
        return noChange;
      } else {
        const oneOf = prop.oneOf;
        if (!oneOf) {
          return noChange;
        } else {
          // find {nullable: true} property
          const nullableMarkerIndex = oneOf.findIndex(
            (t) => !isReferenceObject(t) && t.nullable && !t.type
          );
          if (nullableMarkerIndex > -1) {
            if (oneOf.length === 2) {
              // if only 2 cases in oneOf
              //   -> remove oneOf completely and replace with other type + nullable: true
              return [
                key,
                {
                  ...oneOf[nullableMarkerIndex === 0 ? 1 : 0],
                  nullable: true,
                },
              ];
            } else {
              // if more than 2 cases in oneOf
              //   -> set oneOf nullable: true, and remove {nullable: true} case
              return [
                key,
                {
                  ...prop,
                  oneOf: prop.oneOf?.splice(nullableMarkerIndex),
                  nullable: true,
                },
              ];
            }
          } else {
            return noChange;
          }
        }
      }
    });
    return { ...obj, properties: Object.fromEntries(newProps) };
  }
}
