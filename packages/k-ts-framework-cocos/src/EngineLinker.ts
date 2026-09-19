import { D, F } from "k-ts-framework";

import { cc } from "./cc.js";
import { normalizeResourcePath } from "./ResourceUtil.js";

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

// reason: cc.Bundle 的缓存查询入口在引擎版本间不统一，探测式访问可选的 get 方法
interface ResourceCacheLookup {
    get?: (path: string, type: unknown) => unknown;
}

// reason: 模块顶层不得触碰 F / cc（取 linker、读 cc.resources 都属引擎访问）——
// Creator 3.8 编辑器 executor 对跨包模块的顶层执行顺序敏感，导入绑定时可能尚未就绪；
// 预览/Node 环境无此限制。系统类与 linker 获取全部延迟到 registerEngineSystem()（装配时机），
// 此时全部模块已加载完成；getReadTextFileLinker() 的 memoized 单例语义不受延迟影响。
let registered = false;

/** 创建 cc 引擎接入系统（readTextFile 等 linker 注册，由 registerKFrameworkCocos 调用；幂等） */
export function registerEngineSystem(): void {
    if (!registered) {
        registered = true;
        // k-ts-framework 里的 F.Engine.readTextFile 是延迟占位包装，这里取真正的 linker 再装饰注册 cc 实现
        const readTextFileLinker = F.Engine.getReadTextFileLinker();

        @D.system(COCOS_ENGINE_SYSTEM_TAG)
        class CocosEngineSystem extends F.System {
            @D.linkUtil(readTextFileLinker)
            public readTextFileImpl(path: string): string {
                if (typeof jsb !== "undefined") {
                    // jsb getStringFromFile 读取失败返回空串而非 null，先查存在性（空文件是合法内容）
                    if (!jsb.fileUtils.isFileExist(path)) throw new Error(`readTextFile failed, path not exists: ${path}`);
                    return jsb.fileUtils.getStringFromFile(path);
                }

                // 非 jsb 运行时（编辑器预览/web）：尝试 resources 里已缓存的 TextAsset
                let normalizedPath = normalizeResourcePath(path);
                let cached = (cc.resources as unknown as ResourceCacheLookup).get?.(normalizedPath, cc.TextAsset) as
                    | cc.TextAsset
                    | undefined;
                if (cached) return cached.text;

                throw new Error("readTextFile: 当前运行时无文件系统且 resources 无该缓存；jsb 原生或预加载 TextAsset 可用，JSON 数据表自定义读取请用 game-data-collection 的 setJsonLoadFunc");
            }
        }

        F.System.createByTag(COCOS_ENGINE_SYSTEM_TAG);
    }
}
