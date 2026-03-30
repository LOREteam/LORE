type BigIntPrototypeWithJson = typeof BigInt.prototype & {
  toJSON?: () => string;
};

export function installBigIntJsonSerialization() {
  if (typeof BigInt === "undefined") return;
  const bigintPrototype = BigInt.prototype as BigIntPrototypeWithJson;
  if (typeof bigintPrototype.toJSON === "function") return;

  Object.defineProperty(bigintPrototype, "toJSON", {
    value() {
      return this.toString();
    },
    configurable: true,
    writable: true,
  });
}

installBigIntJsonSerialization();
