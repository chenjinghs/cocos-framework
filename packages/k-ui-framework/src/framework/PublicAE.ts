import { F } from "k-ts-framework";

import { UITagType } from "./Define";

/**
 * UI 控件/界面被隐藏事件
 */
export class OnWidgetBoundSEvent<P = undefined, T extends {} = {}> extends F.StoreEvent {
    public constructor(public owner: F.RStore, public widget: T, public readonly params: P extends undefined ? undefined : P) {
        super();
    }
}

/**
 * UI 控件/界面被显示事件
 */
export class OnWidgetUnboundSEvent<P = undefined> extends F.StoreEvent {
    public constructor(public readonly params: P extends undefined ? undefined : P) {
        super();
    }
}

/**
 * UI 界面预开启逻辑，可在这个时候向逻辑系统预载网络数据
 * @param params 预开启参数
 * @returns
 */
export class OnWndPreOpenSAction<P = undefined> extends F.StoreAction {
    public constructor(public readonly params: P extends undefined ? undefined : P) {
        super();
    }
}

/**
 * UI 界面预关闭逻辑，可在这个时候播放关闭动画逻辑
 * @param params 预关闭参数
 * @returns
 */
export class OnWndPreCloseSAction<P = undefined> extends F.StoreAction {
    public constructor(public readonly params: P extends undefined ? undefined : P) {
        super();
    }
}

/**
 * UI 界面提前 close，触发于 UI 还没完全打开就要关闭
 * @param params 预关闭参数
 * @returns
 */
export class OnWndAheadCloseSAction<P = undefined> extends F.StoreAction {
    public constructor(public readonly params: P extends undefined ? undefined : P) {
        super();
    }
}

/**
 * UI 界面打开事件
 * @param params 打开参数
 */
export class OnWndOpenedSEvent<P = undefined> extends F.StoreEvent {
    public constructor(public readonly params: P extends undefined ? undefined : P) {
        super();
    }
}

/**
 * UI 界面关闭事件
 * @param params 关闭参数
 */
export class OnWndCloseSEvent<P = undefined> extends F.StoreEvent {
    public constructor(public readonly params: P extends undefined ? undefined : P) {
        super();
    }
}

/**
 * UI 界面被压栈事件
 */
export class OnWndPausedSEvent extends F.StoreEvent {
    public constructor(public newTop: UITagType) {
        super();
    }
}

/**
 * UI 界面被弹出栈事件
 */
export class OnWndResumedSEvent extends F.StoreEvent {
    public constructor(public lastTop: UITagType) {
        super();
    }
}

/**
 * UI 界面被压栈事件
 */
export class OnWndPausedEvent extends F.Event {
    public constructor(public uiTag: UITagType, public newTop: UITagType) {
        super();
    }
}

/**
 * UI 界面被弹出栈事件
 */
export class OnWndResumedEvent extends F.Event {
    public constructor(public uiTag: UITagType, public lastTop: UITagType) {
        super();
    }
}

/**
 * UI 界面界面打开（晚于 UI 自身的 OnWndOpenedSEvent）
 */
export class OnWndOpenedEvent<P = undefined> extends F.Event {
    public constructor(public uiTag: UITagType, public readonly params: P extends undefined ? undefined : P) {
        super();
    }
}

/**
 * UI 界面界面关闭（早于 UI 自身的 OnWndCloseSEvent）
 */
export class OnWndCloseEvent<P = undefined> extends F.Event {
    public constructor(public uiTag: UITagType, public readonly params: P extends undefined ? undefined : P) {
        super();
    }
}

/**
 * UI 界面栈顶变化事件（每帧末触发）
 */
export class OnWndStackTopChangedEvent extends F.Event {
    public constructor(public currentTop?: UITagType, public lastTop?: UITagType) {
        super();
    }
}
