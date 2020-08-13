import { CognitiveComplexityUi } from "./CognitiveComplexityUi";
import { FolderOutput } from "../../../shared/types";
import { element } from "../framework";
import { ToggleableBox } from "./generic/ToggleableBox";

export function FolderComplexity(name: string, complexity: FolderOutput, isTopLevel: boolean): Node {
    return ToggleableBox(
        [element("p", {}, [name])],
        CognitiveComplexityUi(complexity, false),
        isTopLevel,
    );
}
