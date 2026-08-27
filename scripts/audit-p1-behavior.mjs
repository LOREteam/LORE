import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const PROJECT_ROOT = process.cwd();
const COORDINATOR_PATH = path.join(PROJECT_ROOT, "scripts", "test-business-logic.mjs");
const BUSINESS_LOGIC_SUITE_PATH = path.join(PROJECT_ROOT, "scripts", "business-logic-suite.mjs");
const SOURCE_EXTENSIONS = [".mjs", ".ts", ".tsx", ".js"];
const ASSERT_METHODS = new Set([
  "deepEqual",
  "deepStrictEqual",
  "doesNotMatch",
  "doesNotReject",
  "doesNotThrow",
  "equal",
  "fail",
  "ifError",
  "match",
  "notDeepEqual",
  "notDeepStrictEqual",
  "notEqual",
  "notStrictEqual",
  "ok",
  "partialDeepStrictEqual",
  "rejects",
  "strict",
  "strictEqual",
  "throws",
]);
const ASSERT_CONSTRUCTORS = new Set(["AssertionError", "CallTracker"]);
// Node 24.5 exposes the legacy Assert constructor as a function, while later
// supported Node 24 releases do not. It is not an assertion method and must
// not make the audit's supported assertion surface runtime-version-specific.
const OPTIONAL_LEGACY_ASSERT_EXPORTS = new Set(["Assert"]);
const ASSERT_MODULES = new Set(["assert", "assert/strict", "node:assert", "node:assert/strict"]);
const FS_MODULES = new Set(["fs", "node:fs"]);
const TRANSPARENT_INSTANCE_METHODS = new Set([
  "at",
  "endsWith",
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "includes",
  "indexOf",
  "join",
  "lastIndexOf",
  "map",
  "match",
  "matchAll",
  "normalize",
  "replace",
  "replaceAll",
  "search",
  "slice",
  "some",
  "sort",
  "split",
  "startsWith",
  "substr",
  "substring",
  "test",
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
]);
const TRANSPARENT_STATIC_METHODS = new Set([
  "Array.from",
  "BigInt",
  "JSON.parse",
  "Number",
  "Object.entries",
  "Object.fromEntries",
  "Object.keys",
  "Object.values",
  "String",
]);
const AUDIT_COMPILER_OPTIONS = {
  allowJs: true,
  checkJs: false,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  noResolve: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.Latest,
};

function resolveRelativeModule(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`)];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!resolved) throw new Error(`cannot resolve direct coordinator import: ${specifier}`);
  const relative = path.relative(PROJECT_ROOT, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`direct coordinator import escapes repository: ${specifier}`);
  }
  return resolved;
}

function relativeImports(filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const modules = new Set();
  const addSpecifier = (specifier) => {
    if (specifier.startsWith("./")) modules.add(resolveRelativeModule(filePath, specifier));
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      addSpecifier(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      addSpecifier(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...modules];
}

function isBusinessTestModule(filePath) {
  const name = path.basename(filePath);
  return name.startsWith("test-") || name === "business-logic-suite.mjs";
}

function coordinatorTestModules(coordinatorPath) {
  const pending = [coordinatorPath];
  const visited = new Set([coordinatorPath]);
  const modules = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    for (const imported of relativeImports(current)) {
      if (!isBusinessTestModule(imported) || visited.has(imported)) continue;
      visited.add(imported);
      modules.add(imported);
      pending.push(imported);
    }
  }
  return [...modules].sort((left, right) => left.localeCompare(right));
}

function symbolAt(checker, node) {
  return node ? checker.getSymbolAtLocation(node) : undefined;
}

function addSymbol(set, checker, node) {
  const symbol = symbolAt(checker, node);
  if (!symbol || set.has(symbol)) return false;
  set.add(symbol);
  return true;
}

function moduleSpecifier(statement) {
  return ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
    ? statement.moduleSpecifier.text
    : undefined;
}

function staticMemberName(expression) {
  const unwrapped = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name.text;
  if (
    ts.isElementAccessExpression(unwrapped)
    && (ts.isStringLiteral(unwrapExpression(unwrapped.argumentExpression))
      || ts.isNoSubstitutionTemplateLiteral(unwrapExpression(unwrapped.argumentExpression)))
  ) {
    return unwrapExpression(unwrapped.argumentExpression).text;
  }
  return undefined;
}

function memberReceiver(expression) {
  const unwrapped = unwrapExpression(expression);
  return ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)
    ? unwrapExpression(unwrapped.expression)
    : undefined;
}

function throwUnknownAssertMethod(method, sourceFile, node) {
  const label = method ?? "<dynamic>";
  throw new Error(`unknown node:assert method "${label}" at ${sourceLocation(sourceFile, node)}`);
}

function collectClassifierBindings(sourceFile, checker) {
  const assertObjects = new Set();
  const namedAssertMethods = new Map();
  const fsObjects = new Set();
  const readFileSyncBindings = new Set();

  for (const statement of sourceFile.statements) {
    const specifier = moduleSpecifier(statement);
    if (!specifier || !statement.importClause) continue;
    const { importClause } = statement;
    const namedBindings = importClause.namedBindings;
    if (ASSERT_MODULES.has(specifier)) {
      if (importClause.name) addSymbol(assertObjects, checker, importClause.name);
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        addSymbol(assertObjects, checker, namedBindings.name);
      } else if (namedBindings && !importClause.isTypeOnly) {
        for (const element of namedBindings.elements) {
          if (element.isTypeOnly) continue;
          const method = element.propertyName?.text ?? element.name.text;
          if (method === "default") {
            addSymbol(assertObjects, checker, element.name);
          } else if (ASSERT_METHODS.has(method)) {
            const symbol = symbolAt(checker, element.name);
            if (symbol) namedAssertMethods.set(symbol, method);
          } else if (!ASSERT_CONSTRUCTORS.has(method)) {
            throwUnknownAssertMethod(method, sourceFile, element.propertyName ?? element.name);
          }
        }
      }
    }
    if (FS_MODULES.has(specifier)) {
      if (importClause.name) addSymbol(fsObjects, checker, importClause.name);
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        addSymbol(fsObjects, checker, namedBindings.name);
      } else if (namedBindings) {
        for (const element of namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (importedName === "readFileSync") addSymbol(readFileSyncBindings, checker, element.name);
        }
      }
    }
  }

  const declarations = [];
  const collect = (node) => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (!declaration.initializer) continue;
      const initializer = unwrapExpression(declaration.initializer);
      if (ts.isIdentifier(declaration.name) && ts.isIdentifier(initializer)) {
        const initializerSymbol = symbolAt(checker, initializer);
        if (initializerSymbol && assertObjects.has(initializerSymbol)) {
          changed = addSymbol(assertObjects, checker, declaration.name) || changed;
        }
        if (initializerSymbol && fsObjects.has(initializerSymbol)) {
          changed = addSymbol(fsObjects, checker, declaration.name) || changed;
        }
        const method = initializerSymbol ? namedAssertMethods.get(initializerSymbol) : undefined;
        if (method) {
          const symbol = symbolAt(checker, declaration.name);
          if (symbol && !namedAssertMethods.has(symbol)) {
            namedAssertMethods.set(symbol, method);
            changed = true;
          }
        }
        if (initializerSymbol && readFileSyncBindings.has(initializerSymbol)) {
          changed = addSymbol(readFileSyncBindings, checker, declaration.name) || changed;
        }
      }
      const initializerReceiver = memberReceiver(initializer);
      if (
        ts.isIdentifier(declaration.name)
        && initializerReceiver
        && ts.isIdentifier(initializerReceiver)
        && assertObjects.has(symbolAt(checker, initializerReceiver))
      ) {
        const method = staticMemberName(initializer);
        if (!method) {
          throwUnknownAssertMethod(undefined, sourceFile, initializer);
        } else if (ASSERT_METHODS.has(method)) {
          const symbol = symbolAt(checker, declaration.name);
          if (symbol && !namedAssertMethods.has(symbol)) {
            namedAssertMethods.set(symbol, method);
            changed = true;
          }
        } else if (!ASSERT_CONSTRUCTORS.has(method)) {
          throwUnknownAssertMethod(method, sourceFile, initializer);
        }
      }
      if (
        ts.isObjectBindingPattern(declaration.name)
        && ts.isIdentifier(initializer)
        && assertObjects.has(symbolAt(checker, initializer))
      ) {
        for (const element of declaration.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const method = element.propertyName?.text ?? element.name.text;
          if (ASSERT_CONSTRUCTORS.has(method)) continue;
          if (!ASSERT_METHODS.has(method)) {
            throwUnknownAssertMethod(method, sourceFile, element.propertyName ?? element.name);
          }
          const symbol = symbolAt(checker, element.name);
          if (symbol && !namedAssertMethods.has(symbol)) {
            namedAssertMethods.set(symbol, method);
            changed = true;
          }
        }
      }
    }
  }
  return { assertObjects, namedAssertMethods, fsObjects, readFileSyncBindings };
}

function sourceLocation(sourceFile, node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${sourceFile.fileName}:${line + 1}:${character + 1}`;
}

function assertionCall(node, state) {
  if (!ts.isCallExpression(node)) return undefined;
  const expression = unwrapExpression(node.expression);
  if (ts.isIdentifier(expression)) {
    const symbol = symbolAt(state.checker, expression);
    if (symbol && state.bindings.assertObjects.has(symbol)) return { method: "call", node };
    const method = symbol ? state.bindings.namedAssertMethods.get(symbol) : undefined;
    return method ? { method, node } : undefined;
  }
  const receiver = memberReceiver(expression);
  if (!receiver || !ts.isIdentifier(receiver)) return undefined;
  const receiverSymbol = symbolAt(state.checker, receiver);
  if (!receiverSymbol || !state.bindings.assertObjects.has(receiverSymbol)) return undefined;
  const method = staticMemberName(expression);
  if (!method) throwUnknownAssertMethod(undefined, state.sourceFile, expression);
  if (ASSERT_CONSTRUCTORS.has(method)) return undefined;
  if (!ASSERT_METHODS.has(method)) {
    throwUnknownAssertMethod(method, state.sourceFile, expression);
  }
  return { method, node };
}

const SINGLE_ASSERT_ARGUMENT_METHODS = new Set(["call", "ifError", "ok", "strict"]);
const CALLBACK_ASSERT_METHODS = new Set(["doesNotReject", "doesNotThrow", "rejects", "throws"]);

function isLiteralMessage(node) {
  if (!node) return false;
  const unwrapped = unwrapExpression(node);
  return ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped);
}

function assertionDataArguments(call) {
  if (call.method === "fail") return [];
  if (SINGLE_ASSERT_ARGUMENT_METHODS.has(call.method)) return call.node.arguments.slice(0, 1);
  if (CALLBACK_ASSERT_METHODS.has(call.method) && isLiteralMessage(call.node.arguments[1])) {
    return call.node.arguments.slice(0, 1);
  }
  return call.node.arguments.slice(0, 2);
}

function hasSourceFileDeclaration(symbol, sourceFile) {
  return Boolean(symbol?.declarations?.some((declaration) => declaration.getSourceFile() === sourceFile));
}

function transparentStaticCallName(node, state) {
  if (!ts.isCallExpression(node)) return undefined;
  const expression = unwrapExpression(node.expression);
  if (ts.isIdentifier(expression) && TRANSPARENT_STATIC_METHODS.has(expression.text)) {
    const symbol = symbolAt(state.checker, expression);
    return hasSourceFileDeclaration(symbol, state.sourceFile) ? undefined : expression.text;
  }
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  const receiver = unwrapExpression(expression.expression);
  if (!ts.isIdentifier(receiver)) return undefined;
  const name = `${receiver.text}.${expression.name.text}`;
  if (!TRANSPARENT_STATIC_METHODS.has(name)) return undefined;
  const symbol = symbolAt(state.checker, receiver);
  return hasSourceFileDeclaration(symbol, state.sourceFile) ? undefined : name;
}

function isReadFileSyncCall(node, state) {
  if (!ts.isCallExpression(node)) return false;
  const expression = unwrapExpression(node.expression);
  if (ts.isIdentifier(expression)) {
    const symbol = symbolAt(state.checker, expression);
    return Boolean(symbol && state.bindings.readFileSyncBindings.has(symbol));
  }
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "readFileSync") return false;
  const receiver = unwrapExpression(expression.expression);
  if (!ts.isIdentifier(receiver)) return false;
  const symbol = symbolAt(state.checker, receiver);
  return Boolean(symbol && state.bindings.fsObjects.has(symbol));
}

function localFunctionSymbolFromCall(node, state) {
  if (!ts.isCallExpression(node)) return undefined;
  const expression = unwrapExpression(node.expression);
  if (!ts.isIdentifier(expression)) return undefined;
  const symbol = symbolAt(state.checker, expression);
  return symbol && state.functionRecords.has(symbol) ? symbol : undefined;
}

function callbackReturnTainted(node, state) {
  const unwrapped = unwrapExpression(node);
  if (!isNestedFunctionLike(unwrapped)) {
    return valueTainted(unwrapped, state);
  }
  if (!ts.isBlock(unwrapped.body)) return valueTainted(unwrapped.body, state);
  let tainted = false;
  const visit = (current) => {
    if (tainted) return;
    if (current !== unwrapped.body && isNestedFunctionLike(current)) return;
    if (ts.isReturnStatement(current) && current.expression && valueTainted(current.expression, state)) {
      tainted = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(unwrapped.body);
  return tainted;
}

function transparentCallArgumentTainted(argument, state) {
  const unwrapped = unwrapExpression(argument);
  return ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)
    ? callbackReturnTainted(unwrapped, state)
    : valueTainted(unwrapped, state);
}

function valueTainted(node, state) {
  if (!node) return false;
  const current = unwrapExpression(node);
  if (ts.isIdentifier(current)) {
    const symbol = symbolAt(state.checker, current);
    return Boolean(symbol && state.taintedSymbols.has(symbol));
  }
  if (ts.isCallExpression(current)) {
    if (isReadFileSyncCall(current, state)) return true;
    if (assertionCall(current, state)) return false;
    const localFunction = localFunctionSymbolFromCall(current, state);
    if (localFunction && state.taintedReturnFunctions.has(localFunction)) return true;
    if (transparentStaticCallName(current, state)) {
      return current.arguments.some((argument) => transparentCallArgumentTainted(argument, state));
    }
    const expression = unwrapExpression(current.expression);
    if (
      ts.isPropertyAccessExpression(expression)
      && TRANSPARENT_INSTANCE_METHODS.has(expression.name.text)
    ) {
      return valueTainted(expression.expression, state)
        || current.arguments.some((argument) => transparentCallArgumentTainted(argument, state));
    }
    return false;
  }
  if (ts.isPropertyAccessExpression(current)) return valueTainted(current.expression, state);
  if (ts.isElementAccessExpression(current)) {
    return valueTainted(current.expression, state) || valueTainted(current.argumentExpression, state);
  }
  if (ts.isBinaryExpression(current)) {
    return valueTainted(current.left, state) || valueTainted(current.right, state);
  }
  if (ts.isConditionalExpression(current)) {
    return valueTainted(current.condition, state)
      || valueTainted(current.whenTrue, state)
      || valueTainted(current.whenFalse, state);
  }
  if (ts.isTemplateExpression(current)) {
    return current.templateSpans.some((span) => valueTainted(span.expression, state));
  }
  if (
    ts.isPrefixUnaryExpression(current)
    || ts.isPostfixUnaryExpression(current)
    || ts.isTypeOfExpression(current)
    || ts.isVoidExpression(current)
    || ts.isDeleteExpression(current)
    || ts.isAwaitExpression(current)
    || ts.isYieldExpression(current)
    || ts.isSpreadElement(current)
  ) {
    return valueTainted(current.operand ?? current.expression, state);
  }
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.some((element) => valueTainted(element, state));
  }
  if (ts.isObjectLiteralExpression(current)) {
    return current.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) return valueTainted(property.initializer, state);
      if (ts.isShorthandPropertyAssignment(property)) return valueTainted(property.name, state);
      if (ts.isSpreadAssignment(property)) return valueTainted(property.expression, state);
      return false;
    });
  }
  if (ts.isCommaListExpression(current)) {
    return current.elements.some((element) => valueTainted(element, state));
  }
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
    return callbackReturnTainted(current, state);
  }
  return false;
}

function containsTaintedReference(node, state) {
  let found = false;
  const visit = (current) => {
    if (!current || found) return;
    const unwrapped = unwrapExpression(current);
    if (unwrapped !== current) {
      visit(unwrapped);
      return;
    }
    if (ts.isIdentifier(current)) {
      const symbol = symbolAt(state.checker, current);
      found = Boolean(symbol && state.taintedSymbols.has(symbol));
      return;
    }
    if (ts.isPropertyAccessExpression(current)) {
      visit(current.expression);
      return;
    }
    if (ts.isElementAccessExpression(current)) {
      visit(current.expression);
      visit(current.argumentExpression);
      return;
    }
    if (ts.isCallExpression(current)) {
      found = valueTainted(current, state);
      return;
    }
    if (ts.isNewExpression(current)) {
      return;
    }
    if (ts.isTaggedTemplateExpression(current)) {
      visit(current.template);
      return;
    }
    if (ts.isPropertyAssignment(current)) {
      visit(current.initializer);
      return;
    }
    if (ts.isShorthandPropertyAssignment(current)) {
      visit(current.name);
      return;
    }
    if (ts.isSpreadAssignment(current)) {
      visit(current.expression);
      return;
    }
    if (ts.isVariableDeclaration(current) || ts.isPropertyDeclaration(current) || ts.isEnumMember(current)) {
      visit(current.initializer);
      return;
    }
    if (ts.isParameter(current) || ts.isBindingElement(current)) {
      visit(current.initializer);
      return;
    }
    if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
      for (const parameter of current.parameters) visit(parameter.initializer);
      visit(current.body);
      return;
    }
    if (ts.isMethodDeclaration(current) || ts.isGetAccessorDeclaration(current) || ts.isSetAccessorDeclaration(current)) {
      for (const parameter of current.parameters) visit(parameter.initializer);
      visit(current.body);
      return;
    }
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
      for (const member of current.members) visit(member);
      return;
    }
    if (ts.isLabeledStatement(current)) {
      visit(current.statement);
      return;
    }
    if (
      ts.isImportDeclaration(current)
      || ts.isImportClause(current)
      || ts.isImportSpecifier(current)
      || ts.isNamespaceImport(current)
      || ts.isExportDeclaration(current)
      || ts.isTypeNode(current)
    ) {
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function collectFunctionRecords(sourceFile, checker) {
  const records = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const symbol = symbolAt(checker, node.name);
      if (symbol) records.set(symbol, { symbol, nameNode: node.name, node, parameters: node.parameters });
    } else if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && (ts.isArrowFunction(unwrapExpression(node.initializer)) || ts.isFunctionExpression(unwrapExpression(node.initializer)))
    ) {
      const symbol = symbolAt(checker, node.name);
      const functionNode = unwrapExpression(node.initializer);
      if (symbol) records.set(symbol, { symbol, nameNode: node.name, node: functionNode, parameters: functionNode.parameters });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return records;
}

function collectFunctionCallSites(sourceFile, state) {
  const callSites = new Map([...state.functionRecords.keys()].map((symbol) => [symbol, []]));
  const references = new Map([...state.functionRecords.keys()].map((symbol) => [symbol, []]));
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const symbol = symbolAt(state.checker, node);
      if (symbol && references.has(symbol)) references.get(symbol).push(node);
    }
    if (ts.isCallExpression(node)) {
      const symbol = localFunctionSymbolFromCall(node, state);
      if (symbol) callSites.get(symbol).push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { callSites, references };
}

function isDirectFunctionReference(node, record) {
  if (node === record.nameNode) return true;
  let current = node;
  let parent = node.parent;
  while (parent && unwrapExpression(parent) === current) {
    current = parent;
    parent = parent.parent;
  }
  return Boolean(parent && ts.isCallExpression(parent) && unwrapExpression(parent.expression) === current);
}

function functionReferencesEscape(record, state) {
  return state.functionReferences.get(record.symbol).some((node) => !isDirectFunctionReference(node, record));
}

function assignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function functionIsTransparent(record, state, transparentFunctions) {
  if (record.node.asteriskToken || record.node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
    return false;
  }
  let transparent = true;
  const visit = (node) => {
    if (!transparent) return;
    if (
      ts.isAwaitExpression(node)
      || ts.isYieldExpression(node)
      || ts.isNewExpression(node)
      || ts.isTaggedTemplateExpression(node)
      || ts.isDeleteExpression(node)
      || (ts.isBinaryExpression(node) && assignmentOperator(node.operatorToken.kind))
      || ts.isPostfixUnaryExpression(node)
      || (ts.isPrefixUnaryExpression(node)
        && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken))
    ) {
      transparent = false;
      return;
    }
    if (ts.isCallExpression(node)) {
      const assertCall = assertionCall(node, state);
      const expression = unwrapExpression(node.expression);
      const localFunction = localFunctionSymbolFromCall(node, state);
      const allowedInstance = ts.isPropertyAccessExpression(expression)
        && TRANSPARENT_INSTANCE_METHODS.has(expression.name.text);
      if (
        !assertCall
        && !transparentStaticCallName(node, state)
        && !allowedInstance
        && !(localFunction && transparentFunctions.has(localFunction))
      ) {
        transparent = false;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(record.node.body);
  return transparent;
}

function addBindingSymbols(name, state) {
  let changed = false;
  if (ts.isIdentifier(name)) return addSymbol(state.taintedSymbols, state.checker, name);
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) changed = addBindingSymbols(element.name, state) || changed;
  }
  return changed;
}

function addObjectEntriesValueBinding(name, state) {
  if (!ts.isArrayBindingPattern(name)) return addBindingSymbols(name, state);
  const valueElement = name.elements[1];
  return valueElement && !ts.isOmittedExpression(valueElement)
    ? addBindingSymbols(valueElement.name, state)
    : false;
}

function addLiteralRowBindings(name, expression, state) {
  if (!ts.isArrayLiteralExpression(expression) || expression.elements.length === 0) return false;
  if (ts.isIdentifier(name)) {
    return expression.elements.every((element) => valueTainted(element, state))
      ? addBindingSymbols(name, state)
      : false;
  }
  if (!ts.isArrayBindingPattern(name)) return false;
  const rows = expression.elements.map((element) => unwrapExpression(element));
  if (!rows.every(ts.isArrayLiteralExpression)) return false;
  let changed = false;
  for (let index = 0; index < name.elements.length; index += 1) {
    const binding = name.elements[index];
    if (!binding || ts.isOmittedExpression(binding)) continue;
    const columnIsAlwaysTainted = rows.every(
      (row) => row.elements[index] && valueTainted(row.elements[index], state),
    );
    if (columnIsAlwaysTainted) changed = addBindingSymbols(binding.name, state) || changed;
  }
  return changed;
}

function aggregateLiteral(node) {
  const unwrapped = unwrapExpression(node);
  return ts.isArrayLiteralExpression(unwrapped) || ts.isObjectLiteralExpression(unwrapped);
}

function objectEntriesCall(node, state) {
  return ts.isCallExpression(unwrapExpression(node))
    && transparentStaticCallName(unwrapExpression(node), state) === "Object.entries";
}

function collectTaintNodes(sourceFile) {
  const variableDeclarations = [];
  const assignments = [];
  const forOfStatements = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) variableDeclarations.push(node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) assignments.push(node);
    if (ts.isForOfStatement(node)) forOfStatements.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { variableDeclarations, assignments, forOfStatements };
}

function buildTaintState(sourceFile, checker) {
  const state = {
    sourceFile,
    checker,
    bindings: collectClassifierBindings(sourceFile, checker),
    taintedSymbols: new Set(),
    taintedReturnFunctions: new Set(),
    functionRecords: collectFunctionRecords(sourceFile, checker),
  };
  const { callSites, references } = collectFunctionCallSites(sourceFile, state);
  state.functionCallSites = callSites;
  state.functionReferences = references;
  const transparentFunctions = new Set();
  let transparencyChanged = true;
  while (transparencyChanged) {
    transparencyChanged = false;
    for (const record of state.functionRecords.values()) {
      if (transparentFunctions.has(record.symbol)) continue;
      if (functionIsTransparent(record, state, transparentFunctions)) {
        transparentFunctions.add(record.symbol);
        transparencyChanged = true;
      }
    }
  }
  state.transparentFunctions = transparentFunctions;
  const nodes = collectTaintNodes(sourceFile);

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of nodes.variableDeclarations) {
      if (!declaration.initializer || aggregateLiteral(declaration.initializer)) continue;
      if (valueTainted(declaration.initializer, state)) {
        changed = addBindingSymbols(declaration.name, state) || changed;
      }
    }
    for (const assignment of nodes.assignments) {
      if (ts.isIdentifier(assignment.left) && valueTainted(assignment.right, state)) {
        changed = addSymbol(state.taintedSymbols, checker, assignment.left) || changed;
      }
    }
    for (const statement of nodes.forOfStatements) {
      if (!ts.isVariableDeclarationList(statement.initializer)) continue;
      const declaration = statement.initializer.declarations[0];
      if (!declaration) continue;
      const expression = unwrapExpression(statement.expression);
      if (ts.isArrayLiteralExpression(expression)) {
        changed = addLiteralRowBindings(declaration.name, expression, state) || changed;
      } else if (objectEntriesCall(expression, state) && valueTainted(expression.arguments[0], state)) {
        changed = addObjectEntriesValueBinding(declaration.name, state) || changed;
      } else if (!aggregateLiteral(expression) && valueTainted(expression, state)) {
        changed = addBindingSymbols(declaration.name, state) || changed;
      }
    }
    for (const record of state.functionRecords.values()) {
      if (functionReferencesEscape(record, state)) continue;
      const calls = state.functionCallSites.get(record.symbol);
      if (calls.length > 0) {
        for (let index = 0; index < record.parameters.length; index += 1) {
          const parameter = record.parameters[index];
          if (!ts.isIdentifier(parameter.name)) continue;
          const allCallsTainted = calls.every(
            (call) => call.arguments[index] && valueTainted(call.arguments[index], state),
          );
          if (allCallsTainted) changed = addSymbol(state.taintedSymbols, checker, parameter.name) || changed;
        }
      }
      if (
        state.transparentFunctions.has(record.symbol)
        && callbackReturnTainted(record.node, state)
        && !state.taintedReturnFunctions.has(record.symbol)
      ) {
        state.taintedReturnFunctions.add(record.symbol);
        changed = true;
      }
    }
  }
  return state;
}

function auditAssertionSourceFile(sourceFile, checker) {
  const state = buildTaintState(sourceFile, checker);
  let total = 0;
  let sourceOperand = 0;
  const visit = (node) => {
    const call = assertionCall(node, state);
    if (call) {
      total += 1;
      if (assertionDataArguments(call).some((argument) => containsTaintedReference(argument, state))) {
        sourceOperand += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { total, sourceOperand, behavioral: total - sourceOperand };
}

function sourceFileFromProgram(program, fileName) {
  const absolute = path.resolve(fileName);
  const direct = program.getSourceFile(absolute);
  if (direct) return direct;
  const normalized = absolute.toLowerCase();
  const matched = program.getSourceFiles().find((sourceFile) => path.resolve(sourceFile.fileName).toLowerCase() === normalized);
  if (!matched) throw new Error(`cannot load audit source file: ${fileName}`);
  return matched;
}

function inMemoryAuditProgram(sourceText, fileName) {
  const absolute = path.resolve(PROJECT_ROOT, fileName);
  const canonical = (candidate) => path.resolve(candidate).toLowerCase();
  const target = canonical(absolute);
  const scriptKind = /\.tsx?$/i.test(absolute) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const host = ts.createCompilerHost(AUDIT_COMPILER_OPTIONS, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (candidate, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (canonical(candidate) === target) {
      return ts.createSourceFile(candidate, sourceText, languageVersion, true, scriptKind);
    }
    return getSourceFile(candidate, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (candidate) => canonical(candidate) === target || fileExists(candidate);
  host.readFile = (candidate) => (canonical(candidate) === target ? sourceText : readFile(candidate));
  const program = ts.createProgram({ rootNames: [absolute], options: AUDIT_COMPILER_OPTIONS, host });
  return { program, sourceFile: sourceFileFromProgram(program, absolute) };
}

export function auditAssertionSource(sourceText, fileName = "fixture.mjs") {
  const { program, sourceFile } = inMemoryAuditProgram(sourceText, fileName);
  return auditAssertionSourceFile(sourceFile, program.getTypeChecker());
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function identifierText(node) {
  return ts.isIdentifier(node) ? node.text : undefined;
}

function namespaceBindingFromExpression(expression, namespaceBindings) {
  const unwrapped = unwrapExpression(expression);
  const directName = identifierText(unwrapped);
  if (directName && namespaceBindings.has(directName)) return directName;
  if (
    !ts.isBinaryExpression(unwrapped)
    || unwrapped.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
  ) {
    return undefined;
  }
  const left = unwrapExpression(unwrapped.left);
  const rightName = identifierText(unwrapExpression(unwrapped.right));
  if (
    !rightName
    || !namespaceBindings.has(rightName)
    || !ts.isPropertyAccessExpression(left)
    || left.name.text !== "default"
    || identifierText(unwrapExpression(left.expression)) !== rightName
  ) {
    return undefined;
  }
  return rightName;
}

function collectVariableDeclarations(sourceFile) {
  const declarations = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return declarations;
}

function isNamedRunBinding(bindingElement) {
  const propertyName = bindingElement.propertyName ?? bindingElement.name;
  return ts.isIdentifier(propertyName) && propertyName.text.startsWith("run");
}

function addAliasBindings(sourceFile, namespaceBindings, namedRunBindings) {
  const declarations = collectVariableDeclarations(sourceFile);
  const aliasBindingNodes = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (!declaration.initializer) continue;
      const namespaceName = namespaceBindingFromExpression(declaration.initializer, namespaceBindings);
      if (!namespaceName) continue;
      if (ts.isIdentifier(declaration.name)) {
        aliasBindingNodes.add(declaration.name);
        if (!namespaceBindings.has(declaration.name.text)) {
          namespaceBindings.add(declaration.name.text);
          changed = true;
        }
        continue;
      }
      if (!ts.isObjectBindingPattern(declaration.name)) continue;
      for (const element of declaration.name.elements) {
        if (!isNamedRunBinding(element)) continue;
        const bindingName = identifierText(element.name);
        if (ts.isIdentifier(element.name)) aliasBindingNodes.add(element.name);
        if (bindingName && !namedRunBindings.has(bindingName)) {
          namedRunBindings.add(bindingName);
          changed = true;
        }
      }
    }
  }
  return aliasBindingNodes;
}

function isNestedFunctionLike(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node);
}

function bindingEntries(bindingName, entries = []) {
  if (ts.isIdentifier(bindingName)) {
    entries.push({ name: bindingName.text, node: bindingName });
    return entries;
  }
  for (const element of bindingName.elements) {
    if (!ts.isOmittedExpression(element)) bindingEntries(element.name, entries);
  }
  return entries;
}

function closestScope(node, predicate) {
  let current = node.parent;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function isFunctionScope(node) {
  return isNestedFunctionLike(node) || ts.isSourceFile(node);
}

function isLexicalScope(node) {
  return isFunctionScope(node)
    || ts.isBlock(node)
    || ts.isCatchClause(node)
    || ts.isForStatement(node)
    || ts.isForInStatement(node)
    || ts.isForOfStatement(node);
}

function localBindingScopes(suiteFunction, namesToTrack, ignoredBindingNodes) {
  const bindings = [];
  const addBindingName = (bindingName, scope) => {
    if (!scope) return;
    for (const { name, node } of bindingEntries(bindingName)) {
      if (namesToTrack.has(name) && !ignoredBindingNodes.has(node)) bindings.push({ name, scope });
    }
  };
  const visit = (node) => {
    if (ts.isParameter(node)) {
      addBindingName(node.name, closestScope(node, isFunctionScope));
    } else if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
      const isBlockScoped = (node.parent.flags & ts.NodeFlags.BlockScoped) !== 0;
      addBindingName(node.name, closestScope(node, isBlockScoped ? isLexicalScope : isFunctionScope));
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      addBindingName(node.name, closestScope(node, isLexicalScope));
    } else if (ts.isClassDeclaration(node) && node.name) {
      addBindingName(node.name, closestScope(node, isLexicalScope));
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      addBindingName(node.variableDeclaration.name, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(suiteFunction);
  return bindings;
}

function isLocallyShadowed(bindingName, node, bindings) {
  return bindings.some(
    (binding) => binding.name === bindingName && binding.scope.pos <= node.pos && node.end <= binding.scope.end,
  );
}

function isDirectTestRunnerCall(
  node,
  namespaceBindings,
  namedRunBindings,
  shadowBindings,
) {
  if (!ts.isCallExpression(node)) return false;
  if (ts.isIdentifier(node.expression)) {
    return namedRunBindings.has(node.expression.text)
      && !isLocallyShadowed(node.expression.text, node.expression, shadowBindings);
  }
  if (!ts.isPropertyAccessExpression(node.expression) || !node.expression.name.text.startsWith("run")) {
    return false;
  }
  const receiverName = identifierText(unwrapExpression(node.expression.expression));
  return Boolean(
    receiverName
    && namespaceBindings.has(receiverName)
    && !isLocallyShadowed(receiverName, node.expression.expression, shadowBindings),
  );
}

export function auditBusinessLogicSuiteCoordinator(sourceText, fileName = "business-logic-suite.mjs") {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const namespaceBindings = new Set();
  const namedRunBindings = new Set();
  let directTestRunnerImports = 0;
  let directTestRunnerSideEffectImports = 0;

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!statement.moduleSpecifier.text.startsWith("./test-")) continue;
    directTestRunnerImports += 1;
    if (!statement.importClause) {
      directTestRunnerSideEffectImports += 1;
      continue;
    }
    if (statement.importClause.name) {
      namespaceBindings.add(statement.importClause.name.text);
    }
    const namedBindings = statement.importClause.namedBindings;
    if (!namedBindings) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      namespaceBindings.add(namedBindings.name.text);
      continue;
    }
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName.startsWith("run")) {
        namedRunBindings.add(element.name.text);
      }
    }
  }

  const aliasBindingNodes = addAliasBindings(sourceFile, namespaceBindings, namedRunBindings);

  const suiteFunction = sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "runBusinessLogicSuite",
  );
  if (!suiteFunction?.body) {
    throw new Error(`cannot find runBusinessLogicSuite in ${fileName}`);
  }
  const shadowBindings = localBindingScopes(
    suiteFunction,
    new Set([...namespaceBindings, ...namedRunBindings]),
    aliasBindingNodes,
  );
  let directTestRunnerCalls = 0;
  const visit = (node) => {
    if (isNestedFunctionLike(node)) return;
    if (isDirectTestRunnerCall(
      node,
      namespaceBindings,
      namedRunBindings,
      shadowBindings,
    )) {
      directTestRunnerCalls += 1;
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of suiteFunction.body.statements) visit(statement);

  return {
    directTestRunnerImports,
    directTestRunnerSideEffectImports,
    directTestRunnerCalls,
  };
}

function combine(rows) {
  return rows.reduce(
    (totals, row) => ({
      total: totals.total + row.total,
      sourceOperand: totals.sourceOperand + row.sourceOperand,
      behavioral: totals.behavioral + row.behavioral,
    }),
    { total: 0, sourceOperand: 0, behavioral: 0 },
  );
}

export function auditP1Behavior({
  coordinatorPath = COORDINATOR_PATH,
  businessLogicSuitePath = BUSINESS_LOGIC_SUITE_PATH,
} = {}) {
  const coordinator = {
    ...auditAssertionSource(fs.readFileSync(coordinatorPath, "utf8"), coordinatorPath),
    ...auditBusinessLogicSuiteCoordinator(
      fs.readFileSync(businessLogicSuitePath, "utf8"),
      businessLogicSuitePath,
    ),
  };
  const modules = coordinatorTestModules(coordinatorPath).map((file) => ({
    file: path.relative(PROJECT_ROOT, file).replaceAll("\\", "/"),
    ...auditAssertionSource(fs.readFileSync(file, "utf8"), file),
  }));
  const moduleTotals = combine(modules);
  const total = combine([coordinator, moduleTotals]);
  return {
    status: "pass",
    schemaVersion: 2,
    classifier: "scope-aware node:assert data arguments with conservative readFileSync taint",
    coordinator,
    modules: { count: modules.length, ...moduleTotals },
    total: {
      ...total,
      behavioralPercent: total.total === 0 ? 0 : Number(((total.behavioral / total.total) * 100).toFixed(2)),
    },
  };
}

export function runSelfTest() {
  const runtimeAssertMethods = Object.entries(assert)
    .filter(([name, value]) => (
      typeof value === "function"
      && !ASSERT_CONSTRUCTORS.has(name)
      && !OPTIONAL_LEGACY_ASSERT_EXPORTS.has(name)
    ))
    .map(([name]) => name)
    .sort();
  assert.deepEqual([...ASSERT_METHODS].sort(), runtimeAssertMethods);
  assert.deepEqual(
    auditAssertionSource([
      'import assert from "node:assert/strict";',
      "assert(true);",
      ...[...ASSERT_METHODS].map((method) => `assert.${method}();`),
    ].join("\n"), "assert-surface.fixture.mjs"),
    { total: 20, sourceOperand: 0, behavioral: 20 },
  );
  assert.deepEqual(
    auditAssertionSource([
      'import assert from "node:assert/strict";',
      'import { readFileSync } from "node:fs";',
      'const routeSource = readFileSync("route.ts", "utf8");',
      'assert.match(routeSource, /safe/);',
      'assert.equal(parse("7"), 7);',
      'assert.doesNotMatch(readFileSync("route.ts", "utf8"), /unsafe/);',
    ].join("\n"), "source-operands.fixture.mjs"),
    { total: 3, sourceOperand: 2, behavioral: 1 },
  );
  assert.throws(
    () => auditAssertionSource([
      'import assert from "node:assert/strict";',
      "assert.futureMethod(true);",
    ].join("\n"), "unknown-assert.fixture.mjs"),
    /unknown node:assert method "futureMethod"/,
  );
  assert.throws(
    () => auditAssertionSource([
      'import assert from "node:assert/strict";',
      'assert["futureMethod"](true);',
    ].join("\n"), "unknown-computed-assert.fixture.mjs"),
    /unknown node:assert method "futureMethod"/,
  );
  assert.throws(
    () => auditAssertionSource([
      'import { futureMethod as futureAlias } from "node:assert/strict";',
      "futureAlias(true);",
    ].join("\n"), "unknown-named-assert.fixture.mjs"),
    /unknown node:assert method "futureMethod"/,
  );
  assert.deepEqual(
    auditAssertionSource([
      'import assert, { strictEqual as same } from "node:assert/strict";',
      "const sameAlias = same;",
      "same(1, 1);",
      "sameAlias(1, 1);",
      'assert["equal"](1, 1);',
    ].join("\n"), "known-named-assert.fixture.mjs"),
    { total: 3, sourceOperand: 0, behavioral: 3 },
  );
  assert.deepEqual(
    auditAssertionSource([
      'import assert from "node:assert/strict";',
      "new assert.AssertionError({});",
      "new assert.CallTracker();",
    ].join("\n"), "assert-constructors.fixture.mjs"),
    { total: 0, sourceOperand: 0, behavioral: 0 },
  );
  assert.deepEqual(
    auditAssertionSource([
      'import assert from "node:assert/strict";',
      'import { readFileSync } from "node:fs";',
      'import { spawnSync } from "node:child_process";',
      'import { createPreview } from "./preview.mjs";',
      "function workflowJobBlock(source, jobName) {",
      '  const lines = source.replace(/\\r\\n?/g, "\\n").split("\\n");',
      "  const startIndex = lines.findIndex((line) => line === `  ${jobName}:`);",
      '  assert.notEqual(startIndex, -1, "job source must contain the requested job");',
      '  return lines.slice(startIndex).join("\\n");',
      "}",
      "function runCli(source) {",
      '  return spawnSync(process.execPath, [source], { encoding: "utf8" });',
      "}",
      'const workflowPath = ".github/workflows/ci.yml";',
      'const workflow = readFileSync(workflowPath, "utf8");',
      'const block = workflowJobBlock(workflow, "checks");',
      "const offsets = Object.fromEntries(",
      '  [["setup", "Setup Node.js"]].map(([label, token]) => [label, block.indexOf(token)]),',
      ");",
      "for (const [label, offset] of Object.entries(offsets)) {",
      "  assert.ok(offset >= -1, label);",
      "}",
      'for (const [label, tupleSource] of [["workflow", workflow], ["block", block]]) {',
      "  assert.match(tupleSource, /checks/, label);",
      "}",
      "assert.match(block, /checks/);",
      "const result = runCli(workflow);",
      "assert.deepEqual(result, { status: 0, workflow: workflowPath });",
      "{",
      '  const workflow = runCli("clean");',
      "  assert.equal(workflow.status, 0);",
      "}",
      "assert.equal(result.status, 0, workflow);",
    ].join("\n"), "transparent-scope.fixture.mjs"),
    { total: 7, sourceOperand: 4, behavioral: 3 },
  );
  assert.deepEqual(
    auditAssertionSource([
      'import assert from "node:assert/strict";',
      'import { readFileSync } from "node:fs";',
      'import { spawnSync } from "node:child_process";',
      "function runPreview(source) {",
      '  const child = spawnSync(process.execPath, ["preview"], { encoding: "utf8" });',
      "  return { status: child.status, stdout: child.stdout, echoed: source };",
      "}",
      'const source = readFileSync("route.ts", "utf8");',
      "const preview = runPreview(source);",
      "assert.equal(preview.status, 0);",
      'assert.match(preview.stdout ?? "", /pass/);',
      "assert.equal(runPreview(source).status, 0);",
      "assert.equal(createPreview(source).status, 0);",
      "assert.equal(spawnSync(process.execPath, [source]).status, 0);",
    ].join("\n"), "effect-boundary.fixture.mjs"),
    { total: 5, sourceOperand: 0, behavioral: 5 },
  );
  const modules = coordinatorTestModules(COORDINATOR_PATH).map((file) => path.basename(file));
  assert.ok(modules.includes("business-logic-suite.mjs"));
  assert.ok(modules.includes("test-business-wallet-models.mjs"));
  assert.deepEqual(
    auditBusinessLogicSuiteCoordinator([
      'import { runNamed as namedAlias } from "./test-named.mjs";',
      'import * as testNamespace from "./test-namespace.mjs";',
      'import "./test-side-effect.mjs";',
      'import { runIgnored } from "./not-a-test.mjs";',
      "const namespaceAlias = testNamespace.default ?? testNamespace;",
      "const { runDestructured: destructuredAlias } = testNamespace.default ?? testNamespace;",
      "function runBusinessLogicSuite() {",
      "  namedAlias();",
      "  testNamespace.runNamespace();",
      "  namespaceAlias.runAliased();",
      "  destructuredAlias();",
      "  function nestedHelper() {",
      "    namedAlias();",
      "    testNamespace.runNested();",
      "  }",
      "}",
    ].join("\n")),
    {
      directTestRunnerImports: 3,
      directTestRunnerSideEffectImports: 1,
      directTestRunnerCalls: 4,
    },
  );
  assert.deepEqual(
    auditBusinessLogicSuiteCoordinator([
      'import { runImported, runVariable, runFunction, runParameter, runCaught } from "./test-runners.mjs";',
      "function runBusinessLogicSuite(runParameter) {",
      "  runImported();",
      "  {",
      "    const runVariable = () => {};",
      "    runVariable();",
      "  }",
      "  function runFunction() {}",
      "  runFunction();",
      "  try {",
      "    throw new Error('synthetic');",
      "  } catch (runCaught) {",
      "    runCaught();",
      "  }",
      "  runParameter();",
      "}",
    ].join("\n")),
    {
      directTestRunnerImports: 1,
      directTestRunnerSideEffectImports: 0,
      directTestRunnerCalls: 1,
    },
  );
  assert.deepEqual(
    auditBusinessLogicSuiteCoordinator([
      'import * as testNamespace from "./test-namespace.mjs";',
      "function runBusinessLogicSuite() {",
      "  const namespaceAlias = testNamespace.default ?? testNamespace;",
      "  const { runDestructured: destructuredAlias } = testNamespace.default ?? testNamespace;",
      "  namespaceAlias.runVisible();",
      "  destructuredAlias();",
      "  {",
      "    const namespaceAlias = { runShadowed() {} };",
      "    const destructuredAlias = () => {};",
      "    namespaceAlias.runShadowed();",
      "    destructuredAlias();",
      "  }",
      "}",
    ].join("\n")),
    {
      directTestRunnerImports: 1,
      directTestRunnerSideEffectImports: 0,
      directTestRunnerCalls: 2,
    },
  );
  const selfTestDirectory = fs.mkdtempSync(path.join(PROJECT_ROOT, ".tmp-audit-p1-behavior-"));
  try {
    const isolatedCoordinatorPath = path.join(selfTestDirectory, "coordinator.mjs");
    const overriddenSuitePath = path.join(selfTestDirectory, "overridden-suite.mjs");
    fs.writeFileSync(isolatedCoordinatorPath, "");
    fs.writeFileSync(overriddenSuitePath, [
      'import { runOverridden } from "./test-overridden.mjs";',
      "export function runBusinessLogicSuite() { runOverridden(); }",
    ].join("\n"));
    const overriddenReport = auditP1Behavior({
      coordinatorPath: isolatedCoordinatorPath,
      businessLogicSuitePath: overriddenSuitePath,
    });
    assert.equal(overriddenReport.schemaVersion, 2);
    assert.deepEqual(
      {
        imports: overriddenReport.coordinator.directTestRunnerImports,
        sideEffectImports: overriddenReport.coordinator.directTestRunnerSideEffectImports,
        calls: overriddenReport.coordinator.directTestRunnerCalls,
      },
      { imports: 1, sideEffectImports: 0, calls: 1 },
    );
  } finally {
    fs.rmSync(selfTestDirectory, { recursive: true, force: true });
  }
  const report = auditP1Behavior();
  assert.equal(report.schemaVersion, 2);
  assert.ok(report.coordinator.directTestRunnerImports > 0);
  assert.ok(report.coordinator.directTestRunnerSideEffectImports <= report.coordinator.directTestRunnerImports);
  assert.ok(report.coordinator.directTestRunnerCalls > 0);
  console.log(JSON.stringify({ status: "pass", cases: 17, schemaVersion: 2 }));
}

const args = new Set(process.argv.slice(2));
if (args.has("--self-test")) {
  if (args.size !== 1) throw new Error("--self-test cannot be combined with other arguments");
  runSelfTest();
} else if (args.size > 0) {
  throw new Error(`unknown argument: ${[...args].join(" ")}`);
} else {
  console.log(JSON.stringify(auditP1Behavior()));
}
