import { IEngine, IPlugin } from "./Define";

export const plugin: IPlugin = {
    start: async (_: IEngine) => {
        console.log(`no plugin`);
    },
};
