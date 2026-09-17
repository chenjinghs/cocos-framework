import { F } from "k-ts-framework";
import { PrefabProxy } from "k-ts-framework-cocos";

/** Cocos UI 系统内部通知需要对事件进行绑定 */
export const _bindRes = F.createUtilLinker<(store: F.RStore, prefabProxy: PrefabProxy) => void>();

/** Cocos UI 系统内部通知需要对事件进行解绑 */
export const _unbindRes = F.createUtilLinker<(store: F.RStore) => void>();
