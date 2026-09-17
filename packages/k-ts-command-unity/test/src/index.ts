import { COMMAND_SYSTEM_TAG } from "k-ts-command";
import { F } from "k-ts-framework";
import { PROTOBUF_SYSTEM_TAG } from "k-ts-protobuf";
import { RPC_SYSTEM_TAG } from "k-ts-network";
import "./CommandAE";
import "./TestCommandSystem";

const IMMORTAL_SYSTEM_TAGS = [COMMAND_SYSTEM_TAG, RPC_SYSTEM_TAG, PROTOBUF_SYSTEM_TAG];

F.System.createByTag(IMMORTAL_SYSTEM_TAGS);
