import { COMMAND_SYSTEM_TAG, getCommandSenderId } from "k-ts-command";
import { D, F } from "k-ts-framework";

import { Foobar3Action, FoobarAction } from "./CommandAE";

@D.system(COMMAND_SYSTEM_TAG)
class TestCommandSystem extends F.System {
    @D.on()
    protected onFoobarAction(action: FoobarAction) {
        this.info(`exec FoobarAction`);
        this.info(`param 1: ${typeof action.foo} ${action.foo}`);
        this.info(`param 2: ${typeof action.bar} ${action.bar}`);
        this.info(`param 3: ${typeof action.baz} ${action.baz}`);
        this.info(`senderId: ${getCommandSenderId(action)}`);
    }

    @D.on()
    protected onFoobar3Action(action: Foobar3Action) {
        this.info(`exec Foobar3Action`);
        this.info(`param 1: ${typeof action.foo} ${action.foo}`);
        this.info(`param 2: ${typeof action.bar} ${action.bar}`);
        this.info(`param 3: ${typeof action.baz} ${action.baz}`);
        this.info(`senderId: ${getCommandSenderId(action)}`);
    }
}
