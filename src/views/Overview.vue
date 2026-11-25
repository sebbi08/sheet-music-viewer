<template>
  <div class="overview">
    <div class="container">
      <v-card @click="goToFolders()">
        <v-icon x-large>mdi-folder</v-icon>
        <h2 class="itemName">Folder Selection</h2>
      </v-card>
      <v-card @click="goToSetLists()">
        <v-icon x-large>mdi-bookmark-music</v-icon>
        <h2 class="itemName">Set Lists</h2>
      </v-card>
    </div>

    <!-- Favorites (spec 2026-11-25 „Startseite“): shown when loaded; the cards above never wait for them. -->
    <h2 class="text-h6 favoritesHeading">Favoriten</h2>
    <p v-if="favorites.listError !== null" class="favoritesNote" data-testid="favorites-error">
      {{ favorites.listError }}
    </p>
    <div v-else-if="favorites.list.length > 0" class="container">
      <v-card v-for="favorite in favorites.list" :key="favorite.key" data-testid="favorite-card"
        @click="openFavorite(favorite)">
        <!-- Unmarks without opening the sheet; the card goes at once. -->
        <v-btn class="favoriteToggle" data-testid="favorite-toggle" icon variant="text" size="small" color="red"
          @click.stop="unmark(favorite)">
          <v-icon>mdi-heart</v-icon>
        </v-btn>
        <v-icon x-large>mdi-file</v-icon>
        <h4 class="itemName favoriteName">{{ favorite.name }}</h4>
        <h5 class="itemName favoriteDir">{{ favorite.dir }}</h5>
      </v-card>
    </div>
    <p v-else-if="loaded" class="favoritesNote" data-testid="favorites-empty">
      Noch keine Favoriten. Markiere Blätter mit dem Herz.
    </p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouteNames } from '../Enums';
import router from '../router';
import type { FavoriteSheet } from '../sheetSettings';
import { useFavorites } from '../store/favorites';

const favorites = useFavorites();
/** The hint waits for the first load of this visit (the list may still be empty because it was not read yet). */
const loaded = ref(false);

// `loadList` assigns a new list (or an error) after its first read, before the background search ends.
watch(() => [favorites.list, favorites.listError], () => {
  loaded.value = true;
});

onMounted(() => {
  void favorites.loadList().finally(() => {
    loaded.value = true;
  });
});

function goToSetLists(): void {
  router.push({ name: RouteNames.SetListList });
}

function goToFolders(): void {
  router.push({ name: RouteNames.SheetSelection });
}

function openFavorite(favorite: FavoriteSheet): void {
  router.push({ name: RouteNames.SheetViewer, params: { path: favorite.pdfPath } });
}

/** A card is shown only for a favorite, so the state before the press is "marked". */
function unmark(favorite: FavoriteSheet): void {
  void favorites.set(favorite.pdfPath, false, true);
}

</script>
<style lang="less" scoped>
.overview {
  max-height: calc(100vh - 32px - 64px);
  overflow: auto;
}

.container {
  width: auto;
  display: flex;
  flex-wrap: wrap;

  .v-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
    margin: 16px;
    width: calc(25% - 32px);

    @media (max-width: 960px) {
      width: calc(33% - 32px);
    }

    @media (max-width: 700px) {
      width: calc(50% - 32px);
    }

    @media (max-width: 400px) {
      width: calc(100% - 32px);
    }
  }
}

.favoritesHeading {
  margin: 8px 16px 0;
}

.favoritesNote {
  margin: 8px 16px;
}

.favoriteToggle {
  position: absolute;
  top: 4px;
  right: 4px;
}

.itemName {
  word-break: break-word;
  text-align: center;
}
</style>
