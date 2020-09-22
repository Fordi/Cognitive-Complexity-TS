import * as ts from "typescript";
import { UnreachableNodeState } from "../util/node-util";
import {
    getIdentifier,
    FunctionNode,
    isFunctionNode
} from "./node-inspection";

export function chooseContainerName(node: ts.Node, variableBeingDefined: string): string | undefined {
    if (isFunctionNode(node)) {
        return getFunctionNodeName(node, variableBeingDefined);
    }

    if (ts.isClassDeclaration(node)) {
        return getClassDeclarationName(node);
    }

    if (ts.isClassExpression(node)) {
        return getClassExpressionName(node, variableBeingDefined);
    }

    const name = findIntroducedName(node);
    if (name !== undefined) {
        return name;
    }

    if (ts.isModuleDeclaration(node)) {
        return getModuleDeclarationName(node);
    }

    if (ts.isTypeAliasDeclaration(node)) {
        return getTypeAliasName(node);
    }

    return undefined;
}

export function findIntroducedName(node: ts.Node): string | undefined {
    if (ts.isClassDeclaration(node)) {
        return getClassDeclarationName(node);
    }

    if (ts.isClassExpression(node)) {
        return getClassExpressionName(node);
    }

    if (ts.isConstructorDeclaration(node)) {
        return "constructor";
    }

    if (ts.isInterfaceDeclaration(node)) {
        return getInterfaceDeclarationName(node);
    }

    if (isFunctionNode(node)) {
        return getFunctionNodeName(node);
    }

    return undefined;
}

export function getNameIfCalledNode(node: ts.Node): string | undefined {
    if (ts.isCallExpression(node)) {
        return getCalledFunctionName(node);
    }

    if (ts.isNewExpression(node)) {
        return getNewedConstructorName(node);
    }

    if (ts.isPropertyAccessExpression(node)) {
        return getPropertyAccessName(node);
    }

    if (ts.isJsxOpeningLikeElement(node)) {
        return node.getChildAt(1).getText();
    }

    if (ts.isTypeReferenceNode(node)) {
        return node.getChildAt(0).getText();
    }

    if (ts.isTaggedTemplateExpression(node)) {
        return node.getChildAt(0).getText();
    }

    return undefined;
}

export function getNameIfNameDeclaration(node: ts.Node): string | undefined {
    if (ts.isVariableDeclaration(node)
        || ts.isCallSignatureDeclaration(node)
        || ts.isBindingElement(node)
        || ts.isTypeElement(node)
        || ts.isEnumDeclaration(node)
        || ts.isEnumMember(node)
    ) {
        const identifier = node.getChildAt(0).getText();
        return identifier;
    }

    if (ts.isPropertyDeclaration(node)) {
        return getIdentifier(node);
    }

    if (ts.isTypeAliasDeclaration(node)) {
        return getTypeAliasName(node);
    }

    return undefined;
}

function getIdentifierDespiteBrackets(node: ts.Node): string | undefined {
    if (ts.isIdentifier(node)) {
        return node.getText();
    }

    if (ts.isParenthesizedExpression(node)) {
        return getIdentifierDespiteBrackets(node.getChildAt(1));
    }

    return undefined;
}

function getCalledFunctionName(node: ts.CallExpression): string {
    const children = node.getChildren();
    const expressionToCall = children[0];
    const name = getIdentifierDespiteBrackets(expressionToCall);

    return name ?? "";
}

function getClassDeclarationName(node: ts.ClassDeclaration): string {
    const name = getIdentifier(node);
    return name ?? ""; // anonymous class
}

function getClassExpressionName(
    node: ts.ClassExpression,
    variableBeingDefined: string | undefined = undefined
): string | undefined {
    const firstChild = node.getChildAt(1);
    if (ts.isIdentifier(firstChild)) {
        return firstChild.getText();
    }

    return variableBeingDefined ?? undefined;
}

function getFunctionNodeName(
    func: FunctionNode,
    variableBeingDefined: string | undefined = undefined
): string {
    if (ts.isAccessor(func)) {
        return func.getChildAt(1).getText();
    }

    if (ts.isArrowFunction(func)) {
        return variableBeingDefined ?? "";
    }

    if (ts.isFunctionDeclaration(func)) {
        const functionKeywordIndex = func.getChildren()
            .findIndex(node => node.kind === ts.SyntaxKind.FunctionKeyword);
        const identifier = func.getChildAt(functionKeywordIndex + 1);

        return identifier.getText();
    }

    if (ts.isFunctionExpression(func)) {
        const maybeIdentifier = func.getChildren()[1];
        if (ts.isIdentifier(maybeIdentifier)) {
            return maybeIdentifier.getText();
        } else {
            return variableBeingDefined ?? "";
        }
    }

    if (ts.isMethodDeclaration(func)) {
        const name = getIdentifier(func);

        if (name !== undefined) {
            return name;
        }

        throw new UnreachableNodeState(func, "Method has no identifier.");
    }

    throw new UnreachableNodeState(func, "FunctionNode is not of a recognised type.");
}

function getInterfaceDeclarationName(node: ts.InterfaceDeclaration): string {
    return node.getChildAt(1).getText();
}

function getModuleDeclarationName(node: ts.ModuleDeclaration): string {
    const moduleIdentifier = node.getChildren().find(node => ts.isIdentifier(node));
    if (!moduleIdentifier) {
        throw new UnreachableNodeState(node, "Module declaration has no identifier.");
    }
    return moduleIdentifier.getText();
}

function getNewedConstructorName(node: ts.NewExpression): string {
    const name = getIdentifierDespiteBrackets(node.getChildAt(1));
    if (name !== undefined) {
        return name;
    }

    throw new UnreachableNodeState(node, "Newed constructor does not have a name.");
}

function getPropertyAccessName(node: ts.PropertyAccessExpression): string {
    const expressionNodes = node.getChildren();
    const identifier = expressionNodes[expressionNodes.length - 1];
    return identifier.getText();
}

function getTypeAliasName(node: ts.TypeAliasDeclaration): string {
    return node.getChildAt(1).getText();
}
