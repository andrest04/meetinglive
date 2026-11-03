// Node loader hook that lets a child process run the repo's TypeScript: tries `.ts` and
// `/index.ts` for extensionless relative imports. Used with --experimental-transform-types.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw error;
    for (const suffix of ['.ts', '/index.ts']) {
      try {
        return await nextResolve(specifier + suffix, context);
      } catch {
        // try the next candidate
      }
    }
    throw error;
  }
}
