import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const PROJECT_ROOT = process.cwd();
const COORDINATOR_PATH = path.join(PROJECT_ROOT, "scripts", "test-business-logic.mjs");
const BUSINESS_LOGIC_SUITE_PATH = path.join(PROJECT_ROOT, "scripts", "business-logic-suite.mjs");
const SOURCE_EXTENSIONS = [".mjs", ".ts", ".tsx", ".js"];
const ASSERT_METHODS = new Set([
  "deepEqual", "doesNotMatch", "equal", "match", "notDeepEqual", "notEqual", "ok", "rejects", "throws",
]);

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

function isReadFileSyncExpression(node) {
  let found = false;
  const visit = (current) => {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === "readFileSync") {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function sourceBindings(sourceFile) {
  const bindings = new Set();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && isReadFileSyncExpression(node.initializer)
    ) {
      bindings.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

function isAssertCall(node) {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "assert"
    && ASSERT_METHODS.has(node.expression.name.text);
}

function isSourceOperand(node, bindings) {
  let found = false;
  const visit = (current) => {
    if (ts.isIdentifier(current) && bindings.has(current.text)) {
      found = true;
      return;
    }
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === "readFileSync") {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

export function auditAssertionSource(sourceText, fileName = "fixture.mjs") {
  const scriptKind = /\.tsx?$/i.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const bindings = sourceBindings(sourceFile);
  let total = 0;
  let sourceOperand = 0;
  const visit = (node) => {
    if (isAssertCall(node)) {
      total += 1;
      if (isSourceOperand(node, bindings)) sourceOperand += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { total, sourceOperand, behavioral: total - sourceOperand };
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
    schemaVersion: 1,
    classifier: "assert-call AST with operands bound to readFileSync",
    coordinator,
    modules: { count: modules.length, ...moduleTotals },
    total: {
      ...total,
      behavioralPercent: total.total === 0 ? 0 : Number(((total.behavioral / total.total) * 100).toFixed(2)),
    },
  };
}

export function runSelfTest() {
  assert.deepEqual(
    auditAssertionSource([
      'const routeSource = readFileSync("route.ts", "utf8");',
      'assert.match(routeSource, /safe/);',
      'assert.equal(parse("7"), 7);',
      'assert.doesNotMatch(readFileSync("route.ts", "utf8"), /unsafe/);',
    ].join("\n")),
    { total: 3, sourceOperand: 2, behavioral: 1 },
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
  assert.ok(report.coordinator.directTestRunnerImports > 0);
  assert.ok(report.coordinator.directTestRunnerSideEffectImports <= report.coordinator.directTestRunnerImports);
  assert.ok(report.coordinator.directTestRunnerCalls > 0);
  console.log(JSON.stringify({ status: "pass", cases: 7, schemaVersion: 1 }));
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
