# @wytcab/projection-core

[![npm](https://img.shields.io/npm/v/@wytcab/projection-core.svg)](https://www.npmjs.com/package/@wytcab/projection-core)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

Framework primitives for cognitive-primitive lenses. The shared core that powers [`@wytcab/nousboot`](https://github.com/wytcab/nousboot) and a small family of forthcoming tools.

## What this is

A "lens" is a transformation applied to a corpus you already have, producing a structured cognitive primitive: a pre-flight briefing, a spec compression, a pre-mortem, a multi-projection rendering. Each lens is a single-file `Lens<TConfig, TOutput>` implementation. This package supplies the interface, the corpus shape, the provider abstraction, and the output schema.

Each lens ships in four wrappers from one logic core:

- CLI binary
- MCP server
- Paperclip extension
- Claude Code skill

This package is consumed by all of them.

## Status

Pre-1.0. Interface stable enough to build against; expect minor breaking changes before 1.0.

## Install

```bash
npm install @wytcab/projection-core
# or
pnpm add @wytcab/projection-core
```

## Use

```typescript
import type {
  Corpus,
  Lens,
  LensConfig,
  LensOutput,
} from "@wytcab/projection-core";

export const myLens: Lens = {
  name: "my-lens",
  version: "0.1.0",
  description: "Does a thing.",

  async run(corpus: Corpus, config: LensConfig): Promise<LensOutput> {
    const start = Date.now();
    const response = await config.provider.generate({
      model: config.model,
      messages: [{ role: "user", content: "..." }],
    });
    return {
      markdown: response.text,
      meta: {
        lensName: "my-lens",
        lensVersion: "0.1.0",
        model: response.model,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        costUsd: response.costUsd,
        durationMs: Date.now() - start,
        generatedAt: new Date(),
      },
    };
  },
};
```

See [`src/lens.ts`](./src/lens.ts) for the full contract.

## Privacy

This package and any lens built on it does not phone home. No telemetry. Your data and your LLM calls stay between you and your chosen provider.

## License

MIT. Copyright (c) 2026 Vilhelm Drosjer.
