/**
 * 框架内所有引擎触点的唯一收口：其余模块只允许从本模块取 cc。
 * 测试通过 tsconfig paths 把 "cc" 指到 fake 实现即可整体注入。
 */
import * as cc from "cc";

export { cc };

type CocosClassDecorator = (target: new (...args: never[]) => unknown) => unknown;

// 4.0 起 ccclass 在 cc 顶层导出；3.8 仅在 _decorator 下提供。运行期特性探测，不做版本嗅探。
const ccclassImpl: (name?: string) => CocosClassDecorator =
    typeof cc.ccclass === "function" ? cc.ccclass : cc._decorator.ccclass;

/**
 * 双版本组件装饰器。
 * 3.8 从 node_modules 加载时模块没有编辑器注册帧，注册会抛错 —— 此时降级为透传并告警：
 * 框架功能一律走 registerKFrameworkCocos()/registerCocosUI() 代码装配，不依赖组件注册成功。
 */
export function ccclass(name?: string): ClassDecorator {
    return (target) => {
        try {
            const replaced = ccclassImpl(name)(target as unknown as new (...args: never[]) => unknown);
            if (typeof replaced === "function") return replaced as typeof target;
        } catch (err) {
            console.warn(`[k-ts-framework-cocos] ccclass("${name}") 注册失败,降级为透传`, err);
        }
        return target;
    };
}
