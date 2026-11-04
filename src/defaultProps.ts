import sampleProps from "./fixtures/sample-props.json";
import type { RenderProps } from "./types";

/**
 * Default props for Studio and for `npx remotion render StoryVideo` without --props.
 * Uses the pipeline's output at public/stories/5627999/render-props.json once it exists
 * (a context module, so a missing file is not a build error), else the synthetic fixture.
 */
const pipelineOutput = import.meta.webpackContext("../public", {
  recursive: true,
  regExp: /^\.\/stories\/5627999\/render-props\.json$/,
});

const PIPELINE_KEY = "./stories/5627999/render-props.json";

export const defaultStoryProps: RenderProps = pipelineOutput.keys().includes(PIPELINE_KEY)
  ? (pipelineOutput(PIPELINE_KEY) as RenderProps)
  : (sampleProps as RenderProps);
