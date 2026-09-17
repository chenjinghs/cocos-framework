import { D, F } from "k-ts-framework";

import { DataTableTemplateInfo } from "../data-table";
import { GAME_DATA_COLLECTION_SYSTEM, GameDataInfoRegistry } from "../Define";
import { _LoadAllTemplateEvent, _UnloadAllTemplateEvent } from "../PrivateAE";
import { getContentRootPath } from "../Util";
import { JSON_DATA_TYPE, JsonData } from "./Define";
import { fetchJsonData, parseJson, setJsonLoadFunc } from "./Util";

@D.store()
class JsonDataRootStore extends F.SingletonStore {
    public pathToData = new Map<string, JsonData>();
    public loadFunc?: (path: string) => any;
}

@D.system(GAME_DATA_COLLECTION_SYSTEM, JsonDataRootStore)
class JsonDataTableSystem extends F.System {
    @D.on()
    public onLoad(event: _LoadAllTemplateEvent) {
        let store = JsonDataRootStore.getSingleton();
        let registry = F.Env.getCurrentData(GameDataInfoRegistry);
        let infos = registry.typeToInfos.get(JSON_DATA_TYPE);
        if (!infos || infos.length === 0) return;

        this.modify(store, (v) => {
            let tag = event.tag;
            let info: DataTableTemplateInfo;

            for (let i of infos!) {
                info = i as DataTableTemplateInfo;
                if (info.tag !== tag || v.pathToData.has(info.path)) continue;

                let obj = this.loadJsonData(info.path);
                if (!obj) {
                    this.error(`load json data failed: ${info.path}`);
                    continue;
                }

                let data = new JsonData(info, obj);
                v.pathToData.set(info.path, data);
            }
        });
    }

    @D.on()
    public onUnload(event: _UnloadAllTemplateEvent) {
        let store = JsonDataRootStore.getSingleton();
        let registry = F.Env.getCurrentData(GameDataInfoRegistry);
        let infos = registry.typeToInfos.get(JSON_DATA_TYPE);
        if (!infos || infos.length === 0) return;

        this.modify(store, (v) => {
            let tag = event.tag;
            let info: DataTableTemplateInfo;

            for (let i of infos!) {
                info = i as DataTableTemplateInfo;
                if (info.tag !== tag) continue;

                let data = v.pathToData.get(info.path);
                if (data) data.obj = undefined;
                v.pathToData.delete(info.path);
            }
        });
    }

    public uninit() {
        let store = JsonDataRootStore.getSingleton();
        this.modify(store, (v) => {
            let pathToData = v.pathToData;
            v.pathToData = new Map<string, JsonData>();
            for (let data of pathToData.values()) {
                data.obj = undefined;
            }
        });
    }

    @D.linkUtil(fetchJsonData)
    public onFetch(path: string) {
        let store = JsonDataRootStore.getSingleton();
        let ret = store.pathToData.get(path);
        if (ret) return ret;

        let registry = F.Env.getCurrentData(GameDataInfoRegistry);
        let infos = registry.typeToInfos.get(JSON_DATA_TYPE);
        if (!infos || infos.length === 0) return;

        this.modify(store, (v) => {
            let info = infos!.find((v) => (v as DataTableTemplateInfo).path === path) as DataTableTemplateInfo;
            if (!info) return;

            let obj = this.loadJsonData(path);
            if (!obj) return;

            ret = new JsonData(info, obj);
            v.pathToData.set(path, ret);
        });

        if (!ret) {
            this.error(`load json data failed: ${path}`);
        }
        return ret;
    }

    @D.linkUtil(setJsonLoadFunc)
    public setLoadFunc(func?: (path: string) => any) {
        this.modify(JsonDataRootStore.getSingleton(), (v) => {
            v.loadFunc = func;
        });
    }

    // @D.linkUtil(setJsonDataExtraDataKey)
    // public setExtraDataKey(key?: string) {
    //     this.modify(JsonDataRootStore.getSingleton(), (v) => {
    //         v.extraDataKey = key ?? DEFAULT_EXTRA_DATA_KEY;
    //     });
    // }

    // @D.linkUtil(setJsonDataMapMarker)
    // public setMapMarker(marker?: string) {
    //     this.modify(JsonDataRootStore.getSingleton(), (v) => {
    //         v.mapMarker = marker ?? DEFAULT_MAP_MARKER;
    //     });
    // }

    // @D.linkUtil(setJsonDataBigIntMarker)
    // public setBigIntMarker(marker?: string) {
    //     this.modify(JsonDataRootStore.getSingleton(), (v) => {
    //         v.bigintMarker = marker ?? DEFAULT_BIGINT_MARKER;
    //     });
    // }

    private verifyTag(tag?: string) {
        return tag ?? JSON_DATA_TYPE;
    }

    private getFullPath(filePath: string) {
        return CS.System.IO.Path.Combine(getContentRootPath(), filePath);
    }

    private loadJsonData(path: string): any {
        let fullPath = this.getFullPath(path);
        let store = JsonDataRootStore.getSingleton();

        let loadFunc = store.loadFunc;
        if (loadFunc) return loadFunc(fullPath);
        else return parseJson(fullPath);
    }
}
