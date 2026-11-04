"use client";

import dynamic from "next/dynamic";
import type { StoryPlayerProps } from "./StoryPlayer";

const StoryPlayer = dynamic(() => import("./StoryPlayer"), {
  ssr: false,
  loading: () => <div className="player-loading">Loading video…</div>,
});

/** A story's Player in a 9:16 frame. */
export function PhonePlayer({ className, ...props }: StoryPlayerProps & { className?: string }) {
  return (
    <figure className={`phone ${className ?? ""}`} aria-label={`Video: ${props.story.title}`}>
      <div className="phone-screen">
        <StoryPlayer {...props} />
      </div>
    </figure>
  );
}
