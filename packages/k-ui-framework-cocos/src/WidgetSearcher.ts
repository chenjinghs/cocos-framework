import { F } from "k-ts-framework";
import { cc } from "k-ts-framework-cocos";

export enum EWidgetSearcherFailedReason {
    NotFound,
    Inactive,
}

export interface IWidgetSearcherOutParams {
    failedReason?: EWidgetSearcherFailedReason;
    /** 查找失败所在的路径段 */
    failedSegment?: string;
}

export interface IWidgetSearcherOptions {
    withoutLog?: boolean;
    withAssert?: boolean;
    out?: IWidgetSearcherOutParams;
}

/**
 * 按路径在节点子树中查找控件，路径形如 "panel/btn_ok/title"。
 * 找不到返回 undefined 并记录 NotFound；找到但节点未激活返回 undefined 并记录 Inactive。
 */
export function findWidget(root: cc.Node, path: string, options?: IWidgetSearcherOptions): cc.Node | undefined {
    F.assert(path.trim().length > 0, `findWidget: path must not be empty`);

    let segments = path.split("/").filter((v) => v.length > 0);
    let current: cc.Node | null = root;
    for (let segment of segments) {
        current = current.getChildByName(segment);
        if (current === null) {
            handleFailed(EWidgetSearcherFailedReason.NotFound, `cannot find widget[${segment}], path: ${path}`, segment, options);
            return undefined;
        }
    }

    if (!current.activeInHierarchy) {
        handleFailed(EWidgetSearcherFailedReason.Inactive, `widget[${path}] is inactive`, segments[segments.length - 1] as string, options);
        return undefined;
    }

    return current;
}

/** 查找控件（带断言） */
export function getWidget(root: cc.Node, path: string): cc.Node {
    return findWidget(root, path, { withAssert: true }) as cc.Node;
}

function handleFailed(failedReason: EWidgetSearcherFailedReason, msg: string, segment: string, options?: IWidgetSearcherOptions) {
    options?.withAssert === true && F.assert(false, `[WidgetSearcher] ${msg}`);
    options?.withoutLog !== true && console.warn(`[WidgetSearcher] ${msg}`);

    if (options?.out === undefined) return;
    options.out.failedReason = failedReason;
    options.out.failedSegment = segment;
}
