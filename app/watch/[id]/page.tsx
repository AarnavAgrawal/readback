import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getStoryProps, listStories } from "../../../server/demo";
import { WatchView } from "./WatchView";

type Params = { params: Promise<{ id: string }> };

const loadProps = cache(async (id: string) => {
  if (!/^\d+$/.test(id)) return null;
  try {
    return await getStoryProps(id);
  } catch (err) {
    console.error(`[watch] could not load props for ${id}`, err);
    return null;
  }
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const props = await loadProps(id);
  return {
    title: props ? `${props.title} | Readback` : "Video not found | Readback",
    description: props ? `“${props.hook}” ${props.airportName}, ${props.dateLine}.` : undefined,
  };
}

export default async function WatchPage({ params }: Params) {
  const { id } = await params;
  const props = await loadProps(id);
  if (!props) notFound();

  const summary = (await listStories().catch(() => [])).find((s) => s.eventId === id) ?? null;
  return <WatchView story={props} summary={summary} />;
}
