/**
 * 框架内所有引擎触点的唯一收口：其余模块只允许从本模块取 cc。
 * 测试通过 tsconfig paths 把 "cc" 指到 fake 实现即可整体注入。
 */
import * as cc from "cc";

export { cc };
