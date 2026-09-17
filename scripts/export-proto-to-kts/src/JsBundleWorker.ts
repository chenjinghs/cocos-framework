import { parentPort, workerData } from "node:worker_threads";

import { loadRoot } from "./RootLoader";
import { generateStaticJsBundle } from "./StaticJsBundleGenerator";

const { protoRootPath, protoFiles } = workerData as { protoRootPath: string; protoFiles: string[] };
const root = loadRoot(protoRootPath, protoFiles);
parentPort!.postMessage(generateStaticJsBundle(root));
