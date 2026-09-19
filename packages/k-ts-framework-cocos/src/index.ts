import { F } from "k-ts-framework";

import { cc, ccclass } from "./cc.js";
import { newByteArray } from "./ByteArray.js";
import { registerAsyncLoadSubscriber } from "./AsyncLoad.js";
import { registerDelegateSubscriber } from "./DelegateEvent.js";
import { registerEngineSystem } from "./EngineLinker.js";

export * from "./cc.js";
export * from "./ResourceUtil.js";
export * from "./NodeUtil.js";
export * from "./PrefabProxy.js";
export * from "./EventWrapper.js";
export * from "./DelegateEvent.js";
export * from "./ByteArray.js";
export * from "./AsyncLoad.js";
export * from "./EngineLinker.js";

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
@ccclass("KFrameworkBootstrap")
export class KFrameworkBootstrap extends cc.Component {
    public onLoad(): void {
        registerKFrameworkCocos();
    }
}
