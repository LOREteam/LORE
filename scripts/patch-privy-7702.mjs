import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const targets = [
  {
    format: "cjs",
    file: path.join(
      root,
      "node_modules",
      "@privy-io",
      "ethereum",
      "dist",
      "cjs",
      "to-viem-transaction-serializable.js",
    ),
  },
  {
    format: "esm",
    file: path.join(
      root,
      "node_modules",
      "@privy-io",
      "ethereum",
      "dist",
      "esm",
      "to-viem-transaction-serializable.mjs",
    ),
  },
  {
    format: "wallet-cjs",
    file: path.join(
      root,
      "node_modules",
      "@privy-io",
      "react-auth",
      "node_modules",
      "@privy-io",
      "js-sdk-core",
      "dist",
      "cjs",
      "embedded",
      "stack",
      "wallet-api-eth-transaction.js",
    ),
  },
  {
    format: "wallet-esm",
    file: path.join(
      root,
      "node_modules",
      "@privy-io",
      "react-auth",
      "node_modules",
      "@privy-io",
      "js-sdk-core",
      "dist",
      "esm",
      "embedded",
      "stack",
      "wallet-api-eth-transaction.mjs",
    ),
  },
];

function buildSource(format) {
  if (format === "wallet-cjs" || format === "wallet-esm") {
    const importLine =
      format === "wallet-cjs"
        ? `var encodings=require("../../utils/encodings.js");`
        : `import{bytesToHex as bytesToHex,isHexEncoded as isHexEncoded,utf8ToBytes as utf8ToBytes}from"../../utils/encodings.mjs";`;
    const exportLine =
      format === "wallet-cjs"
        ? `exports.toWalletApiUnsignedEthTransaction=toWalletApiUnsignedEthTransaction;`
        : `export{toWalletApiUnsignedEthTransaction};`;
    const bytesFn = format === "wallet-cjs" ? "encodings.bytesToHex" : "bytesToHex";
    const hexFn = format === "wallet-cjs" ? "encodings.isHexEncoded" : "isHexEncoded";
    const utf8Fn = format === "wallet-cjs" ? "encodings.utf8ToBytes" : "utf8ToBytes";

    return `${importLine}
function toHexLike(value){
  if(typeof value==="number"||typeof value==="bigint"){
    return \`0x\${BigInt(value).toString(16)}\`;
  }
  if(typeof value==="string"){
    return ${hexFn}(value)?value:${bytesFn}(${utf8Fn}(value));
  }
}
function normalizeAuthorizationList(authorizationList){
  if(!Array.isArray(authorizationList)||authorizationList.length===0)return undefined;
  return authorizationList.map((authorization)=>({
    chain_id:toHexLike(authorization.chainId ?? authorization.chain_id),
    contract:authorization.contract ?? authorization.address,
    nonce:toHexLike(authorization.nonce),
    r:authorization.r,
    s:authorization.s,
    y_parity:Number(authorization.yParity ?? authorization.y_parity ?? authorization.v ?? 0),
  }));
}
function encodeData(data){
  if(data===undefined)return undefined;
  return typeof data==="string"
    ? (${hexFn}(data)?data:${bytesFn}(${utf8Fn}(data)))
    : ${bytesFn}(Buffer.from(Uint8Array.from(data)));
}
function toWalletApiUnsignedEthTransaction(input){
  return{
    from:input.from,
    to:input.to??undefined,
    nonce:toHexLike(input.nonce),
    chain_id:toHexLike(input.chainId ?? input.chain_id),
    data:encodeData(input.data),
    value:toHexLike(input.value),
    type:input.type,
    gas_limit:toHexLike(input.gasLimit ?? input.gas_limit ?? input.gas),
    gas_price:toHexLike(input.gasPrice ?? input.gas_price),
    max_fee_per_gas:toHexLike(input.maxFeePerGas ?? input.max_fee_per_gas),
    max_priority_fee_per_gas:toHexLike(input.maxPriorityFeePerGas ?? input.max_priority_fee_per_gas),
    authorization_list:normalizeAuthorizationList(input.authorizationList ?? input.authorization_list),
  };
}
${exportLine}
`;
  }

  const importLine =
    format === "cjs"
      ? `const { isHex, toHex } = require("viem");`
      : `import { isHex, toHex } from "viem";`;
  const exportLine =
    format === "cjs"
      ? `exports.STRING_TO_NUMBER_TXN_TYPE = STRING_TO_NUMBER_TXN_TYPE;\nexports.toViemTransactionSerializable = toViemTransactionSerializable;`
      : `export { STRING_TO_NUMBER_TXN_TYPE, toViemTransactionSerializable };`;

  return `${importLine}
const NUMBER_TO_STRING_TXN_TYPE = {
  0: "legacy",
  1: "eip2930",
  2: "eip1559",
  3: "eip4844",
  4: "eip7702",
};

const STRING_TO_NUMBER_TXN_TYPE = {
  legacy: 0,
  eip2930: 1,
  eip1559: 2,
  eip4844: 3,
  eip7702: 4,
};

function toOptionalBigInt(value) {
  return value !== undefined && value !== null ? BigInt(value) : undefined;
}

function normalizeAccessList(accessList) {
  if (!accessList) return undefined;
  if (Array.isArray(accessList)) {
    return accessList.map((entry) =>
      Array.isArray(entry)
        ? { address: entry[0], storageKeys: entry[1] }
        : entry,
    );
  }
  return Object.entries(accessList).map(([address, storageKeys]) => ({
    address,
    storageKeys,
  }));
}

function normalizeAuthorizationList(authorizationList) {
  if (!Array.isArray(authorizationList)) return undefined;
  return authorizationList.map((authorization) => ({
    ...authorization,
    chainId: Number(authorization.chainId),
    nonce: Number(authorization.nonce),
    yParity: Number(authorization.yParity ?? authorization.v ?? 0),
  }));
}

function normalizeType(rawType, request) {
  if (rawType === undefined || rawType === null) {
    return request.authorizationList?.length ? 4 : 2;
  }
  if (typeof rawType === "string") {
    return STRING_TO_NUMBER_TXN_TYPE[rawType] ?? Number(rawType);
  }
  return Number(rawType);
}

function toViemTransactionSerializable(input) {
  let request;
  let rawType;
  ({ type: rawType, ...request } = typeof input === "string" ? JSON.parse(input) : input);

  const accessList = normalizeAccessList(request.accessList);
  const authorizationList = normalizeAuthorizationList(request.authorizationList);
  const chainId = Number(request.chainId ?? 1);
  const data = isHex(request.data)
    ? request.data
    : request.data
      ? toHex(Uint8Array.from(request.data))
      : undefined;
  const nonce = request.nonce !== undefined && request.nonce !== null ? Number(request.nonce) : undefined;
  const base = {
    chainId,
    data,
    nonce,
    value: toOptionalBigInt(request.value),
    gas: toOptionalBigInt(request.gas ?? request.gasLimit),
  };
  const type = normalizeType(rawType, request);

  if (type === 0) {
    return {
      ...request,
      type: NUMBER_TO_STRING_TXN_TYPE[type],
      ...base,
      gasPrice: toOptionalBigInt(request.gasPrice),
      accessList: undefined,
      authorizationList: undefined,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
    };
  }

  if (type === 1) {
    return {
      ...request,
      type: NUMBER_TO_STRING_TXN_TYPE[type],
      ...base,
      gasPrice: toOptionalBigInt(request.gasPrice),
      accessList,
      authorizationList: undefined,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
    };
  }

  if (type === 2) {
    return {
      ...request,
      type: NUMBER_TO_STRING_TXN_TYPE[type],
      ...base,
      accessList,
      authorizationList: undefined,
      maxFeePerGas: toOptionalBigInt(request.maxFeePerGas),
      maxPriorityFeePerGas: toOptionalBigInt(request.maxPriorityFeePerGas),
      gasPrice: undefined,
      maxFeePerBlobGas: undefined,
    };
  }

  if (type === 4) {
    return {
      ...request,
      type: NUMBER_TO_STRING_TXN_TYPE[type],
      ...base,
      accessList,
      authorizationList,
      maxFeePerGas: toOptionalBigInt(request.maxFeePerGas),
      maxPriorityFeePerGas: toOptionalBigInt(request.maxPriorityFeePerGas),
      gasPrice: undefined,
      maxFeePerBlobGas: undefined,
    };
  }

  throw new Error(\`Unsupported transaction type: \${rawType ?? type}\`);
}

${exportLine}
`;
}

let patchedAny = false;

for (const target of targets) {
  if (!fs.existsSync(target.file)) {
    console.warn(`[patch-privy-7702] skipped missing file: ${target.file}`);
    continue;
  }
  fs.writeFileSync(target.file, buildSource(target.format), "utf8");
  console.log(`[patch-privy-7702] patched ${path.relative(root, target.file)}`);
  patchedAny = true;
}

if (!patchedAny) {
  console.warn("[patch-privy-7702] no files patched");
}
