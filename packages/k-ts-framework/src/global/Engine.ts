import { createUtilLinker } from "../misc/UtilLinker";

/**
 * 为了给其他插件扩展engine接口用
 */
export class Engine {
    private static readTextFileLinker: ((path: string) => string) | undefined;

    /**
     * 同步读取文本文件。
     * 实现经 linker 注入（如 k-ts-framework-cocos 的 jsb.fileUtils / resources 缓存实现），
     * linker 延迟到首次调用时创建 —— 模块导入期 Env.current 可能尚未设置。
     */
    public static readTextFile(path: string): string {
        return (Engine.readTextFileLinker ??= createUtilLinker<(path: string) => string>())(path);
    }

    /**
     * 获取 readTextFile 的底层 linker，供引擎接入包以 D.linkUtil 注册实现。
     * @internal
     */
    public static getReadTextFileLinker(): (path: string) => string {
        return (Engine.readTextFileLinker ??= createUtilLinker<(path: string) => string>());
    }
}
