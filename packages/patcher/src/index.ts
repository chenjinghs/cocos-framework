/**
 * patcher 引擎无关核心：契约（Define）、补丁流程（Patcher）、多语言（Localization）、插件（Plugin）
 * 与可注入的工具（Util：fs/path/存储/系统语言）。
 *
 * 文件系统、路径、UI、网络等引擎实现由接入包注入：
 * - patcher-cocos：Cocos Creator 实现，registerPatcherCocos() 装配并返回 IEngine 供 Patcher.start 使用。
 */
export * from "./Define";
export * from "./Util";
export * from "./Patcher";
export * from "./Localization";
export * from "./Plugin";
