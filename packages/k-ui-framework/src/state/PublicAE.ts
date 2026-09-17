import { F } from "k-ts-framework";

export class EnterUIStateSAction<T=unknown> extends F.StoreAction {
    public constructor(public readonly params?: T) {
        super();
    }
}
export class ExitUIStateSAction extends F.StoreAction {}
export class PauseUIStateSAction extends F.StoreAction {}
export class ResumeUIStateSAction extends F.StoreAction {}
