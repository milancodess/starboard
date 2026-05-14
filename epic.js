async function getEpicFreeGames() {
  try {
    const response = await fetch(
      "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=NP&allowCountries=NP",
      {
        headers: {
          accept: "application/json, text/plain, */*",
          Referer: "https://store.epicgames.com/",
        },
      },
    );

    const data = await response.json();

    const games = data?.data?.Catalog?.searchStore?.elements
      ?.filter((game) => game.title && game.price)
      ?.map((game) => {
        const promotions = game.promotions;
        let status = "Not Free";
        let discountPercentage = 0;
        let isFree = false;

        if (
          game.price?.totalPrice?.discountPrice === 0 ||
          game.price?.totalPrice?.fmtPrice?.discountPrice === "0"
        ) {
          isFree = true;
          status = "Free Now";
        } else if (promotions?.promotionalOffers?.length > 0) {
          const currentOffers =
            promotions.promotionalOffers[0]?.promotionalOffers || [];
          if (currentOffers.length > 0) {
            status = "On Sale";
            discountPercentage =
              currentOffers[0]?.discountSetting?.discountPercentage || 0;
            if (discountPercentage === 100) {
              status = "Free Now";
              isFree = true;
            }
          }
        } else if (promotions?.upcomingPromotionalOffers?.length > 0) {
          const upcomingOffers =
            promotions.upcomingPromotionalOffers[0]?.promotionalOffers || [];
          if (upcomingOffers.length > 0) {
            status = "Upcoming Sale";
            discountPercentage =
              upcomingOffers[0]?.discountSetting?.discountPercentage || 0;
            if (discountPercentage === 100) {
              status = "Upcoming Free";
            }
          }
        }

        let thumbnail = null;
        if (game.keyImages) {
          const wideImage = game.keyImages.find(
            (img) =>
              img.type === "DieselStoreFrontWide" ||
              img.type === "OfferImageWide",
          );
          thumbnail = wideImage?.url || game.keyImages[0]?.url;
        }

        let slug = null;
        if (game.catalogNs?.mappings && game.catalogNs.mappings.length > 0) {
          slug = game.catalogNs.mappings[0]?.pageSlug;
        } else if (game.offerMappings && game.offerMappings.length > 0) {
          slug = game.offerMappings[0]?.pageSlug;
        } else if (
          game.productSlug &&
          game.productSlug !== "[]" &&
          game.productSlug !== "null"
        ) {
          slug = game.productSlug;
        } else if (game.urlSlug) {
          slug = game.urlSlug;
        }

        let originalPrice = "N/A";
        let currentPrice = "N/A";

        if (game.price?.totalPrice?.fmtPrice) {
          originalPrice = game.price.totalPrice.fmtPrice.originalPrice || "N/A";
          currentPrice =
            game.price.totalPrice.fmtPrice.discountPrice || originalPrice;
        }

        return {
          title: game.title,
          description: game.description || "No description available",
          status,
          isFree,
          originalPrice,
          currentPrice: isFree ? "Free" : currentPrice,
          discountPercentage:
            discountPercentage > 0 ? `${discountPercentage}%` : null,
          slug,
          thumbnail,
          categories: game.categories?.map((c) => c.path) || [],
          seller: game.seller?.name || "Unknown",
          effectiveDate: game.effectiveDate,
        };
      });

    const freeGames = games?.filter((game) => game.isFree) || [];
    const onSaleGames =
      games?.filter((game) => !game.isFree && game.status !== "Not Free") || [];
    const isDropped = freeGames.some(
      (g) => new Date(g.effectiveDate) <= Date.now() && g.status === "Free Now",
    );

    return { allGames: games, freeGames, onSaleGames, isDropped };
  } catch (err) {
    console.error("Error fetching Epic Games:", err);
    return null;
  }
}

module.exports = { getEpicFreeGames };
