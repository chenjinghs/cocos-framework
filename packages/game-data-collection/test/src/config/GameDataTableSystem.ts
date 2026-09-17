import { ConfigUtil } from "game-data-collection";
import { D, F } from "k-ts-framework";

import { GAME_DATA_TABLE_SYSTEM_TAG } from "./Define";

const jsonConfigFileList: string[] = ["client/ui"];

@D.system(GAME_DATA_TABLE_SYSTEM_TAG)
class GameDataTableSystem extends F.System {
    public init() {
        console.log("GameDataTableSystem init");
        return ConfigUtil.loadJsonDataTable(jsonConfigFileList);
    }

    public uninit() {
        console.log("GameDataTableSystem uninit");
        return ConfigUtil.unloadJsonDataTable(jsonConfigFileList);
    }
}
