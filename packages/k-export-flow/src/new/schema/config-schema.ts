import { z } from "zod";

const ProcessorTypeSchema = z.object({
    type: z.string(),
}).passthrough();

export const RootConfigSchema = z.object({
    env: z.array(z.record(z.string(), z.string())).optional(),
    processors: z.array(ProcessorTypeSchema),
}).passthrough();
