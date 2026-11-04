import { Composition } from "remotion";
import { defaultStoryProps } from "./defaultProps";
import { STORY_FPS, StoryVideo, calculateStoryMetadata } from "./StoryVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="StoryVideo"
      component={StoryVideo}
      durationInFrames={1800}
      fps={STORY_FPS}
      width={1080}
      height={1920}
      defaultProps={defaultStoryProps}
      calculateMetadata={calculateStoryMetadata}
    />
  );
};
