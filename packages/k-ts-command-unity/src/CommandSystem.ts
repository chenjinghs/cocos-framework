import { D, F } from "k-ts-framework";
import { COMMAND_SYSTEM_TAG, CommandInfo, CommandRegistry, ICommandRouter } from "./Define";
import { constructCommandAction, registerCommandRouter, splitCommandParams, unregisterCommandRouter } from "./Util";

const K_COMMAND = CS.KFramework.KGameInstance.GetDefault().FindGameLogicWithType(puer.$typeof(CS.KCommand)) as CS.KCommand;

class ExecuteAction extends F.Action<boolean> {
    public constructor(public command: string, public param: string) {
        super();
    }
}

@D.system(COMMAND_SYSTEM_TAG)
class CommandSystem extends F.System implements ICommandRouter {
    private static execAction(command: string, param: string): boolean {
        return ExecuteAction.do(command, param) === true;
    }

    public init() {
        K_COMMAND.RegisterExecutor(CommandSystem.execAction);
        registerCommandRouter(this);
        return true;
    }

    public uninit() {
        unregisterCommandRouter(this);
        K_COMMAND.UnregisterExecutor(CommandSystem.execAction);
    }

    public route(params: string[], allInfos: Map<string, CommandInfo>): boolean {
        let info = allInfos.get(params[0]);
        if (!info) return false;

        params.shift();
        let action = constructCommandAction(info, params);
        action.doImp();
        return true;
    }

    // 注册命令行自动补全
    // private onRegisterAutoCompleteCommand(commandList: $Ref<UE.TArray<UE.AutoCompleteCommand>>) {
    //     let commandListRef = $unref(commandList);
    //     F.Env.getCurrentData(CommandRegistry).infos.forEach((info, command) => {
    //         let autoCompleteCommand = new UE.AutoCompleteCommand();
    //         autoCompleteCommand.Command = command;
    //         autoCompleteCommand.Desc = info.desc;
    //         commandListRef.Add(autoCompleteCommand);
    //     });
    // }

    @D.on()
    private onExecute(action: ExecuteAction) {
        let cmd = action.command.toLowerCase() + " " + action.param;
        return this.onDispatchCommand(cmd);
    }

    private onDispatchCommand(command: string): boolean {
        if (command.length === 0) return false;

        let params = splitCommandParams(command);
        let registry = F.Env.getCurrentData(CommandRegistry);
        let infos = registry.infos;
        for (let router of registry.routers) {
            if (router === this) continue;
            if (this.dispatchToRouter(router, command, params, infos)) return true;
        }
        // 最后再尝试分发到自己的 system 进行处理
        return this.dispatchToRouter(this, command, params, infos);
    }

    // prettier-ignore
    private dispatchToRouter(router: ICommandRouter, command: string, params: string[], infos: Map<string, CommandInfo>) {
        if (router.route(params, infos, command)) {
            this.info(`execute command [${command}] succeed`);
            return true;
        }
        return false;
    }
}
