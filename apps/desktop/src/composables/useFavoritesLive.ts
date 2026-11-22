import { computed } from "vue";
import { useFavorites, type FavoriteChannel } from "./useFavorites";
import { useLiveStatus } from "./useLiveStatus";
import { favoriteView } from "@/lib/favoriteView";

/** Live state of favorites: the status lookup the Favorites list uses, and how many are live. */
export function useFavoritesLive() {
  const { favorites } = useFavorites();
  const { statuses, getStatus } = useLiveStatus();

  const statusOf = (favorite: FavoriteChannel) => {
    // Read `statuses` so anything computed from this follows every live-status update.
    void statuses.value;
    return (
      getStatus(favorite.channel, favorite.platform) ||
      (favorite.displayName ? getStatus(favorite.displayName, favorite.platform) : null)
    );
  };
  const liveCount = computed(() => favoriteView(favorites.value, statusOf).liveCount);

  return { statusOf, liveCount };
}
