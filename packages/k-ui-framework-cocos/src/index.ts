import { F } from "k-ts-framework";
import { cc, registerKFrameworkCocos } from "k-ts-framework-cocos";

import { attachUIRootToScene } from "./CocosUISystem";
import { UI_SYSTEM_TAGS_FOR_COCOS } from "./Define";

export * from "./Define";
export * from "./CocosUISystem";
export * from "./WidgetSearcher";
export * from "./PrefabProxyEx";
export * from "./DecoratorExtension";

let registered = false;

/**
 * 装配 k-ui-framework 的 Cocos 接入：
 * 注册核心 UI 系统与 Cocos 引擎系统（8 个 UIEngineInterface linker）。
 * 幂等，可重复调用。
 */
export function registerCocosUI(): void {
    if (registered) return;
    registered = true;

    registerKFrameworkCocos();
    F.System.createByTag(UI_SYSTEM_TAGS_FOR_COCOS);
}

/**
 * 场景接入组件：挂到场景任一节点，onLoad 时自动完成 registerCocosUI() 并创建 UIRoot 子树。
 */
@cc.ccclass("CocosUISystem")
export class CocosUISystemComponent extends cc.Component {
    public onLoad(): void {
        registerCocosUI();
        attachUIRootToScene();
    }
}
