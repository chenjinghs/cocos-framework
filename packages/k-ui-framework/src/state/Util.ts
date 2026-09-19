import { F } from "k-ts-framework";

import { IUIStateTemplate } from "./Define.js";

/**
 * 获取 UI State 配置信息(项目实现)
 * @param uiTag
 * @returns
 */
export const getUIStateTemplate = F.createUtilLinker<(state: string) => IUIStateTemplate>();

export const enterUIState = F.createUtilLinker<<T = unknown>(stateName: string, params?: T) => void>();

export const exitUIState = F.createUtilLinker<(stateName: string) => void>();

export const clearUIState = F.createUtilLinker<() => void>();
