import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    let candidate;
    if (specifier.startsWith('@/')) candidate = path.join(root, specifier.slice(2));
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (candidate) {
      for (const suffix of ['', '.ts', '.tsx', '.mjs', '/index.ts']) {
        if (existsSync(candidate + suffix) && path.extname(candidate + suffix)) {
          return { url: pathToFileURL(candidate + suffix).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (/\.tsx?$/.test(url)) {
      const filename = fileURLToPath(url);
      const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        fileName: filename,
      });
      return { format: 'module', source: output.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
