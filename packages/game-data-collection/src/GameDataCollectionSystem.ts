import { D, F } from "k-ts-framework";

import { GAME_DATA_COLLECTION_SYSTEM } from "./Define";
import { getContentRootPath, setContentRootPath } from "./Util";

@D.store()
class GameDataCollectionStore extends F.SingletonStore {
    public contentPath: string = "";
}

@D.system(GAME_DATA_COLLECTION_SYSTEM, GameDataCollectionStore)
class GameDataCollectionSystem extends F.System {
    @D.linkUtil(setContentRootPath)
    public setContentPath(path: string) {
        this.modify(GameDataCollectionStore.getSingleton(), (v) => {
            v.contentPath = path;
        });
    }

    @D.linkUtil(getContentRootPath)
    public getContentPath() {
        return GameDataCollectionStore.getSingleton().contentPath;
    }
}