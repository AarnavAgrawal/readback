import sampleProps from "./fixtures/sample-props.json";
import type { RenderProps } from "./types";

/**
 * Default props for Studio. Real renders always pass --props / inputProps.
 * Kept free of any public/ lookup: Git doesn't store an empty public/ folder,
 * and the sandbox renderer can't copy a bundle that has one.
 */
export const defaultStoryProps = sampleProps as RenderProps;
