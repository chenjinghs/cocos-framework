/** 测试用 jsb 全局声明：EngineLinker 的 typeof jsb 守卫在非 jsb 运行时下走 resources 缓存分支。 */

declare const jsb: {
    fileUtils: {
        getStringFromFile(path: string): string;
    };
};
