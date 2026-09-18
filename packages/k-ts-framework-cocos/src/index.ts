import { F } from "k-ts-framework";

import { cc } from "./cc";
import { newByteArray } from "./ByteArray";
import { registerAsyncLoadSubscriber } from "./AsyncLoad";
import { registerDelegateSubscriber } from "./DelegateEvent";
import { registerEngineSystem } from "./EngineLinker";

export * from "./cc";
export * from "./ResourceUtil";
export * from "./NodeUtil";
export * from "./PrefabProxy";
export * from "./EventWrapper";
export * from "./DelegateEvent";
export * from "./ByteArray";
export * from "./AsyncLoad";
export * from "./EngineLinker";

let registered = false;

/**
 * 装配 k-ts-framework 的 Cocos 接入：
 * 注册 ByteArray 实现、事件/异步加载订阅器、引擎 linker 系统。
 * 幂等，可重复调用。
 */
export function registerKFrameworkCocos(): void {
    if (registered) return;

    // reason: NewByteArray 由 declare module 声明为 ambient function（只读类型层），运行时静态赋值需收窄
    const engineStatics = F.Engine as unknown as { NewByteArray: () => unknown };
    engineStatics.NewByteArray = newByteArray;
    registerDelegateSubscriber();
    registerAsyncLoadSubscriber();
    registerEngineSystem();
    // 全部注册成功后才置位：中途抛错（如重复注册断言）不留下半装配状态
    registered = true;
}

/**
 * 场景接入组件：挂到场景任一节点，onLoad 时自动完成 registerKFrameworkCocos()。
 */
@cc.ccclass("KFrameworkBootstrap")
export class KFrameworkBootstrap extends cc.Component {
    public onLoad(): void {
        registerKFrameworkCocos();
    }
}
