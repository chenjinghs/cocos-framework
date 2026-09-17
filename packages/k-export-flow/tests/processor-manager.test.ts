import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AnyType, Manager, OutputData, Processor, createDefaultGlobalConfig, getDefaultConcurrency, parseLocalizationConfig, pushElementOrArray, setGlobalConfig } from "../src/new";

class NumberData extends OutputData {
    public constructor(public value: number) {
        super();
    }

    public override getDescription(): string {
        return `NumberData:${this.value}`;
    }
}

class CodexSeedProcessor extends Processor<CodexSeedProcessor> {
    public inputDataType = undefined;
    public outputDataType = NumberData;

    protected processSingle(): NumberData[] {
        return [new NumberData(1), new NumberData(2)];
    }
}
CodexSeedProcessor.register();

class CodexDoubleProcessor extends Processor<CodexDoubleProcessor> {
    public inputDataType = NumberData;
    public outputDataType = NumberData;
    public createdWith?: string;

    public override onCreate(): void {
        this.createdWith = this.getConfig<{ label?: string }>().label;
    }

    protected processSingle(data: NumberData): NumberData {
        return new NumberData(data.value * 2);
    }
}
CodexDoubleProcessor.register();

class CodexAnyEchoProcessor extends Processor<CodexAnyEchoProcessor> {
    public inputDataType = AnyType;
    public outputDataType = NumberData;

    protected processSingle(data: NumberData | undefined): NumberData {
        return new NumberData(data?.value ?? 10);
    }
}
CodexAnyEchoProcessor.register();

class CodexFailingProcessor extends Processor<CodexFailingProcessor> {
    public inputDataType = NumberData;
    public outputDataType = NumberData;

    protected processSingle(): NumberData {
        throw new Error("expected processor failure");
    }
}
CodexFailingProcessor.register();

function createTempDir(name: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function initLocalization(): void {
    const config = createDefaultGlobalConfig();
    setGlobalConfig(config);
    parseLocalizationConfig(config.localization);
}

test("manager util pushElementOrArray filters undefined and keeps truthy items", () => {
    const values: number[] = [];
    pushElementOrArray(values, 1);
    pushElementOrArray(values, [2, undefined, 3]);
    pushElementOrArray(values, 0);

    assert.deepEqual(values, [1, 2, 3]);
});

test("getDefaultConcurrency honors valid env, clamps max, and falls back for invalid env", () => {
    const oldValue = process.env.EXPORT_FLOW_CONCURRENCY;
    try {
        process.env.EXPORT_FLOW_CONCURRENCY = "2";
        assert.equal(getDefaultConcurrency(), 2);

        process.env.EXPORT_FLOW_CONCURRENCY = "999";
        assert.equal(getDefaultConcurrency(), 32);

        process.env.EXPORT_FLOW_CONCURRENCY = "bad";
        assert.equal(getDefaultConcurrency() >= 4, true);
        assert.equal(getDefaultConcurrency() <= 32, true);
    } finally {
        if (oldValue === undefined) {
            delete process.env.EXPORT_FLOW_CONCURRENCY;
        } else {
            process.env.EXPORT_FLOW_CONCURRENCY = oldValue;
        }
    }
});

test("Processor.processAll handles arrays, post-process order, removal, and captured failures", async () => {
    const processor = new CodexDoubleProcessor();
    processor.config = { type: "CodexDoubleProcessor", description: "double" };
    const events: string[] = [];
    const late = () => {
        events.push("late");
    };
    const early = () => {
        events.push("early");
    };

    processor.addPostProcessFunc(late, 20);
    processor.addPostProcessFunc(early, 10);
    assert.equal(processor.hasPostProcessFunc(late), true);
    processor.removePostProcessFunc(late);
    assert.equal(processor.hasPostProcessFunc(late), false);
    processor.addPostProcessFunc(late, 20);

    const outputs = await processor.processAll([new NumberData(1), new NumberData(3)]);
    assert.deepEqual(outputs.map((data) => data?.value), [2, 6]);
    assert.deepEqual(events, ["early", "late"]);
    assert.equal(processor.hasErrorOccurred(), false);

    processor.setFailed(new Error("manual"));
    assert.equal(processor.hasErrorOccurred(), true);
    assert.equal(processor.getLastError(), "manual");

    const failing = new CodexFailingProcessor();
    failing.config = { type: "CodexFailingProcessor", description: "fail" };
    assert.deepEqual(await failing.processAll([new NumberData(1)]), []);
    assert.equal(failing.hasErrorOccurred(), true);
    assert.equal(failing.getLastError(), "expected processor failure");
});

test("Manager.runProcessors chains typed processors and reports processor errors", async () => {
    initLocalization();
    const manager = Manager.getInstance();
    const seed = new CodexSeedProcessor();
    seed.config = { type: "CodexSeedProcessor", description: "seed" };
    const double = new CodexDoubleProcessor();
    double.config = { type: "CodexDoubleProcessor", description: "double" };

    const result = await manager.runProcessors([seed, double]);
    assert.deepEqual(result?.map((data) => (data as NumberData).value), [2, 4]);
    assert.equal(manager.getCurrentProcessor(), undefined);

    const failing = new CodexFailingProcessor();
    failing.config = { type: "CodexFailingProcessor", description: "fail" };
    await assert.rejects(() => manager.runProcessors([seed, failing]), /expected processor failure/);

    await Manager.destroy();
});

test("Manager.run creates pipeline from YAML, replaces args, processes env, and stores pending cache writes", async () => {
    const root = createTempDir("k-export-flow-manager-");
    const yamlPath = path.join(root, "pipeline.yml");
    fs.writeFileSync(yamlPath, [
        "env:",
        "  - resolvedPath: \"$rootPath/output\"",
        "processors:",
        "  - type: CodexAnyEchoProcessor",
        "    description: any seed",
        "  - type: CodexDoubleProcessor",
        "    description: double",
        "    label: \"$label\"",
        "    enabled: \"$!skipDouble\"",
    ].join("\n"), "utf-8");

    const manager = Manager.getInstance();
    await manager.run(yamlPath, new Map<string, string>([
        ["rootPath", root],
        ["label", "created"],
        ["skipDouble", "false"],
    ]));

    assert.equal(manager.hasFinished(), true);
    assert.equal(manager.getLastError(), undefined);
    assert.equal(manager.getAdditionalArg("resolvedPath"), `${root}/output`);
    assert.equal((manager.findProcessor("CodexDoubleProcessor") as CodexDoubleProcessor | undefined)?.createdWith, "created");

    const writes: string[] = [];
    manager.setPendingCacheWrite("same", async () => {
        writes.push("old");
    });
    manager.setPendingCacheWrite("same", async () => {
        writes.push("new");
    });
    await manager.flushPendingCacheWrites();
    assert.deepEqual(writes, ["new"]);

    manager.setPendingCacheWrite("failing", async () => {
        throw new Error("cache write failed");
    });
    manager.setPendingCacheWrite("after-failing", async () => {
        writes.push("after");
    });
    await assert.rejects(() => manager.flushPendingCacheWrites(), /cache write failed/);
    assert.deepEqual(writes, ["new", "after"]);

    const infoDir = path.join(root, "cache");
    fs.mkdirSync(infoDir, { recursive: true });
    manager.setPendingIncrementBuildInfo(new Map([["a.xlsx", { hash: "1", csvFiles: ["a.csv"] }]]), infoDir);
    await manager.flushPendingIncrementBuildInfo();
    assert.match(fs.readFileSync(path.join(infoDir, "export-csv-increment-info.json"), "utf-8"), /a\.xlsx/);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("Manager.run records errors when throwError is false and rejects invalid pipelines", async () => {
    initLocalization();
    const root = createTempDir("k-export-flow-manager-fail-");
    const noProcessorYaml = path.join(root, "empty.yml");
    const invalidProcessorYaml = path.join(root, "invalid.yml");
    fs.writeFileSync(noProcessorYaml, "processors: []\n", "utf-8");
    fs.writeFileSync(invalidProcessorYaml, [
        "processors:",
        "  - type: MissingCodexProcessor",
        "    description: missing",
    ].join("\n"), "utf-8");

    const manager = Manager.getInstance();
    await assert.rejects(
        () => manager.run(noProcessorYaml, new Map<string, string>([["rootPath", root]]), false),
        /pipeline\.yml has no processors/,
    );

    await assert.rejects(
        () => manager.run(invalidProcessorYaml, new Map<string, string>([["rootPath", root]])),
        /create-processor-failed|MissingCodexProcessor/,
    );

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});
