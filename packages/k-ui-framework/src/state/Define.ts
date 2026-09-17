import { D, F } from "k-ts-framework";

export const UI_STATE_SYSTEM_TAG = "UIStateSystemTag";

export interface IUIStateTemplate {
    /** 进入 State 时会自动打开这些 Tag 对应的 UI */
    openOnEnter?: string[];
    /** 退出时清理 openOnEnter */
    isCloseOnExit?: boolean;
    /** 清理 Wnd 时保留以下 Tag 对应的 UI */
    keepOnExit?: string[];
}

@D.store(UI_STATE_SYSTEM_TAG)
export class UIStateStackStore extends F.SingletonStore {
    public stateStack: string[] = [];
}
