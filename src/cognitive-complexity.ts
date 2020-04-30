import * as ts from "typescript"
import { FileOutput, FunctionOutput, ScoreAndInner } from "./types";
import { sum } from "./util";
import { isFunctionNode, isBreakOrContinueToLabel, getColumnAndLine, getFunctionNodeName, getClassDeclarationName, getModuleDeclarationName, getCalledFunctionName, getDeclarationName, isNamedDeclarationOfContainer } from "./node-inspection";
import { whereAreChildren } from "./depth";

// function for file cost returns FileOutput
export function fileCost(file: ts.SourceFile): FileOutput {
    // TODO can I just call nodeCost(file)
    const childCosts = file.getChildren()
        .map(elem => nodeCost(elem, true)); // using an arrow so it shows up in call hierarchy

    // score is sum of score for all child nodes
    const score = childCosts
        .map(childNode => childNode.score)
        .reduce(sum, 0);

    // inner is concat of all functions declared directly under every child node
    const inner = childCosts.map(childNode => childNode.inner).flat();

    return {
        inner,
        score,
    };
}

function nodeCost(
    node: ts.Node,
    topLevel: boolean,
    depth = 0,
    namedAncestors = [] as ReadonlyArray<string>,
): ScoreAndInner {
    let score = 0;

    // TODO write isSequenceOfBinaryOperators to check whether to do an inherent increment
    // BinaryExpressions have 1 child that is the operator
    // BinaryExpressions have their last child as a sub expression
    // can just consume the entire sequence of the same operator
    // then continue traversing from the next different operator in the sequence,
    // which presumably will be given another inherent increment by the next call to calcNodeCost
    // should redundant brackets be ignored? or do they end a sequence?
    // probably the latter, which would also be easier

    // TODO check if ConstructorDeclaration and AccessorDeclaration (get,set) need to be added separately

    // certain language features carry and inherent cost
    if (ts.isCatchClause(node)
        || ts.isConditionalExpression(node)
        || ts.isDoStatement(node)
        || ts.isForInStatement(node)
        || ts.isForOfStatement(node)
        || ts.isForStatement(node)
        || ts.isSwitchStatement(node)
        || ts.isWhileStatement(node)
        || isBreakOrContinueToLabel(node)
    ) {
        score += 1;
    } else if (ts.isBinaryExpression(node)
        // the parent does not use the same operator as this node
        && node.parent.getChildAt(1)?.kind != node.getChildAt(1).kind
    ) {
        score += 1;
    } else if (ts.isCallExpression(node)) {
        const calledFunctionName = getCalledFunctionName(node);
        for (const name of namedAncestors) {
            if (name === calledFunctionName) {
                score += 1;
                break;
            }
        }
    }

    // An `if` may contain an else keyword followed by else code.
    // An `else if` is just the else keyword followed by an if statement.
    // Therefore this block is entered for both `if` and `else if`.
    else if (ts.isIfStatement(node)) {
        // increment for `if` and `else if`
        score += 1;

        // increment for solo else
        const children = node.getChildren();
        const elseIndex = children.findIndex(child => child.kind === ts.SyntaxKind.ElseKeyword);
        if (elseIndex !== -1) {
            const elseIf = ts.isIfStatement(children[elseIndex + 1]);
            if (!elseIf) {
                score += 1;
            }
        }
    }

    // increment for nesting level
    if (depth > 0) {
        if (ts.isCatchClause(node)
            || ts.isConditionalExpression(node)
            || ts.isDoStatement(node)
            || ts.isForInStatement(node)
            || ts.isForOfStatement(node)
            || ts.isForStatement(node)
            || ts.isSwitchStatement(node)
            || ts.isWhileStatement(node)
            || (

            // increment for `if`, but not `else if`
            // The parent of the `if` within an `else if`
            // is the `if` the `else` belongs to.
            // However `if (...) if (...)` is treated as false here
            // even though technically there should be 2 increments.
            // This quirky syntax produces the same score as using `&&`,
            // so maybe it doesn't matter.
            ts.isIfStatement(node) && !ts.isIfStatement(node.parent)
            )
        ) {
            score += depth;
        }
    }

    // TODO use separate functions for score and inner

    // The inner functions of a node is defined as the concat of:
    // * all child nodes that are functions/namespaces/classes
    // * all functions declared directly under a non function child node
    const inner = [] as FunctionOutput[];

    // get the ancestors function names from the perspective of this node's children
    const namedAncestorsOfChildren = maybeAddNodeToNamedAncestors(node, namedAncestors);

    function aggregateScoreAndInnerForChildren(nodesInsideNode: ts.Node[], localDepth: number, topLevel: boolean) {
        for (const child of nodesInsideNode) {
            const childCost = nodeCost(child, topLevel, localDepth, namedAncestorsOfChildren);

            score += childCost.score;

            let name: string;

            // a function/class/namespace is part of the inner scope we want to output
            if (isFunctionNode(child)) {
                const variableBeingDefined = namedAncestorsOfChildren[namedAncestorsOfChildren.length - 1];
                name = getFunctionNodeName(child, variableBeingDefined);
            } else if (ts.isClassDeclaration(child)) {
                name = getClassDeclarationName(child);
            } else if (ts.isModuleDeclaration(child)) {
                name = getModuleDeclarationName(child);
            } else {
                // the child's inner is all part of this node's direct inner scope
                inner.push(...childCost.inner);
                continue;
            }

            inner.push({
                ...getColumnAndLine(child),
                ...childCost,
                name,
            });
        }
    }

    // Aggregate score of this node's children.
    // Aggregate the inner functions of this node's children.
    const { same, below } = whereAreChildren(node);

    if (topLevel) {
        aggregateScoreAndInnerForChildren(same, depth, topLevel);
        aggregateScoreAndInnerForChildren(below, depth, false);
    } else {
        aggregateScoreAndInnerForChildren(same, depth, false);
        aggregateScoreAndInnerForChildren(below, depth + 1, false);
    }

    return {
        inner,
        score,
    };
}

export function maybeAddNodeToNamedAncestors(
    node: ts.Node,
    ancestorsOfNode: ReadonlyArray<string>
): ReadonlyArray<string> {
    if (isNamedDeclarationOfContainer(node)) {
        return [...ancestorsOfNode, getDeclarationName(node)];
    }

    if (isFunctionNode(node)) {
        const nodeNameIfCallable = getFunctionNodeName(node);

        if (nodeNameIfCallable !== undefined && nodeNameIfCallable.length !== 0) {
            return [...ancestorsOfNode, nodeNameIfCallable];
        }
    }

    return ancestorsOfNode;
}
