import { effectScope, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamMixer } from "../useStreamMixer";

vi.mock("../useWorkspaces", () => ({
  useWorkspaces: () => ({ activeWorkspaceId: { value: "one" } }),
}));

describe("stream mixer", () => {
  let scope: EffectScope;
  let mixer: ReturnType<typeof useStreamMixer>;
  beforeEach(() => {
    localStorage.clear();
    scope = effectScope();
    scope.run(() => {
      mixer = useStreamMixer();
    });
  });
  afterEach(() => scope.stop());

  it("multiplies channel and master volume", () => {
    // Arrange
    mixer.workspace().volume = 50;
    mixer.channel("a").volume = 80;
    // Act
    const audio = mixer.effectiveAudio("a", "one", ["a"]);
    // Assert
    expect(audio).toEqual({ volume: 0.4, muted: false });
  });

  it("solos multiple channels without changing their mute state", () => {
    // Arrange
    mixer.channel("a").solo = true;
    mixer.channel("b").solo = true;
    // Act
    const states = ["a", "b", "c"].map((id) => mixer.effectiveAudio(id, "one", ["a", "b", "c"]));
    // Assert
    expect(states.map((state) => state.muted)).toEqual([false, false, true]);
    expect(mixer.channel("c").muted).toBe(false);
  });

  it("ignores removed solo channels and isolates workspace controls", () => {
    // Arrange
    mixer.channel("removed").solo = true;
    mixer.workspace().muted = true;
    // Act
    const other = mixer.effectiveAudio("b", "two", ["b"]);
    mixer.workspace().muted = false;
    const current = mixer.effectiveAudio("a", "one", ["a"]);
    // Assert
    expect(other.muted).toBe(false);
    expect(current.muted).toBe(false);
  });

  it("changes audio focus only for the selected interaction mode", () => {
    // Arrange
    mixer.workspace().mode = "hover";
    const ids = ["a", "b"];
    // Act
    mixer.interact("b", "click");
    const before = ids.map((id) => mixer.effectiveAudio(id, "one", ids).muted);
    mixer.interact("b", "hover");
    const after = ids.map((id) => mixer.effectiveAudio(id, "one", ids).muted);
    // Assert
    expect(before).toEqual([false, true]);
    expect(after).toEqual([true, false]);
    expect(mixer.channel("a").muted).toBe(false);
  });

  it("retains manual focus until explicitly changed", () => {
    // Arrange
    mixer.workspace().mode = "manual";
    mixer.focusAudio("b");
    // Act
    mixer.interact("a", "hover");
    mixer.interact("a", "click");
    // Assert
    expect(mixer.effectiveAudio("a", "one", ["a", "b"]).muted).toBe(true);
    expect(mixer.effectiveAudio("b", "one", ["a", "b"]).muted).toBe(false);
  });

  it("restores multi-source audio after all-muted without changing channel settings", () => {
    // Arrange
    mixer.workspace().mode = "all-muted";
    mixer.channel("a").volume = 60;
    mixer.channel("b").muted = true;
    // Act
    const silent = mixer.effectiveAudio("a", "one", ["a", "b"]);
    mixer.workspace().mode = "multi";
    // Assert
    expect(silent).toEqual({ volume: 0.6, muted: true });
    expect(mixer.effectiveAudio("a", "one", ["a", "b"])).toEqual({ volume: 0.6, muted: false });
    expect(mixer.effectiveAudio("b", "one", ["a", "b"]).muted).toBe(true);
  });

  it("falls back to a remaining stream when the audio-focused stream is removed", () => {
    // Arrange
    mixer.workspace().mode = "click";
    mixer.focusAudio("removed");
    // Act
    const audio = mixer.effectiveAudio("a", "one", ["a", "b"]);
    // Assert
    expect(audio.muted).toBe(false);
    expect(mixer.effectiveAudio("b", "one", ["a", "b"]).muted).toBe(true);
  });
});
