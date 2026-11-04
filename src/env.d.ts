// rspack/webpack context modules (used to pick up pipeline output when it exists).
interface ImportMeta {
  webpackContext(
    request: string,
    options?: { recursive?: boolean; regExp?: RegExp },
  ): {
    keys(): string[];
    (id: string): unknown;
  };
}
