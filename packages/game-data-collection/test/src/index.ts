import { DATA_TABLE_SYSTEM_TAG } from "game-data-collection";
import { F } from "k-ts-framework";

import { GAME_DATA_TABLE_SYSTEM_TAG } from "./config";
import { getTemplate } from "./config/util/UIDataTable";

F.System.createByTag([DATA_TABLE_SYSTEM_TAG, GAME_DATA_TABLE_SYSTEM_TAG]);

let template = getTemplate(1);
console.log(`dataTable load template : id: ${template?.id}, name: ${template?.name}`);
