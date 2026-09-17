// import { D, F } from "k-ts-framework";
// import { ERPCType, IMessageWithSenderId, SENDER_ID_FIELD_NAME } from "k-ts-network";
// import { field, ValueType } from "k-ts-protobuf";

// import { COMMAND_SYSTEM_TAG, CommandInfo, CommandRegistry, ICommandRouter } from "./Define";
// import { constructCommandAction, registerCommandRouter, splitCommandParams, unregisterCommandRouter } from "./Util";

// export const SERVER_COMMAND_PREFIX = "gms";

// @D.route(ERPCType.ToServer)
// class c2d_SendCommand extends F.Action {
//     @field(ValueType.String)
//     public command: string;

//     public senderId: number = 0;

//     public constructor(command: string) {
//         super();
//         this.command = command;
//     }
// }

// @D.system(COMMAND_SYSTEM_TAG)
// class C2DCommandRouterSystem extends F.System implements ICommandRouter {
//     public init() {
//         if (F.isClient()) {
//             // 只有client才处理
//             registerCommandRouter(this);
//         }
//         return true;
//     }

//     public uninit() {
//         unregisterCommandRouter(this);
//     }

//     public route(params: string[], allInfos: Map<string, CommandInfo>, originalCommand: string): boolean {
//         if (params[0] !== SERVER_COMMAND_PREFIX || params.length < 2) return false;

//         let commandName = `${params[0]} ${params[1]}`;
//         let info = allInfos.get(commandName);
//         if (!info) return false;

//         c2d_SendCommand.do(originalCommand);
//         return true;
//     }

//     // 接收客户端rpc到服务器的GM指令
//     @D.on()
//     protected onReceiveServerCommand(action: c2d_SendCommand) {
//         let params = splitCommandParams(action.command);
//         F.assert(params[0] === SERVER_COMMAND_PREFIX);

//         let commandName = `${params[0]} ${params[1]}`;
//         let info = F.Env.getCurrentData(CommandRegistry).infos.get(commandName);
//         if (!info) return;

//         params[1] = commandName;
//         params.shift();
//         let cmdAction = constructCommandAction(info, params);
//         if (!cmdAction) return;

//         this.info(`senderId: ${action.senderId}, exec c2d command: ${action.command}`);

//         let descriptor = Object.getOwnPropertyDescriptor(cmdAction, SENDER_ID_FIELD_NAME);
//         if (descriptor) {
//             (cmdAction as unknown as IMessageWithSenderId)[SENDER_ID_FIELD_NAME] = action.senderId;
//         }
//         cmdAction.doImp();
//     }
// }
