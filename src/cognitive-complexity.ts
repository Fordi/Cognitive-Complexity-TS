import * as ts from "typescript";
import { OutputElem, OutputFileElem } from "./types";
import { throwingIterator } from "./util";

interface ScoreAndInner {
    inner: OutputElem[];
    score: number;
}

class UnexpectedNodeError extends Error {
    constructor(public readonly node: ts.Node) {
        super("Unexpected Node");
    }
}

function calcElemCost(node: ts.Node, depth = 0): OutputElem {
    const inner = [] as OutputElem[];

    let score = 0;
    for (const child of node.getChildren()) {
        const elem = calcElemCost(child);
        score += elem.score;
        inner.push(elem);
    }

    const { line, character: column } = node.getSourceFile()
        .getLineAndCharacterOfPosition(node.getStart());

    const nodeCost = new NodeCost(node, depth);
    score += nodeCost.score;
    inner.push(...nodeCost.inner);

    return {
        name: node.getFullText(), // todo make this match the function etc
        score,
        line,
        column,
        inner,
    }
}

export function calcFileCost(file: ts.Node): OutputFileElem {
    const inner = [] as OutputElem[];

    let score = 0;
    for (const child of file.getChildren()) {
        const elem = calcElemCost(child);
        score += elem.score;
        inner.push(elem);
    }

    return {
        inner,
        score,
    }
}

abstract class AbstractNodeCost {
    protected _score = 0;
    public readonly inner = [] as OutputElem[];

    constructor(
        protected node: ts.Node,
        protected depth: number
    ) {
        this.calculate();
    }

    // can probs put depth in the constructor as readonly
    // maybe make this get called in the constructor
    protected abstract calculate(): void;

    protected include(node: ts.Node, depth: number) {
        const { inner, score } = new NodeCost(node, depth);
        this.inner.push(...inner);
        this._score += score;
    }

    protected includeAll(nodes: ts.Node[], depth: number) {
        for (const child of nodes) {
            this.include(child, depth);
        }
    }

    get score(): number {
        return this._score;
    }
}

class NodeCost extends AbstractNodeCost {

    protected calculate() {
        const depth = this.depth;
        const node = this.node;
        // certain langauge features carry and inherent cost
        if (ts.isCatchClause(node)
            || ts.isConditionalExpression(node)
            || ts.isForInStatement(node)
            || ts.isForOfStatement(node)
            || ts.isForStatement(node)
            || ts.isIfStatement(node)
            || ts.isSwitchStatement(node)
            || ts.isWhileStatement(node)
            || isBreakOrContinueToLabel(node)
        ) {
            this._score += 1;
        }

        // increment for nesting level
        if (depth > 0 && (
            ts.isConditionalExpression(node)
            || ts.isForInStatement(node)
            || ts.isForOfStatement(node)
            || ts.isForStatement(node)
            || ts.isIfStatement(node)
            || ts.isSwitchStatement(node)
            || ts.isWhileStatement(node)
        )) {
            this._score += depth;
        }

        // TODO write isSequenceOfBinaryOperators to check whether to do an inherent increment
        // BinaryExpressions have 1 child that is the operator
        // BinaryExpressions have their last child as a sub expression
        // can just consume the entire sequence of the same operator
        // then continue traversing from the next different operator in the sequence,
        // which presumably will be given another inherent increment by the next call to calcNodeCost
        // should redundant brackets be ignored? or do they end a sequence?
        // probably the latter, which would also be easier

        // certain structures increment depth for their child nodes
        if (ts.isForInStatement(node)
            || ts.isForOfStatement(node)
            || ts.isForStatement(node)
            || (
                depth !== 0
                && (
                    ts.isArrowFunction(node)
                    || ts.isFunctionDeclaration(node)
                    || ts.isFunctionExpression(node)
                    || ts.isMethodDeclaration(node)
                )
            )
        ) {
            // TODO some of the children will have the same depth, some will be depth + 1
            // the condition of an if/do has the same depth
            // the block/statement has depth + 1

        } else if (ts.isCatchClause(node)) {
            this.includeAll(node.getChildren(), depth + 1);

        } else if (ts.isConditionalExpression(node)) {
            const { inner, score } = new ConditionalExpressionCost(node, depth);
            this.inner.push(...inner);
            this._score += score;

        } else if (ts.isDoStatement(node)) {
            const { inner, score } = new DoStatementCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else if (ts.isIfStatement(node)) {
            const { inner, score } = new IfStatementCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else if (ts.isSwitchStatement(node)) {
            const { inner, score } = new SwitchStatementCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else if (ts.isWhileStatement(node)) {
            const { inner, score } = new WhileStatementCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else {
            this.includeAll(node.getChildren(), depth);
        }
    }
}

class ConditionalExpressionCost extends AbstractNodeCost {

    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        let childNodesToAggregate = [] as ts.Node[];

        for (const child of node.getChildren()) {
            if (ts.isToken(child) && child.kind === ts.SyntaxKind.QuestionToken) {
                // aggregate condition
                this.includeAll(childNodesToAggregate, depth);
                childNodesToAggregate = [];

            } else if (ts.isToken(child) && child.kind === ts.SyntaxKind.ColonToken) {
                // aggregate then
                this.includeAll(childNodesToAggregate, depth + 1);
                childNodesToAggregate = [];

            } else {
                childNodesToAggregate.push();
            }
        }

        // aggregate else
        this.includeAll(childNodesToAggregate, depth);

        return {
            score: this._score,
            inner: this.inner,
        }
    }
}

class DoStatementCost extends AbstractNodeCost {

    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const nextChild = throwingIterator(node.getChildren().values());

        const child = nextChild();
        if (ts.isToken(child) && child.kind === ts.SyntaxKind.DoKeyword) {
            // aggregate block
            this.include(nextChild(), depth + 1);
            // consume while keyword
            nextChild();
            // consume open paren
            nextChild();
            // aggregate condition
            this.include(nextChild(), depth);
        } else {
            throw new UnexpectedNodeError(child);
        }
    }
}

class IfStatementCost extends AbstractNodeCost {

    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const nextChild = throwingIterator(node.getChildren().values());

        while (true) {
            const child = nextChild();
            if (ts.isToken(child) && child.kind === ts.SyntaxKind.IfKeyword) {
                // consume open parenthesis
                nextChild();
                // aggregate condition
                this.include(nextChild(), depth);
            } else if (ts.isToken(child) && child.kind === ts.SyntaxKind.CloseParenToken) {
                // aggregate then
                this.include(nextChild(), depth + 1);
            } else if (ts.isToken(child) && child.kind === ts.SyntaxKind.ElseKeyword) {
                // aggregate else
                this.include(nextChild(), depth + 1);
                break;
            } else {
                throw new UnexpectedNodeError(child);
            }
        }
    }
}

class SwitchStatementCost extends AbstractNodeCost {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const nextChild = throwingIterator(node.getChildren().values());

        // consume switch keyword
        nextChild();
        // consume open parenthesis
        nextChild();
        // aggregate condition
        this.include(nextChild(), depth);
        // consume close parenthesis
        nextChild();
        // consume cases
        this.include(nextChild(), depth + 1);
    }
}

class WhileStatementCost extends AbstractNodeCost {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const nextChild = throwingIterator(node.getChildren().values());

        while (true) {
            const child = nextChild();
            if (ts.isToken(child) && child.kind === ts.SyntaxKind.WhileKeyword) {
                // consume open parenthesis
                nextChild();
                // aggregate condition
                this.include(nextChild(), depth);
            } if (ts.isToken(child) && child.kind === ts.SyntaxKind.CloseParenToken) {
                // aggregate loop code
                this.include(nextChild(), depth + 1);
                break;
            } else {
                throw new UnexpectedNodeError(child);
            }
        }
    }
}

function isBreakOrContinueToLabel(node: ts.Node): boolean {
    if (ts.isBreakOrContinueStatement(node)) {
        for (const child of node.getChildren()) {
            if (ts.isIdentifier(child)) {
                return true;
            }
        }
    }

    return false;
}
