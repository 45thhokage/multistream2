import { createSharedComposable, useStorage } from "@vueuse/core";
import { DEFAULT_LAYOUT } from "@/config/layouts";

export type SidebarTab =
  | "streams"
  | "layout"
  | "following"
  | "favorites"
  | "presets"
  | "history"
  | "workspaces";

export interface Preferences {
  selectedChat: string;
  sidebarOpen: boolean;
  followedSidebarOpen: boolean;
  notificationsEnabled: boolean;
  onboardingCompleted: boolean;
  pendingChangelogVersion: string;

  recordingQuality: string;
  recordingPath: string;
  nativePlayerEnabled: boolean;
  adblockEnabled: boolean;
  immersiveModeEnabled: boolean;
  fitVideoAuto: boolean;
  tabbedSidebar: boolean;
  sidebarTab: SidebarTab;
  streamLayout: string;
}

const defaultPreferences: Preferences = {
  selectedChat: "",
  sidebarOpen: true,
  followedSidebarOpen: false,
  notificationsEnabled: true,
  onboardingCompleted: false,
  pendingChangelogVersion: "",

  recordingQuality: "best",
  recordingPath: "",
  nativePlayerEnabled: false,
  adblockEnabled: true,
  immersiveModeEnabled: false,
  fitVideoAuto: true,
  tabbedSidebar: false,
  sidebarTab: "following",
  streamLayout: DEFAULT_LAYOUT,
};

const _usePreferences = () => {
  /**
   * @brief Selected chat
   */
  const selectedChat = useStorage<string>(
    "preferences.selectedChat",
    defaultPreferences.selectedChat
  );

  /**
   * @brief Sidebar open state
   */
  const sidebarOpen = useStorage<boolean>(
    "preferences.sidebarOpen",
    defaultPreferences.sidebarOpen
  );

  /**
   * @brief Followed channels sidebar open state
   */
  const followedSidebarOpen = useStorage<boolean>(
    "preferences.followedSidebarOpen",
    defaultPreferences.followedSidebarOpen
  );

  /**
   * @brief Notifications enabled
   */
  const notificationsEnabled = useStorage<boolean>(
    "preferences.notificationsEnabled",
    defaultPreferences.notificationsEnabled
  );

  /**
   * @brief Onboarding completed state
   */
  const onboardingCompleted = useStorage<boolean>(
    "preferences.onboardingCompleted",
    defaultPreferences.onboardingCompleted
  );

  const pendingChangelogVersion = useStorage<string>(
    "preferences.pendingChangelogVersion",
    defaultPreferences.pendingChangelogVersion
  );

  const recordingQuality = useStorage<string>(
    "preferences.recordingQuality",
    defaultPreferences.recordingQuality
  );

  const recordingPath = useStorage<string>(
    "preferences.recordingPath",
    defaultPreferences.recordingPath
  );

  const nativePlayerEnabled = useStorage<boolean>(
    "preferences.nativePlayerEnabled",
    defaultPreferences.nativePlayerEnabled
  );

  const adblockEnabled = useStorage<boolean>(
    "preferences.adblockEnabled",
    defaultPreferences.adblockEnabled
  );

  const immersiveModeEnabled = useStorage<boolean>(
    "preferences.immersiveModeEnabled",
    defaultPreferences.immersiveModeEnabled
  );
  /** Fit a website tile's video to the tile when the viewer presses play in it. */
  const fitVideoAuto = useStorage<boolean>(
    "preferences.fitVideoAuto",
    defaultPreferences.fitVideoAuto
  );
  /** Left sidebar shows one section at a time from a strip of icon tabs. */
  const tabbedSidebar = useStorage<boolean>(
    "preferences.tabbedSidebar",
    defaultPreferences.tabbedSidebar
  );
  const sidebarTab = useStorage<SidebarTab>(
    "preferences.sidebarTab",
    defaultPreferences.sidebarTab
  );
  const streamLayout = useStorage<string>(
    "preferences.streamLayout",
    defaultPreferences.streamLayout
  );

  /**
   * @brief Set the selected chat
   *
   * @param chatId The chat ID
   * @return void
   */
  const setSelectedChat = (chatId: string) => {
    selectedChat.value = chatId;
  };

  const setRecordingQuality = (quality: string) => {
    recordingQuality.value = quality;
  };

  const setRecordingPath = (path: string) => {
    recordingPath.value = path;
  };

  const setAdblockEnabled = (enabled: boolean) => {
    adblockEnabled.value = enabled;
  };

  const setImmersiveModeEnabled = (enabled: boolean) => {
    immersiveModeEnabled.value = enabled;
  };

  const toggleImmersiveMode = () => {
    immersiveModeEnabled.value = !immersiveModeEnabled.value;
  };

  /**
   * @brief Toggle the sidebar
   *
   * @return void
   */
  const toggleSidebar = () => {
    sidebarOpen.value = !sidebarOpen.value;
  };

  /**
   * @brief Set the sidebar open state
   *
   * @param open The open state
   * @return void
   */
  const setSidebarOpen = (open: boolean) => {
    sidebarOpen.value = open;
  };

  /**
   * @brief Toggle the followed channels sidebar
   *
   * @return void
   */
  const toggleFollowedSidebar = () => {
    followedSidebarOpen.value = !followedSidebarOpen.value;
  };

  /**
   * @brief Set the followed channels sidebar open state
   *
   * @param open The open state
   * @return void
   */
  const setFollowedSidebarOpen = (open: boolean) => {
    followedSidebarOpen.value = open;
  };

  /**
   * @brief Set the onboarding completed state
   *
   * @param completed The completed state
   * @return void
   */
  const setOnboardingCompleted = (completed: boolean) => {
    onboardingCompleted.value = completed;
  };

  const setPendingChangelogVersion = (version: string) => {
    pendingChangelogVersion.value = version;
  };

  /**
   * @brief Reset the preferences to default
   *
   * @return void
   */
  const resetPreferences = () => {
    selectedChat.value = defaultPreferences.selectedChat;
    sidebarOpen.value = defaultPreferences.sidebarOpen;
    followedSidebarOpen.value = defaultPreferences.followedSidebarOpen;
    notificationsEnabled.value = defaultPreferences.notificationsEnabled;
    onboardingCompleted.value = defaultPreferences.onboardingCompleted;
    pendingChangelogVersion.value = defaultPreferences.pendingChangelogVersion;

    recordingQuality.value = defaultPreferences.recordingQuality;
    recordingPath.value = defaultPreferences.recordingPath;
    nativePlayerEnabled.value = defaultPreferences.nativePlayerEnabled;
    adblockEnabled.value = defaultPreferences.adblockEnabled;
    immersiveModeEnabled.value = defaultPreferences.immersiveModeEnabled;
    fitVideoAuto.value = defaultPreferences.fitVideoAuto;
    tabbedSidebar.value = defaultPreferences.tabbedSidebar;
    sidebarTab.value = defaultPreferences.sidebarTab;
    streamLayout.value = defaultPreferences.streamLayout;
  };

  return {
    // state
    selectedChat,
    sidebarOpen,
    followedSidebarOpen,
    notificationsEnabled,
    onboardingCompleted,
    pendingChangelogVersion,

    recordingQuality,
    recordingPath,
    nativePlayerEnabled,
    adblockEnabled,
    immersiveModeEnabled,
    fitVideoAuto,
    tabbedSidebar,
    sidebarTab,
    streamLayout,

    // actions
    setSelectedChat,
    toggleSidebar,
    setSidebarOpen,
    toggleFollowedSidebar,
    setFollowedSidebarOpen,
    setOnboardingCompleted,
    setPendingChangelogVersion,
    setRecordingQuality,
    setRecordingPath,
    setAdblockEnabled,
    setImmersiveModeEnabled,
    toggleImmersiveMode,
    resetPreferences,
  };
};

export const usePreferences = createSharedComposable(_usePreferences);
