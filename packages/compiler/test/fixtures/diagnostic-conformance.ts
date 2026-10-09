import ts from "@typescript/typescript6";

export interface ConformanceResult {
  readonly violations: ReadonlyArray<string>;
  readonly declarations: ReadonlyArray<string>;
}

const codePattern = /^EFFX(?:\d{4}|\[[^\]]+\]\/\d{4})$/;

const helpers = {
  error: true,
  warning: true,
  info: true,
  makeDiagnostic: true,
} satisfies Record<string, true>;

const propertyName = (node: ts.PropertyName): string | undefined =>
  ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;

/** Check syntax, including renamed imports; comments and documentation text are not emitters. */
export const inspectDiagnosticSource = (file: string, source: string): ConformanceResult => {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations: Array<string> = [];
  const declarations: Array<string> = [];
  const importedHelpers = new Set<string>();
  const compilerNamespaces = new Set<string>();
  const factories = new Set(["defineDiagnostic"]);

  const report = (node: ts.Node, reason: string): void => {
    const { line, character } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
    violations.push(`${file}:${line + 1}:${character + 1}: ${reason}`);
  };

  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const module = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;

    if (bindings === undefined) continue;

    const diagnosticModule =
      module === "@effx/compiler" ||
      module === "@effx/diagnostics" ||
      /(?:^|\/)Diagnostic\.ts$/.test(module);

    if (ts.isNamespaceImport(bindings) && diagnosticModule)
      compilerNamespaces.add(bindings.name.text);

    if (!ts.isNamedImports(bindings)) continue;

    for (const binding of bindings.elements) {
      const exported = (binding.propertyName ?? binding.name).text;

      if (diagnosticModule && Object.hasOwn(helpers, exported)) {
        importedHelpers.add(binding.name.text);
        report(binding, "deleted string-code helper import");
      }

      if (diagnosticModule && exported === "defineDiagnostic") factories.add(binding.name.text);
    }
  }

  const isHelper = (node: ts.Expression): boolean => {
    if (ts.isIdentifier(node)) return importedHelpers.has(node.text);

    if (ts.isPropertyAccessExpression(node))
      return (
        ts.isIdentifier(node.expression) &&
        compilerNamespaces.has(node.expression.text) &&
        Object.hasOwn(helpers, node.name.text)
      );

    if (ts.isElementAccessExpression(node))
      return (
        ts.isIdentifier(node.expression) &&
        compilerNamespaces.has(node.expression.text) &&
        node.argumentExpression !== undefined &&
        ts.isStringLiteral(node.argumentExpression) &&
        Object.hasOwn(helpers, node.argumentExpression.text)
      );

    return false;
  };
  // Follow local aliases as well as import aliases, independent of declaration order.

  let changed = true;

  while (changed) {
    changed = false;

    const aliases = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        isHelper(node.initializer) &&
        !importedHelpers.has(node.name.text)
      ) {
        importedHelpers.add(node.name.text);
        changed = true;
      }

      ts.forEachChild(node, aliases);
    };

    aliases(tree);
  }

  const isEntryObject = (node: ts.ObjectLiteralExpression): boolean => {
    const names = new Set(
      node.properties.flatMap((property) =>
        property.name === undefined ? [] : [propertyName(property.name)],
      ),
    );

    return [
      "code",
      "owner",
      "title",
      "severity",
      "severityPolicy",
      "explanation",
      "examples",
    ].every((name) => names.has(name));
  };

  const inEntryArgument = (node: ts.Node): boolean => {
    let child: ts.Node = node;

    for (let parent = node.parent; parent !== undefined; child = parent, parent = parent.parent) {
      if (
        ts.isCallExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        factories.has(parent.expression.text)
      )
        return parent.arguments[0] === child;
    }

    return false;
  };

  const isDeclaration = (node: ts.StringLiteral): boolean => {
    let child: ts.Node = node;

    for (let parent = node.parent; parent !== undefined; child = parent, parent = parent.parent) {
      if (
        ts.isObjectLiteralExpression(parent) &&
        isEntryObject(parent) &&
        ts.isPropertyAssignment(node.parent) &&
        propertyName(node.parent.name) === "code"
      )
        return true;

      if (
        ts.isCallExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        factories.has(parent.expression.text)
      )
        return parent.arguments[0] === child;
    }

    return false;
  };

  const isProjection = (properties: ReadonlyMap<string, ts.Expression>): boolean => {
    const code = properties.get("code");
    const message = properties.get("message");
    const severity = properties.get("severity");

    if (
      code === undefined ||
      message === undefined ||
      !ts.isPropertyAccessExpression(code) ||
      !ts.isPropertyAccessExpression(message) ||
      code.name.text !== "code" ||
      message.name.text !== "message"
    )
      return false;
    const origin = code.expression.getText(tree);

    return (
      message.expression.getText(tree) === origin &&
      (severity === undefined ||
        (ts.isPropertyAccessExpression(severity) &&
          severity.name.text === "severity" &&
          severity.expression.getText(tree) === origin))
    );
  };

  const isSchemaFields = (node: ts.ObjectLiteralExpression): boolean => {
    const parent = node.parent;

    return (
      ts.isCallExpression(parent) &&
      parent.arguments[0] === node &&
      ts.isPropertyAccessExpression(parent.expression) &&
      parent.expression.expression.getText(tree) === "Schema" &&
      ["Struct", "TaggedStruct", "TaggedUnion"].includes(parent.expression.name.text)
    );
  };

  const isWireDecoderFixture = (node: ts.ObjectLiteralExpression): boolean => {
    const parent = node.parent;

    if (
      !ts.isCallExpression(parent) ||
      parent.arguments[0] !== node ||
      !ts.isCallExpression(parent.expression)
    )
      return false;
    const decoder = parent.expression.expression;

    return (
      ts.isPropertyAccessExpression(decoder) &&
      decoder.expression.getText(tree) === "Schema" &&
      ["decodeEffect", "decodeUnknownEffect", "decodeUnknownSync", "decodeSync"].includes(
        decoder.name.text,
      ) &&
      parent.expression.arguments[0]?.getText(tree) === "Diagnostic"
    );
  };

  // Runtime definitions already own code/message; this one adapter restores canonical severity.
  const isRuntimeProjection = (node: ts.ObjectLiteralExpression): boolean => {
    if (file !== "packages/compiler/src/annotation.ts" || node.properties.length !== 2)
      return false;

    const spread = node.properties.find(ts.isSpreadAssignment);

    const severity = node.properties.find(
      (property) => ts.isPropertyAssignment(property) && propertyName(property.name) === "severity",
    );

    if (
      spread?.expression.getText(tree) !== "problem" ||
      severity === undefined ||
      !ts.isPropertyAssignment(severity)
    )
      return false;

    if (
      ![
        'RuntimeDiagnostics["EFFX1301"].entry.severity',
        "RuntimeDiagnostics['EFFX1301'].entry.severity",
      ].includes(severity.initializer.getText(tree))
    )
      return false;

    for (
      let parent: ts.Node | undefined = node.parent;
      parent !== undefined;
      parent = parent.parent
    ) {
      if (
        ts.isArrowFunction(parent) ||
        ts.isFunctionExpression(parent) ||
        ts.isFunctionDeclaration(parent)
      ) {
        const declaration = parent.parent;

        return (
          ts.isVariableDeclaration(declaration) &&
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === "definitionDiagnostics"
        );
      }
    }

    return false;
  };

  // Numeric protocol severity is a different representation, not a compiler finding override.
  const isProtocolProjection = (
    node: ts.ObjectLiteralExpression,
    properties: ReadonlyMap<string, ts.Expression>,
  ): boolean => {
    const owner = node.parent;

    if (
      !ts.isVariableDeclaration(owner) ||
      owner.type === undefined ||
      !ts.isTypeReferenceNode(owner.type)
    )
      return false;

    const name = owner.type.typeName.getText(tree);

    const declaration = tree.statements.find(
      (statement) =>
        (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) &&
        statement.name.text === name,
    );

    const members =
      declaration !== undefined && ts.isInterfaceDeclaration(declaration)
        ? declaration.members
        : declaration !== undefined &&
            ts.isTypeAliasDeclaration(declaration) &&
            ts.isTypeLiteralNode(declaration.type)
          ? declaration.type.members
          : undefined;

    const severity = members?.find(
      (member) => member.name !== undefined && propertyName(member.name) === "severity",
    );

    if (severity === undefined || !ts.isPropertySignature(severity) || severity.type === undefined)
      return false;

    const types = ts.isUnionTypeNode(severity.type) ? severity.type.types : [severity.type];

    if (
      !types.every(
        (type) =>
          type.kind === ts.SyntaxKind.NumberKeyword ||
          (ts.isLiteralTypeNode(type) && ts.isNumericLiteral(type.literal)),
      )
    )
      return false;

    const code = properties.get("code");
    const message = properties.get("message");
    const source = properties.get("source");

    if (
      code === undefined ||
      !ts.isPropertyAccessExpression(code) ||
      code.name.text !== "code" ||
      message === undefined ||
      source === undefined ||
      !ts.isStringLiteral(source) ||
      source.text !== "effx"
    )
      return false;

    const origin = code.expression.getText(tree);

    const referencesMessage = (part: ts.Node): boolean =>
      (ts.isPropertyAccessExpression(part) &&
        part.name.text === "message" &&
        part.expression.getText(tree) === origin) ||
      ts.forEachChild(part, referencesMessage) === true;

    return referencesMessage(message);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) && codePattern.test(node.text) && isDeclaration(node))
      declarations.push(node.text);

    if (
      ts.isCallExpression(node) &&
      (isHelper(node.expression) ||
        (ts.isIdentifier(node.expression) &&
          Object.hasOwn(helpers, node.expression.text) &&
          node.arguments.some((arg) => ts.isStringLiteral(arg) && codePattern.test(arg.text))))
    )
      report(node, "string-code diagnostic helper call");

    if (
      ts.isObjectLiteralExpression(node) &&
      !isEntryObject(node) &&
      !inEntryArgument(node) &&
      !isSchemaFields(node) &&
      !isWireDecoderFixture(node) &&
      !isRuntimeProjection(node)
    ) {
      const properties = new Map(
        node.properties.flatMap((property): Array<[string, ts.Expression]> => {
          if (ts.isPropertyAssignment(property)) {
            const name = propertyName(property.name);

            return name === undefined ? [] : [[name, property.initializer]];
          }

          if (ts.isShorthandPropertyAssignment(property))
            return [[property.name.text, property.name]];

          return [];
        }),
      );

      const code = properties.get("code");

      const construction =
        properties.has("message") &&
        code !== undefined &&
        (properties.has("severity") || (ts.isStringLiteral(code) && codePattern.test(code.text)));

      const overwrite =
        node.properties.some(ts.isSpreadAssignment) &&
        ["code", "message", "severity"].some((key) => properties.has(key));

      const leafFactory =
        file === "packages/diagnostics/src/definition.ts" &&
        properties.get("code")?.getText(tree) === "entry.code" &&
        properties.get("message")?.getText(tree) === "render(params)";

      if (
        (construction || overwrite) &&
        !leafFactory &&
        !isProjection(properties) &&
        !isProtocolProjection(node, properties)
      )
        report(node, "raw Diagnostic construction or override");
    }

    ts.forEachChild(node, visit);
  };

  visit(tree);

  return { violations, declarations };
};
