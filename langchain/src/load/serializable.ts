import { SerializedFields, keyToJson, mapKeys } from "./map_keys.js";

export interface BaseSerialized<T extends string> {
  lc: number;
  type: T;
  id: string[];
}

export interface SerializedConstructor extends BaseSerialized<"constructor"> {
  kwargs: SerializedFields;
}

export interface SerializedSecret extends BaseSerialized<"secret"> {}

export interface SerializedNotImplemented
  extends BaseSerialized<"not_implemented"> {}

export type Serialized =
  | SerializedConstructor
  | SerializedSecret
  | SerializedNotImplemented;

function shallowCopy<T extends object>(obj: T): T {
  return Array.isArray(obj) ? ([...obj] as T) : ({ ...obj } as T);
}

function replaceSecrets(
  root: SerializedFields,
  secretsMap: { [key: string]: string }
): SerializedFields {
  const result = shallowCopy(root);
  for (const [path, secretId] of Object.entries(secretsMap)) {
    const [last, ...partsReverse] = path.split(".").reverse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = result;
    for (const part of partsReverse.reverse()) {
      if (current[part] === undefined) {
        break;
      }
      current[part] = shallowCopy(current[part]);
      current = current[part];
    }
    if (current[last] !== undefined) {
      current[last] = {
        lc: 1,
        type: "secret",
        id: [secretId],
      };
    }
  }
  return result;
}

export abstract class Serializable {
  lc_serializable = false;

  lc_kwargs: SerializedFields;

  /**
   * A path to the module that contains the class, eg. ["langchain", "llms"]
   * Usually should be the same as the entrypoint the class is exported from.
   */
  abstract lc_namespace: string[];

  /**
   * A map of secrets, which will be omitted from serialization.
   * Keys are paths to the secret in constructor args, e.g. "foo.bar.baz".
   * Values are the secret ids, which will be used when deserializing.
   */
  get lc_secrets(): { [key: string]: string } | undefined {
    return undefined;
  }

  /**
   * A map of additional attributes to merge with constructor args.
   * Keys are the attribute names, e.g. "foo".
   * Values are the attribute values, which will be serialized.
   * These attributes need to be accepted by the constructor as arguments.
   */
  get lc_attributes(): SerializedFields | undefined {
    return undefined;
  }

  /**
   * A map of aliases for constructor args.
   * Keys are the attribute names, e.g. "foo".
   * Values are the alias that will replace the key in serialization.
   * This is used to eg. make argument names match Python.
   */
  get lc_aliases(): { [key: string]: string } | undefined {
    return undefined;
  }

  constructor(kwargs?: SerializedFields, ..._args: never[]) {
    this.lc_kwargs = kwargs || {};
  }

  toJSON(): Serialized {
    if (!this.lc_serializable) {
      return this.toJSONNotImplemented();
    }
    if (
      // eslint-disable-next-line no-instanceof/no-instanceof
      this.lc_kwargs instanceof Serializable ||
      typeof this.lc_kwargs !== "object" ||
      Array.isArray(this.lc_kwargs)
    ) {
      // We do not support serialization of classes with arg not a POJO
      // I'm aware the check above isn't as strict as it could be
      return this.toJSONNotImplemented();
    }

    const aliases: { [key: string]: string } = {};
    const secrets: { [key: string]: string } = {};
    const kwargs = Object.keys(this.lc_kwargs).reduce((acc, key) => {
      acc[key] = key in this ? this[key as keyof this] : this.lc_kwargs[key];
      return acc;
    }, {} as SerializedFields);
    // get secrets, attributes and aliases from all superclasses
    for (
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      let current = Object.getPrototypeOf(this);
      current;
      current = Object.getPrototypeOf(current)
    ) {
      Object.assign(aliases, Reflect.get(current, "lc_aliases", this));
      Object.assign(secrets, Reflect.get(current, "lc_secrets", this));
      Object.assign(kwargs, Reflect.get(current, "lc_attributes", this));
    }

    return {
      lc: 1,
      type: "constructor",
      id: [...this.lc_namespace, this.constructor.name],
      kwargs: mapKeys(
        this.lc_secrets ? replaceSecrets(kwargs, secrets) : kwargs,
        keyToJson,
        aliases
      ),
    };
  }

  toJSONNotImplemented(): SerializedNotImplemented {
    return {
      lc: 1,
      type: "not_implemented",
      id: [...this.lc_namespace, this.constructor.name],
    };
  }
}
