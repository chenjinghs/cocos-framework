import { UI_SYSTEM_TAGS } from "k-ui-framework";

export const COCOS_UI_SYSTEM_TAG = "CocosUISystemTag";

export const UI_SYSTEM_TAGS_FOR_COCOS = [...UI_SYSTEM_TAGS, COCOS_UI_SYSTEM_TAG];

/** 面板 prefab 在 resources 下的路径前缀，约定为 resources/ui/<uiTag>.prefab */
export const UI_PANEL_PREFIX = "ui/";

/** UIRoot 节点名（挂在场景 Canvas 下） */
export const UI_ROOT_NAME = "UIRoot";
