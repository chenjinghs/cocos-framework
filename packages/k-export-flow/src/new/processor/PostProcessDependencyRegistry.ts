import * as fs from "fs";
import * as path from "path";
import { globSync } from "glob";
import * as yaml from "yaml";
import { DataPostProcess } from "./PostProcess";

// ─── YAML 结构类型 ───

interface IYamlCsvGroup {
    name: string;
    includeRegex: string[];
}

interface IYamlProcessorDecl {
    name: string;
    file?: string;
    description?: string;
    readsTables?: string[];
    alwaysRun?: boolean;
    csvGroups?: IYamlCsvGroup[];
}

interface IYamlConfig {
    version: number;
    globalProcessors: IYamlProcessorDecl[];
}

// ─── 依赖注册表 ───

/**
 * 后处理器依赖声明注册表。
 *
 * 职责：
 * 1. 从 YAML 加载处理器→表的依赖声明
 * 2. 构建反向依赖图（表→哪些处理器依赖它）
 * 3. 校验 TS 注册时声明的依赖是否与 YAML 一致
 * 4. 计算传递闭包：给定被改的表，返回所有需要重导出的表
 * 5. 检测循环依赖
 * 6. 导出依赖图为 Markdown
 */
export class PostProcessDependencyRegistry {
    // processor name → readsTables
    private processorToTables = new Map<string, string[]>();
    // processor name → alwaysRun
    private processorToAlwaysRun = new Set<string>();
    // processor name → file path
    private processorToFile = new Map<string, string>();
    // processor name → description
    private processorToDescription = new Map<string, string>();
    // processor name → csvGroups (compiled regexes, flat)
    private processorToCsvGroupRegexes = new Map<string, RegExp[]>();
    // table name → set of processor names that read it (反向依赖图)
    private reverseGraph = new Map<string, Set<string>>();
    // ts file path (relative to export-flow src dir) → processor names
    private fileToProcessors = new Map<string, string[]>();
    // processor key → 引用它的表（csv basename，小写）—— 来自各表 yaml 的 additionalDataPostProcess 引用
    private processorToReferencingTables = new Map<string, Set<string>>();
    // 是否已加载
    private loaded = false;

    // ─── 加载 ───

    /**
     * 从 YAML 文件加载后处理器依赖声明。
     * 构建 processor→tables 映射和反向依赖图。
     */
    public loadYamlDeclarations(yamlPath: string): void {
        if (!fs.existsSync(yamlPath)) {
            throw new Error(`Post-process deps YAML not found: ${yamlPath}`);
        }

        const content = fs.readFileSync(yamlPath, "utf-8");
        const config: IYamlConfig = yaml.parse(content);

        if (!config.globalProcessors || !Array.isArray(config.globalProcessors)) {
            throw new Error("Invalid YAML: missing globalProcessors array");
        }

        // 清空旧数据
        this.processorToTables.clear();
        this.processorToAlwaysRun.clear();
        this.processorToFile.clear();
        this.processorToDescription.clear();
        this.processorToCsvGroupRegexes.clear();
        this.reverseGraph.clear();
        this.fileToProcessors.clear();

        for (const decl of config.globalProcessors) {
            if (!decl.name) {
                throw new Error("Invalid YAML: processor missing 'name' field");
            }

            const tables = decl.readsTables ?? [];
            this.processorToTables.set(decl.name, tables);
            if (decl.description) {
                this.processorToDescription.set(decl.name, decl.description);
            }
            if (decl.alwaysRun) {
                this.processorToAlwaysRun.add(decl.name);
            }
            if (decl.csvGroups) {
                const regexes = decl.csvGroups.flatMap((g) => g.includeRegex.map((r) => new RegExp(r)));
                this.processorToCsvGroupRegexes.set(decl.name, regexes);
            }

            // 构建反向依赖图: table → set of processors
            for (const table of tables) {
                let dependents = this.reverseGraph.get(table);
                if (!dependents) {
                    dependents = new Set<string>();
                    this.reverseGraph.set(table, dependents);
                }
                dependents.add(decl.name);
            }
        }

        this.loaded = true;
    }

    /**
     * 从 DataPostProcess 中同步暂存的 callerFile 信息。
     * 在 injectDependencyRegistry 中调用，用于补全模块加载阶段（registry 尚未初始化）
     * 已注册的 processor 文件映射。
     */
    public loadPendingProcessorFiles(): void {
        const pending = DataPostProcess.getPendingProcessorFiles();
        for (const [processorName, callerFile] of pending) {
            if (!callerFile) continue;
            this.registerProcessorFile(callerFile, processorName);
        }
        DataPostProcess.clearPendingProcessorFiles();

        // 单表后处理器（registerDataPostProcess）
        const pendingSingle = DataPostProcess.getPendingSingleTableFiles();
        for (const [key, callerFile] of pendingSingle) {
            this.registerSingleTableProcessor(key, callerFile);
        }
        DataPostProcess.clearPendingSingleTableFiles();
    }

    private registerProcessorFile(callerFile: string, processorName: string): void {
        this.processorToFile.set(processorName, callerFile);
        const procs = this.fileToProcessors.get(callerFile) ?? [];
        if (!procs.includes(processorName)) procs.push(processorName);
        this.fileToProcessors.set(callerFile, procs);
    }

    /**
     * 注册单表后处理器（registerDataPostProcess）的依赖信息。
     * 单表 processor 的 key 即表名，依赖表就是自身：
     * 1. 建立 file → processor 映射，使 TS 变更能被增量哈希检测（detectChangedProcessors）捕获；
     * 2. 补一条 self-table 映射（key → [key]），让 TS 变更能通过 readsTables 反查到对应 CSV、触发该表重导。
     * 不要求在 post-process-deps.yml 声明（YAML 仅约束 registerAllDataPostProcess）。
     */
    public registerSingleTableProcessor(key: string, callerFile: string): void {
        if (callerFile) this.registerProcessorFile(callerFile, key);
        if (!this.processorToTables.has(key)) {
            this.processorToTables.set(key, [key]);
        }
    }

    /**
     * 扫描各表的单表导出 yaml 配置，提取 additionalDataPostProcess(.key) 引用，
     * 建立 processorKey → 引用它的表（csv basename，小写）映射。
     *
     * 用途（增量）：EnumExporter / ServerDataPostProcess 这类“通用后处理器”靠各表
     * yaml 的 additionalDataPostProcess.key 挂载，真实依赖只存在于这些 yaml 引用里，
     * 无法靠表名启发式反查。TS 变更检测据此精确重导所有引用它的表。
     */
    public loadAdditionalPostProcessReferences(configRootDir: string): void {
        this.processorToReferencingTables.clear();
        if (!configRootDir || !fs.existsSync(configRootDir)) return;

        const files = globSync(path.join(configRootDir, "**/*.yml").replaceAll("\\", "/"), { nodir: true });
        for (const file of files) {
            let parsed: unknown;
            try {
                parsed = yaml.parse(fs.readFileSync(file, "utf-8"));
            } catch {
                continue;
            }
            const keys = PostProcessDependencyRegistry.collectAdditionalPostProcessKeys(parsed);
            if (keys.length === 0) continue;

            // yaml 文件名（去扩展名）即对应 csv 的 basename
            const tableBaseName = path.basename(file).replace(/\.ya?ml$/i, "").toLowerCase();
            for (const key of keys) {
                let set = this.processorToReferencingTables.get(key);
                if (!set) {
                    set = new Set<string>();
                    this.processorToReferencingTables.set(key, set);
                }
                set.add(tableBaseName);
            }
        }
    }

    private static collectAdditionalPostProcessKeys(config: any): string[] {
        if (!config || typeof config !== "object") return [];
        const result: string[] = [];
        const pushKey = (entry: any) => {
            if (entry && typeof entry === "object" && typeof entry.key === "string") result.push(entry.key);
        };
        pushKey(config.additionalDataPostProcess);
        if (Array.isArray(config.additionalDataPostProcessList)) {
            for (const entry of config.additionalDataPostProcessList) pushKey(entry);
        }
        return result;
    }

    /**
     * 查询通过 yaml additionalDataPostProcess 引用了指定 processor 的表（csv basename，小写集合）。
     */
    public getReferencingTableBaseNames(processorKey: string): Set<string> {
        return this.processorToReferencingTables.get(processorKey) ?? new Set<string>();
    }

    // ─── 校验与注册 ───

    /**
     * TS 代码注册处理器时校验依赖声明。
     * 检查:
     * 1. processorName 是否在 YAML 中声明
     * 2. readsTables 是否与 YAML 声明完全匹配
     * 不匹配则 throw Error。
     */
    public validateAndRegister(processorName: string, callerFile?: string): void {
        if (!this.loaded) {
            throw new Error("YAML declarations not loaded. Call loadYamlDeclarations() first.");
        }

        if (!this.processorToTables.has(processorName)) {
            throw new Error(
                `Processor "${processorName}" is not declared in YAML. ` +
                `All registerAllDataPostProcess processors must be declared in post-process-deps.yml.`,
            );
        }

        if (callerFile) {
            this.registerProcessorFile(callerFile, processorName);
        }
    }

    // ─── 查询 ───

    /**
     * 查询哪些处理器依赖指定的表。
     * 返回所有声明了 readsTables 包含 tableName 的处理器名集合。
     */
    public getDependents(tableName: string): Set<string> {
        return this.reverseGraph.get(tableName) ?? new Set<string>();
    }

    /**
     * 检查处理器是否声明了读取指定表。
     */
    public isDeclared(processor: string, table: string): boolean {
        const tables = this.processorToTables.get(processor);
        return tables !== undefined && tables.includes(table);
    }

    /**
     * 检查处理器是否标记为 alwaysRun。
     */
    public hasAlwaysRun(processor: string): boolean {
        return this.processorToAlwaysRun.has(processor);
    }

    /**
     * 获取反向依赖图（表 → 依赖它的处理器集合）。
     */
    public getReverseGraph(): Map<string, Set<string>> {
        return new Map(this.reverseGraph);
    }

    // ─── 传递闭包 ───

    /**
     * 给定被改的表集合，返回所有需要重新导出的表（包括传递依赖）。
     *
     * 算法: BFS 迭代实现
     * 1. 从 changedTables 出发，找到所有依赖这些表的处理器
     * 2. 这些处理器读取的所有表也加入结果
     * 3. 重复直到没有新表加入
     */
    public computeTransitiveClosure(changedTables: Set<string>): Set<string> {
        const result = new Set<string>(changedTables);
        const queue: string[] = Array.from(changedTables);
        let head = 0;

        while (head < queue.length) {
            const table = queue[head++];

            // 找到依赖这个表的所有处理器
            const dependents = this.reverseGraph.get(table);
            if (!dependents) continue;

            // 这些处理器读取的所有表也需要重导出
            for (const processor of dependents) {
                const tables = this.processorToTables.get(processor);
                if (!tables) continue;

                for (const t of tables) {
                    if (!result.has(t)) {
                        result.add(t);
                        queue.push(t);
                    }
                }
            }
        }

        return result;
    }

    // ─── 循环依赖检测 ───

    /**
     * 检测处理器间的循环依赖。
     *
     * 构建 processor→processor 有向图（A reads B 的表 → A 依赖 B），
     * 使用 DFS + 三色标记法检测有向环。
     */
    public detectCycles(): Array<string[]> {
        const processorNames = new Set(this.processorToTables.keys());

        // Directed: A depends on B if A reads a table named B
        const adj = new Map<string, Set<string>>();
        for (const [processor, tables] of this.processorToTables) {
            const deps = new Set<string>();
            for (const table of tables) {
                if (processorNames.has(table) && table !== processor) {
                    deps.add(table);
                }
            }
            adj.set(processor, deps);
        }

        const WHITE = 0;
        const GRAY = 1;
        const BLACK = 2;

        const color = new Map<string, number>();
        for (const node of adj.keys()) {
            color.set(node, WHITE);
        }

        const cycles: Array<string[]> = [];
        const seenCycles = new Set<string>();

        for (const startNode of adj.keys()) {
            if (color.get(startNode) !== WHITE) continue;

            const stack: Array<{ node: string; neighbors: string[]; idx: number; path: string[] }> = [];
            stack.push({ node: startNode, neighbors: Array.from(adj.get(startNode) ?? []), idx: 0, path: [startNode] });
            color.set(startNode, GRAY);

            while (stack.length > 0) {
                const frame = stack[stack.length - 1];

                if (frame.idx >= frame.neighbors.length) {
                    color.set(frame.node, BLACK);
                    stack.pop();
                    continue;
                }

                const neighbor = frame.neighbors[frame.idx];
                frame.idx++;

                const neighborColor = color.get(neighbor) ?? WHITE;

                if (neighborColor === GRAY) {
                    const path = frame.path;
                    const cycleStart = path.indexOf(neighbor);
                    if (cycleStart >= 0) {
                        const cycle = path.slice(cycleStart);
                        const normalized = this.normalizeCycle(cycle);
                        const key = normalized.join(" → ");
                        if (!seenCycles.has(key)) {
                            seenCycles.add(key);
                            cycles.push(normalized);
                        }
                    }
                } else if (neighborColor === WHITE) {
                    color.set(neighbor, GRAY);
                    stack.push({
                        node: neighbor,
                        neighbors: Array.from(adj.get(neighbor) ?? []),
                        idx: 0,
                        path: [...frame.path, neighbor],
                    });
                }
            }
        }

        return cycles;
    }

    /**
     * 标准化循环: 旋转使字典序最小元素开头，便于去重。
     */
    private normalizeCycle(cycle: string[]): string[] {
        if (cycle.length === 0) return cycle;

        let minIdx = 0;
        for (let i = 1; i < cycle.length; i++) {
            if (cycle[i] < cycle[minIdx]) {
                minIdx = i;
            }
        }

        return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
    }

    // ─── 导出 ───

    /**
     * 导出依赖关系图为 Markdown 表格。
     */
    public exportDependencyGraph(): string {
        const lines: string[] = [
            "# Post-Process Dependency Graph",
            "",
            "| Processor | File | Description | Reads Tables | Always Run |",
            "|-----------|------|-------------|--------------|------------|",
        ];

        for (const [name, tables] of this.processorToTables) {
            const file = this.processorToFile.get(name) ?? "";
            const desc = this.processorToDescription.get(name) ?? "";
            const alwaysRun = this.processorToAlwaysRun.has(name) ? "Yes" : "No";
            const tablesStr = tables.length > 0 ? tables.join(", ") : "_none_";

            lines.push(`| ${name} | ${file} | ${desc} | ${tablesStr} | ${alwaysRun} |`);
        }

        lines.push("");
        lines.push("## Reverse Dependencies (Table → Processors)");
        lines.push("");
        lines.push("| Table | Dependent Processors |");
        lines.push("|-------|---------------------|");

        for (const [table, processors] of this.reverseGraph) {
            lines.push(`| ${table} | ${Array.from(processors).join(", ")} |`);
        }

        return lines.join("\n");
    }

    // ─── 辅助查询 ───

    /**
     * 获取所有已声明的处理器名。
     */
    public getAllProcessors(): string[] {
        return Array.from(this.processorToTables.keys());
    }

    /**
     * 获取处理器的依赖表列表。
     */
    public getProcessorTables(processor: string): string[] | undefined {
        return this.processorToTables.get(processor);
    }

    /**
    /**
     * 获取处理器的 csvGroups 匹配规则（已编译为 RegExp[]）。
     * 返回 undefined 表示未声明（不限制 CSV）；返回空数组表示声明了但无规则。
     */
    public getProcessorCsvGroupRegexes(processorName: string): RegExp[] | undefined {
        return this.processorToCsvGroupRegexes.get(processorName);
    }

    /**
     * 获取处理器在 YAML 中声明的 TS 文件路径（相对于 export-flow src 目录）。
     */
    public getProcessorFile(processorName: string): string | undefined {
        return this.processorToFile.get(processorName);
    }

    /**
     * 根据 TS 文件路径（相对于 export-flow src 目录）查找对应的处理器名列表。
     */
    public getProcessorNamesByFile(relFilePath: string): string[] {
        return this.fileToProcessors.get(relFilePath) ?? [];
    }

    /**
     * 返回所有在 YAML 中声明了 TS 文件路径的 [file, processors] 条目。
     */
    public getAllProcessorFiles(): Map<string, string[]> {
        return new Map(this.fileToProcessors);
    }
}
