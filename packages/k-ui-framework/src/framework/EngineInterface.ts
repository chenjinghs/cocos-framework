/**
 * 扩展引擎实现时需要实现的接口
 */

import { F } from "k-ts-framework";

import { RUIStore, UIResType } from "./Define";

export namespace UIEngineInterface {
    /** 获取一个 UI 对应的引擎资源 */
    export const _findUIRes = F.createUtilLinker<<T extends UIResType>(uiStore: RUIStore) => T | undefined>();

    export const _loadUIResAsync = F.createUtilLinker<<T extends UIResType>(uiStore: RUIStore, parent?: T, callback?: (res: T) => void) => void>();

    /** 卸载引擎资源 */
    export const _unloadUIRes = F.createUtilLinker<(uiStore: RUIStore, immediatelyDestroy?: boolean) => void>();

    /** 绑定引擎资源到 UIStore 上 */
    export const _bindUIRes = F.createUtilLinker<<T extends UIResType>(uiStore: RUIStore, uiRes: T) => void>();

    /** 从 UIStore 上解绑引擎资源 */
    export const _unbindUIRes = F.createUtilLinker<(uiStore: RUIStore) => void>();

    /** 将 UIStore 对应资源添加到屏幕上 */
    export const _addToScreen = F.createUtilLinker<(uiStore: RUIStore, sortingOrder: number) => void>();

    /** 将 UIStore 对应资源从屏幕上移除 */
    export const _removeFromScreen = F.createUtilLinker<(uiStore: RUIStore) => void>();

    /** 修改 UIStore 对应资源的层级 */
    export const _modifySortingOrder = F.createUtilLinker<(uiStore: RUIStore, sortingOrder: number) => void>();
}
