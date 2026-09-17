import { D, F } from "k-ts-framework";

import { closeWnd, openWnd } from "../framework";
import { UI_STATE_SYSTEM_TAG, UIStateStackStore } from "./Define";
import { EnterUIStateSAction, ExitUIStateSAction, PauseUIStateSAction, ResumeUIStateSAction } from "./PublicAE";
import { clearUIState, enterUIState, exitUIState, getUIStateTemplate } from "./Util";

@D.system(UI_STATE_SYSTEM_TAG, UIStateStackStore)
class UIStateSystem extends F.System {
    @D.linkUtil(enterUIState)
    protected enterUIState(stateName: string, params?: unknown) {
        let stateStack = UIStateStackStore.getSingleton().stateStack;
        let index = stateStack.findIndex((v) => v === stateName);

        if (index !== -1) {
            // 如果该 state 已经在栈顶，不做处理
            if (index === stateStack.length - 1) return;

            // 已经入栈，但不是栈顶，先进行退出
            this.exitStateImpl(index);
        }

        // 对栈顶 state 进行暂停
        this.pauseTopState();

        // 进入新的 state
        this.enterStateImpl(stateName, params);
    }

    @D.linkUtil(exitUIState)
    protected exitUIState(stateName: string) {
        let stateStack = UIStateStackStore.getSingleton().stateStack;
        let index = stateStack.findIndex((v) => v === stateName);

        // 栈中不存在该 state，不做处理
        if (index === -1) return;

        // 退出该 state
        this.exitStateImpl(index);

        // 如果移除是栈顶元素，需要恢复上一个状态
        if (index !== stateStack.length) this.resumeTopState();
    }

    @D.linkUtil(clearUIState)
    protected clearUIState() {
        let stackStore = UIStateStackStore.getSingleton();
        let stateStack = stackStore.stateStack;
        for (let i = stateStack.length - 1; i >= 0; i--) {
            this.exitStateImpl(i, false);
        }
        this.modify(stackStore, (v) => (v.stateStack = []));
    }

    private enterStateImpl(stateName: string, params?: unknown) {
        this.info(`enter state: ${stateName}`);
        let stackStore = UIStateStackStore.getSingleton();
        let stateStore = F.Store.isValidTag(stateName) ? F.createSSWithTag(stateName, stackStore) : undefined;
        F.assert(!Array.isArray(stateStore), `${stateName} is tag in many store`);

        let template = getUIStateTemplate(stateName);
        F.assert(template, `${stateName} is not register in UIStateStackStore`);
        this.modify(stackStore, (v) => v.stateStack.push(stateName));
        template.openOnEnter?.forEach((v) => openWnd(v));

        if (stateStore === undefined) return;
        F.assert(!Array.isArray(stateStore), `${stateName} is tag in many store`);
        EnterUIStateSAction.do(stateStore, params);
    }

    private exitStateImpl(index: number, isRemoveIt = true) {
        let stackStore = UIStateStackStore.getSingleton();
        let stateName = stackStore.stateStack[index];
        this.info(`exit state: ${stateName}`);
        isRemoveIt && this.modify(stackStore, (v) => v.stateStack.splice(index, 1));

        let template = getUIStateTemplate(stateName);
        F.assert(template, `${stateName} is not register in UIStateStackStore`);
        template.isCloseOnExit && template.openOnEnter?.forEach((v) => !template?.keepOnExit?.includes(v) && closeWnd(v));

        let stateStore = F.findStoreByTag(stateName);
        if (stateStore === undefined) return;
        ExitUIStateSAction.do(stateStore);
        F.destroySS(stateStore);
    }

    private pauseTopState() {
        let topStateStore = this.findTopStateStore();
        topStateStore && PauseUIStateSAction.do(topStateStore);
    }

    private resumeTopState() {
        let topStateStore = this.findTopStateStore();
        topStateStore && ResumeUIStateSAction.do(topStateStore);
    }

    private findTopStateStore() {
        let stateStack = UIStateStackStore.getSingleton().stateStack;
        let stateName = stateStack[stateStack.length - 1];
        return F.findStoreByTag(stateName);
    }
}
