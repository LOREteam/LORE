import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const PROJECT_ROOT = process.cwd();
const COORDINATOR_PATH = path.join(PROJECT_ROOT, "scripts", "test-business-logic.mjs");
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
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier.startsWith("./")) modules.add(resolveRelativeModule(filePath, specifier));
  }
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

export function auditP1Behavior({ coordinatorPath = COORDINATOR_PATH } = {}) {
  const coordinator = auditAssertionSource(fs.readFileSync(coordinatorPath, "utf8"), coordinatorPath);
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
  console.log(JSON.stringify({ status: "pass", cases: 2, schemaVersion: 1 }));
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
