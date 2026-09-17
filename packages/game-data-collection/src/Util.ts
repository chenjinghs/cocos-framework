import { F } from "k-ts-framework";

import { GameDataInfo, GameDataInfoRegistry } from "./Define";
import { _LoadAllTemplateEvent, _UnloadAllTemplateEvent } from "./PrivateAE";

export function registerTemplateInfo(type: symbol, info: GameDataInfo) {
    let typeToInfos = F.Env.getCurrentData(GameDataInfoRegistry).typeToInfos;
    let infos = typeToInfos.get(type);
    if (!infos) {
        infos = new Array<GameDataInfo>();
        typeToInfos.set(type, infos);
    }

    infos.push(info);
}

export const setContentRootPath = F.createUtilLinker<(path: string) => void>();
export const getContentRootPath = F.createUtilLinker<() => string>();

export function loadAllTemplates(tag?: string) {
    _LoadAllTemplateEvent.dispatch(tag);
}

export function unloadAllTemplates(tag?: string) {
    _UnloadAllTemplateEvent.dispatch(tag);
}
