import { D, F } from "k-ts-framework";

import { cc } from "./cc";
import { normalizeResourcePath } from "./ResourceUtil";

export const COCOS_ENGINE_SYSTEM_TAG = "CocosEngineSystemTag";

// reason: 在包含 namespace F/Engine 增强（如 ByteArray.ts 的 NewByteArray）的编译单元里，
// F.Engine 会解析到增强命名空间而非 k-ts-framework 的 Engine 类，此处同步声明 readTextFile 系列保证可见性。
declare module "k-ts-framework" {
    export namespace F {
        export namespace Engine {
            export function readTextFile(path: string): string;
            export function getReadTextFileLinker(): (path: string) => string;
        }
    }
}

// k-ts-framework 里的 F.Engine.readTextFile 是延迟占位包装，这里取真正的 linker 再装饰注册 cc 实现
const readTextFileLinker = F.Engine.getReadTextFileLinker();

// reason: cc.Bundle 的缓存查询入口在引擎版本间不统一，探测式访问可选的 get 方法
interface ResourceCacheLookup {
    get?: (path: string, type: unknown) => unknown;
}
const resourcesCacheLookup = cc.resources as unknown as ResourceCacheLookup;

@D.system(COCOS_ENGINE_SYSTEM_TAG)
class CocosEngineSystem extends F.System {
    @D.linkUtil(readTextFileLinker)
    public readTextFileImpl(path: string): string {
        if (typeof jsb !== "undefined") {
            let content = jsb.fileUtils.getStringFromFile(path);
            if (content === null) throw new Error(`readTextFile failed, path not exists: ${path}`);
            return content;
        }

        // 非 jsb 运行时（编辑器预览/web）：尝试 resources 里已缓存的 TextAsset
        let normalizedPath = normalizeResourcePath(path);
        let cached = resourcesCacheLookup.get?.(normalizedPath, cc.TextAsset) as cc.TextAsset | undefined;
        if (cached) return cached.text;

        throw new Error("readTextFile: file system unavailable in this runtime, inject via F.Engine.readTextFile linker override");
    }
}

/** 创建 cc 引擎接入系统（readTextFile 等 linker 注册，由 registerKFrameworkCocos 调用） */
export function registerEngineSystem(): void {
    F.System.createByTag(COCOS_ENGINE_SYSTEM_TAG);
}
