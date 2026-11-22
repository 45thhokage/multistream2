import { createSharedComposable, useStorage } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { toast } from "./useToast";
import { useStreams, type Platform } from "./useStreams";

/** One stream of a preset: enough to open it again. */
export interface PresetStream {
  channel: string;
  platform: Platform;
  iframeUrl?: string;
  displayName?: string;
  handle?: string;
}

/**
 * A preset saves a lineup, not a tile (adapted from Multi Worldview's presets, MIT): every stream
 * in the workspace, in tile order, added back together.
 */
export interface Preset {
  id: string;
  name: string;
  streams: PresetStream[];
  pinned?: boolean;
  createdAt: number;
}

const _usePresets = () => {
  const { t } = useI18n();
  const presets = useStorage<Preset[]>("presets", []);
  const { activeStreams, addStream, streamPageUrl } = useStreams();

  /** Save the current workspace's streams as a preset. A website keeps the page it is on. */
  const saveCurrent = (name: string): Preset | null => {
    const streams: PresetStream[] = activeStreams.value.map((s) => {
      const entry: PresetStream = { channel: s.channel, platform: s.platform };
      const url = s.platform === "custom" ? streamPageUrl(s.id) || s.iframeUrl : s.iframeUrl;
      if (url) entry.iframeUrl = url;
      if (s.displayName) entry.displayName = s.displayName;
      if (s.handle) entry.handle = s.handle;
      return entry;
    });
    if (streams.length === 0) return null;
    const preset: Preset = {
      id: `preset-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
      name: name.trim().slice(0, 60) || t("sidebarSections.presets.defaultName"),
      streams,
      createdAt: Date.now(),
    };
    presets.value = [preset, ...presets.value];
    return preset;
  };

  /** Add every stream of a preset to the current workspace, in order. */
  const apply = (id: string): number => {
    const preset = presets.value.find((p) => p.id === id);
    if (!preset) return 0;
    let added = 0;
    for (const s of preset.streams) {
      if (addStream(s.channel, s.platform, s.iframeUrl, s.displayName, s.handle)) added++;
    }
    if (added > 0)
      toast.success(t("sidebarSections.presets.applied", { name: preset.name, count: added }));
    return added;
  };

  const rename = (id: string, name: string) => {
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    presets.value = presets.value.map((p) => (p.id === id ? { ...p, name: clean } : p));
  };

  const togglePin = (id: string) => {
    presets.value = presets.value.map((p) => {
      if (p.id !== id) return p;
      if (!p.pinned) return { ...p, pinned: true };
      const { pinned: _unpinned, ...rest } = p;
      return rest;
    });
  };

  const remove = (id: string) => {
    presets.value = presets.value.filter((p) => p.id !== id);
  };

  return { presets, saveCurrent, apply, rename, togglePin, remove };
};

export const usePresets = createSharedComposable(_usePresets);
