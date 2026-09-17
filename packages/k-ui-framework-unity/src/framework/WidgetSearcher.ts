import { F } from "k-ts-framework";
import { GameObjectUtil } from "k-ts-framework-unity";

import { GetUIContainerTransform } from "./Util";

export interface IWidgetSearcherElement {
    /** GameObject 名字 */
    name: string;
    /** GameObject 序号，从 1 开始 */
    index?: number;
    /** 列表中元素序号，从 1 开始 */
    list_index?: number;
    /** 是否强制重建 widgetTree */
    force_rebuild?: boolean;
}

export enum EWidgetSearcherFailedReason {
    WndNotFound,
    WidgetNotFound,
    WidgetTreeNotFound,
    ListCellNotFound,
}

export type WidgetSearcherType = IWidgetSearcherElement[];
export type WidgetSearcherOutParams = { failedReason?: EWidgetSearcherFailedReason; failedSection?: number };
export type WidgetSearcherOptions = { withoutLog?: boolean; withAssert?: boolean; out?: WidgetSearcherOutParams; skipForceRebuild?: boolean };

const CSWidgetTreeComponent = CS.KingSoft.UI.WidgetTreeComponent;
const CSLoopScrollView = CS.KingSoft.UI.LoopScrollView;

export namespace WidgetSearcher {
    export function find<T = CS.UnityEngine.Transform>(elements: WidgetSearcherType, options?: WidgetSearcherOptions): T | undefined {
        F.assert(elements.length > 0, `findWidgetTransWithElements: elements.length must > 0`);

        let rootTrans: CS.UnityEngine.Transform = GetUIContainerTransform();
        let trans = rootTrans;
        for (let i = 0; i < elements.length; i++) {
            let element = elements[i];
            if (trans === rootTrans) {
                let newTrans = trans.Find(element.name);
                if (newTrans === undefined || newTrans === null) {
                    handleFailed(EWidgetSearcherFailedReason.WndNotFound, `cannot find wnd[${element.name}] in UIRoot`, i, elements, options);
                    return undefined;
                }
                trans = newTrans;
            } else {
                let widgetTree = GameObjectUtil.findComponent(trans, CSWidgetTreeComponent);
                if (widgetTree === undefined || widgetTree === null) {
                    handleFailed(EWidgetSearcherFailedReason.WidgetTreeNotFound, `cannot find WTC in widget[${trans.name}]`, i, elements, options);
                    return undefined;
                }
                if (element.force_rebuild && options?.skipForceRebuild !== true) widgetTree.MarkTreeDirty();
                let newTrans = widgetTree.FindTransform(element.name, (element.index ?? 1) - 1);
                if (newTrans === undefined || newTrans === null) {
                    handleFailed(EWidgetSearcherFailedReason.WidgetNotFound, `cannot find widget[${element.name}][${element.index}] in WTC[${trans.name}]`, i, elements, options);
                    return undefined;
                }
                trans = newTrans;
            }
            if (element.list_index !== undefined) {
                let scrollView = GameObjectUtil.getComponent(trans, CSLoopScrollView);
                if (scrollView === undefined || scrollView === null) {
                    handleFailed(EWidgetSearcherFailedReason.WidgetNotFound, `cannot find LoopScrollView in [${trans.name}][${element.index}]`, i, elements, options);
                    return undefined;
                }
                let cellObject = scrollView.GetCellObjectByIndex(element.list_index - 1);
                let newTrans = cellObject?.transform;
                if (newTrans === undefined || newTrans === null) {
                    handleFailed(EWidgetSearcherFailedReason.ListCellNotFound, `cannot find cell[${element.list_index}] in [${trans.name}]`, i, elements, options);
                    return undefined;
                }
                trans = newTrans;
            }
        }
        return trans as T;
    }

    export function get<T = CS.UnityEngine.Transform>(elements: WidgetSearcherType): T {
        return find<T>(elements, { withAssert: true }) as T;
    }

    export function genUniqueKey(elements: WidgetSearcherType) {
        return elements.map((v) => `${v.name}&${v.index}&${v.list_index}`).join("_");
    }

    export function getWndName(elements: WidgetSearcherType) {
        return elements.at(0)?.name ?? "";
    }

    export function isSame(a: WidgetSearcherType, b: WidgetSearcherType) {
        return genUniqueKey(a) === genUniqueKey(b);
    }
}

function handleFailed(failedReason: EWidgetSearcherFailedReason, msg: string, section: number, elements: WidgetSearcherType, options?: WidgetSearcherOptions) {
    options?.withAssert && F.assert(false, `[WidgetSearcher] ${msg}, section: ${section + 1}, elements:${JSON.stringify(elements)}`);
    options?.withoutLog !== true && console.warn(`[WidgetSearcher] ${msg}, section: ${section + 1}, elements:${JSON.stringify(elements)}`);

    if (options?.out === undefined) return;
    options.out.failedReason = failedReason;
    options.out.failedSection = section;
}
